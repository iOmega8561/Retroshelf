import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function serialize(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    const rendered =
      value instanceof Error ? JSON.stringify(value.message) : typeof value === 'string' ? JSON.stringify(value) : String(value);
    parts.push(`${key}=${rendered}`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** Plain single-line logs to stdout/stderr; journald/podman add timestamps. */
export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];
  const write = (lvl: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[lvl] < threshold) return;
    const line = `[${lvl}] ${msg}${serialize(meta)}\n`;
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line);
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}
