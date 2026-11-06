/*
 * Locale-independent helpers. Anything a person reads (numbers, sizes, dates) is formatted by
 * the translator in ../i18n so it follows the active language.
 */

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
