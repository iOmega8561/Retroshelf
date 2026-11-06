import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { MEDIA_EXTENSIONS } from '../util/mime.js';
import { extensionOf, normalizeReferencedPath, resolveInside, stripExtension } from '../util/paths.js';
import { SET_EXTENSIONS, resolveDiscSet } from './discsets.js';
import { parseGamelist, sortKey, splitGenres, type GamelistEntry } from './gamelist.js';
import type { SystemDef } from './systems.js';

export interface FileRef {
  /** POSIX path relative to the scanned root (system folder or bios folder). */
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

export type MediaKind = 'cover' | 'screenshot' | 'titlescreen' | 'marquee' | 'fanart' | 'video';

export interface GameRecord {
  id: string;
  folder: string;
  name: string;
  sortName: string;
  /** Primary file first, followed by disc-set members. */
  files: FileRef[];
  description?: string;
  developer?: string;
  publisher?: string;
  genres?: string[];
  releaseDate?: string;
  year?: number;
  players?: string;
  rating?: number;
  /** Media paths relative to the system folder. */
  media: Partial<Record<MediaKind, string>>;
}

export interface SystemScan {
  folder: string;
  absDir: string;
  games: GameRecord[];
  /** Every servable media file referenced by a game (relative to the system folder). */
  mediaFiles: Set<string>;
}

export interface ScanOptions {
  maxDepth: number;
  followSymlinks: boolean;
  showHidden: boolean;
  maxGamelistBytes: number;
  makeId: (folder: string, rel: string) => string;
  log: Logger;
}

/** Folders that hold artwork, not games. Matched case-insensitively at the top of a system folder. */
const MEDIA_DIRS: Record<string, MediaKind | 'mix' | 'other'> = {
  covers: 'cover', boxart: 'cover', box2dfront: 'cover', boxfront: 'cover',
  screenshots: 'screenshot', snaps: 'screenshot', snap: 'screenshot',
  titlescreens: 'titlescreen', titles: 'titlescreen',
  marquees: 'marquee', wheel: 'marquee', wheels: 'marquee', logos: 'marquee',
  fanart: 'fanart',
  videos: 'video',
  miximages: 'mix', mixart: 'mix',
  images: 'other', '3dboxes': 'other', backcovers: 'other', physicalmedia: 'other', manuals: 'other',
};
const MEDIA_PARENT_DIRS = new Set(['media', 'downloaded_media']);

/** Never treat these as games when a system has no explicit extension list. */
const NON_ROM_EXTENSIONS = new Set([
  'xml', 'txt', 'nfo', 'md', 'pdf', 'htm', 'html', 'json', 'ini', 'cfg', 'dat', 'db', 'log', 'bak',
  'srm', 'sav', 'state', 'auto', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'mp4', 'webm', 'mkv',
]);

interface WalkedFile {
  rel: string;
  abs: string;
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isDirectoryOrFile(abs: string, dirent: Dirent, followSymlinks: boolean): Promise<'dir' | 'file' | null> {
  if (dirent.isDirectory()) return 'dir';
  if (dirent.isFile()) return 'file';
  if (dirent.isSymbolicLink() && followSymlinks) {
    try {
      const stat = await fs.stat(abs);
      return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Depth-limited walk that skips dotfiles. `skip` is consulted for top-level directory names only. */
async function walk(root: string, maxDepth: number, followSymlinks: boolean, skip: (name: string) => boolean): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const visit = async (dir: string, relDir: string, depth: number): Promise<void> => {
    for (const dirent of await readDirSafe(dir)) {
      if (dirent.name.startsWith('.')) continue;
      const abs = path.join(dir, dirent.name);
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const kind = await isDirectoryOrFile(abs, dirent, followSymlinks);
      if (kind === 'dir') {
        if (depth === 0 && skip(dirent.name)) continue;
        if (depth + 1 < maxDepth) await visit(abs, rel, depth + 1);
      } else if (kind === 'file') {
        out.push({ rel, abs });
      }
    }
  };
  await visit(root, '', 0);
  return out;
}

async function statAll(files: WalkedFile[]): Promise<FileRef[]> {
  const result: FileRef[] = [];
  const BATCH = 64;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = await Promise.all(
      files.slice(i, i + BATCH).map(async (f) => {
        try {
          const stat = await fs.stat(f.abs);
          return stat.isFile() ? { rel: f.rel, abs: f.abs, size: stat.size, mtimeMs: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const ref of batch) if (ref) result.push(ref);
  }
  return result;
}

interface MediaIndex {
  byKind: Map<MediaKind | 'mix', Map<string, string>>;
  /** lowercase rel → actual rel, for every media file found under the system folder. */
  all: Map<string, string>;
}

async function indexMedia(absDir: string, maxDepth: number, followSymlinks: boolean): Promise<MediaIndex> {
  const byKind = new Map<MediaKind | 'mix', Map<string, string>>();
  const all = new Map<string, string>();

  const indexDir = async (dirAbs: string, dirRel: string, kind: MediaKind | 'mix' | 'other') => {
    const files = await walk(dirAbs, maxDepth, followSymlinks, () => false);
    let map = kind === 'other' ? undefined : byKind.get(kind);
    if (!map && kind !== 'other') {
      map = new Map();
      byKind.set(kind, map);
    }
    for (const file of files) {
      if (!MEDIA_EXTENSIONS.has(extensionOf(file.rel))) continue;
      const rel = `${dirRel}/${file.rel}`;
      all.set(rel.toLowerCase(), rel);
      if (!map) continue;
      const stem = stripExtension(file.rel).toLowerCase();
      if (!map.has(stem)) map.set(stem, rel);
      const base = path.posix.basename(stem);
      if (!map.has(base)) map.set(base, rel);
    }
  };

  for (const dirent of await readDirSafe(absDir)) {
    if (!dirent.isDirectory() && !(followSymlinks && dirent.isSymbolicLink())) continue;
    const lower = dirent.name.toLowerCase();
    const kind = MEDIA_DIRS[lower];
    if (kind) {
      await indexDir(path.join(absDir, dirent.name), dirent.name, kind);
    } else if (MEDIA_PARENT_DIRS.has(lower)) {
      for (const child of await readDirSafe(path.join(absDir, dirent.name))) {
        const childKind = MEDIA_DIRS[child.name.toLowerCase()];
        if (childKind && (child.isDirectory() || (followSymlinks && child.isSymbolicLink()))) {
          await indexDir(path.join(absDir, dirent.name, child.name), `${dirent.name}/${child.name}`, childKind);
        }
      }
    }
  }
  return { byKind, all };
}

async function loadGamelist(absDir: string, opts: ScanOptions, folder: string): Promise<GamelistEntry[]> {
  const file = path.join(absDir, 'gamelist.xml');
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return [];
  }
  if (!stat.isFile()) return [];
  if (stat.size > opts.maxGamelistBytes) {
    opts.log.warn('gamelist.xml too large, ignoring', { system: folder, bytes: stat.size });
    return [];
  }
  try {
    return parseGamelist(await fs.readFile(file, 'utf8'));
  } catch (error) {
    opts.log.warn('gamelist.xml could not be parsed, falling back to file names', { system: folder, error: error as Error });
    return [];
  }
}

function displayNameFromFile(rel: string): string {
  return stripExtension(path.posix.basename(rel)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function scanSystem(folder: string, absDir: string, def: SystemDef, opts: ScanOptions): Promise<SystemScan> {
  const isMediaTopDir = (name: string) => {
    const lower = name.toLowerCase();
    return lower in MEDIA_DIRS || MEDIA_PARENT_DIRS.has(lower);
  };

  const [walked, media, gamelist] = await Promise.all([
    walk(absDir, opts.maxDepth, opts.followSymlinks, isMediaTopDir),
    indexMedia(absDir, opts.maxDepth, opts.followSymlinks),
    loadGamelist(absDir, opts, folder),
  ]);

  const candidates = walked.filter((f) => f.rel.toLowerCase() !== 'gamelist.xml' && !NON_ROM_EXTENSIONS.has(extensionOf(f.rel)));
  const files = new Map<string, FileRef>();
  const lowerIndex = new Map<string, string>();
  for (const ref of await statAll(candidates)) {
    files.set(ref.rel, ref);
    lowerIndex.set(ref.rel.toLowerCase(), ref.rel);
  }
  const resolveFile = (rel: string) => (files.has(rel) ? rel : lowerIndex.get(rel.toLowerCase()));
  const absFor = (rel: string) => files.get(rel)?.abs ?? path.join(absDir, rel);
  const allowed = (rel: string) => {
    const ext = extensionOf(rel);
    return def.extensions ? def.extensions.includes(ext) : !NON_ROM_EXTENSIONS.has(ext);
  };

  /* ---- Disc sets: playlists first so they claim the cue sheets they reference. ---- */
  const setOrder = (rel: string) => (extensionOf(rel) === 'm3u' ? 0 : 1);
  const descriptors = [...files.keys()]
    .filter((rel) => SET_EXTENSIONS.has(extensionOf(rel)) && allowed(rel))
    .sort((a, b) => setOrder(a) - setOrder(b) || a.localeCompare(b));
  const claimedBy = new Map<string, string>();
  const setMembers = new Map<string, string[]>();
  for (const rel of descriptors) {
    if (claimedBy.has(rel)) continue;
    const members = await resolveDiscSet(rel, resolveFile, absFor);
    setMembers.set(rel, members);
    for (const member of members.slice(1)) {
      if (!claimedBy.has(member)) claimedBy.set(member, rel);
      setMembers.delete(member); // a cue claimed by an m3u is no longer its own game
    }
  }

  /* ---- Media resolution ---- */
  const mediaFiles = new Set<string>();
  const referencedMedia = async (ref: string | undefined): Promise<string | undefined> => {
    if (!ref) return undefined;
    const rel = normalizeReferencedPath(ref);
    if (!rel || !MEDIA_EXTENSIONS.has(extensionOf(rel))) return undefined;
    const known = media.all.get(rel.toLowerCase());
    if (known) return known;
    const abs = resolveInside(absDir, rel);
    if (!abs) return undefined;
    try {
      if ((await fs.stat(abs)).isFile()) {
        media.all.set(rel.toLowerCase(), rel);
        return rel;
      }
    } catch {
      /* referenced but missing */
    }
    return undefined;
  };
  const conventional = (kind: MediaKind | 'mix', romRel: string): string | undefined => {
    const map = media.byKind.get(kind);
    if (!map) return undefined;
    const stem = stripExtension(romRel).toLowerCase();
    return map.get(stem) ?? map.get(path.posix.basename(stem));
  };

  const buildMedia = async (romRel: string, entry?: GamelistEntry): Promise<GameRecord['media']> => {
    const image = await referencedMedia(entry?.image);
    const result: GameRecord['media'] = {
      cover:
        conventional('cover', romRel) ??
        (await referencedMedia(entry?.cover)) ??
        (await referencedMedia(entry?.thumbnail)) ??
        image ??
        conventional('mix', romRel),
      screenshot: conventional('screenshot', romRel) ?? (await referencedMedia(entry?.screenshot)),
      titlescreen: conventional('titlescreen', romRel) ?? (await referencedMedia(entry?.titlescreen)),
      marquee: conventional('marquee', romRel) ?? (await referencedMedia(entry?.marquee)),
      fanart: conventional('fanart', romRel) ?? (await referencedMedia(entry?.fanart)),
      video: conventional('video', romRel) ?? (await referencedMedia(entry?.video)),
    };
    if (!result.screenshot && image && image !== result.cover) result.screenshot = image;
    if (!result.cover && result.screenshot) result.cover = result.screenshot;
    for (const key of Object.keys(result) as MediaKind[]) {
      const value = result[key];
      if (value) mediaFiles.add(value);
      else delete result[key];
    }
    return result;
  };

  /* ---- Assemble games ---- */
  const games: GameRecord[] = [];
  const used = new Set<string>();
  const filesFor = (rel: string): FileRef[] =>
    (setMembers.get(rel) ?? [rel]).map((member) => files.get(member)).filter((f): f is FileRef => Boolean(f));

  for (const entry of gamelist) {
    const normalized = normalizeReferencedPath(entry.path);
    const rel = normalized ? resolveFile(normalized) : undefined;
    if (!rel || used.has(rel) || claimedBy.has(rel)) continue;
    used.add(rel);
    if (entry.hidden && !opts.showHidden) continue;
    const name = entry.name || displayNameFromFile(rel);
    games.push({
      id: opts.makeId(folder, rel),
      folder,
      name,
      sortName: sortKey(entry.sortName || name),
      files: filesFor(rel),
      description: entry.description,
      developer: entry.developer,
      publisher: entry.publisher,
      genres: splitGenres(entry.genre),
      releaseDate: entry.releaseDate,
      year: entry.year,
      players: entry.players,
      rating: entry.rating,
      media: await buildMedia(rel, entry),
    });
  }

  for (const rel of files.keys()) {
    if (used.has(rel) || claimedBy.has(rel) || !allowed(rel)) continue;
    used.add(rel);
    const name = displayNameFromFile(rel);
    games.push({
      id: opts.makeId(folder, rel),
      folder,
      name,
      sortName: sortKey(name),
      files: filesFor(rel),
      media: await buildMedia(rel),
    });
  }

  return { folder, absDir, games, mediaFiles };
}

/* ---------------- BIOS ---------------- */

export interface BiosScan {
  /** Every BIOS file keyed by path relative to the bios root. */
  files: Map<string, FileRef>;
  /** Files per top-level folder (lowercased folder name). */
  byFolder: Map<string, { folder: string; files: FileRef[] }>;
  /** Files placed directly in the bios root (flat ES-DE style). */
  rootFiles: FileRef[];
}

export async function scanBios(biosDir: string, followSymlinks: boolean): Promise<BiosScan> {
  const walked = await walk(biosDir, 3, followSymlinks, () => false);
  const refs = await statAll(walked);
  const files = new Map<string, FileRef>();
  const byFolder = new Map<string, { folder: string; files: FileRef[] }>();
  const rootFiles: FileRef[] = [];
  for (const ref of refs) {
    files.set(ref.rel, ref);
    const slash = ref.rel.indexOf('/');
    if (slash === -1) {
      rootFiles.push(ref);
      continue;
    }
    const folder = ref.rel.slice(0, slash);
    const key = folder.toLowerCase();
    const bucket = byFolder.get(key) ?? { folder, files: [] };
    bucket.files.push(ref);
    byFolder.set(key, bucket);
  }
  for (const bucket of byFolder.values()) bucket.files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, byFolder, rootFiles };
}

export async function listSystemFolders(romsDir: string, followSymlinks: boolean): Promise<Array<{ folder: string; abs: string }>> {
  const result: Array<{ folder: string; abs: string }> = [];
  for (const dirent of await readDirSafe(romsDir)) {
    if (dirent.name.startsWith('.')) continue;
    const abs = path.join(romsDir, dirent.name);
    if ((await isDirectoryOrFile(abs, dirent, followSymlinks)) === 'dir') result.push({ folder: dirent.name, abs });
  }
  return result.sort((a, b) => a.folder.localeCompare(b.folder));
}

