const sizeUnits = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < sizeUnits.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${sizeUnits[unit]}`;
}

const numberFormat = new Intl.NumberFormat();
export const formatCount = (n: number) => numberFormat.format(n);

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "2001-09-10" → "10 September 2001" in the reader's locale; "1996" stays "1996". */
export function formatReleaseDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  if (!year) return undefined;
  if (!month) return String(year);
  const options: Intl.DateTimeFormatOptions = day ? { year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long' };
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(Date.UTC(year, month - 1, day || 1));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function formatRelative(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), 'day');
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}

/**
 * Deterministic hue for placeholder art, picked from a curated set that sits well next to the
 * violet accent (no olive or brown, which turn muddy at label lightness).
 */
const LABEL_HUES = [295, 268, 242, 215, 188, 162, 350, 18, 330];
export function hueFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return LABEL_HUES[Math.abs(hash) % LABEL_HUES.length]!;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'game';
}
