import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// The demo build: the same renderer, but with the whole core bundled into
// the page and `window.api` served in-process against the in-memory demo
// registrar (src/renderer/api/demo.ts). No server, no storage — a static
// page that runs the app on an invented portfolio. See docs/demo.md.
//
//   npm run demo:build  → dist/demo
//   npm run demo:dev    → vite dev server

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DOMBOT_DEMO__: 'true',
  },
  build: {
    outDir: 'dist/demo',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
});
