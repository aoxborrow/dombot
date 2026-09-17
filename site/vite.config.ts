import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { bakeRelease } from '../scripts/inject-release.mjs';

// Standalone Vite project for the marketing/landing site (separate from the
// Electron app's Vite configs at the repo root). Run via the site:* scripts,
// which pass this directory as the Vite root so this config is picked up.
//
//   npm run site:dev      # dev server with HMR, http://localhost:8794
//   npm run site:build    # production build → site/dist (deployed by Workers Builds)
//   npm run site:preview   # serve the built site locally
//
// base: './' keeps every asset URL relative, so the build works unchanged
// whether it's served from a project path (aoxborrow.github.io/dombot/) or a
// custom domain at the root.
// The latest release, recorded in the repo by the release workflow.
const release = JSON.parse(
  readFileSync(new URL('./release.json', import.meta.url), 'utf8'),
) as { tagName?: string; assets?: { name: string; url: string }[] };

export default defineConfig({
  plugins: [
    {
      name: 'bake-release',
      transformIndexHtml: (html) => bakeRelease(html, release),
    },
  ],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: { port: 8794 },
  preview: { port: 8794 },
});
