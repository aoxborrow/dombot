import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { RegistrarName } from '@aoxborrow/registrar-client';
import { getRegistrarClient } from './registrars';
import { getBaseRenewal, reloadBasePricing } from './base-pricing';
import type { RenewalPricing } from '../../shared/ipc';

// Renewal-price service backing the Renewals dashboard. Prices come from three
// layers, most-accurate first:
//
//   1. manual override — a price the user typed in.
//   2. per-name API quote — only for registrars that price a *specific owned*
//      domain, so the figure captures premium renewals. In practice that's just
//      Gandi: every other provider either can't price an owned domain at all
//      (Dynadot/Cloudflare/GoDaddy-renewal/Spaceship/NameBright) or only exposes
//      a generic per-TLD rate, which we deliberately don't use here.
//   3. base database — the standard per-TLD rate that fills everything else
//      (see base-pricing.ts).
//
// All prices are treated as USD.

// Registrars whose `getPricing(domain)` returns a genuine per-name renewal for a
// domain you already own (verified live). Only these get an API lookup.
const SPECIFIC_CAPABLE = new Set<RegistrarName>(['gandi']);

// Cache entries older than this are re-fetched. Renewal prices change rarely, so
// a long life keeps the dashboard instant and the APIs untouched on revisit.
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

interface CacheEntry {
  renewal: number | null;
  currency: string;
  fetchedAt: number;
}

let cache: Record<string, CacheEntry> | null = null;
let overrides: Record<string, number> | null = null;
// Dedupes in-flight lookups by cache key so concurrent requests coalesce.
const inFlight = new Map<string, Promise<CacheEntry>>();

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'pricing-cache.json');
}

function overridesFile(): string {
  return path.join(app.getPath('userData'), 'pricing-overrides.json');
}

function loadCache(): Record<string, CacheEntry> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<
      string,
      CacheEntry
    >;
  } catch {
    cache = {};
  }
  return cache;
}

function persistCache(store: Record<string, CacheEntry>): void {
  cache = store;
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(store), 'utf8');
  } catch {
    // A failed cache write just means the next lookup re-fetches; not fatal.
  }
}

function loadOverrides(): Record<string, number> {
  if (overrides) return overrides;
  try {
    overrides = JSON.parse(fs.readFileSync(overridesFile(), 'utf8')) as Record<
      string,
      number
    >;
  } catch {
    overrides = {};
  }
  return overrides;
}

function persistOverrides(store: Record<string, number>): void {
  overrides = store;
  try {
    fs.writeFileSync(overridesFile(), JSON.stringify(store), 'utf8');
  } catch {
    // Non-fatal — the override just won't survive a restart.
  }
}

/** Everything after the first dot, lowercased. "example.co.uk" → "co.uk". */
function tldOf(domain: string): string {
  const dot = domain.indexOf('.');
  return dot === -1 ? '' : domain.slice(dot + 1).toLowerCase();
}

/** Fetches a fresh per-name renewal price; null-priced entry on any failure. */
async function fetchPrice(
  registrar: RegistrarName,
  domain: string,
): Promise<CacheEntry> {
  try {
    const pricing = await getRegistrarClient(registrar).getPricing(domain);
    return {
      renewal: typeof pricing.renewal === 'number' ? pricing.renewal : null,
      currency: pricing.currency ?? 'USD',
      fetchedAt: Date.now(),
    };
  } catch {
    return { renewal: null, currency: 'USD', fetchedAt: Date.now() };
  }
}

/** Returns a cached entry when fresh, otherwise fetches (deduped) and stores it. */
function resolveCached(
  key: string,
  fetcher: () => Promise<CacheEntry>,
): Promise<CacheEntry> {
  const hit = loadCache()[key];
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(hit);
  }
  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = fetcher()
    .then((fresh) => {
      const store = loadCache();
      store[key] = fresh;
      persistCache(store);
      return fresh;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * The annual renewal price for a domain, with provenance. Manual override wins;
 * then a per-name API quote for the registrars that support it (accurate,
 * premium-inclusive); then the base per-TLD database; otherwise unavailable.
 */
export async function getRenewalPrice(
  registrar: RegistrarName,
  domain: string,
): Promise<RenewalPricing> {
  const manual = loadOverrides()[`${registrar}:${domain}`];
  if (typeof manual === 'number') {
    return {
      domain,
      registrar,
      renewal: manual,
      currency: 'USD',
      source: 'manual',
    };
  }

  if (SPECIFIC_CAPABLE.has(registrar)) {
    const entry = await resolveCached(`${registrar}:dom:${domain}`, () =>
      fetchPrice(registrar, domain),
    );
    if (entry.renewal !== null) {
      return {
        domain,
        registrar,
        renewal: entry.renewal,
        currency: entry.currency,
        source: 'api',
      };
    }
  }

  const base = getBaseRenewal(registrar, tldOf(domain));
  if (base !== null) {
    return {
      domain,
      registrar,
      renewal: base,
      currency: 'USD',
      source: 'base',
    };
  }

  return {
    domain,
    registrar,
    renewal: null,
    currency: 'USD',
    source: 'unavailable',
  };
}

/** Sets (number) or clears (null) a manual annual renewal price for a domain. */
export function setManualPrice(
  registrar: RegistrarName,
  domain: string,
  price: number | null,
): void {
  const store = { ...loadOverrides() };
  const key = `${registrar}:${domain}`;
  if (price === null || Number.isNaN(price)) {
    delete store[key];
  } else {
    store[key] = price;
  }
  persistOverrides(store);
}

/**
 * Drops the on-disk price cache and re-reads the base pricing database (manual
 * overrides are untouched), so the next lookups reflect fresh data.
 */
export function clearPricingCache(): void {
  cache = {};
  inFlight.clear();
  reloadBasePricing();
  try {
    fs.rmSync(cacheFile(), { force: true });
  } catch {
    // Nothing to remove.
  }
}
