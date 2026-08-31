import { defineConfig } from 'vite';

// Standalone Vite project for the marketing/landing site (separate from the
// Electron app's Vite configs at the repo root). Run via the site:* scripts,
// which pass this directory as the Vite root so this config is picked up.
//
//   npm run site:dev      # dev server with HMR, http://localhost:8794
//   npm run site:build    # production build → site/dist (deployed to Pages)
//   npm run site:preview   # serve the built site locally
//
// base: './' keeps every asset URL relative, so the build works unchanged
// whether it's served from a project path (aoxborrow.github.io/dombot/) or a
// custom domain at the root.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: { port: 8794 },
  preview: { port: 8794 },
});
