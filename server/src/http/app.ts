import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { EJS_LOCAL_MOUNT, type Config } from '../config.js';
import type { Catalog } from '../library/catalog.js';
import type { Logger } from '../logger.js';
import { apiRouter } from './routes/api.js';
import { filesRouter, mediaRouter } from './routes/files.js';
import { manifestHandler } from './routes/manifest.js';
import { appCsp, inlineScriptHashes, playerCsp, securityHeaders } from './security.js';

interface Page {
  html: Buffer;
  etag: string;
  csp: string;
}

async function loadPage(file: string, csp: (hashes: string[]) => string): Promise<Page> {
  const html = await fs.readFile(file);
  return {
    html,
    etag: `"p-${createHash('sha1').update(html).digest('base64url').slice(0, 16)}"`,
    csp: csp(inlineScriptHashes(html.toString('utf8'))),
  };
}

function sendPage(page: Page): RequestHandler {
  return (req, res) => {
    res.setHeader('Content-Security-Policy', page.csp);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', page.etag);
    if (req.headers['if-none-match'] === page.etag) {
      res.status(304).end();
      return;
    }
    res.type('html').send(page.html);
  };
}

function requestLog(log: Logger): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      log.debug('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
        range: req.headers.range,
      });
    });
    next();
  };
}

async function mountWebUi(app: Express, config: Config, log: Logger): Promise<void> {
  let appPage: Page;
  let playerPage: Page;
  try {
    appPage = await loadPage(path.join(config.webDir, 'index.html'), appCsp);
    playerPage = await loadPage(path.join(config.webDir, 'play.html'), (hashes) => playerCsp(config, hashes));
  } catch {
    log.warn('web UI build not found; serving the API only', { webDir: config.webDir });
    return;
  }

  app.get('/', sendPage(appPage));
  app.get('/index.html', (_req, res) => res.redirect(301, '/'));
  app.get('/play', sendPage(playerPage));
  app.get('/play.html', (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(301, `/play${query}`);
  });

  // Hashed build output: cache forever.
  app.use(
    '/assets',
    express.static(path.join(config.webDir, 'assets'), { index: false, redirect: false, immutable: true, maxAge: '365d', fallthrough: false }),
  );

  // Everything else in the build (icons, favicon, service worker).
  app.use(
    express.static(config.webDir, {
      index: false,
      redirect: false,
      maxAge: '1d',
      setHeaders: (res, filePath) => {
        const name = path.basename(filePath);
        if (name === 'sw.js') {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/');
        } else if (name.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // Client-side routes: any other GET that wants HTML gets the app shell.
  const shell = sendPage(appPage);
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/(api|files|media|assets|emulatorjs)\//.test(req.path) || !req.accepts('html')) {
      next();
      return;
    }
    shell(req, res, next);
  });
}

export async function createApp(config: Config, catalog: Catalog, log: Logger): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));
  app.use(requestLog(log));

  app.use('/api', apiRouter(config, catalog));
  app.use('/files', filesRouter(config, catalog));
  app.use('/media', mediaRouter(config, catalog));
  if (config.ejsLocalDir) {
    const stat = await fs.stat(path.join(config.ejsLocalDir, 'loader.js')).catch(() => null);
    if (!stat?.isFile()) throw new Error(`EJS_LOCAL_DIR does not contain an EmulatorJS data folder (no loader.js): ${config.ejsLocalDir}`);
    const version = await fs
      .readFile(path.join(config.ejsLocalDir, 'version.json'), 'utf8')
      .then((text) => (JSON.parse(text) as { version?: string }).version)
      .catch(() => undefined);
    log.info('serving bundled EmulatorJS', { version: version ?? 'unknown', path: EJS_LOCAL_MOUNT });
    // Bundled EmulatorJS: versioned with the image, so a day of caching plus revalidation is safe.
    app.use(
      EJS_LOCAL_MOUNT.replace(/\/$/, ''),
      express.static(config.ejsLocalDir, {
        index: false,
        redirect: false,
        fallthrough: false,
        maxAge: '1d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.json')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  }

  const manifest = manifestHandler(config, catalog);
  app.get('/manifest.json', manifest);
  app.get('/manifest.webmanifest', manifest);

  await mountWebUi(app, config, log);

  app.use((req, res) => {
    res.status(404).type('text').send('Not found');
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) log.error('request failed', { method: req.method, path: req.path, error: err as Error });
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status);
    if (req.path.startsWith('/api/')) res.json({ error: status === 404 ? 'not_found' : 'internal_error' });
    else res.type('text').send(status === 404 ? 'Not found' : 'Internal server error');
  };
  app.use(errorHandler);

  return app;
}
