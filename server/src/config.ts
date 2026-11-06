import path from 'node:path';

export type CoepMode = 'require-corp' | 'credentialless' | 'off';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  host: string;
  port: number;
  appName: string;
  libraryDir: string;
  romsDir: string;
  biosDir: string;
  /** Built Vite output. Missing in dev, where Vite serves the UI itself. */
  webDir: string;
  /** EmulatorJS data folder (CDN by default). Always ends with `/`. */
  ejsDataPath: string;
  /** Local EmulatorJS `data/` folder served at EJS_LOCAL_MOUNT (the full image sets this). */
  ejsLocalDir: string | null;
  /** Origin of ejsDataPath for CSP, or null when served from this origin. */
  ejsOrigin: string | null;
  ejsCacheLimitBytes: number;
  coep: CoepMode;
  scanToken: string | null;
  scanCooldownMs: number;
  rescanIntervalMs: number;
  maxScanDepth: number;
  maxGamelistBytes: number;
  showHidden: boolean;
  followSymlinks: boolean;
  trustProxy: string | boolean;
  logLevel: LogLevel;
}

class ConfigError extends Error {}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${name} must be a boolean (got "${raw}")`);
}

function oneOf<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const raw = str(name, fallback) as T;
  if (!allowed.includes(raw)) {
    throw new ConfigError(`${name} must be one of ${allowed.join(', ')} (got "${raw}")`);
  }
  return raw;
}

function parseEjsPath(raw: string): { dataPath: string; origin: string | null } {
  const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
  if (withSlash.startsWith('/')) return { dataPath: withSlash, origin: null };
  let url: URL;
  try {
    url = new URL(withSlash);
  } catch {
    throw new ConfigError(`EJS_DATA_PATH must be an absolute URL or a path starting with "/" (got "${raw}")`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`EJS_DATA_PATH must use http(s) (got "${url.protocol}")`);
  }
  return { dataPath: url.href, origin: url.origin };
}

function parseTrustProxy(raw: string): string | boolean {
  const lower = raw.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false' || lower === '') return false;
  return raw; // e.g. "loopback", "10.0.0.0/8", "1"
}

/** URL path where a bundled EmulatorJS (EJS_LOCAL_DIR) is served. */
export const EJS_LOCAL_MOUNT = '/emulatorjs/data/';

export function loadConfig(): Config {
  const libraryDir = path.resolve(str('LIBRARY_DIR', '/library'));
  const ejsLocalDir = process.env.EJS_LOCAL_DIR?.trim() ? path.resolve(process.env.EJS_LOCAL_DIR.trim()) : null;
  // A bundled copy is used by default when present; EJS_DATA_PATH can still point elsewhere.
  const ejs = parseEjsPath(str('EJS_DATA_PATH', ejsLocalDir ? EJS_LOCAL_MOUNT : 'https://cdn.emulatorjs.org/stable/data/'));
  const scanToken = process.env.SCAN_TOKEN?.trim() || null;

  return {
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 8080, 1, 65535),
    appName: str('APP_NAME', 'Retroshelf').slice(0, 40),
    libraryDir,
    romsDir: path.resolve(str('ROMS_DIR', path.join(libraryDir, 'roms'))),
    biosDir: path.resolve(str('BIOS_DIR', path.join(libraryDir, 'bios'))),
    webDir: path.resolve(str('WEB_DIR', path.join(process.cwd(), '..', 'web', 'dist'))),
    ejsDataPath: ejs.dataPath,
    ejsLocalDir,
    ejsOrigin: ejs.origin,
    ejsCacheLimitBytes: int('EJS_CACHE_LIMIT_MB', 1024, 0, 16384) * 1024 * 1024,
    coep: oneOf<CoepMode>('COEP', 'require-corp', ['require-corp', 'credentialless', 'off']),
    scanToken,
    scanCooldownMs: int('SCAN_COOLDOWN_SECONDS', 10, 0, 86400) * 1000,
    rescanIntervalMs: int('RESCAN_INTERVAL_MINUTES', 0, 0, 10080) * 60_000,
    maxScanDepth: int('MAX_SCAN_DEPTH', 4, 1, 16),
    maxGamelistBytes: int('MAX_GAMELIST_MB', 64, 1, 1024) * 1024 * 1024,
    showHidden: bool('SHOW_HIDDEN', false),
    followSymlinks: bool('FOLLOW_SYMLINKS', false),
    trustProxy: parseTrustProxy(str('TRUST_PROXY', 'loopback')),
    logLevel: oneOf<LogLevel>('LOG_LEVEL', 'info', ['debug', 'info', 'warn', 'error']),
  };
}

export { ConfigError };
