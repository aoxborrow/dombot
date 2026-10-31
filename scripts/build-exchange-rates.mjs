// Builds the exchange-rate archive that ships in the app (docs/exchange-rates.md):
// the European Central Bank's average euro reference rate for every month since
// 2000, for the 29 currencies it quotes against the euro.
//
//   { "base": "EUR", "currencies": ["AUD", …], "months": { "2000-01": [1.5421, …], … } }
//
// One array per month in `currencies` order, six significant digits, null where
// the ECB has no rate (ISK from 2009-01 to 2018-01). Only months whose average
// is out: the current one isn't until it ends, and the app fetches it then.
//
// Consumed by src/shared/exchange-rates.ts. Rerun before a release; a stale
// archive only means the app fetches a few more months.
//
// Fails when the currencies the ECB quotes today no longer match
// RATE_CURRENCIES (src/shared/currencies.ts), so a currency joining or leaving
// the euro's list is a deliberate change.
//
// Usage:
//   node scripts/build-exchange-rates.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RATE_CURRENCIES } from '../src/shared/currencies.ts';

const START = '2000-01';
const DAILY_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const monthlyUrl = (codes) =>
  `https://data-api.ecb.europa.eu/service/data/EXR/M.${codes.join('+')}.EUR.SP00.A` +
  `?startPeriod=${START}&format=csvdata&detail=dataonly`;

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT = path.join(repoRoot, 'data', 'exchange-rates.json');

const quoted = RATE_CURRENCIES.filter((c) => c !== 'EUR');

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

// Today's quoted set, from the daily file.
const daily = await get(DAILY_URL);
const today = new Set(
  [...daily.matchAll(/currency=['"]([A-Z]{3})['"]/g)].map((m) => m[1]),
);
const added = [...today].filter((c) => !quoted.includes(c));
const dropped = quoted.filter((c) => !today.has(c));
if (added.length || dropped.length) {
  throw new Error(
    `The ECB's currencies changed (${[
      added.length ? `added ${added.join(', ')}` : '',
      dropped.length ? `dropped ${dropped.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ')}). Update RATE_CURRENCIES in src/shared/currencies.ts first.`,
  );
}

// `detail=dataonly` leaves the series' attributes out, so no field is quoted.
const csv = (await get(monthlyUrl(quoted))).trim().split(/\r?\n/);
const header = csv[0].split(',');
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`The monthly CSV has no ${name} column.`);
  return i;
};
const [currencyCol, periodCol, valueCol] = [
  col('CURRENCY'),
  col('TIME_PERIOD'),
  col('OBS_VALUE'),
];

const byMonth = new Map();
const seen = new Set();
for (const line of csv.slice(1)) {
  const fields = line.split(',');
  const code = fields[currencyCol];
  const month = fields[periodCol];
  const value = Number(fields[valueCol]);
  if (!quoted.includes(code) || !/^\d{4}-\d{2}$/.test(month)) continue;
  if (!Number.isFinite(value) || value <= 0) continue;
  seen.add(code);
  if (!byMonth.has(month)) byMonth.set(month, new Map());
  byMonth.get(month).set(code, Number(value.toPrecision(6)));
}
const missing = quoted.filter((c) => !seen.has(c));
if (missing.length)
  throw new Error(`No monthly averages came back for ${missing.join(', ')}.`);

const months = [...byMonth.keys()].sort();
const lines = months.map((month) => {
  const row = quoted.map((c) => byMonth.get(month).get(c) ?? null);
  return `    ${JSON.stringify(month)}: ${JSON.stringify(row)}`;
});
// One month per line, so a rebuild's diff shows just the new months.
const json = [
  '{',
  '  "base": "EUR",',
  `  "currencies": ${JSON.stringify(quoted)},`,
  '  "months": {',
  lines.join(',\n'),
  '  }',
  '}',
  '',
].join('\n');
fs.writeFileSync(OUTPUT, json);

const gaps = quoted
  .map((c) => [c, months.filter((m) => !byMonth.get(m).has(c))])
  .filter(([, m]) => m.length > 0)
  .map(([c, m]) => `${c} (${m.length} months, ${m[0]} to ${m.at(-1)})`);
console.log(
  `Wrote ${path.relative(repoRoot, OUTPUT)}: ${months.length} months, ` +
    `${months[0]} to ${months.at(-1)}, ${(json.length / 1024).toFixed(0)} KB.`,
);
if (gaps.length) console.log(`No rate for ${gaps.join('; ')}.`);
