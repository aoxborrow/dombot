import type { DocStore } from '../../core/storage/doc-store';

// DocStore over a D1 database: one `docs` table (migrations/0001_docs.sql).
// Strongly consistent, and the same table works on any SQL database if
// another host wants it. `loadAll` fetches every row in one query so a
// request can hydrate all namespaces with a single round trip.

interface Row {
  ns: string;
  key: string;
  value: string;
}

export class D1DocStore implements DocStore {
  constructor(private readonly db: D1Database) {}

  async get(ns: string, key: string): Promise<unknown | null> {
    const row = await this.db
      .prepare('SELECT value FROM docs WHERE ns = ?1 AND key = ?2')
      .bind(ns, key)
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as unknown) : null;
  }

  async put(ns: string, key: string, value: unknown): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO docs (ns, key, value, updated_at) VALUES (?1, ?2, ?3, ?4) ' +
          'ON CONFLICT (ns, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .bind(ns, key, JSON.stringify(value), Date.now())
      .run();
  }

  async delete(ns: string, key: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM docs WHERE ns = ?1 AND key = ?2')
      .bind(ns, key)
      .run();
  }

  async list(ns: string): Promise<Record<string, unknown>> {
    const { results } = await this.db
      .prepare('SELECT key, value FROM docs WHERE ns = ?1')
      .bind(ns)
      .all<Pick<Row, 'key' | 'value'>>();
    const out: Record<string, unknown> = {};
    for (const r of results) out[r.key] = JSON.parse(r.value) as unknown;
    return out;
  }

  async clear(ns: string): Promise<void> {
    await this.db.prepare('DELETE FROM docs WHERE ns = ?1').bind(ns).run();
  }

  /** Every namespace at once — one query for a full hydration. */
  async loadAll(): Promise<Record<string, Record<string, unknown>>> {
    const { results } = await this.db
      .prepare('SELECT ns, key, value FROM docs')
      .all<Row>();
    const out: Record<string, Record<string, unknown>> = {};
    for (const r of results) {
      (out[r.ns] ??= {})[r.key] = JSON.parse(r.value) as unknown;
    }
    return out;
  }
}
