import { MemoryDocStore, type DocStore } from './doc-store';

// The synchronous façade services use over the (async) DocStore.
//
// Every store DomBot keeps is small — a few hundred domains at most — so each
// namespace is loaded into memory once (`hydrateStores`, called by the host
// before it serves anything) and read synchronously from then on. That keeps
// the services exactly as they were on the desktop (a module-level in-memory
// copy, rewritten wholesale on each change) while the persistence underneath
// can be a JSON file, a D1 table, or a test double.
//
// Writes update memory immediately and are persisted through one serialized
// queue, so a burst of changes lands in order and a failed write can't
// interleave with a later one. `set`/`delete`/`clear` return the write's
// promise: callers that must surface a failure (saving credentials) await it;
// the rest fire-and-forget, and the failure is logged. A host that must not
// answer before data is durable (a Worker request) awaits `flushWrites()`.

let store: DocStore = new MemoryDocStore();
const registry = new Set<Namespace<unknown>>();

/** Installs the host's DocStore. Drops every namespace's in-memory copy, so
 *  call `hydrateStores()` afterwards (tests: between cases). */
export function configureStore(next: DocStore): void {
  store = next;
  for (const ns of registry) ns.reset();
}

/** The configured DocStore (for hosts that need raw access, e.g. migration). */
export function getStore(): DocStore {
  return store;
}

// ── write queue ─────────────────────────────────────────────────────────────

let tail: Promise<void> = Promise.resolve();
/** The first write to fail since the last `flushWrites()` reported it. */
let unreportedFailure: unknown = null;
let failed = false;

function enqueue(label: string, write: () => Promise<void>): Promise<void> {
  const p = tail.then(write);
  // Keep the queue alive past a failure, and mark the rejection handled so a
  // fire-and-forget caller doesn't trip an unhandled-rejection warning. An
  // awaiting caller still receives the rejection from `p`; everyone else
  // learns of it from the next `flushWrites()`.
  tail = p.catch((err) => {
    if (!failed) {
      failed = true;
      unreportedFailure = err;
    }
  });
  p.catch((err) => console.error(`[storage] ${label} failed`, err));
  return p;
}

/**
 * Settles once every write issued so far has been persisted. Rejects with the
 * first failure since the previous flush, so a host that answers "saved" only
 * after the flush (a Worker request) never says so for data that isn't.
 */
export async function flushWrites(): Promise<void> {
  await tail;
  if (failed) {
    const err = unreportedFailure;
    failed = false;
    unreportedFailure = null;
    throw err;
  }
}

// ── namespaces ──────────────────────────────────────────────────────────────

export class Namespace<T> {
  private data: Map<string, T> | null = null;

  constructor(readonly name: string) {
    registry.add(this as Namespace<unknown>);
  }

  /** Forgets the in-memory copy (the next `load` re-reads the store). */
  reset(): void {
    this.data = null;
  }

  /** (Re)loads the namespace from the store. */
  async load(): Promise<void> {
    this.replace(await store.list(this.name));
  }

  /** Installs a namespace's entries wholesale (used by hydrateStores). */
  replace(entries: Record<string, unknown>): void {
    this.data = new Map(Object.entries(entries) as [string, T][]);
  }

  get loaded(): boolean {
    return this.data !== null;
  }

  private ensure(): Map<string, T> {
    if (!this.data) {
      throw new Error(
        `[storage] namespace "${this.name}" read before hydrateStores()`,
      );
    }
    return this.data;
  }

  get(key: string): T | undefined {
    return this.ensure().get(key);
  }

  has(key: string): boolean {
    return this.ensure().has(key);
  }

  /** A snapshot of every entry. */
  all(): Record<string, T> {
    return Object.fromEntries(this.ensure());
  }

  size(): number {
    return this.ensure().size;
  }

  set(key: string, value: T): Promise<void> {
    this.ensure().set(key, value);
    return enqueue(`${this.name}/${key} put`, () =>
      store.put(this.name, key, value),
    );
  }

  delete(key: string): Promise<void> {
    if (!this.ensure().delete(key)) return Promise.resolve();
    return enqueue(`${this.name}/${key} delete`, () =>
      store.delete(this.name, key),
    );
  }

  clear(): Promise<void> {
    this.ensure().clear();
    return enqueue(`${this.name} clear`, () => store.clear(this.name));
  }
}

/** Loads every namespace any service has declared. Hosts call this once
 *  after `configureStore`, before handling requests. Safe to call again. */
export async function hydrateStores(): Promise<void> {
  if (store.loadAll) {
    // One round trip for everything (the web host does this per request).
    const all = await store.loadAll();
    for (const ns of registry) ns.replace(all[ns.name] ?? {});
    return;
  }
  await Promise.all([...registry].map((ns) => ns.load()));
}

// ── whole-store export / import (backup, migration, secret rotation) ────────

/** Every registered namespace's entries, minus `exclude`. Reads memory, so
 *  the store must be hydrated. */
export function exportNamespaces(
  exclude: ReadonlySet<string> = new Set(),
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const ns of registry) {
    if (exclude.has(ns.name) || !ns.loaded) continue;
    out[ns.name] = ns.all() as Record<string, unknown>;
  }
  return out;
}

/**
 * Replaces the store with `data` wholesale — memory first, then a clear plus
 * one put per entry through the write queue. A namespace this build doesn't
 * know is skipped (so a bundle from a newer DomBot can't leave stray docs).
 * A registered namespace missing from the bundle is *emptied*, not kept:
 * "import" means the store becomes what the file says, so a crafted file
 * can't swap in its own settings or pairings while leaving the existing
 * credentials in place. Only `exclude` survives untouched.
 */
export function importNamespaces(
  data: Record<string, Record<string, unknown>>,
  exclude: ReadonlySet<string> = new Set(),
): { namespaces: number; entries: number } {
  let namespaces = 0;
  let entries = 0;
  for (const ns of registry) {
    if (exclude.has(ns.name)) continue;
    const incoming = data[ns.name];
    if (!incoming) {
      if (ns.loaded && ns.size() > 0) void ns.clear();
      continue;
    }
    ns.replace(incoming);
    namespaces++;
    const items = Object.entries(incoming);
    entries += items.length;
    enqueue(`${ns.name} import`, async () => {
      await store.clear(ns.name);
      for (const [key, value] of items) await store.put(ns.name, key, value);
    });
  }
  return { namespaces, entries };
}
