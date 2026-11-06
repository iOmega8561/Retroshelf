import { ConfigError, loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { Catalog } from './library/catalog.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`[error] invalid configuration: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const log = createLogger(config.logLevel);
  const catalog = new Catalog(config, log);
  let app;
  try {
    app = await createApp(config, catalog, log);
  } catch (error) {
    log.error('startup failed', { error: error as Error });
    process.exit(1);
  }

  const server = app.listen(config.port, config.host, () => {
    log.info('listening', {
      address: `http://${config.host}:${config.port}`,
      library: config.libraryDir,
      coep: config.coep,
      emulatorjs: config.ejsLocalDir ? `bundled (${config.ejsLocalDir})` : config.ejsDataPath,
    });
  });
  // Outlive typical reverse-proxy idle timeouts so pooled upstream connections aren't reset.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Serve requests right away; the library fills in when the first scan completes.
  void catalog.scan('startup').catch((error: unknown) => log.error('initial scan failed', { error: error as Error }));
  catalog.startPeriodicRescan();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    catalog.stop();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    // Long ROM downloads shouldn't hold the container hostage.
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { error: reason as Error }));
}

void main();
