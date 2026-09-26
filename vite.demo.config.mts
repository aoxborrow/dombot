import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
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

// The shared index.html carries only what the desktop app needs. The demo is
// a public web page, so give it the same head as the marketing site: a title,
// description, canonical URL, sharing card and favicon. The favicon is the
// site's own file (Vite bundles it as an asset); the card image is served by
// dombot.ai, so there is one copy of each.
const DESCRIPTION =
  'Try DomBot in your browser. All your domains from all your registrars in one app. ' +
  'Track spending, manage in bulk, organize with folders, and connect any agent over MCP. ' +
  'Free and open source.';
const TITLE = 'DomBot Demo — A better way to manage your domain portfolio';

function demoHead(): Plugin {
  return {
    name: 'dombot-demo-head',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tags = [
            { tag: 'meta', attrs: { name: 'theme-color', content: '#0a0a0a' } },
            { tag: 'meta', attrs: { name: 'description', content: DESCRIPTION } },
            { tag: 'link', attrs: { rel: 'canonical', href: 'https://demo.dombot.ai/' } },
            { tag: 'meta', attrs: { property: 'og:site_name', content: 'DomBot' } },
            { tag: 'meta', attrs: { property: 'og:title', content: TITLE } },
            { tag: 'meta', attrs: { property: 'og:description', content: DESCRIPTION } },
            { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
            { tag: 'meta', attrs: { property: 'og:url', content: 'https://demo.dombot.ai/' } },
            { tag: 'meta', attrs: { property: 'og:image', content: 'https://dombot.ai/og-image.png' } },
            { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
            { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
            {
              tag: 'meta',
              attrs: {
                property: 'og:image:alt',
                content: 'DomBot Domains screen — every domain across all your registrars in one table',
              },
            },
            { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
            { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/site/public/favicon.svg' } },
        ];
        return {
          html: html.replace('<title>DomBot</title>', `<title>${TITLE}</title>`),
          tags: tags.map((t) => ({ ...t, injectTo: 'head' as const })),
        };
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), demoHead()],
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
