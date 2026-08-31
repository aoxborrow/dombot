import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// Base TLD-pricing fill. Standard annual renewal rate per registrar + TLD, used
// for every domain we can't price accurately per-name (i.e. everything except
// the registrars that quote a specific owned domain — see pricing.ts). This is
// the curated "database of all registrar pricing across TLDs" layer; accurate
// per-name premium renewals are layered on top of it where a registrar supports
// them.
//
// Loaded from an optional JSON file so the database can be dropped in without a
// rebuild. Shape (all prices annual renewal, USD):
//
//   {
//     "dynadot":  { "com": 10.88, "io": 53.5 },
//     "porkbun":  { "com": 11.06 },
//     "*":        { "com": 12.99 }          // fallback for any registrar
//   }
//
// A registrar's own table wins; the "*" wildcard fills gaps. Until a file is
// present every lookup returns null, so those domains show as unpriced.

type PricingTable = Record<string, Record<string, number>>;

let table: PricingTable | null = null;

function tableFile(): string {
  return path.join(app.getPath('userData'), 'base-pricing.json');
}

function loadTable(): PricingTable {
  if (table) return table;
  try {
    table = JSON.parse(fs.readFileSync(tableFile(), 'utf8')) as PricingTable;
  } catch {
    table = {};
  }
  return table;
}

/**
 * Standard annual renewal (USD) for a registrar + TLD from the base database, or
 * null when the database has no entry (or isn't present yet). Prefers the
 * registrar's own rate, then the `*` wildcard.
 */
export function getBaseRenewal(registrar: string, tld: string): number | null {
  const t = loadTable();
  const own = t[registrar]?.[tld];
  if (typeof own === 'number') return own;
  const wildcard = t['*']?.[tld];
  return typeof wildcard === 'number' ? wildcard : null;
}

/** Drops the in-memory copy so the next lookup re-reads the file from disk. */
export function reloadBasePricing(): void {
  table = null;
}
