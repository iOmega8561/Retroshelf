/**
 * Container health probe (Quadlet HealthCmd / Docker HEALTHCHECK) without curl or wget.
 * Exits 0 when the HTTP server answers /api/health.
 */
const port = Number(process.env.PORT) || 8080;

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
