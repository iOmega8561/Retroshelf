/**
 * Wire contract between the Retroshelf server and its web client.
 * Declaration-only on purpose: both sides import it with `import type`,
 * so nothing from this file is ever emitted or shipped at runtime.
 */

export type SystemMode = 'play' | 'download';

/**
 * User-facing text is never sent by the server: these codes are translated by the client
 * (web/src/i18n), so every language ships complete with the UI.
 */
export type UnplayableReason = 'no-browser-core' | 'archive-too-large';
export type GuideId =
  | 'azahar'
  | 'dolphin-gc'
  | 'dolphin-wii'
  | 'cemu'
  | 'switch'
  | 'pcsx2'
  | 'rpcs3'
  | 'vita3k'
  | 'flycast'
  | 'xemu'
  | 'xenia'
  | 'unknown';
/** Kind of extras folder a file came from ("UPDATE", "DLC", "PATCH", "ADD-ONS"). */
export type ExtraKind = 'update' | 'dlc' | 'patch' | 'addon';

export type BiosNoteId = 'gba-optional' | 'nds-optional' | 'psx-hle' | 'ps2-required' | 'saturn-hle' | 'dreamcast-optional' | 'amiga-aros';

export interface SystemSummary {
  /** Folder name under /library/roms, used as the stable system id. */
  id: string;
  name: string;
  shortName: string;
  /** Brand name, or `Other` for unrecognised folders (translated by the client). */
  manufacturer: string;
  year?: number;
  /** `play`: runs in the browser. `download`: offer files + setup guide. */
  mode: SystemMode;
  /** Core needs SharedArrayBuffer, i.e. a cross-origin isolated secure context. */
  requiresIsolation: boolean;
  gameCount: number;
  /** Approximate box-art aspect ratio (width / height) for grid tiles. */
  coverAspect: number;
}

export interface GameSummary {
  id: string;
  system: string;
  name: string;
  /** Normalised, lowercase key for stable alphabetical sorting. */
  sortName: string;
  year?: number;
  /** ISO date, `YYYY-MM-DD` or `YYYY`. */
  releaseDate?: string;
  genres?: string[];
  developer?: string;
  publisher?: string;
  players?: string;
  /** 0..1, as stored by ES-DE. */
  rating?: number;
  cover?: string;
  /** Real width / height of the cover image, measured by the server, so grids lay out before images load. */
  coverAspect?: number;
  fileName: string;
  size: number;
  /** Disc set (cue/bin, m3u, gdi, ccd) served as a single archive. */
  multiFile?: boolean;
  /** Number of update / DLC / patch / add-on files that belong to the game. */
  extraCount?: number;
  /** ES-DE folder game ("Game.ps3/"): the whole directory is the game. */
  directory?: boolean;
}

export interface LibraryPayload {
  status: 'ready' | 'scanning';
  scannedAt?: string;
  durationMs?: number;
  systems: SystemSummary[];
  games: GameSummary[];
}

export interface FileLink {
  name: string;
  size: number;
  url: string;
}

export interface ExtraLink extends FileLink {
  kind: ExtraKind;
}

export interface PlayConfig {
  /** Value for EJS_core. */
  core: string;
  gameUrl: string;
  biosUrl?: string;
  /** Stable, filesystem-safe name EmulatorJS uses for settings/state keys. */
  gameName: string;
  threads: boolean;
  /** EmulatorJS data path (CDN), always ending in `/`. */
  dataPath: string;
  /** Max ROM size EmulatorJS caches in IndexedDB (bytes). */
  cacheLimit: number;
}

export interface BiosInfo {
  required: boolean;
  present: boolean;
  /** Folder the server looks in, relative to /library/bios. */
  folder: string;
  expected?: string[];
  note?: BiosNoteId;
  files: FileLink[];
  bundle?: FileLink;
}

export interface SetupGuide {
  guide: GuideId;
  /** Proper name of the recommended emulator, when there is a single obvious one. */
  emulator?: string;
  url?: string;
}

export interface GameMedia {
  cover?: string;
  screenshot?: string;
  titlescreen?: string;
  marquee?: string;
  fanart?: string;
  video?: string;
}

export interface GameDetail extends GameSummary {
  systemName: string;
  /** Default description (`<desc>`). */
  description?: string;
  /** Translations from `<desc lang="…">`, keyed by base language ("en", "it"). */
  descriptions?: Record<string, string>;
  media: GameMedia;
  /** Single best download: the ROM itself, or a zip of the disc set. */
  download?: FileLink;
  /** The file(s) the emulator receives: primary file and disc-set members. */
  files: FileLink[];
  /** Updates, DLC, patches and add-ons from the game's extras folders. */
  extras: ExtraLink[];
  /** The game folder, or the game plus its extras, as one streamed ZIP (size unknown for folder games: 0). */
  downloadAll?: FileLink;
  play?: PlayConfig;
  unplayableReason?: UnplayableReason;
  bios: BiosInfo;
  setup?: SetupGuide;
}

export interface HealthPayload {
  status: 'ok';
  scanning: boolean;
  ready: boolean;
  games: number;
  systems: number;
  scannedAt?: string;
  uptimeSeconds: number;
  /** Where the player loads EmulatorJS from. */
  emulatorjs: 'cdn' | 'bundled';
}

export interface ScanResponse {
  status: 'started' | 'running' | 'cooldown';
  retryAfterSeconds?: number;
}
