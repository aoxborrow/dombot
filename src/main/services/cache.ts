import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { STALE_AFTER_MS as SHARED_STALE_AFTER_MS } from '../../shared/ipc';

// Generic, timestamped, on-disk cache for domain data (portfolio, per-domain
// detail, aftermarket). Every entry carries a `fetchedAt` so the UI can show
// when data was last refreshed and flag anything past the staleness threshold.
//
// One JSON file per namespace under `userData` (cross-platform: Electron
// resolves that per-OS), mirroring the existing pricing-cache convention. Files
// are small and human-inspectable; the dataset is at most a few hundred domains.
//
// This layer is deliberately type-agnostic — it stores and returns plain JSON.
// Callers that hold Date fields (domains) revive them on read; see registrars.ts.

/** Cache namespaces. `clearAll` iterates these, so keep the list complete. */
export const CACHE_NAMESPACES = ['portfolio', 'detail', 'market'] as const;
export type CacheNamespace = (typeof CACHE_NAMESPACES)[number];

/** A cached value plus when it was fetched (ms epoch). */
export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

/**
 * Data older than this is considered stale. We still show stale data (hydration
 * never blocks on the network); the UI just highlights its age so the user can
 * choose to refresh. 14 days matches the renewal-price cache's TTL.
 */
export const STALE_AFTER_MS = SHARED_STALE_AFTER_MS;

type Store = Record<string, CacheEntry<unknown>>;

// Lazily-loaded in-memory copy per namespace, so repeated reads don't touch disk.
const memory = new Map<CacheNamespace, Store>();

function fileFor(ns: CacheNamespace): string {
  return path.join(app.getPath('userData'), `cache-${ns}.json`);
}

function load(ns: CacheNamespace): Store {
  const cached = memory.get(ns);
  if (cached) return cached;
  let store: Store;
  try {
    store = JSON.parse(fs.readFileSync(fileFor(ns), 'utf8')) as Store;
  } catch {
    // Missing or corrupt file — start empty, exactly like the other caches.
    store = {};
  }
  memory.set(ns, store);
  return store;
}

function persist(ns: CacheNamespace, store: Store): void {
  memory.set(ns, store);
  try {
    fs.writeFileSync(fileFor(ns), JSON.stringify(store), 'utf8');
  } catch {
    // A failed write just means the next launch re-fetches; not fatal.
  }
}

/** The cached entry for `key`, or null when absent. Age is not considered. */
export function readEntry<T>(
  ns: CacheNamespace,
  key: string,
): CacheEntry<T> | null {
  return (load(ns)[key] as CacheEntry<T> | undefined) ?? null;
}

/** Every cached entry in a namespace, keyed as stored. */
export function readAll<T>(ns: CacheNamespace): Record<string, CacheEntry<T>> {
  return load(ns) as Record<string, CacheEntry<T>>;
}

/** Stores `data` for `key`, stamped now, and returns the written entry. */
export function writeEntry<T>(
  ns: CacheNamespace,
  key: string,
  data: T,
): CacheEntry<T> {
  const entry: CacheEntry<T> = { data, fetchedAt: Date.now() };
  const store = { ...load(ns), [key]: entry };
  persist(ns, store);
  return entry;
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

/** Drops one namespace's cache (memory + disk). */
export function clearNamespace(ns: CacheNamespace): void {
  memory.set(ns, {});
  try {
    fs.rmSync(fileFor(ns), { force: true });
  } catch {
    // Nothing to remove.
  }
}

/** Drops every namespace's cache. */
export function clearAll(): void {
  for (const ns of CACHE_NAMESPACES) clearNamespace(ns);
}
