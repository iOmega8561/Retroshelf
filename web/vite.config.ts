import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const backend = process.env.RETROSHELF_BACKEND ?? 'http://localhost:8080';
const buildId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);

/** In dev, serve the player at /play like the production server does. */
function playerRoute(): Plugin {
  return {
    name: 'retroshelf-player-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/play(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/play/, '/play.html');
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), playerRoute()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: {
    port: 5173,
    // Same isolation as production, so threaded cores (PSP) work on http://localhost:5173.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    proxy: Object.fromEntries(['/api', '/files', '/media', '/manifest.json'].map((path) => [path, { target: backend }])),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      input: {
        main: `${root}index.html`,
        play: `${root}play.html`,
        sw: `${root}src/sw/sw.ts`,
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
