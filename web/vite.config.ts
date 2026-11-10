import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev` serves the API on 8787; `npm run dev:web` proxies to it so the
// browser only ever sees one origin (set PUBLIC_URL=http://localhost:5173).
const backend = process.env.PLANTES_BACKEND ?? 'http://127.0.0.1:8787';
const proxied = ['/api', '/auth', '/oauth', '/mcp', '/photos', '/p/', '/.well-known', '/healthz'];

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map((path) => [path, { target: backend }])),
  },
});
