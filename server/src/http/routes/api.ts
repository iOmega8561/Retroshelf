import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { HealthPayload, LibraryPayload } from '../../../../shared/api.js';
import type { Config } from '../../config.js';
import type { Catalog } from '../../library/catalog.js';

function notModified(req: Request, etag: string): boolean {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
}

function sendJson(req: Request, res: Response, body: unknown, etag?: string): void {
  res.setHeader('Cache-Control', 'no-cache');
  if (etag) {
    res.setHeader('ETag', etag);
    if (notModified(req, etag)) {
      res.status(304).end();
      return;
    }
  }
  res.type('application/json').send(JSON.stringify(body));
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function apiRouter(config: Config, catalog: Catalog): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/health', (_req, res) => {
    const body: HealthPayload = {
      status: 'ok',
      scanning: catalog.scanning,
      ready: catalog.ready,
      games: catalog.gameCount,
      systems: catalog.systemCount,
      scannedAt: catalog.scannedAt?.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  router.get('/library', (req, res) => {
    const payload = catalog.payload();
    if (!payload) {
      const body: LibraryPayload = { status: 'scanning', systems: [], games: [] };
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '2');
      res.json(body);
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', payload.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    if (notModified(req, payload.etag)) {
      res.status(304).end();
      return;
    }
    const accept = String(req.headers['accept-encoding'] ?? '');
    res.type('application/json');
    if (/\bbr\b/.test(accept)) {
      res.setHeader('Content-Encoding', 'br');
      res.send(payload.br);
    } else if (/\bgzip\b/.test(accept)) {
      res.setHeader('Content-Encoding', 'gzip');
      res.send(payload.gzip);
    } else {
      res.send(payload.identity());
    }
  });

  router.get('/systems', (req, res) => {
    sendJson(req, res, catalog.systems(), catalog.payload()?.etag);
  });

  router.get('/games/:id', (req, res) => {
    const id = req.params.id;
    const game = /^[A-Za-z0-9_-]{6,32}$/.test(id) ? catalog.game(id) : undefined;
    const detail = game ? catalog.detail(game) : null;
    if (!detail) {
      res.status(catalog.ready ? 404 : 503).json({ error: catalog.ready ? 'game_not_found' : 'library_scanning' });
      return;
    }
    const libraryEtag = catalog.payload()?.etag.replace(/"/g, '');
    sendJson(req, res, detail, libraryEtag ? `"${libraryEtag}-${id}"` : undefined);
  });

  router.post('/scan', (req, res) => {
    // Browsers label cross-site requests; refuse them so other sites can't trigger rescans.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: 'cross_site_request' });
      return;
    }
    if (config.scanToken && !tokenMatches(req.headers.authorization, config.scanToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'scan_token_required' });
      return;
    }
    const result = catalog.requestScan();
    if (result.status === 'cooldown' && result.retryAfterSeconds) res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(result.status === 'cooldown' ? 429 : 202).json(result);
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return router;
}
