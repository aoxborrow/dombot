import { getDevEnvVar } from './dev-env';
import { isStale, readAll, readEntry, writeEntry } from './cache';
import type { Aftermarket, MarketListing } from '../../shared/ipc';

// DomDB aftermarket pricing (Afternic, Sedo, etc.). Single-domain endpoint only
// — no bulk — and rate-limited to 60 calls/min per key, so every call goes
// through a global queue that spaces requests ~1.1s apart.

const API_URL = 'https://api.domdb.com/v1/domain/get';
const MIN_INTERVAL_MS = 1100;

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after the previous call, spaced by MIN_INTERVAL_MS. */
function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  // Keep the chain alive regardless of individual outcomes.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface DomdbAftermarket {
  platformName?: string;
  platformDisplay?: string;
  price?: string;
  priceCurrencyCode?: string;
  serviceType?: string;
  canMakeOffer?: boolean;
}

interface DomdbResponse {
  errors?: { code: string; message: string }[];
  data?: {
    availability?: string;
    aftermarkets?: DomdbAftermarket[];
    url?: string;
  } | null;
}

/**
 * Aftermarket data for one domain, or null when DomDB isn't configured or the
 * request fails. An untracked domain returns a valid result with empty listings.
 */
export async function getAftermarket(
  domain: string,
  refresh = false,
): Promise<Aftermarket | null> {
  // Serve a fresh-enough cached value without a network call (launch/hydration
  // and revisits). refresh=true bypasses the cache and re-fetches.
  if (!refresh) {
    const cached = readEntry<Aftermarket | null>('market', domain);
    if (cached && !isStale(cached)) return cached.data;
  }

  const apiKeyPublic = getDevEnvVar('DOMDB_PUBLIC_API_KEY');
  const apiKeyPrivate = getDevEnvVar('DOMDB_PRIVATE_API_KEY');
  if (!apiKeyPublic || !apiKeyPrivate) return null;

  return schedule(async () => {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKeyPublic, apiKeyPrivate, domain }),
        signal: AbortSignal.timeout(20_000),
      });
      // 404 = DOMAIN_NOT_FOUND — untracked, but a meaningful (empty) result.
      if (!res.ok && res.status !== 404) return null;

      const json = (await res.json()) as DomdbResponse;
      const data = json.data;
      const detailUrl =
        typeof data?.url === 'string'
          ? data.url
          : `https://domdb.com/${domain}`;

      if (!data) {
        const untracked: Aftermarket = {
          domain,
          availability: 'untracked',
          listings: [],
          detailUrl,
        };
        writeEntry('market', domain, untracked);
        return untracked;
      }

      const listings: MarketListing[] = (data.aftermarkets ?? []).map((a) => {
        const parsed = Number(a.price);
        const price =
          a.price != null && a.price !== '' && !Number.isNaN(parsed)
            ? parsed
            : null;
        return {
          platform: a.platformDisplay ?? a.platformName ?? 'Unknown',
          price,
          currency: a.priceCurrencyCode ?? 'USD',
          serviceType: a.serviceType ?? '',
          canMakeOffer: Boolean(a.canMakeOffer),
        };
      });
      // Lowest price first; offer-only (null price) listings last.
      listings.sort((x, y) => {
        if (x.price == null && y.price == null) return 0;
        if (x.price == null) return 1;
        if (y.price == null) return -1;
        return x.price - y.price;
      });

      const result: Aftermarket = {
        domain,
        availability: data.availability ?? 'unknown',
        listings,
        detailUrl,
      };
      writeEntry('market', domain, result);
      return result;
    } catch {
      return null;
    }
  });
}

/** All cached aftermarket data, keyed by domain — for launch hydration. */
export function getCachedAftermarket(): Record<string, Aftermarket | null> {
  const all = readAll<Aftermarket | null>('market');
  const out: Record<string, Aftermarket | null> = {};
  for (const [domain, entry] of Object.entries(all)) out[domain] = entry.data;
  return out;
}
