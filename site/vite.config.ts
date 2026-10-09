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
// Every published release, newest first, recorded in the repo by the release
// workflow. It's also served as-is at dombot.ai/releases.json, where the app
// reads it to tell users a newer version is out; the page bakes in the
// newest one's downloads.
const { releases = [] } = JSON.parse(
  readFileSync(new URL('./public/releases.json', import.meta.url), 'utf8'),
) as { releases?: { tag: string; assets: { name: string; url: string }[] }[] };
const release = releases[0]
  ? { tagName: releases[0].tag, assets: releases[0].assets }
  : {};

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
