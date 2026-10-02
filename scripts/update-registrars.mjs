// Refreshes the bundled IANA registrar list and the registrar mapping.
//
// data/iana-registrars.json is IANA's Registrar ID registry, trimmed to the
// Accredited and Reserved rows (a terminated ID never shows up in RDAP). The
// app never downloads it; run this by hand when a registrar is missing, review
// the diff, and it ships in the next release.
//
// data/registrar-mapping.json is hand-edited. An entry's optional `patterns`
// (regular expressions over IANA names) are applied here, never in the app:
// every accredited ID whose name matches is added to that entry's `ianaIds`,
// so each new assignment shows up in the diff.
//
// Usage:
//   node scripts/update-registrars.mjs [path/to/registrar-ids-1.csv]
//
// With no argument it downloads the CSV from IANA.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE =
  'https://www.iana.org/assignments/registrar-ids/registrar-ids-1.csv';
const KEPT = new Set(['Accredited', 'Reserved']);

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const IANA_FILE = path.join(repoRoot, 'data', 'iana-registrars.json');
const MAPPING_FILE = path.join(repoRoot, 'data', 'registrar-mapping.json');

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readSource() {
  const arg = process.argv[2];
  if (arg) return { text: fs.readFileSync(arg, 'utf8'), lastModified: null };
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`${SOURCE}: HTTP ${response.status}`);
  return {
    text: await response.text(),
    lastModified: response.headers.get('last-modified'),
  };
}

function ianaRows(text) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const col = (name) => header.findIndex((h) => h.trim() === name);
  const idCol = col('ID');
  const nameCol = col('Registrar Name');
  const statusCol = col('Status');
  if (idCol < 0 || nameCol < 0 || statusCol < 0)
    throw new Error(`Unexpected CSV header: ${header.join(', ')}`);
  return rows
    .filter((r) => r.length > statusCol && KEPT.has(r[statusCol].trim()))
    .map((r) => [Number(r[idCol]), r[nameCol].trim(), r[statusCol].trim()])
    .filter(([id]) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a[0] - b[0]);
}

/** One row per line, so a renamed or added registrar is a one-line diff. */
function writeIana(rows, lastModified) {
  const lines = rows.map((r) => `    ${JSON.stringify(r)}`);
  const out =
    '{\n' +
    `  "source": ${JSON.stringify(SOURCE)},\n` +
    `  "lastModified": ${JSON.stringify(lastModified)},\n` +
    '  "columns": ["id", "name", "status"],\n' +
    '  "registrars": [\n' +
    lines.join(',\n') +
    '\n  ]\n}\n';
  fs.writeFileSync(IANA_FILE, out);
}

/** Pretty JSON, but each `ianaIds` list packed onto as few lines as fit. */
function writeMapping(mapping) {
  const json = JSON.stringify(mapping, null, 2).replace(
    /"ianaIds": \[([^\]]*)\]/g,
    (_, body) => {
      const ids = body
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) return '"ianaIds": []';
      const lines = [];
      let line = '';
      for (const id of ids) {
        if (line && line.length + id.length + 2 > 72) {
          lines.push(line);
          line = '';
        }
        line += (line ? ', ' : '') + id;
      }
      lines.push(line);
      if (lines.length === 1 && lines[0].length < 50)
        return `"ianaIds": [${lines[0]}]`;
      return `"ianaIds": [\n      ${lines.join(',\n      ')}\n    ]`;
    },
  );
  fs.writeFileSync(MAPPING_FILE, json + '\n');
}

function readJson(file, fallback) {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : fallback;
}

const { text, lastModified } = await readSource();
const rows = ianaRows(text);
const previous = new Map(
  readJson(IANA_FILE, { registrars: [] }).registrars.map(([id, name]) => [
    id,
    name,
  ]),
);
const byId = new Map(rows.map((r) => [r[0], r]));
writeIana(rows, lastModified);

const mapping = readJson(MAPPING_FILE, {});
const owner = new Map();
for (const [key, entry] of Object.entries(mapping))
  for (const id of entry.ianaIds ?? []) owner.set(id, key);

const added = [];
for (const [key, entry] of Object.entries(mapping)) {
  const patterns = (entry.patterns ?? []).map((p) => new RegExp(p, 'i'));
  if (patterns.length === 0) continue;
  for (const [id, name, status] of rows) {
    if (status !== 'Accredited' || owner.has(id)) continue;
    if (!patterns.some((re) => re.test(name))) continue;
    entry.ianaIds = [...(entry.ianaIds ?? []), id];
    owner.set(id, key);
    added.push(`${id} ${name} → ${key}`);
  }
  entry.ianaIds.sort((a, b) => a - b);
}
writeMapping(mapping);

// Report what changed, for the PR description.
const fresh = rows.filter(([id]) => previous.size > 0 && !previous.has(id));
const renamed = rows.filter(
  ([id, name]) => previous.has(id) && previous.get(id) !== name,
);
const gone = [...owner.entries()].filter(([id]) => !byId.has(id));
const unmapped = rows.filter(
  ([id, , status]) => status === 'Accredited' && !owner.has(id),
);
const section = (title, lines) => {
  console.log(`\n${title} (${lines.length})`);
  for (const line of lines.slice(0, 50)) console.log(`  ${line}`);
  if (lines.length > 50) console.log(`  … ${lines.length - 50} more`);
};
console.log(
  `IANA: ${rows.length} rows (Last-Modified ${lastModified ?? 'unknown'})`,
);
section(
  'New IDs',
  fresh.map(([id, name]) => `${id} ${name}`),
);
section(
  'Renamed',
  renamed.map(([id, name]) => `${id} ${previous.get(id)} → ${name}`),
);
section('Added to the mapping by patterns', added);
section(
  'Mapped IDs no longer accredited (remove them)',
  gone.map(([id, key]) => `${id} (${key})`),
);
console.log(`\nUnmapped accredited IDs: ${unmapped.length}`);
