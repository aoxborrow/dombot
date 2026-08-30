import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { RegistrarName } from '@aoxborrow/registrar-client';
import { getRegistrarClient } from './registrars';
import type { PriceSource, RenewalPricing } from '../../shared/ipc';

// Renewal-price service backing the Renewals dashboard. Every registrar's
// `getPricing` returns a per-TLD/per-domain renewal figure; this module routes
// each domain to the right kind of lookup, caches results on disk (prices move
// slowly), dedupes concurrent identical lookups, and layers user-entered manual
// overrides on top. All prices are treated as USD. See PriceSource for how the
// `source` field is derived.

// Registrars priced per-TLD: one lookup covers every domain on that TLD (big
// dedup), but a premium name held here shows the standard TLD rate. Dynadot is
// here too — its only price source (bulk_search) quotes a name only when it's
// available to register, so it can't price an owned domain per-name; we read the
// TLD's standard rate instead. The name-aware registrars (godaddy, cloudflare,
// gandi) get the full domain, so their per-name premium renewals are captured.
const TLD_ONLY = new Set<RegistrarName>([
  'namecheap',
  'namesilo',
  'porkbun',
  'dynadot',
]);

// Registrars with no pricing endpoint at all — the user must enter a price.
const NO_PRICING = new Set<RegistrarName>(['spaceship', 'namebright']);

// TLDs with no premium tier: a standard TLD-rate lookup is exact for these, so
// results from a TLD-only registrar aren't flagged `estimated`. Legacy gTLDs and
// .io renew at a flat rate regardless of the name; most everything else can
// carry registry premiums.
const FLAT_TLDS = new Set(['com', 'net', 'org', 'info', 'biz', 'io']);

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
// Dedupes in-flight lookups by cache key so, e.g., forty .com domains at one
// TLD-priced registrar make a single API call instead of forty.
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

/** Fetches a fresh renewal price; returns a null-priced entry on any failure. */
async function fetchPrice(
  registrar: RegistrarName,
  tldOrDomain: string,
): Promise<CacheEntry> {
  try {
    const pricing = await getRegistrarClient(registrar).getPricing(tldOrDomain);
    return {
      renewal: typeof pricing.renewal === 'number' ? pricing.renewal : null,
      currency: pricing.currency ?? 'USD',
      fetchedAt: Date.now(),
    };
  } catch {
    // Unsupported TLD, transient error, or a registrar that can't price an
    // already-owned name — cache the miss so we don't retry every visit.
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
 * The annual renewal price for a domain, with provenance. Manual overrides win;
 * otherwise it routes to a per-domain or per-TLD registrar lookup (see the
 * registrar sets above) and flags TLD-rate quotes on premium-capable TLDs as
 * `estimated`.
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

  if (NO_PRICING.has(registrar)) {
    return {
      domain,
      registrar,
      renewal: null,
      currency: 'USD',
      source: 'unavailable',
    };
  }

  const tld = tldOf(domain);
  const tldOnly = TLD_ONLY.has(registrar);
  const key = tldOnly
    ? `${registrar}:tld:${tld}`
    : `${registrar}:dom:${domain}`;
  const entry = await resolveCached(key, () =>
    fetchPrice(registrar, tldOnly ? tld : domain),
  );

  let source: PriceSource = 'api';
  if (entry.renewal === null) source = 'unavailable';
  else if (tldOnly && !FLAT_TLDS.has(tld)) source = 'estimated';
  // Name-aware registrars fall through as 'api' — their quote is name-accurate.

  return {
    domain,
    registrar,
    renewal: entry.renewal,
    currency: entry.currency,
    source,
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

/** Drops the on-disk price cache (manual overrides are untouched). */
export function clearPricingCache(): void {
  cache = {};
  inFlight.clear();
  try {
    fs.rmSync(cacheFile(), { force: true });
  } catch {
    // Nothing to remove.
  }
}
