import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Config } from '../../config.js';
import type { Catalog } from '../../library/catalog.js';
import { binaryContentType, mediaContentType, strongEtag } from '../../util/mime.js';
import { isSafeSegment, realpathInside, resolveInside, safeRelativeFromSegments } from '../../util/paths.js';
import { buildZipLayout, canZip, crc32ForEntries, streamingZip, streamZipRange, zipSize, type ZipEntryInput } from '../../util/zip.js';
import { fileSource, sendRanged, type RangedSource } from '../send.js';

class NotFound extends Error {
  readonly status = 404;
}

const ROM_CACHE = 'private, no-cache';
const MEDIA_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';

function wildcardSegments(req: Request): string[] {
  const value = (req.params as Record<string, unknown>).path;
  return Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? value.split('/') : [];
}

function wantsDownload(req: Request): boolean {
  return req.query.download === '1' || req.query.download === 'true';
}

/**
 * Resolve an indexed file with every check in place: lexical containment, optional symlink
 * containment, and a fresh stat (the file may have changed since the last scan).
 */
async function openChecked(root: string, absPath: string, followSymlinks: boolean): Promise<{ size: number; mtimeMs: number }> {
  const relative = path.relative(root, absPath);
  if (!resolveInside(root, relative)) throw new NotFound();
  if (!followSymlinks && !(await realpathInside(root, absPath))) throw new NotFound();
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) throw new NotFound();
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    throw new NotFound();
  }
}

async function openCheckedDir(root: string, absDir: string, followSymlinks: boolean): Promise<void> {
  if (!resolveInside(root, path.relative(root, absDir))) throw new NotFound();
  if (!followSymlinks && !(await realpathInside(root, absDir))) throw new NotFound();
  const stat = await fs.stat(absDir).catch(() => null);
  if (!stat?.isDirectory()) throw new NotFound();
}

async function zipSource(entries: ZipEntryInput[]): Promise<RangedSource> {
  const fresh = await Promise.all(
    entries.map(async (entry) => {
      const stat = await fs.stat(entry.absPath).catch(() => null);
      if (!stat?.isFile()) throw new NotFound();
      return { ...entry, size: stat.size, mtimeMs: stat.mtimeMs };
    }),
  );
  if (!canZip(fresh)) throw new NotFound();
  return {
    size: zipSize(fresh),
    mtimeMs: Math.max(...fresh.map((e) => e.mtimeMs)),
    etag: strongEtag('z', ...fresh.map((e) => `${e.name}:${e.size}:${Math.floor(e.mtimeMs)}`)),
    contentType: 'application/zip',
    // CRCs are only computed when bytes are actually requested (never for HEAD).
    open: async (start, end) => streamZipRange(buildZipLayout(fresh, await crc32ForEntries(fresh)), start, end),
  };
}

