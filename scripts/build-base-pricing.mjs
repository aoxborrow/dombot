// Extracts the base renewal-pricing database that ships in the app from a full
// tldes.com pricing dump.
//
// The full dump (data/tld-pricing-<date>.json) covers every registrar tldes.com
// tracks and every price column — far more than we need, and not ours to
// redistribute, so it's gitignored and never committed. This script pulls out
// just the renewal price for the registrars registrar-client supports and writes
// a compact map the app loads directly:
//
//   { "<registrar short name>": { "<tld>": <renewal price USD>, ... }, ... }
//
// Consumed by src/main/services/base-pricing.ts.
//
// Usage:
//   node scripts/build-base-pricing.mjs [path/to/full-dump.json]
//
// With no argument it uses the newest data/tld-pricing-<date>.json.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { registrars } = require('@aoxborrow/registrar-client');

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = path.join(repoRoot, 'data');
const OUTPUT = path.join(dataDir, 'tld-renewal-pricing.json');

// The registrars we support, each with the public website domain the dump keys
// on — both come straight from registrar-client, so this script stays correct as
// providers are added, removed, or rebranded there.
const SUPPORTED = Object.entries(registrars).map(([name, cls]) => ({
  name,
  website: cls.website.toLowerCase(),
}));

function findFullDump() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const candidates = fs
    .readdirSync(dataDir)
    .filter((f) => /^tld-pricing-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (candidates.length === 0) {
    throw new Error(
      `No full dump found. Pass one explicitly, or place a data/tld-pricing-<date>.json file.`,
    );
  }
  return path.join(dataDir, candidates[candidates.length - 1]);
}

const inputPath = findFullDump();
const dump = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// The dump keys registrars by website domain (e.g. "gandi.net"), which is the
// same domain registrar-client reports as each provider's `website` — so we join
// on that directly.
const byWebsite = new Map(dump.registrars.map((r) => [r.name.toLowerCase(), r]));

const out = {};
const warnings = [];

for (const { name, website } of SUPPORTED) {
  const entry = byWebsite.get(website);
  if (!entry) {
    warnings.push(`"${name}" (${website}) not present in the dump — skipped.`);
    continue;
  }
  if (entry.currency && entry.currency !== 'USD') {
    // The app treats every base price as USD (see base-pricing.ts), so a
    // non-USD registrar would silently mis-price. Surface it rather than ship it.
    warnings.push(
      `"${name}" (${entry.name}) priced in ${entry.currency}, not USD — skipped to avoid mis-pricing.`,
    );
    continue;
  }

  // prices tuples are [tld, registration, renewal, transfer]; we keep renewal.
  const byTld = {};
  for (const [tld, , renewal] of entry.prices) {
    const price = Number(renewal);
    if (Number.isFinite(price)) byTld[String(tld).toLowerCase()] = price;
  }
  // Sort TLDs for a stable, diff-friendly output.
  out[name] = Object.fromEntries(
    Object.entries(byTld).sort(([a], [b]) => a.localeCompare(b)),
  );
}

fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

const totalTlds = Object.values(out).reduce(
  (n, m) => n + Object.keys(m).length,
  0,
);
console.log(
  `Wrote ${path.relative(repoRoot, OUTPUT)} — ${Object.keys(out).length} registrars, ${totalTlds} prices.`,
);
console.log(`  source: ${path.relative(repoRoot, inputPath)}`);
for (const w of warnings) console.warn(`  warning: ${w}`);
