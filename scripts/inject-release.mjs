// Bake the latest GitHub Release's download URLs + version into the landing page
// at build time, so the shipped HTML is fully static (no client-side API calls).
//
// Usage: node scripts/inject-release.mjs <release.json> <index.html>
//   <release.json>  output of `gh release view --json tagName,assets`
//                   (or `{}` when there is no release yet)
//   <index.html>    the page to rewrite in place (the Vite entry, pre-build)
//
// Matches each download button (data-asset="…") to a release asset by filename
// and rewrites its href; fills the version and reveals it. If there's no release,
// it does nothing — the buttons keep their hard-coded /releases href.

import { readFileSync, writeFileSync } from 'node:fs';

const [, , releasePath, htmlPath] = process.argv;
if (!releasePath || !htmlPath) {
  console.error('usage: node scripts/inject-release.mjs <release.json> <index.html>');
  process.exit(1);
}

const rel = JSON.parse(readFileSync(releasePath, 'utf8') || '{}');
const assets = rel.assets || [];
if (!rel.tagName || assets.length === 0) {
  console.log('inject-release: no release found — leaving /releases fallback links.');
  process.exit(0);
}

// data-asset key -> predicate over the asset filename. `gh` exposes the browser
// download URL as asset.url.
const MATCHERS = {
  'dmg-arm64': (n) => /\.dmg$/i.test(n) && /arm64/i.test(n),
  'dmg-x64': (n) => /\.dmg$/i.test(n) && /(x64|x86_64|intel)/i.test(n),
  exe: (n) => /\.exe$/i.test(n),
  deb: (n) => /\.deb$/i.test(n),
  rpm: (n) => /\.rpm$/i.test(n),
};

let html = readFileSync(htmlPath, 'utf8');

for (const [key, match] of Object.entries(MATCHERS)) {
  const asset = assets.find((a) => match(a.name));
  if (!asset) {
    console.warn(`inject-release: no asset matched data-asset="${key}"`);
    continue;
  }
  // Replace the href of the <a> tag carrying data-asset="<key>" (href precedes it).
  const re = new RegExp(`(<a\\s+href=")[^"]*("[^>]*\\bdata-asset="${key}")`);
  const next = html.replace(re, `$1${asset.url}$2`);
  if (next === html) console.warn(`inject-release: could not find link for data-asset="${key}"`);
  html = next;
}

// Fill + reveal the version.
html = html
  .replace('data-dl-version-wrap hidden', 'data-dl-version-wrap')
  .replace('<strong data-dl-version></strong>', `<strong data-dl-version>${rel.tagName}</strong>`);

writeFileSync(htmlPath, html);
console.log(`inject-release: baked ${rel.tagName} (${assets.length} assets) into ${htmlPath}`);
