import type { BiosScan, FileRef } from './scanner.js';
import type { SystemDef } from './systems.js';

export interface BiosResolution {
  /** Folder (relative to the bios root) the files came from, or the one we'd expect. */
  folder: string;
  /** Files handed to the emulator. */
  files: FileRef[];
  /** Every file present for this system (offered for download). */
  available: FileRef[];
  /** How EmulatorJS should receive it. */
  delivery: 'none' | 'file' | 'bundle';
}

/**
 * Pick BIOS files for a ROM folder:
 *  1. bios/<rom folder>, then bios/<canonical key>, then any ES-DE alias folder.
 *  2. Otherwise, matching file names placed flat in the bios root (ES-DE layout).
 * If the system lists preferred names, only those are passed to the core (when any exist).
 * One file is passed as-is; several are wrapped in a virtual ZIP that EmulatorJS extracts.
 */
export function resolveBios(romFolder: string, def: SystemDef, scan: BiosScan): BiosResolution {
  const candidates = [romFolder, def.key, ...def.folders].map((f) => f.toLowerCase());
  let folder = romFolder;
  let available: FileRef[] = [];

  for (const candidate of candidates) {
    const bucket = scan.byFolder.get(candidate);
    if (bucket && bucket.files.length) {
      folder = bucket.folder;
      available = bucket.files;
      break;
    }
  }

  const preferred = def.bios?.files?.map((f) => f.toLowerCase());
  if (!available.length && preferred?.length) {
    available = scan.rootFiles.filter((f) => preferred.includes(f.rel.toLowerCase()));
    if (available.length) folder = '';
  }

  if (!available.length) return { folder, files: [], available, delivery: 'none' };

  let files = available;
  if (preferred?.length) {
    const matching = available.filter((f) => preferred.includes(baseName(f.rel).toLowerCase()));
    if (matching.length) files = matching;
  }

  const delivery = files.length === 1 && !def.bios?.keepArchives ? 'file' : 'bundle';
  return { folder, files, available, delivery };
}

export function baseName(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? rel : rel.slice(slash + 1);
}
