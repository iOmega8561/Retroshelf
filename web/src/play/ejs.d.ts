/**
 * The slice of EmulatorJS 4.2.x that Retroshelf relies on (configuration globals read by
 * loader.js, plus the emulator instance it exposes as window.EJS_emulator).
 */

interface EmscriptenFs {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
  syncfs(populate: boolean, callback: (error?: unknown) => void): void;
}

interface EjsGameManager {
  FS: EmscriptenFs;
  getState(): Uint8Array;
  loadState(state: Uint8Array): void;
  getSaveFilePath(): string;
  getSaveFile(save?: boolean): Uint8Array | null;
  saveSaveFiles(): void;
  loadSaveFiles(): void;
}

interface EjsEmulator {
  started?: boolean;
  paused?: boolean;
  gameManager?: EjsGameManager;
  on(event: string, callback: (data?: unknown) => void): void;
  pause?(dontUpdate?: boolean): void;
  play?(dontUpdate?: boolean): void;
  displayMessage?(message: string, durationMs?: number): void;
  getSettingValue?(id: string): string | null;
  takeScreenshot?(source?: string, format?: string, upscale?: number): Promise<{ blob?: Blob; screenshot?: Blob; format?: string }>;
}

interface Window {
  EJS_player?: string;
  EJS_core?: string;
  EJS_gameUrl?: string;
  EJS_biosUrl?: string;
  EJS_pathtodata?: string;
  EJS_gameName?: string;
  EJS_threads?: boolean;
  EJS_color?: string;
  EJS_backgroundColor?: string;
  EJS_startOnLoaded?: boolean;
  EJS_CacheLimit?: number;
  EJS_defaultOptions?: Record<string, string>;
  EJS_Buttons?: Record<string, boolean>;
  EJS_onSaveState?: (event: { state: Uint8Array }) => void;
  EJS_onLoadState?: () => void;
  EJS_onGameStart?: () => void;
  EJS_ready?: () => void;
  EJS_emulator?: EjsEmulator;
}

/* Internals used to work around EmulatorJS 4.2.x dropping early gamepad connections. */
interface EjsEmulator {
  gamepad?: { gamepads: Array<{ id: string; index: number }> };
  gamepadSelection?: string[];
  gamepadLabels?: unknown[];
  updateGamepadLabels?(): void;
}

interface Window {
  EJS_language?: string;
}
