/**
 * Retroshelf service worker.
 *
 *  - App shell (HTML pages + hashed assets) is precached at install, so the library opens offline.
 *  - /api/library and /api/games/* are network-first with a cached fallback.
 *  - Cover art is stale-while-revalidate with a bounded cache.
 *  - ROMs and BIOS (/files/*) are never touched: they're large, use byte ranges, and
 *    EmulatorJS already caches them in IndexedDB.
 *  - Cross-origin requests (the EmulatorJS CDN) pass straight through.
 *
 * Built as a standalone classic script (no imports) so every browser can register it.
 */

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const SHELL_CACHE = `rs-shell-${__BUILD_ID__}`;
const DATA_CACHE = 'rs-data-v1';
const MEDIA_CACHE = 'rs-media-v1';
/** Bundled EmulatorJS scripts, styles and translations (cores are cached by EmulatorJS itself). */
const EMULATOR_CACHE = 'rs-emulatorjs-v1';
const MEDIA_LIMIT = 1500;
const DATA_LIMIT = 400;
const PAGES = ['/', '/play'];
const STATIC = ['/manifest.json', '/favicon.svg', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

function pageKey(url: URL): string {
  return url.pathname === '/play' || url.pathname === '/play.html' ? '/play' : '/';
}

async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  const assets = new Set<string>(STATIC);
  for (const page of PAGES) {
    const response = await fetch(page, { cache: 'no-cache' });
    if (!response.ok) continue;
    const html = await response.clone().text();
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) if (match[1]) assets.add(match[1]);
    await cache.put(page, response);
  }
  // Fonts referenced from stylesheets.
  for (const asset of [...assets].filter((a) => a.endsWith('.css'))) {
    try {
      const css = await (await fetch(asset)).text();
      for (const match of css.matchAll(/url\((\/assets\/[^)]+)\)/g)) if (match[1]) assets.add(match[1]);
    } catch {
      /* offline during install: runtime caching fills the gap */
    }
  }
  await Promise.all(
    [...assets].map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        /* ignore individual failures */
      }
    }),
  );
}

async function trim(cacheName: string, limit: number): Promise<void> {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(request);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('rs-shell-') && name !== SHELL_CACHE).map((name) => caches.delete(name)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

async function navigate(event: FetchEvent, url: URL): Promise<Response> {
  const key = pageKey(url);
  try {
    const preloaded = (await event.preloadResponse) as Response | undefined;
    const response = preloaded ?? (await fetch(event.request));
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(key, copy)));
    }
    return response;
  } catch {
    const cached = await caches.match(key);
    return cached ?? new Response('Retroshelf is offline and this page isn\u2019t cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(event: FetchEvent, cacheName: string, limit: number): Promise<Response> {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(cacheName)
          .then((cache) => cache.put(event.request, copy))
          .then(() => trim(cacheName, limit)),
      );
    }
    return response;
  } catch (error) {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    throw error;
  }
}

let mediaWrites = 0;
async function staleWhileRevalidate(event: FetchEvent, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok && response.type === 'basic') {
        await cache.put(event.request, response.clone());
        mediaWrites += 1;
        if (cacheName === MEDIA_CACHE && mediaWrites % 50 === 0) await trim(MEDIA_CACHE, MEDIA_LIMIT);
      }
      return response;
    })
    .catch(() => cached ?? Response.error());
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/files/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, url));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  } else if (url.pathname === '/api/library' || url.pathname.startsWith('/api/games/')) {
    event.respondWith(networkFirst(event, DATA_CACHE, DATA_LIMIT));
  } else if (url.pathname.startsWith('/emulatorjs/') && !url.pathname.endsWith('.data')) {
    event.respondWith(staleWhileRevalidate(event, EMULATOR_CACHE));
  } else if (url.pathname.startsWith('/media/')) {
    event.respondWith(staleWhileRevalidate(event, MEDIA_CACHE));
  } else if (STATIC.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
  }
});
