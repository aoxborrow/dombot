import type { RegistrarName } from '@aoxborrow/registrar-client';
import tldPricingData from '../../../data/tld-renewal-pricing.json';

// Base TLD-pricing fill. Standard annual renewal rate per registrar + TLD, used
// for every domain we can't price accurately per-name (i.e. everything except
// the registrars that quote a specific owned domain — see pricing.ts). This is
// the "database of all registrar pricing across TLDs" layer; accurate per-name
// premium renewals are layered on top of it where a registrar supports them.
//
// The data originates from the tldes.com pricing dump. We don't ship that full
// dump (it's large and not ours to redistribute — it's gitignored); instead
// scripts/build-base-pricing.mjs extracts just the renewal price for the
// registrars registrar-client supports into data/tld-renewal-pricing.json, keyed
// by registrar short name → TLD → renewal (USD). Re-run that script to refresh
// the table from a newer dump.

// Renewal price (USD) per registrar short name, per TLD.
type PricingTable = Record<string, Record<string, number>>;

// Bundled table is already in the exact shape we need — no build step at load.
const table: PricingTable = tldPricingData as PricingTable;

/**
 * Standard annual renewal (USD) for a registrar + TLD from the base database, or
 * null when the dataset has no entry for that registrar/TLD.
 */
export function getBaseRenewal(
  registrar: RegistrarName,
  tld: string,
): number | null {
  const price = table[registrar]?.[tld.toLowerCase()];
  return typeof price === 'number' ? price : null;
}

/**
 * No-op retained for API compatibility. The base table is a static bundled
 * import now, so there's nothing to reload at runtime; refreshing it means
 * re-running scripts/build-base-pricing.mjs and rebuilding the app.
 */
export function reloadBasePricing(): void {
  // Bundled table is immutable at runtime.
}
