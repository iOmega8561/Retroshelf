import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Defence in depth against directory traversal / LFI:
 *  1. URL segments are validated one by one (no `..`, no dotfiles, no separators, no control chars).
 *  2. The joined path must stay lexically inside the root after normalisation.
 *  3. Unless symlinks are explicitly trusted, the real path must stay inside the real root.
 *  4. Routes only serve files the scanner indexed (see Catalog), so 1-3 are a second line.
 */

// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_SEGMENT = /[\\/\u0000-\u001f\u007f]/;

export function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= 255 &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.startsWith('.') &&
    !FORBIDDEN_IN_SEGMENT.test(segment)
  );
}

/** Join already-decoded URL segments into a POSIX relative path, or null if any is unsafe. */
export function safeRelativeFromSegments(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > 32) return null;
  for (const segment of segments) if (!isSafeSegment(segment)) return null;
  return segments.join('/');
}

/**
 * Normalise a relative path written in a gamelist/cue/m3u (`./covers/a.png`, `discs\\a.cue`)
 * against a base directory (relative to the system root). Returns a POSIX path relative to the
 * system root, or null when it is absolute, empty, or escapes the root.
 */
export function normalizeReferencedPath(reference: string, baseRelDir = ''): string | null {
  let ref = reference.trim().replace(/\\/g, '/');
  if (!ref || ref.includes('\0')) return null;
  if (ref.startsWith('/') || /^[a-zA-Z]:\//.test(ref) || ref.startsWith('~')) return null;
  ref = path.posix.normalize(path.posix.join(baseRelDir || '.', ref));
  if (ref === '.' || ref === '..' || ref.startsWith('../') || ref.startsWith('/')) return null;
  return ref;
}

/** Lexical containment check. `root` must already be absolute and resolved. */
export function resolveInside(root: string, relative: string): string | null {
  if (relative.includes('\0')) return null;
  const absolute = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return absolute === root || absolute.startsWith(rootWithSep) ? absolute : null;
}

/** Symlink-aware containment: both sides are canonicalised before comparing. */
export async function realpathInside(root: string, absolute: string): Promise<boolean> {
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
    const rootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    return realTarget === realRoot || realTarget.startsWith(rootWithSep);
  } catch {
    return false;
  }
}

export function toPosix(relative: string): string {
  return relative.split(path.sep).join('/');
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Encode a POSIX relative path for use in a URL, one segment at a time. */
export function encodePath(relative: string): string {
  return relative.split('/').map(encodeURIComponent).join('/');
}
