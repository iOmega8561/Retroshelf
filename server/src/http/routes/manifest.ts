import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Config } from '../../config.js';
import type { Catalog } from '../../library/catalog.js';

const DESCRIPTIONS = {
  en: 'Your retro game library, playable in the browser.',
  it: 'La tua libreria di giochi retr\u00f2, giocabile nel browser.',
} as const;
type Locale = keyof typeof DESCRIPTIONS;

/** First supported language in Accept-Language preference order; English otherwise. */
export function preferredLocale(header: string | undefined): Locale {
  const ranked = (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { base: tag.toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.base && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { base } of ranked) if (base === 'en' || base === 'it') return base;
  return 'en';
}

/**
 * Generated per request so the installed app carries the configured name, a description in the
 * visitor's language, and jump-list shortcuts to the largest systems in this library.
 */
export function manifestHandler(config: Config, catalog: Catalog): RequestHandler {
  return (req, res) => {
    const lang = preferredLocale(req.headers['accept-language']);
    const manifest = {
      id: '/',
      lang,
      dir: 'ltr',
      name: config.appName,
      short_name: config.appName.length > 12 ? config.appName.slice(0, 12) : config.appName,
      description: DESCRIPTIONS[lang],
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#1a1630',
      theme_color: '#1a1630',
      categories: ['games', 'entertainment'],
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
      shortcuts: catalog.topSystems(4).map((system) => ({
        name: system.name,
        short_name: system.shortName,
        url: `/?system=${encodeURIComponent(system.id)}`,
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      })),
    };
    const body = JSON.stringify(manifest);
    const etag = `"m-${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Accept-Language');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type('application/manifest+json').send(body);
  };
}
