// The one storage interface every host implements. Everything DomBot persists
// is "a namespace of JSON values keyed by string" — the portfolio cache, folder
// definitions, settings, credentials — so that's the whole contract. Electron
// backs it with one JSON file per namespace (src/electron/storage); the web
// host backs it with a single `docs` table. See docs/web-deployment.md.
//
// Services never call this directly: they go through `Namespace` (namespace.ts),
// which loads a namespace into memory once and keeps reads synchronous.

export interface DocStore {
  /** The value stored under `ns`/`key`, or null when absent. */
  get(ns: string, key: string): Promise<unknown | null>;
  /** Stores (creates or replaces) a JSON-serializable value. */
  put(ns: string, key: string, value: unknown): Promise<void>;
  /** Removes one key. No-op when absent. */
  delete(ns: string, key: string): Promise<void>;
  /** Every key/value in a namespace (empty object when none). */
  list(ns: string): Promise<Record<string, unknown>>;
  /** Removes every key in a namespace. */
  clear(ns: string): Promise<void>;
  /**
   * Optional: every namespace at once. A store that can do this in one round
   * trip (a SQL table) should; `hydrateStores` uses it when present.
   */
  loadAll?(): Promise<Record<string, Record<string, unknown>>>;
}

/** In-memory store: tests, and the default before a host configures one. */
export class MemoryDocStore implements DocStore {
  private readonly data = new Map<string, Map<string, unknown>>();

  private ns(ns: string): Map<string, unknown> {
    let m = this.data.get(ns);
    if (!m) {
      m = new Map();
      this.data.set(ns, m);
    }
    return m;
  }

  async get(ns: string, key: string): Promise<unknown | null> {
    return structuredClone(this.ns(ns).get(key) ?? null);
  }

  async put(ns: string, key: string, value: unknown): Promise<void> {
    this.ns(ns).set(key, structuredClone(value));
  }

  async delete(ns: string, key: string): Promise<void> {
    this.ns(ns).delete(key);
  }

  async list(ns: string): Promise<Record<string, unknown>> {
    return structuredClone(Object.fromEntries(this.ns(ns)));
  }

  async clear(ns: string): Promise<void> {
    this.data.delete(ns);
  }

  async loadAll(): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [ns, m] of this.data)
      out[ns] = structuredClone(Object.fromEntries(m));
    return out;
  }
}
