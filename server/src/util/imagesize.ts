import fs from 'node:fs/promises';

export interface ImageSize {
  width: number;
  height: number;
}

const dims = (width: number, height: number): ImageSize | null => (width > 0 && height > 0 ? { width, height } : null);

/**
 * Image dimensions from the file header (PNG, JPEG, GIF, WebP, BMP), without decoding pixels.
 * Returns 'more' when a JPEG frame header lies beyond the bytes provided.
 */
export function imageSizeFromBuffer(b: Buffer): ImageSize | null | 'more' {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
    return dims(b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (b.length >= 10 && b.toString('ascii', 0, 4) === 'GIF8') return dims(b.readUInt16LE(6), b.readUInt16LE(8));
  if (b.length >= 26 && b.toString('ascii', 0, 2) === 'BM') return dims(b.readInt32LE(18), Math.abs(b.readInt32LE(22)));
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return dims(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const [b0, b1, b2, b3] = [b[21]!, b[22]!, b[23]!, b[24]!];
      return dims(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
    }
    if (chunk === 'VP8X') return dims(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i += 1; // fill byte
      } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2; // markers without a length
      } else if (marker === 0xd9 || marker === 0xda) {
        return null; // end of image / start of scan before any frame header
      } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return dims(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)); // SOFn: precision, height, width
      } else {
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
    return 'more';
  }
  return null;
}

/** Reads as little of the file as possible: 4 KiB, then 64 KiB, then 512 KiB for JPEGs with big EXIF blocks. */
export async function readImageSize(absPath: string): Promise<ImageSize | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(absPath, 'r');
    for (const length of [4096, 65536, 524288]) {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      const result = imageSizeFromBuffer(buffer.subarray(0, bytesRead));
      if (result !== 'more') return result;
      if (bytesRead < length) return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
