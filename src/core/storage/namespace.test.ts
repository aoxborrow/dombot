import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore, type DocStore } from './doc-store';
import {
  Namespace,
  configureStore,
  flushWrites,
  hydrateStores,
} from './namespace';

describe('Namespace over a DocStore', () => {
  let store: MemoryDocStore;
  beforeEach(() => {
    store = new MemoryDocStore();
    configureStore(store);
  });

  it('throws when read before hydration', () => {
    const ns = new Namespace<number>('t-unhydrated');
    expect(() => ns.get('a')).toThrow(/hydrateStores/);
  });

  it('round-trips values through the store', async () => {
    const ns = new Namespace<{ n: number }>('t-roundtrip');
    await hydrateStores();
    await ns.set('a', { n: 1 });
    await ns.set('b', { n: 2 });
    expect(ns.get('a')).toEqual({ n: 1 });
    expect(ns.all()).toEqual({ a: { n: 1 }, b: { n: 2 } });
    expect(await store.list('t-roundtrip')).toEqual({
      a: { n: 1 },
      b: { n: 2 },
    });

    await ns.delete('a');
    expect(ns.has('a')).toBe(false);
    expect(await store.get('t-roundtrip', 'a')).toBeNull();

    await ns.clear();
    expect(ns.size()).toBe(0);
    expect(await store.list('t-roundtrip')).toEqual({});
  });

  it('loads what the store already holds', async () => {
    await store.put('t-preload', 'k', 'v');
    const ns = new Namespace<string>('t-preload');
    await hydrateStores();
    expect(ns.get('k')).toBe('v');
  });

  it('reads are synchronous and reflect a write immediately', async () => {
    const ns = new Namespace<number>('t-sync');
    await hydrateStores();
    void ns.set('x', 5);
    expect(ns.get('x')).toBe(5);
    await flushWrites();
  });

  it('persists writes in order and survives a failed write', async () => {
    const puts: string[] = [];
    const flaky: DocStore = {
      ...new MemoryDocStore(),
      async put(_ns, key) {
        if (key === 'bad') throw new Error('disk full');
        puts.push(key);
      },
      async delete() {},
      async clear() {},
      async get() {
        return null;
      },
      async list() {
        return {};
      },
    };
    configureStore(flaky);
    const ns = new Namespace<number>('t-order');
    await hydrateStores();
    const ok1 = ns.set('one', 1);
    const bad = ns.set('bad', 2);
    const ok2 = ns.set('two', 3);
    await expect(bad).rejects.toThrow('disk full');
    await Promise.all([ok1, ok2]);
    expect(puts).toEqual(['one', 'two']);
    // Memory still holds the value whose persist failed — the caller decides.
    expect(ns.get('bad')).toBe(2);
  });

  it('configureStore drops in-memory copies until the next hydrate', async () => {
    const ns = new Namespace<number>('t-reset');
    await hydrateStores();
    await ns.set('a', 1);
    configureStore(new MemoryDocStore());
    expect(ns.loaded).toBe(false);
    await hydrateStores();
    expect(ns.get('a')).toBeUndefined();
  });
});
