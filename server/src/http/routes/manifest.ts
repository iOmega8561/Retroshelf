import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Config } from '../../config.js';
import type { Catalog } from '../../library/catalog.js';

/**
 * Generated per request so the installed app carries the configured name and jump-list
 * shortcuts to the largest systems in this particular library.
 */
export function manifestHandler(config: Config, catalog: Catalog): RequestHandler {
  return (req, res) => {
    const manifest = {
      id: '/',
      name: config.appName,
      short_name: config.appName.length > 12 ? config.appName.slice(0, 12) : config.appName,
      description: 'Your retro game library, playable in the browser.',
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
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type('application/manifest+json').send(body);
  };
}
