import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Electron always ships a current Chromium, so the module-preload polyfill
    // is dead weight — and, more importantly, Vite injects it as an inline
    // <script> that a strict `script-src 'self'` CSP would block. Dropping it
    // keeps the renderer's scripts fully external and same-origin (see the CSP
    // in src/main/index.ts).
    modulePreload: { polyfill: false },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
});
