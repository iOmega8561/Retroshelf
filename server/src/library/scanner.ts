import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExtraKind } from '../../../shared/api.js';
import type { Logger } from '../logger.js';
import { MEDIA_EXTENSIONS } from '../util/mime.js';
import { extensionOf, normalizeReferencedPath, resolveInside, stripExtension } from '../util/paths.js';
import { SET_EXTENSIONS, resolveDiscSet } from './discsets.js';
import { parseGamelist, sortKey, splitGenres, type Gamelist, type GamelistEntry } from './gamelist.js';
import type { SystemDef } from './systems.js';

export interface FileRef {
  /** POSIX path relative to the scanned root (system folder or bios folder). */
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

export interface ExtraRef extends FileRef {
  kind: ExtraKind;
}

export type MediaKind = 'cover' | 'screenshot' | 'titlescreen' | 'marquee' | 'fanart' | 'video';

export interface GameRecord {
  id: string;
  folder: string;
  name: string;
  sortName: string;
  /** The game's path: its primary file, or its directory for an ES-DE folder game without one. */
  rel: string;
  /** Primary file first, then disc-set members: exactly what the emulator receives. */
  files: FileRef[];
  /** Updates, DLC, patches and add-ons found in the game's extras folders (download only). */
  extras: ExtraRef[];
  /** Folder the game lives in, relative to the system folder ('' = the system folder itself). */
  baseDir: string;
  /** ES-DE "directory interpreted as file": the whole directory is the game. */
  directory?: string;
  description?: string;
  /** Translated descriptions by language, from `<desc lang="…">`. */
  descriptions?: Record<string, string>;
  developer?: string;
  publisher?: string;
  genres?: string[];
  releaseDate?: string;
  year?: number;
  players?: string;
  rating?: number;
  /** Media paths relative to the system folder. */
  media: Partial<Record<MediaKind, string>>;
  /** Width / height of the cover image (set by the catalog after measuring it). */
  coverAspect?: number;
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

/**
 * Extras folders ("Game/UPDATE/…", "Game/DLC (EUR)/…"): their files belong to the game in the
 * folder above and are never listed as games of their own.
 */
const EXTRAS_DIR = /^(updates?|upd|aggiornament[oi]|dlcs?|patch(?:es)?|add[- ]?ons?)(?:[\s_.([-].*)?$/i;

function extrasKind(dirName: string): ExtraKind | null {
  const match = EXTRAS_DIR.exec(dirName);
  if (!match?.[1]) return null;
  const word = match[1].normalize('NFC').toLowerCase();
  if (word.startsWith('dlc')) return 'dlc';
  if (word.startsWith('patch')) return 'patch';
  if (word.startsWith('add')) return 'addon';
  return 'update';
}

interface Walked {
  files: string[];
  dirs: string[];
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
export async function walk(root: string, maxDepth: number, followSymlinks: boolean, skip: (name: string) => boolean = () => false): Promise<Walked> {
  const out: Walked = { files: [], dirs: [] };
  const visit = async (dir: string, relDir: string, depth: number): Promise<void> => {
    for (const dirent of await readDirSafe(dir)) {
      if (dirent.name.startsWith('.')) continue;
      const abs = path.join(dir, dirent.name);
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const kind = await isDirectoryOrFile(abs, dirent, followSymlinks);
      if (kind === 'dir') {
        if (depth === 0 && skip(dirent.name)) continue;
        out.dirs.push(rel);
        if (depth + 1 < maxDepth) await visit(abs, rel, depth + 1);
      } else if (kind === 'file') {
        out.files.push(rel);
      }
    }
  };
  await visit(root, '', 0);
  return out;
}

async function statAll(root: string, rels: string[]): Promise<FileRef[]> {
  const result: FileRef[] = [];
  const BATCH = 64;
  for (let i = 0; i < rels.length; i += BATCH) {
    const batch = await Promise.all(
      rels.slice(i, i + BATCH).map(async (rel) => {
        const abs = path.join(root, rel);
        try {
          const stat = await fs.stat(abs);
          return stat.isFile() ? { rel, abs, size: stat.size, mtimeMs: stat.mtimeMs } : null;
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
    const { files } = await walk(dirAbs, maxDepth, followSymlinks);
    let map = kind === 'other' ? undefined : byKind.get(kind);
    if (!map && kind !== 'other') {
      map = new Map();
      byKind.set(kind, map);
    }
    for (const file of files) {
      if (!MEDIA_EXTENSIONS.has(extensionOf(file))) continue;
      const rel = `${dirRel}/${file}`;
      all.set(rel.normalize('NFC').toLowerCase(), rel);
      if (!map) continue;
      const stem = stripExtension(file).normalize('NFC').toLowerCase();
      if (!map.has(stem)) map.set(stem, rel);
      const base = path.posix.basename(stem);
      if (!map.has(base)) map.set(base, rel);
    }
  };

  for (const dirent of await readDirSafe(absDir)) {
    if (!dirent.isDirectory() && !(followSymlinks && dirent.isSymbolicLink())) continue;
    const lower = dirent.name.normalize('NFC').toLowerCase();
    const kind = MEDIA_DIRS[lower];
    if (kind) {
      await indexDir(path.join(absDir, dirent.name), dirent.name, kind);
    } else if (MEDIA_PARENT_DIRS.has(lower)) {
      for (const child of await readDirSafe(path.join(absDir, dirent.name))) {
        const childKind = MEDIA_DIRS[child.name.normalize('NFC').toLowerCase()];
        if (childKind && (child.isDirectory() || (followSymlinks && child.isSymbolicLink()))) {
          await indexDir(path.join(absDir, dirent.name, child.name), `${dirent.name}/${child.name}`, childKind);
        }
      }
    }
  }
  return { byKind, all };
}

async function loadGamelist(absDir: string, opts: ScanOptions, folder: string): Promise<Gamelist> {
  const empty: Gamelist = { games: [], folders: [] };
  const file = path.join(absDir, 'gamelist.xml');
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return empty;
  }
  if (!stat.isFile()) return empty;
  if (stat.size > opts.maxGamelistBytes) {
    opts.log.warn('gamelist.xml too large, ignoring', { system: folder, bytes: stat.size });
    return empty;
  }
  try {
    return parseGamelist(await fs.readFile(file, 'utf8'));
  } catch (error) {
    opts.log.warn('gamelist.xml could not be parsed, falling back to file names', { system: folder, error: error as Error });
    return empty;
  }
}

const dirOf = (rel: string) => {
  const dir = path.posix.dirname(rel);
  return dir === '.' ? '' : dir;
};

function displayNameFromFile(rel: string): string {
  return stripExtension(path.posix.basename(rel)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 3DS ids share their last 8 hex digits across game/update/DLC; Switch ids their first 12. */
function relatedTitleIds(a: string, b: string): boolean {
  const ids = (text: string) => [...text.matchAll(/\b([0-9a-f]{16})\b/gi)].map((m) => m[1]!.normalize('NFC').toLowerCase());
  for (const x of ids(a)) for (const y of ids(b)) if (x.slice(-8) === y.slice(-8) || x.slice(0, 12) === y.slice(0, 12)) return true;
  return false;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

export async function scanSystem(folder: string, absDir: string, def: SystemDef, opts: ScanOptions): Promise<SystemScan> {
  const isMediaTopDir = (name: string) => {
    const lower = name.normalize('NFC').toLowerCase();
    return lower in MEDIA_DIRS || MEDIA_PARENT_DIRS.has(lower);
  };
  const allowed = (rel: string) => {
    const ext = extensionOf(rel);
    return def.extensions ? def.extensions.includes(ext) : !NON_ROM_EXTENSIONS.has(ext);
  };

  const [walked, media, gamelist] = await Promise.all([
    walk(absDir, opts.maxDepth, opts.followSymlinks, isMediaTopDir),
    indexMedia(absDir, opts.maxDepth, opts.followSymlinks),
    loadGamelist(absDir, opts, folder),
  ]);

  /* ---- 1. ES-DE folder games: directories named like a ROM ("Game.ps3/", "Game.m3u/"). ---- */
  const directoryGames: string[] = [];
  if (def.extensions) {
    for (const dir of [...walked.dirs].sort((a, b) => a.split('/').length - b.split('/').length)) {
      if (!def.extensions.includes(extensionOf(path.posix.basename(dir)))) continue;
      if (directoryGames.some((root) => dir.startsWith(`${root}/`))) continue;
      directoryGames.push(dir);
    }
  }
  const directoryOf = (rel: string) => directoryGames.find((root) => rel.startsWith(`${root}/`));

  /* ---- 2. Partition files: inside folder games, inside extras folders, everything else. ---- */
  const looseRels: string[] = [];
  const extraInfo = new Map<string, { ownerDir: string; kind: ExtraKind }>();
  const insideDirectory = new Map<string, string[]>();
  for (const rel of walked.files) {
    if (rel.normalize('NFC').toLowerCase() === 'gamelist.xml' || NON_ROM_EXTENSIONS.has(extensionOf(rel))) continue;
    const root = directoryOf(rel);
    if (root) {
      insideDirectory.set(root, [...(insideDirectory.get(root) ?? []), rel]);
      continue;
    }
    const segments = rel.split('/');
    let extra: { ownerDir: string; kind: ExtraKind } | null = null;
    for (let k = 0; k < segments.length - 1; k += 1) {
      const kind = extrasKind(segments[k]!);
      if (kind) {
        extra = { ownerDir: segments.slice(0, k).join('/'), kind };
        break;
      }
    }
    if (extra) extraInfo.set(rel, extra);
    else looseRels.push(rel);
  }

  // Inside a folder game only its top-level candidates (and disc-set members) need stats.
  const directoryCandidates = [...insideDirectory.entries()].flatMap(([root, rels]) =>
    rels.filter((rel) => dirOf(rel) === root && allowed(rel)),
  );
  const refs = await statAll(absDir, [...looseRels, ...extraInfo.keys(), ...directoryCandidates]);
  const files = new Map<string, FileRef>();
  const lowerIndex = new Map<string, string>();
  for (const ref of refs) {
    files.set(ref.rel, ref);
    lowerIndex.set(ref.rel.normalize('NFC').toLowerCase(), ref.rel);
  }
  // Disc sets may point at files deeper inside a folder game: resolve against everything walked.
  const walkedLower = new Map(walked.files.map((rel) => [rel.normalize('NFC').toLowerCase(), rel]));
  const resolveFile = (rel: string) => (files.has(rel) ? rel : (lowerIndex.get(rel.normalize('NFC').toLowerCase()) ?? walkedLower.get(rel.normalize('NFC').toLowerCase())));
  const absFor = (rel: string) => path.join(absDir, rel);
  const refFor = async (rel: string): Promise<FileRef | undefined> => files.get(rel) ?? (await statAll(absDir, [rel]))[0];

  /* ---- 3. Disc sets among loose files: playlists first so they claim their cue sheets. ---- */
  const setOrder = (rel: string) => (extensionOf(rel) === 'm3u' ? 0 : 1);
  const descriptors = looseRels
    .filter((rel) => files.has(rel) && SET_EXTENSIONS.has(extensionOf(rel)) && allowed(rel))
    .sort((a, b) => setOrder(a) - setOrder(b) || a.localeCompare(b));
  const claimed = new Set<string>();
  const setMembers = new Map<string, string[]>();
  for (const rel of descriptors) {
    if (claimed.has(rel)) continue;
    const members = await resolveDiscSet(rel, resolveFile, absFor);
    setMembers.set(rel, members);
    for (const member of members.slice(1)) {
      claimed.add(member);
      setMembers.delete(member); // a cue claimed by an m3u is no longer its own game
    }
  }
  const filesFor = async (rel: string): Promise<FileRef[]> => {
    const members = setMembers.get(rel) ?? [rel];
    const result: FileRef[] = [];
    for (const member of members) {
      const ref = await refFor(member);
      if (ref) result.push(ref);
    }
    return result;
  };

  /* ---- 4. Games ---- */
  const games: GameRecord[] = [];
  const entryFor = new Map<string, GamelistEntry>();
  for (const entry of gamelist.games) {
    const normalized = normalizeReferencedPath(entry.path);
    if (!normalized) continue;
    const rel = resolveFile(normalized) ?? directoryGames.find((root) => root.normalize('NFC').toLowerCase() === normalized.normalize('NFC').toLowerCase());
    if (rel && !entryFor.has(rel)) entryFor.set(rel, entry);
  }
  const folderEntryFor = new Map<string, GamelistEntry>();
  for (const entry of gamelist.folders) {
    const normalized = normalizeReferencedPath(entry.path);
    if (normalized) folderEntryFor.set(normalized.normalize('NFC').toLowerCase(), entry);
  }

  const makeGame = (rel: string, gameFiles: FileRef[], entry: GamelistEntry | undefined, fallbackName: string): GameRecord | null => {
    if (entry?.hidden && !opts.showHidden) return null;
    const name = entry?.name || fallbackName;
    return {
      id: opts.makeId(folder, rel),
      folder,
      name,
      sortName: sortKey(entry?.sortName || name),
      rel,
      files: gameFiles,
      extras: [],
      baseDir: dirOf(gameFiles[0]?.rel ?? rel),
      description: entry?.description,
      descriptions: entry?.descriptions,
      developer: entry?.developer,
      publisher: entry?.publisher,
      genres: splitGenres(entry?.genre),
      releaseDate: entry?.releaseDate,
      year: entry?.year,
      players: entry?.players,
      rating: entry?.rating,
      media: {},
    };
  };
  const entryOf = new Map<GameRecord, GamelistEntry | undefined>();
  const add = (game: GameRecord | null, entry: GamelistEntry | undefined) => {
    if (!game) return;
    games.push(game);
    entryOf.set(game, entry);
  };

  // Loose files, gamelist order first, then files the gamelist doesn't know about.
  const used = new Set<string>();
  const ordered = [...gamelist.games.map((e) => normalizeReferencedPath(e.path)).map((n) => (n ? resolveFile(n) : undefined)), ...looseRels];
  for (const rel of ordered) {
    if (!rel || used.has(rel) || claimed.has(rel) || !files.has(rel) || extraInfo.has(rel) || directoryOf(rel)) continue;
    const entry = entryFor.get(rel);
    if (!entry && !allowed(rel)) continue;
    used.add(rel);
    add(makeGame(rel, await filesFor(rel), entry, displayNameFromFile(rel)), entry);
  }

  // ES-DE folder games.
  for (const root of directoryGames) {
    const inside = (insideDirectory.get(root) ?? []).filter((rel) => dirOf(rel) === root && allowed(rel));
    const sameName = inside.find((rel) => path.posix.basename(rel).normalize('NFC').toLowerCase() === path.posix.basename(root).normalize('NFC').toLowerCase());
    const largest = [...inside].sort((a, b) => (files.get(b)?.size ?? 0) - (files.get(a)?.size ?? 0))[0];
    const primary = sameName ?? (inside.length === 1 ? inside[0] : largest);
    let gameFiles: FileRef[] = [];
    if (primary) {
      const members = SET_EXTENSIONS.has(extensionOf(primary)) ? await resolveDiscSet(primary, resolveFile, absFor) : [primary];
      for (const member of members) {
        const ref = await refFor(member);
        if (ref) gameFiles.push(ref);
      }
    }
    if (!gameFiles.length) gameFiles = [];
    const entry = entryFor.get(root);
    const game = makeGame(primary ?? root, gameFiles, entry, displayNameFromFile(root));
    if (game) {
      game.id = opts.makeId(folder, root);
      game.directory = root;
      game.baseDir = root;
    }
    add(game, entry);
  }

  /* ---- 5. Attach extras to the game in the folder above them. ---- */
  const byDir = new Map<string, GameRecord[]>();
  for (const game of games) byDir.set(game.baseDir, [...(byDir.get(game.baseDir) ?? []), game]);
  const orphans: string[] = [];
  for (const [rel, { ownerDir, kind }] of extraInfo) {
    const ref = files.get(rel);
    if (!ref) continue;
    const candidates = byDir.get(ownerDir) ?? [];
    let owner: GameRecord | undefined = candidates.length === 1 ? candidates[0] : undefined;
    if (!owner && candidates.length > 1) {
      owner = candidates.find((game) => relatedTitleIds(rel, game.rel));
      if (!owner) {
        const key = sortKey(displayNameFromFile(rel));
        let best = 0;
        for (const game of candidates) {
          const score = commonPrefix(key, sortKey(displayNameFromFile(game.rel)));
          if (score > best && score >= 6) {
            best = score;
            owner = game;
          }
        }
      }
    }
    if (owner) owner.extras.push({ ...ref, kind });
    else orphans.push(rel);
  }
  // Extras we can't place stay visible as games rather than disappearing.
  for (const rel of orphans) {
    if (!allowed(rel)) continue;
    const entry = entryFor.get(rel);
    add(makeGame(rel, (await refFor(rel)) ? [files.get(rel)!] : [], entry, displayNameFromFile(rel)), entry);
  }
  for (const game of games) game.extras.sort((a, b) => a.kind.localeCompare(b.kind) || a.rel.localeCompare(b.rel));

  /* ---- 6. `<folder>` metadata for a game alone in its folder, when it has no entry of its own. ---- */
  const countByDir = new Map<string, number>();
  for (const game of games) countByDir.set(game.baseDir, (countByDir.get(game.baseDir) ?? 0) + 1);
  for (const game of games) {
    if (entryOf.get(game) || !game.baseDir || countByDir.get(game.baseDir) !== 1) continue;
    const entry = folderEntryFor.get(game.baseDir.normalize('NFC').toLowerCase());
    if (!entry) {
      // "Game/Game (Europe) [id].cia" + "Game/UPDATE/…": the folder name is the clean title.
      if (game.extras.length && !game.directory) {
        game.name = path.posix.basename(game.baseDir);
        game.sortName = sortKey(game.name);
      }
      continue;
    }
    if (entry.hidden && !opts.showHidden) continue;
    if (entry.name) {
      game.name = entry.name;
      game.sortName = sortKey(entry.sortName || entry.name);
    }
    game.description ??= entry.description;
    game.descriptions ??= entry.descriptions;
    game.developer ??= entry.developer;
    game.publisher ??= entry.publisher;
    game.genres ??= splitGenres(entry.genre);
    game.releaseDate ??= entry.releaseDate;
    game.year ??= entry.year;
    game.players ??= entry.players;
    game.rating ??= entry.rating;
    entryOf.set(game, entry);
  }

  /* ---- 7. Media ---- */
  const mediaFiles = new Set<string>();
  const referencedMedia = async (ref: string | undefined): Promise<string | undefined> => {
    if (!ref) return undefined;
    const rel = normalizeReferencedPath(ref);
    if (!rel || !MEDIA_EXTENSIONS.has(extensionOf(rel))) return undefined;
    const known = media.all.get(rel.normalize('NFC').toLowerCase());
    if (known) return known;
    const abs = resolveInside(absDir, rel);
    if (!abs) return undefined;
    try {
      if ((await fs.stat(abs)).isFile()) {
        media.all.set(rel.normalize('NFC').toLowerCase(), rel);
        return rel;
      }
    } catch {
      /* referenced but missing */
    }
    return undefined;
  };
  const conventional = (kind: MediaKind | 'mix', keys: string[]): string | undefined => {
    const map = media.byKind.get(kind);
    if (!map) return undefined;
    for (const key of keys) {
      const hit = map.get(key) ?? map.get(path.posix.basename(key));
      if (hit) return hit;
    }
    return undefined;
  };

  for (const game of games) {
    const entry = entryOf.get(game);
    // Match media by the game's file, then (for a game with its own folder) by the folder name.
    const keys = [stripExtension(game.rel).normalize('NFC').toLowerCase()];
    if (game.directory) keys.push(stripExtension(game.directory).normalize('NFC').toLowerCase());
    else if (game.baseDir && countByDir.get(game.baseDir) === 1) keys.push(game.baseDir.normalize('NFC').toLowerCase());
    const image = await referencedMedia(entry?.image);
    const result: GameRecord['media'] = {
      cover:
        conventional('cover', keys) ??
        (await referencedMedia(entry?.cover)) ??
        (await referencedMedia(entry?.thumbnail)) ??
        image ??
        conventional('mix', keys),
      screenshot: conventional('screenshot', keys) ?? (await referencedMedia(entry?.screenshot)),
      titlescreen: conventional('titlescreen', keys) ?? (await referencedMedia(entry?.titlescreen)),
      marquee: conventional('marquee', keys) ?? (await referencedMedia(entry?.marquee)),
      fanart: conventional('fanart', keys) ?? (await referencedMedia(entry?.fanart)),
      video: conventional('video', keys) ?? (await referencedMedia(entry?.video)),
    };
    if (!result.screenshot && image && image !== result.cover) result.screenshot = image;
    if (!result.cover && result.screenshot) result.cover = result.screenshot;
    for (const key of Object.keys(result) as MediaKind[]) {
      const value = result[key];
      if (value) mediaFiles.add(value);
      else delete result[key];
    }
    game.media = result;
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
  const { files: rels } = await walk(biosDir, 3, followSymlinks);
  const refs = await statAll(biosDir, rels);
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
    const key = folder.normalize('NFC').toLowerCase();
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

/**
 * Every file of an ES-DE folder game, walked when a download is requested (not kept in memory:
 * a PS3 folder game can hold thousands of files). Bounded so a runaway tree can't stall a request.
 */
export async function directoryContents(root: string, followSymlinks: boolean, limit = 100_000): Promise<FileRef[]> {
  const { files } = await walk(root, 16, followSymlinks);
  if (files.length > limit) throw new RangeError('Folder game has too many files to archive');
  return statAll(root, files.sort());
}
