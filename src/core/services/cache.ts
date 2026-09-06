import { STALE_AFTER_MS as SHARED_STALE_AFTER_MS } from '../../shared/ipc';
import { Namespace } from '../storage/namespace';

// Generic, timestamped cache for domain data (portfolio, per-domain detail).
// Every entry carries a `fetchedAt` so the UI can show when data was last
// refreshed and flag anything past the staleness threshold.
//
// One storage namespace per cache (`cache-portfolio`, `cache-detail`), each a
// map of key → entry. The dataset is at most a few hundred domains, so the
// whole namespace lives in memory (see storage/namespace.ts).
//
// This layer is deliberately type-agnostic — it stores and returns plain JSON.
// Callers that hold Date fields (domains) revive them on read; see registrars.ts.

/** Cache namespaces. `clearAll` iterates these, so keep the list complete. */
export const CACHE_NAMESPACES = ['portfolio', 'detail'] as const;
export type CacheNamespace = (typeof CACHE_NAMESPACES)[number];

/** A cached value plus when it was fetched (ms epoch). */
export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

/**
 * Data older than this is considered stale. We still show stale data (hydration
 * never blocks on the network); the UI just highlights its age so the user can
 * choose to refresh. Matches the default background-sync interval (see
 * services/auto-sync.ts) — see shared/ipc for the value and rationale.
 */
export const STALE_AFTER_MS = SHARED_STALE_AFTER_MS;

const stores: Record<CacheNamespace, Namespace<CacheEntry<unknown>>> = {
  portfolio: new Namespace('cache-portfolio'),
  detail: new Namespace('cache-detail'),
};

/** The cached entry for `key`, or null when absent. Age is not considered. */
export function readEntry<T>(
  ns: CacheNamespace,
  key: string,
): CacheEntry<T> | null {
  return (stores[ns].get(key) as CacheEntry<T> | undefined) ?? null;
}

/** Every cached entry in a namespace, keyed as stored. */
export function readAll<T>(ns: CacheNamespace): Record<string, CacheEntry<T>> {
  return stores[ns].all() as Record<string, CacheEntry<T>>;
}

/** Stores `data` for `key`, stamped now, and returns the written entry. */
export function writeEntry<T>(
  ns: CacheNamespace,
  key: string,
  data: T,
): CacheEntry<T> {
  const entry: CacheEntry<T> = { data, fetchedAt: Date.now() };
  void stores[ns].set(key, entry);
  return entry;
}

/**
 * Updates an existing entry's data in place via `update`, preserving its
 * original `fetchedAt` so the entry's age (and any "last refreshed" display) is
 * unaffected. No-op if the entry is missing. Use this to reflect a known
 * mutation (e.g. a toggled setting) in the cache without faking a fresh fetch.
 */
export function patchEntryData<T>(
  ns: CacheNamespace,
  key: string,
  update: (data: T) => T,
): void {
  const entry = stores[ns].get(key) as CacheEntry<T> | undefined;
  if (!entry) return;
  void stores[ns].set(key, { ...entry, data: update(entry.data) });
}

/** Age of an entry in ms, or Infinity when there is none. */
export function ageOf(entry: { fetchedAt: number } | null | undefined): number {
  return entry ? Date.now() - entry.fetchedAt : Infinity;
}

/** True when the entry is missing or older than `ttl` (default: STALE_AFTER_MS). */
export function isStale(
  entry: { fetchedAt: number } | null | undefined,
  ttl: number = STALE_AFTER_MS,
): boolean {
  return ageOf(entry) >= ttl;
}

/** Drops a single entry from a namespace. No-op if absent. */
export function clearEntry(ns: CacheNamespace, key: string): void {
  void stores[ns].delete(key);
}

/** Drops one namespace's cache. */
export function clearNamespace(ns: CacheNamespace): void {
  void stores[ns].clear();
}

/** Drops every namespace's cache. */
export function clearAll(): void {
  for (const ns of CACHE_NAMESPACES) clearNamespace(ns);
}
