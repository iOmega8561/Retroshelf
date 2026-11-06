import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Config } from '../config.js';

/**
 * Headers applied to every response.
 *
 * COOP + COEP make every page cross-origin isolated, which unlocks SharedArrayBuffer for
 * threaded cores (PSP/PPSSPP, DOSBox Pure). Browsers only honour isolation in secure contexts:
 * HTTPS via the reverse proxy, or http://localhost. The EmulatorJS CDN sends
 * `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *`, so the
 * strict `require-corp` mode works with it.
 */
export function securityHeaders(config: Config): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Permissions-Policy',
      'gamepad=(self), fullscreen=(self), autoplay=(self), screen-wake-lock=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    if (config.coep !== 'off') {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', config.coep);
    }
    next();
  };
}

/** sha256 hashes of inline <script> blocks, so CSP can allow exactly those and nothing else. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const body = match[1] ?? '';
    if (body.trim()) hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

function join(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** Library UI: everything same-origin. */
export function appCsp(inlineHashes: string[]): string {
  return join({
    'default-src': ["'self'"],
    'script-src': ["'self'", ...inlineHashes],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-ancestors': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  });
}

/**
 * Player page. EmulatorJS loads its scripts, styles and localisation from the CDN, compiles
 * WebAssembly, and turns downloaded core JS into blob: scripts and workers, so the policy
 * allows exactly that on top of the app policy.
 */
export function playerCsp(config: Config, inlineHashes: string[]): string {
  const ejs = config.ejsOrigin ? [config.ejsOrigin] : [];
  return join({
    'default-src': ["'self'"],
    'script-src': ["'self'", ...inlineHashes, ...ejs, 'blob:', "'wasm-unsafe-eval'", "'unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'", ...ejs],
    'img-src': ["'self'", 'data:', 'blob:', ...ejs],
    'media-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:', ...ejs],
    'connect-src': ["'self'", 'blob:', 'data:', ...ejs],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-ancestors': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  });
}
