import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistrarName } from '@aoxborrow/registrar-client';

import { MemoryDocStore } from '../storage/doc-store';

// Overrides live in the `pricing-overrides` namespace; back it with a fresh
// in-memory store per test so they start empty, and let tests seed them via
// setManualPrice.

const getBaseRenewal = vi.fn<(r: string, tld: string) => number | null>();
vi.mock('./base-pricing', () => ({
  getBaseRenewal: (r: string, tld: string) => getBaseRenewal(r, tld),
}));

// Re-import fresh each test so the module-level overrides cache resets.
type PricingModule = typeof import('./pricing');
let pricing: PricingModule;
let storage: typeof import('../storage/namespace');
let store: MemoryDocStore;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  getBaseRenewal.mockReturnValue(null);
  // Import pricing first so its namespace registers with the (fresh) storage
  // module, then point that module at an empty store and hydrate.
  pricing = await import('./pricing');
  storage = await import('../storage/namespace');
  store = new MemoryDocStore();
  storage.configureStore(store);
  await storage.hydrateStores();
});

const reg = (name: string) => name as RegistrarName;

describe('usesPerNameQuote', () => {
  it('fetches Name.com quotes for both legacy and premium-capable TLDs', () => {
    expect(pricing.usesPerNameQuote(reg('namecom'), 'com')).toBe(true);
    expect(pricing.usesPerNameQuote(reg('namecom'), 'io')).toBe(true);
  });
  it('is true for gandi/dynadot on a premium-capable TLD', () => {
    expect(pricing.usesPerNameQuote(reg('gandi'), 'io')).toBe(true);
    expect(pricing.usesPerNameQuote(reg('dynadot'), 'DEV')).toBe(true); // case-insensitive
  });

  it('is false on a flat-priced legacy gTLD', () => {
    for (const tld of ['com', 'net', 'org', 'info', 'biz']) {
      expect(pricing.usesPerNameQuote(reg('gandi'), tld)).toBe(false);
    }
  });

  it('is false for a registrar that cannot price per name', () => {
    expect(pricing.usesPerNameQuote(reg('porkbun'), 'io')).toBe(false);
    expect(pricing.usesPerNameQuote(reg('cloudflare'), 'io')).toBe(false);
  });
});

describe('resolvePricing precedence', () => {
  it('base per-TLD when nothing else applies', () => {
    getBaseRenewal.mockReturnValue(9.99);
    const p = pricing.resolvePricing(reg('dynadot'), 'example.com');
    expect(p).toMatchObject({ renewal: 9.99, source: 'base', currency: 'USD' });
  });

  it('unavailable when there is no base rate', () => {
    getBaseRenewal.mockReturnValue(null);
    const p = pricing.resolvePricing(reg('dynadot'), 'example.weird');
    expect(p).toMatchObject({ renewal: null, source: 'unavailable' });
  });

  it('a synced per-name quote beats the base rate', () => {
    getBaseRenewal.mockReturnValue(9.99);
    const p = pricing.resolvePricing(reg('gandi'), 'example.io', {
      renewal: 42,
      currency: 'EUR',
    });
    expect(p).toMatchObject({ renewal: 42, source: 'api', currency: 'EUR' });
  });

  it('ignores a quote whose renewal is null and falls back to base', () => {
    getBaseRenewal.mockReturnValue(9.99);
    const p = pricing.resolvePricing(reg('gandi'), 'example.io', {
      renewal: null,
      currency: 'USD',
    });
    expect(p.source).toBe('base');
  });

  it('a manual override beats both quote and base', () => {
    getBaseRenewal.mockReturnValue(9.99);
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    const p = pricing.resolvePricing(reg('dynadot'), 'example.com', {
      renewal: 42,
      currency: 'USD',
    });
    expect(p).toMatchObject({ renewal: 25, source: 'manual' });
  });
});

describe('setManualPrice', () => {
  it('sets then clears an override (null deletes the key)', () => {
    getBaseRenewal.mockReturnValue(9.99);
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'manual',
    );

    pricing.setManualPrice(reg('dynadot'), 'example.com', null);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'base',
    );
  });

  it('treats NaN as a clear', () => {
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    pricing.setManualPrice(reg('dynadot'), 'example.com', Number.NaN);
    getBaseRenewal.mockReturnValue(null);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'unavailable',
    );
  });

  it('persists overrides to the store', async () => {
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    await storage.flushWrites();
    expect(await store.list('pricing-overrides')).toEqual({
      'dynadot:example.com': 25,
    });
  });
});
