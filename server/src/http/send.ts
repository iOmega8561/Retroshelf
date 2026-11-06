import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { strongEtag } from '../util/mime.js';

export interface RangedSource {
  size: number;
  mtimeMs: number;
  etag: string;
  contentType: string;
  /** Open a stream over bytes [start, end], both inclusive. */
  open(start: number, end: number): Readable | Promise<Readable>;
}

export interface SendOptions {
  cacheControl: string;
  /** Sets Content-Disposition. `attachment` forces a download dialog. */
  fileName?: string;
  disposition?: 'inline' | 'attachment';
}

export type ParsedRange = { start: number; end: number } | 'unsatisfiable' | 'ignore';

/**
 * Parse a `Range` header (RFC 9110 §14.2) for a representation of `size` bytes.
 * A single range is honoured. Multiple ranges are deliberately ignored (a full 200 is a valid
 * response) — emulators and download managers only ever ask for one.
 */
export function parseRange(header: string, size: number): ParsedRange {
  const match = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!match?.[1]) return 'ignore';
  const specs = match[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (specs.length !== 1) return 'ignore';
  const spec = /^(\d*)-(\d*)$/.exec(specs[0]!);
  if (!spec) return 'ignore';
  const [, first, last] = spec;
  if (first === '' && last === '') return 'ignore';

  if (first === '') {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix)) return 'ignore';
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(first);
  const end = last === '' ? size - 1 : Number(last);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'ignore';
  if (last !== '' && end < start) return 'ignore'; // syntactically invalid → ignore header
  if (start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

function etagMatches(header: string, etag: string, weak: boolean): boolean {
  const normalize = (tag: string) => (weak ? tag.replace(/^W\//, '') : tag);
  if (header.trim() === '*') return true;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim();
    if (!weak && tag.startsWith('W/')) return false;
    return normalize(tag) === normalize(etag);
  });
}

function lastModifiedSeconds(mtimeMs: number): number {
  return Math.floor(mtimeMs / 1000);
}

function isFresh(req: IncomingMessage, src: RangedSource): boolean {
  const inm = req.headers['if-none-match'];
  if (inm) return etagMatches(inm, src.etag, true);
  const ims = req.headers['if-modified-since'];
  if (ims) {
    const since = Date.parse(ims);
    return Number.isFinite(since) && lastModifiedSeconds(src.mtimeMs) <= Math.floor(since / 1000);
  }
  return false;
}

function preconditionFailed(req: IncomingMessage, src: RangedSource): boolean {
  const ifMatch = req.headers['if-match'];
  if (ifMatch) return !etagMatches(ifMatch, src.etag, false);
  const ius = req.headers['if-unmodified-since'];
  if (ius) {
    const since = Date.parse(ius);
    return Number.isFinite(since) && lastModifiedSeconds(src.mtimeMs) > Math.floor(since / 1000);
  }
  return false;
}

/** If-Range: honour Range only when the client's validator still matches (strong comparison). */
function ifRangeAllows(req: IncomingMessage, src: RangedSource): boolean {
  const header = req.headers['if-range'];
  const value = (Array.isArray(header) ? (header[0] ?? '') : (header ?? '')).trim();
  if (!value) return true;
  if (value.startsWith('"') || value.startsWith('W/')) return etagMatches(value, src.etag, false);
  const date = Date.parse(value);
  return Number.isFinite(date) && Math.floor(date / 1000) === lastModifiedSeconds(src.mtimeMs);
}

export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function isClientAbort(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'EPIPE';
}

export async function sendRanged(req: IncomingMessage, res: ServerResponse, src: RangedSource, opts: SendOptions): Promise<void> {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', src.etag);
  res.setHeader('Last-Modified', new Date(src.mtimeMs).toUTCString());
  res.setHeader('Cache-Control', opts.cacheControl);
  if (opts.fileName) res.setHeader('Content-Disposition', contentDisposition(opts.disposition ?? 'inline', opts.fileName));

  if (preconditionFailed(req, src)) {
    res.statusCode = 412;
    res.end();
    return;
  }
  if (isFresh(req, src)) {
    res.statusCode = 304;
    res.end();
    return;
  }

  let start = 0;
  let end = src.size - 1;
  res.statusCode = 200;

  const rangeHeader = req.headers.range;
  if (rangeHeader && ifRangeAllows(req, src)) {
    const range = parseRange(rangeHeader, src.size);
    if (range === 'unsatisfiable') {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${src.size}`);
      res.end();
      return;
    }
    if (range !== 'ignore') {
      ({ start, end } = range);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${src.size}`);
    }
  }

  const length = src.size === 0 ? 0 : end - start + 1;
  res.setHeader('Content-Type', src.contentType);
  res.setHeader('Content-Length', String(length));

  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return;
  }

  const stream = await src.open(start, end);
  try {
    await pipeline(stream, res);
  } catch (error) {
    if (!isClientAbort(error)) throw error;
  }
}

export function fileSource(absPath: string, size: number, mtimeMs: number, contentType: string): RangedSource {
  return {
    size,
    mtimeMs,
    contentType,
    etag: strongEtag('f', size, Math.floor(mtimeMs)),
    open: (start, end) => createReadStream(absPath, { start, end, highWaterMark: 256 * 1024 }),
  };
}
