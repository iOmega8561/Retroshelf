import { createHash } from 'node:crypto';
import { extensionOf } from './paths.js';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
};

/** SVG is deliberately excluded: user-supplied SVG can carry script. */
export const MEDIA_EXTENSIONS = new Set([...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)]);
export const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_TYPES));

export function mediaContentType(fileName: string): string | null {
  const ext = extensionOf(fileName);
  return IMAGE_TYPES[ext] ?? VIDEO_TYPES[ext] ?? null;
}

/** ROMs, BIOS dumps and archives are opaque binary as far as the browser is concerned. */
export function binaryContentType(fileName: string): string {
  switch (extensionOf(fileName)) {
    case 'zip':
      return 'application/zip';
    case '7z':
      return 'application/x-7z-compressed';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/** Short, URL-safe, stable identifier (stable across rescans, so client favorites survive). */
export function stableId(...parts: string[]): string {
  return createHash('sha1').update(parts.join('\0')).digest('base64url').slice(0, 12);
}

export function strongEtag(...parts: Array<string | number>): string {
  return `"${createHash('sha1').update(parts.join('|')).digest('base64url').slice(0, 22)}"`;
}
