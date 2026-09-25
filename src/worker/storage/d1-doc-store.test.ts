import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { D1DocStore } from './d1-doc-store';

// Production SQL against node:sqlite; only the D1 transport is simulated.
let sqlite: DatabaseSync;
let batches: number[];
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_docs.sql', 'utf8'));
  batches = [];
  db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const bind = (...values: (string | number)[]) => {
        const params = Object.fromEntries(
          values.map((value, i) => [String(i + 1), value]),
        );
        return {
          async run() {
            return stmt.run(params);
          },
          async all() {
            return { results: stmt.all(params) };
          },
        };
      };
      return { ...bind(), bind };
    },
    async batch(stmts: { run(): Promise<unknown> }[]) {
      batches.push(stmts.length);
      return Promise.all(stmts.map((s) => s.run()));
    },
  } as unknown as D1Database;
});
afterEach(() => sqlite.close());

it('writes many rows in batches, not one query per row', async () => {
  const store = new D1DocStore(db);
  const entries: [string, unknown][] = Array.from({ length: 250 }, (_, i) => [
    `d${i}.com`,
    { n: i },
  ]);
  await store.putMany('domain-purchases', entries);
  expect(batches).toEqual([100, 100, 50]);
  const all = await store.list('domain-purchases');
  expect(Object.keys(all)).toHaveLength(250);
  expect(all['d249.com']).toEqual({ n: 249 });

  // Upserts over existing keys.
  await store.putMany('domain-purchases', [['d0.com', { n: -1 }]]);
  expect((await store.list('domain-purchases'))['d0.com']).toEqual({ n: -1 });
});
