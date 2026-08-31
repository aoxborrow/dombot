// Build the static landing page. The source (site/src/index.html) keeps its
// CSS and JS inline so it's easy to edit in one file; this build extracts them
// into minified external assets and rewrites the HTML to link them:
//
//   site/src/index.html  ->  site/dist/index.html   (HTML, minified)
//                            site/dist/styles.css    (extracted <style>, minified)
//                            site/dist/app.js         (extracted <script>, minified)
//
//   node scripts/build-site.mjs          # build
//   node scripts/build-site.mjs --check  # verify dist is up to date (CI/pre-push)
//
// Asset links carry a ?v=<hash> of their content for cache-busting. dist/ is
// generated and git-ignored.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import CleanCSS from 'clean-css';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'site', 'src', 'index.html');
const OUT_DIR = join(root, 'site', 'dist');
const check = process.argv.includes('--check');

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

const source = await readFile(SRC, 'utf8');

// ── Extract the single inline <style> and <script> blocks ──
const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);
const scriptMatch = source.match(/<script>([\s\S]*?)<\/script>/);
if (!styleMatch) throw new Error('No inline <style> block found in source.');
if (!scriptMatch) throw new Error('No inline <script> block found in source.');

// ── Minify the extracted CSS and JS ──
const css = new CleanCSS({ level: 2, returnPromise: false }).minify(styleMatch[1]);
if (css.errors.length) throw new Error('CSS minify failed: ' + css.errors.join(', '));
const cssOut = css.styles;

const js = await minifyJs(scriptMatch[1], { compress: true, mangle: true });
const jsOut = js.code;

const cssHref = `styles.css?v=${hash(cssOut)}`;
const jsHref = `app.js?v=${hash(jsOut)}`;

// ── Rewrite the HTML: swap inline blocks for external references, in place ──
const html = source
  .replace(styleMatch[0], `<link rel="stylesheet" href="${cssHref}">`)
  .replace(scriptMatch[0], `<script src="${jsHref}"></script>`);

const htmlOut =
  (
    await minifyHtml(html, {
      collapseWhitespace: true,
      conservativeCollapse: true, // keep a single space where whitespace is significant
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      sortAttributes: true,
      sortClassName: true,
    })
  ).trimStart() + '\n';

const files = [
  ['index.html', htmlOut],
  ['styles.css', cssOut + '\n'],
  ['app.js', jsOut + '\n'],
];

if (check) {
  const stale = [];
  for (const [name, content] of files) {
    let current = '';
    try {
      current = await readFile(join(OUT_DIR, name), 'utf8');
    } catch {
      /* missing → stale */
    }
    if (current !== content) stale.push(name);
  }
  if (stale.length) {
    console.error(`site/dist is out of date (${stale.join(', ')}). Run: npm run build:site`);
    process.exit(1);
  }
  console.log('site/dist is up to date.');
} else {
  // Rebuild dist from scratch so no stale assets linger.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, content] of files) {
    await writeFile(join(OUT_DIR, name), content, 'utf8');
  }
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
  console.log(
    `Built site/dist —\n` +
      `  index.html  ${kb(source)} -> ${kb(htmlOut)}\n` +
      `  styles.css  ${kb(cssOut)}  (${cssHref})\n` +
      `  app.js      ${kb(jsOut)}  (${jsHref})`,
  );
}
