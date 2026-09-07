import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// The renderer built for the web host (Cloudflare Worker static assets).
// Same source as the Electron renderer (vite.renderer.config.mts); the
// differences are the output directory and that the browser runtime, not
// Electron, provides `window.api` (see src/renderer/api/http.ts).
//
//   npm run web:build   → dist/web
//   npm run web:dev     → vite build --watch + wrangler dev

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    // The Worker serves a strict `script-src 'self'` CSP; keep the build free
    // of inline scripts (same reason as the Electron renderer build).
    modulePreload: { polyfill: false },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
});
