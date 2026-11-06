import fs from 'node:fs/promises';
import path from 'node:path';
import { extensionOf, normalizeReferencedPath, stripExtension } from '../util/paths.js';

/**
 * Disc images often span several files (a .cue plus its .bin tracks, an .m3u listing several
 * discs, a .gdi with raw tracks). EmulatorJS takes a single URL, so these sets are shipped as
 * one virtual ZIP. This module figures out which files belong to which set.
 */

export const SET_EXTENSIONS = new Set(['cue', 'm3u', 'gdi', 'ccd']);
const MAX_DESCRIPTOR_BYTES = 256 * 1024;

/** Resolves a relative path to an indexed file, tolerating case mismatches from Windows-made cue sheets. */
export type FileResolver = (relPath: string) => string | undefined;

async function readDescriptor(absPath: string): Promise<string | null> {
  try {
    const handle = await fs.open(absPath, 'r');
    try {
      const { size } = await handle.stat();
      if (size > MAX_DESCRIPTOR_BYTES) return null;
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, 0);
      return buffer.toString('utf8').replace(/^\uFEFF/, '');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function cueReferences(content: string): string[] {
  const refs: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const quoted = /^\s*FILE\s+"(.+)"\s+\S+\s*$/i.exec(line);
    const bare = quoted ? null : /^\s*FILE\s+(\S+)\s+\S+\s*$/i.exec(line);
    const ref = quoted?.[1] ?? bare?.[1];
    if (ref) refs.push(ref);
  }
  return refs;
}

function m3uReferences(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function gdiReferences(content: string): string[] {
  const refs: string[] = [];
  const lines = content.split(/\r?\n/).slice(1);
  for (const line of lines) {
    // "1 0 4 2352 track01.bin 0" or with a quoted name containing spaces
    const match = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))\s+\d+\s*$/.exec(line);
    const ref = match?.[1] ?? match?.[2];
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * Returns every member of the set rooted at `primaryRel` (primary first), or just the primary
 * when it isn't a set descriptor. `readAbs` maps a system-relative path to an absolute path.
 */
export async function resolveDiscSet(
  primaryRel: string,
  resolve: FileResolver,
  readAbs: (relPath: string) => string,
  depth = 0,
): Promise<string[]> {
  const ext = extensionOf(primaryRel);
  const members = [primaryRel];
  if (!SET_EXTENSIONS.has(ext) || depth > 2) return members;

  const baseDir = path.posix.dirname(primaryRel) === '.' ? '' : path.posix.dirname(primaryRel);

  if (ext === 'ccd') {
    // CloneCD: siblings share the base name.
    const stem = stripExtension(primaryRel);
    for (const sibling of ['img', 'sub']) {
      const found = resolve(`${stem}.${sibling}`);
      if (found) members.push(found);
    }
    return members;
  }

  const content = await readDescriptor(readAbs(primaryRel));
  if (content === null) return members;
  const refs = ext === 'cue' ? cueReferences(content) : ext === 'gdi' ? gdiReferences(content) : m3uReferences(content);

  for (const ref of refs) {
    const normalized = normalizeReferencedPath(ref, baseDir);
    const found = normalized ? resolve(normalized) : undefined;
    if (!found || members.includes(found)) continue;
    const nested = await resolveDiscSet(found, resolve, readAbs, depth + 1);
    for (const member of nested) if (!members.includes(member)) members.push(member);
  }
  return members;
}

/** Name of a member inside the archive: relative to the primary's folder so references keep working. */
export function archiveNameFor(memberRel: string, primaryRel: string): string {
  const baseDir = path.posix.dirname(primaryRel);
  const relative = path.posix.relative(baseDir === '.' ? '' : baseDir, memberRel);
  return relative.startsWith('..') ? path.posix.basename(memberRel) : relative;
}
