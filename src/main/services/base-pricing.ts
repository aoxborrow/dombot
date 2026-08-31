import type { RegistrarName } from '@aoxborrow/registrar-client';
import { registrarWebsite } from './registrars';
import tldPricingData from '../../../data/tld-pricing-example.json';

// Base TLD-pricing fill. Standard annual renewal rate per registrar + TLD, used
// for every domain we can't price accurately per-name (i.e. everything except
// the registrars that quote a specific owned domain — see pricing.ts). This is
// the "database of all registrar pricing across TLDs" layer; accurate per-name
// premium renewals are layered on top of it where a registrar supports them.
//
// The data comes from the tldes.com pricing API (see data/tld-pricing-openapi.json).
// For now we bundle a saved sample response (data/tld-pricing-example.json); once
// we have API access this same table will be populated from the live endpoint —
// only loadTable() needs to change. Registrars are keyed in that dataset by their
// website domain (e.g. "dynadot.com"), which we map from our registrar id via
// `registrarWebsite`. The sample only covers a couple of registrars, so the rest
// return null (unpriced) until the full dataset is wired in.

// Shape of the tldes.com `data=prices` response we consume. Every price is a
// string in the registrar's currency; `prices` tuples are
// [tld, registration, renewal, transfer].
interface TldesPricing {
  registrars: {
    name: string;
    currency: string;
    prices: string[][];
  }[];
}

// Renewal price (USD) per website domain, per TLD, built once from the dataset.
type PricingTable = Record<string, Record<string, number>>;

let table: PricingTable | null = null;

/**
 * Builds the lookup table from the bundled tldes dataset. This is the only seam
 * that has to change to load from the live API instead of the local sample.
 */
function loadTable(): PricingTable {
  if (table) return table;
  const built: PricingTable = {};
  const data = tldPricingData as TldesPricing;
  for (const registrar of data.registrars) {
    const byTld: Record<string, number> = {};
    for (const [tld, , renewal] of registrar.prices) {
      const price = Number(renewal);
      if (Number.isFinite(price)) byTld[tld.toLowerCase()] = price;
    }
    built[registrar.name.toLowerCase()] = byTld;
  }
  table = built;
  return table;
}

/**
 * Standard annual renewal (USD) for a registrar + TLD from the base database, or
 * null when the dataset has no entry for that registrar/TLD (or doesn't cover the
 * registrar yet).
 */
export function getBaseRenewal(
  registrar: RegistrarName,
  tld: string,
): number | null {
  const website = registrarWebsite[registrar];
  const price = loadTable()[website]?.[tld.toLowerCase()];
  return typeof price === 'number' ? price : null;
}

/** Drops the in-memory table so the next lookup rebuilds it from the source. */
export function reloadBasePricing(): void {
  table = null;
}
