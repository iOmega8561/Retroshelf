import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

/**
 * Virtual, uncompressed ("stored") ZIP archives assembled on the fly from files on disk.
 *
 * Used to hand EmulatorJS a single URL for things that live in several files: cue/bin disc
 * sets, multi-disc m3u playlists and multi-file BIOS folders. EmulatorJS detects ZIPs by magic
 * bytes and extracts them into the core's filesystem.
 *
 * The archive is fully deterministic (fixed entry order, timestamps from mtimes, CRCs written
 * up front rather than in data descriptors), so its size, ETag and every byte offset are known
 * in advance. That makes HEAD and HTTP Range requests work exactly as they do for plain files,
 * and nothing is ever buffered in memory beyond the small header blocks.
 *
 * Limits: classic ZIP (no ZIP64) – each file and the whole archive must stay under 4 GiB.
 */

export interface ZipEntryInput {
  /** Path inside the archive (POSIX, no leading slash). */
  name: string;
  absPath: string;
  size: number;
  mtimeMs: number;
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const MAX_U32 = 0xffffffff;
const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = (3 << 8) | 30; // UNIX, spec 3.0

type Segment = { start: number; length: number } & ({ kind: 'buffer'; data: Buffer } | { kind: 'file'; absPath: string });

export interface ZipLayout {
  size: number;
  segments: Segment[];
}

/** Total archive size, computable without reading any file data. */
export function zipSize(entries: readonly ZipEntryInput[]): number {
  let total = END_RECORD;
  for (const entry of entries) {
    const nameLength = Buffer.byteLength(entry.name, 'utf8');
    total += LOCAL_HEADER + nameLength + entry.size + CENTRAL_HEADER + nameLength;
  }
  return total;
}

export function canZip(entries: readonly ZipEntryInput[]): boolean {
  return (
    entries.length > 0 &&
    entries.length < 0xffff &&
    entries.every((e) => e.size < MAX_U32 && Buffer.byteLength(e.name, 'utf8') < 0xffff) &&
    zipSize(entries) < MAX_U32
  );
}

function dosDateTime(mtimeMs: number): { date: number; time: number } {
  const d = new Date(mtimeMs);
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

export function buildZipLayout(entries: readonly ZipEntryInput[], crcs: readonly number[]): ZipLayout {
  if (!canZip(entries)) throw new RangeError('Archive exceeds classic ZIP limits');
  const segments: Segment[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  entries.forEach((entry, index) => {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crcs[index] ?? 0;
    const { date, time } = dosDateTime(entry.mtimeMs);

    const local = Buffer.alloc(LOCAL_HEADER + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.size, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, LOCAL_HEADER);

    const header = Buffer.alloc(CENTRAL_HEADER + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(VERSION_MADE_BY, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // disk
    header.writeUInt16LE(0, 36); // internal attrs
    header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    header.writeUInt32LE(offset, 42);
    name.copy(header, CENTRAL_HEADER);
    central.push(header);

    segments.push({ kind: 'buffer', data: local, start: offset, length: local.length });
    offset += local.length;
    segments.push({ kind: 'file', absPath: entry.absPath, start: offset, length: entry.size });
    offset += entry.size;
  });

  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(END_RECORD);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  const tail = Buffer.concat([centralDir, end]);
  segments.push({ kind: 'buffer', data: tail, start: offset, length: tail.length });
  offset += tail.length;

  return { size: offset, segments };
}

/** Stream bytes [start, end] (inclusive) of a laid-out archive. */
export function streamZipRange(layout: ZipLayout, start: number, end: number): Readable {
  async function* generate(): AsyncGenerator<Buffer> {
    for (const segment of layout.segments) {
      const segEnd = segment.start + segment.length - 1;
      if (segment.length === 0 || segEnd < start || segment.start > end) continue;
      const from = Math.max(start, segment.start) - segment.start;
      const to = Math.min(end, segEnd) - segment.start;
      if (segment.kind === 'buffer') {
        yield segment.data.subarray(from, to + 1);
      } else {
        for await (const chunk of createReadStream(segment.absPath, { start: from, end: to, highWaterMark: 256 * 1024 })) {
          yield chunk as Buffer;
        }
      }
    }
  }
  return Readable.from(generate(), { objectMode: false });
}

/* ---------- CRC32 with a small bounded cache and single-flight computation ---------- */

const CRC_CACHE_LIMIT = 4096;
const crcCache = new Map<string, { size: number; mtimeMs: number; crc: number }>();
const inflight = new Map<string, Promise<number>>();

async function computeCrc(absPath: string): Promise<number> {
  let crc = 0;
  for await (const chunk of createReadStream(absPath, { highWaterMark: 1024 * 1024 })) {
    crc = zlib.crc32(chunk as Buffer, crc);
  }
  return crc >>> 0;
}

export async function crc32ForFile(entry: ZipEntryInput): Promise<number> {
  const cached = crcCache.get(entry.absPath);
  if (cached && cached.size === entry.size && cached.mtimeMs === entry.mtimeMs) {
    crcCache.delete(entry.absPath); // refresh LRU position
    crcCache.set(entry.absPath, cached);
    return cached.crc;
  }
  const key = `${entry.absPath}|${entry.size}|${entry.mtimeMs}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = computeCrc(entry.absPath).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const crc = await pending;
  crcCache.set(entry.absPath, { size: entry.size, mtimeMs: entry.mtimeMs, crc });
  if (crcCache.size > CRC_CACHE_LIMIT) {
    const oldest = crcCache.keys().next().value;
    if (oldest !== undefined) crcCache.delete(oldest);
  }
  return crc;
}

export async function crc32ForEntries(entries: readonly ZipEntryInput[]): Promise<number[]> {
  const crcs: number[] = [];
  for (const entry of entries) crcs.push(await crc32ForFile(entry)); // sequential: friendlier to spinning disks
  return crcs;
}