/** ZIP64-capable, streamed archive for downloads (no up-front CRC pass, no 4 GiB limit). */
async function downloadSource(entries: ZipEntryInput[]): Promise<RangedSource> {
  if (!entries.length) throw new NotFound();
  const archive = streamingZip(entries);
  return {
    size: archive.size,
    mtimeMs: Math.max(...entries.map((e) => e.mtimeMs)),
    etag: strongEtag('zs', ...entries.map((e) => `${e.name}:${e.size}:${Math.floor(e.mtimeMs)}`)),
    contentType: 'application/zip',
    open: (start, end) => archive.open(start, end),
  };
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (handler: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

export function filesRouter(config: Config, catalog: Catalog): Router {
  const router = Router();

  // /files/roms/:system/<relative path> — only files that belong to a scanned game.
  router.get(
    '/roms/:system/*path',
    wrap(async (req, res) => {
      const folder = String(req.params.system);
      const rel = safeRelativeFromSegments(wildcardSegments(req));
      const root = isSafeSegment(folder) ? catalog.systemRoot(folder) : undefined;
      const file = rel && root ? catalog.romFile(folder, rel) : undefined;
      if (!file || !root) throw new NotFound();
      const { size, mtimeMs } = await openChecked(root, file.abs, config.followSymlinks);
      const name = path.posix.basename(rel!);
      await sendRanged(req, res, fileSource(file.abs, size, mtimeMs, binaryContentType(name)), {
        cacheControl: ROM_CACHE,
        fileName: name,
        disposition: wantsDownload(req) ? 'attachment' : 'inline',
      });
    }),
  );

  // /files/bundles/:gameId/<name>.zip — multi-file disc sets as one stored ZIP.
  router.get(
    '/bundles/:id/:name',
    wrap(async (req, res) => {
      const game = catalog.game(String(req.params.id));
      const archive = game ? catalog.gameArchive(game) : null;
      if (!game || !archive || archive.name !== req.params.name) throw new NotFound();
      const root = catalog.systemRoot(game.folder);
      if (!root) throw new NotFound();
      for (const entry of archive.entries) await openChecked(root, entry.absPath, config.followSymlinks);
      await sendRanged(req, res, await zipSource(archive.entries), {
        cacheControl: ROM_CACHE,
        fileName: archive.name,
        disposition: wantsDownload(req) ? 'attachment' : 'inline',
      });
    }),
  );

  // /files/full/:gameId/<name>.zip — a folder game, or a game with its updates/DLC, in one download.
  router.get(
    '/full/:id/:name',
    wrap(async (req, res) => {
      const game = catalog.game(String(req.params.id));
      const archive = game ? catalog.downloadArchive(game) : null;
      if (!game || !archive || archive.name !== req.params.name) throw new NotFound();
      const root = catalog.systemRoot(game.folder);
      if (!root) throw new NotFound();
      let entries: ZipEntryInput[];
      try {
        entries = await archive.entries();
      } catch {
        throw new NotFound();
      }
      if (game.directory) {
        // The walk never leaves the folder; check the folder itself once instead of every file.
        await openCheckedDir(root, path.join(root, game.directory), config.followSymlinks);
      } else {
        for (const entry of entries) await openChecked(root, entry.absPath, config.followSymlinks);
      }
      await sendRanged(req, res, await downloadSource(entries), {
        cacheControl: ROM_CACHE,
        fileName: archive.name,
        disposition: 'attachment',
      });
    }),
  );

  // /files/bios/<relative path under /library/bios>
  router.get(
    '/bios/*path',
    wrap(async (req, res) => {
      const rel = safeRelativeFromSegments(wildcardSegments(req));
      const file = rel ? catalog.biosFile(rel) : undefined;
      if (!file) throw new NotFound();
      const { size, mtimeMs } = await openChecked(config.biosDir, file.abs, config.followSymlinks);
      const name = path.posix.basename(rel!);
      await sendRanged(req, res, fileSource(file.abs, size, mtimeMs, binaryContentType(name)), {
        cacheControl: ROM_CACHE,
        fileName: name,
        disposition: wantsDownload(req) ? 'attachment' : 'inline',
      });
    }),
  );

  // /files/bios-bundle/:system/<system>-bios.zip — several BIOS files as one archive.
  router.get(
    '/bios-bundle/:system/:name',
    wrap(async (req, res) => {
      const archive = catalog.biosArchive(String(req.params.system));
      if (!archive || archive.name !== req.params.name) throw new NotFound();
      for (const entry of archive.entries) await openChecked(config.biosDir, entry.absPath, config.followSymlinks);
      await sendRanged(req, res, await zipSource(archive.entries), {
        cacheControl: ROM_CACHE,
        fileName: archive.name,
        disposition: wantsDownload(req) ? 'attachment' : 'inline',
      });
    }),
  );

  return router;
}

export function mediaRouter(config: Config, catalog: Catalog): Router {
  const router = Router();
  router.get(
    '/:system/*path',
    wrap(async (req, res) => {
      const folder = String(req.params.system);
      const rel = safeRelativeFromSegments(wildcardSegments(req));
      const root = isSafeSegment(folder) ? catalog.systemRoot(folder) : undefined;
      if (!rel || !root || !catalog.hasMedia(folder, rel)) throw new NotFound();
      const contentType = mediaContentType(rel);
      const absPath = resolveInside(root, rel);
      if (!contentType || !absPath) throw new NotFound();
      const { size, mtimeMs } = await openChecked(root, absPath, config.followSymlinks);
      await sendRanged(req, res, fileSource(absPath, size, mtimeMs, contentType), { cacheControl: MEDIA_CACHE });
    }),
  );
  return router;
}
