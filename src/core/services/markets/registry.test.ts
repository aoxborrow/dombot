import { describe, expect, it } from 'vitest';
import { marketCatalog } from './registry';

describe('market catalog', () => {
  it('has each market’s nameservers, with unique keys and lowercase hosts', () => {
    const catalog = marketCatalog();
    for (const m of catalog) expect(m.nameservers.length).toBeGreaterThan(0);
    const keys = catalog.flatMap((m) => m.nameservers.map((s) => s.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of catalog.flatMap((m) => m.nameservers)) {
      for (const h of s.hosts) expect(h).toBe(h.toLowerCase());
    }
  });
});
