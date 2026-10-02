import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistrarName } from '@aoxborrow/registrar-client';

import { MemoryDocStore } from '../storage/doc-store';

// Overrides live in the `domain-prices` namespace; back it with a fresh
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
    pricing.setManualPrice('example.com', { amount: '25.00', currency: 'USD' });
    const p = pricing.resolvePricing(reg('dynadot'), 'example.com', {
      renewal: 42,
      currency: 'USD',
    });
    expect(p).toMatchObject({ renewal: 25, source: 'manual' });
  });

  it('a user TLD rate beats the base rate', () => {
    getBaseRenewal.mockReturnValue(22.99);
    pricing.setTldRate(reg('godaddy'), 'com', 8.99);
    const p = pricing.resolvePricing(reg('godaddy'), 'Example.COM');
    expect(p).toMatchObject({ renewal: 8.99, source: 'tld', currency: 'USD' });
  });

  it('a synced quote beats a user TLD rate', () => {
    getBaseRenewal.mockReturnValue(9.99);
    pricing.setTldRate(reg('gandi'), 'io', 30);
    const p = pricing.resolvePricing(reg('gandi'), 'example.io', {
      renewal: 42,
      currency: 'EUR',
    });
    expect(p).toMatchObject({ renewal: 42, source: 'api', currency: 'EUR' });
  });

  it('a manual override beats a user TLD rate', () => {
    pricing.setTldRate(reg('godaddy'), 'com', 8.99);
    pricing.setManualPrice('premium.com', {
      amount: '199.00',
      currency: 'USD',
    });
    expect(pricing.resolvePricing(reg('godaddy'), 'cheap.com')).toMatchObject({
      renewal: 8.99,
      source: 'tld',
    });
    expect(pricing.resolvePricing(reg('godaddy'), 'premium.com')).toMatchObject(
      { renewal: 199, source: 'manual' },
    );
  });

  it('a TLD rate is registrar-specific', () => {
    pricing.setTldRate(reg('godaddy'), 'com', 8.99);
    getBaseRenewal.mockImplementation((r) => (r === 'dynadot' ? 10.5 : null));
    expect(pricing.resolvePricing(reg('godaddy'), 'a.com').source).toBe('tld');
    expect(pricing.resolvePricing(reg('dynadot'), 'a.com').source).toBe('base');
  });
});

describe('setManualPrice', () => {
  it('sets then clears an override (null deletes the key)', () => {
    getBaseRenewal.mockReturnValue(9.99);
    pricing.setManualPrice('example.com', { amount: '25.00', currency: 'USD' });
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'manual',
    );

    pricing.setManualPrice('example.com', null);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'base',
    );
  });

  it('treats a zero amount as a clear', () => {
    pricing.setManualPrice('example.com', { amount: '25.00', currency: 'USD' });
    pricing.setManualPrice('example.com', { amount: '0', currency: 'USD' });
    getBaseRenewal.mockReturnValue(null);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'unavailable',
    );
  });

  it('persists overrides to the store', async () => {
    pricing.setManualPrice('example.com', { amount: '25.00', currency: 'USD' });
    await storage.flushWrites();
    expect(await store.list('domain-prices')).toEqual({
      'example.com': { amount: '25.00', currency: 'USD' },
    });
  });

  it('keeps a manual price in its own currency', () => {
    pricing.setManualPrice('example.com', { amount: '1500', currency: 'jpy' });
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com')).toMatchObject(
      { renewal: 1500, currency: 'JPY', source: 'manual' },
    );
    expect(() =>
      pricing.setManualPrice('example.com', { amount: '9.5', currency: 'JPY' }),
    ).toThrow('JPY uses no decimal places.');
    expect(() =>
      pricing.setManualPrice('example.com', { amount: '9', currency: 'XYZ' }),
    ).toThrow('Unknown currency XYZ.');
  });

  it('still reads a price stored as a USD number', async () => {
    await store.put('domain-prices', 'old.com', 12.5);
    await storage.hydrateStores();
    expect(pricing.resolvePricing(reg('dynadot'), 'old.com')).toMatchObject({
      renewal: 12.5,
      currency: 'USD',
      source: 'manual',
    });
  });

  it('keys by name, so the override follows the domain to another account', () => {
    pricing.setManualPrice('Münich.DE', { amount: '40.00', currency: 'USD' });
    expect(
      pricing.resolvePricing(
        reg('dynadot'),
        'xn--mnich-kva.de',
        undefined,
        'acct-1',
      ),
    ).toMatchObject({ renewal: 40, source: 'manual' });
    expect(
      pricing.resolvePricing(reg('godaddy'), 'münich.de', undefined, 'acct-2'),
    ).toMatchObject({ renewal: 40, source: 'manual' });
  });
});

describe('setTldRate', () => {
  it('normalizes the TLD and persists the rate', async () => {
    pricing.setTldRate(reg('godaddy'), '.COM', 8.99);
    pricing.setTldRate(reg('dynadot'), 'IO', 32);
    await storage.flushWrites();
    expect(await store.list('registrar-tld-rates')).toEqual({
      'godaddy:com': 8.99,
      'dynadot:io': 32,
    });
  });

  it('clears with null', () => {
    getBaseRenewal.mockReturnValue(22.99);
    pricing.setTldRate(reg('godaddy'), 'com', 8.99);
    expect(pricing.resolvePricing(reg('godaddy'), 'a.com').source).toBe('tld');
    pricing.setTldRate(reg('godaddy'), 'com', null);
    expect(pricing.resolvePricing(reg('godaddy'), 'a.com').source).toBe('base');
  });

  it('keys a shopper rate by account and falls back to registrar', () => {
    getBaseRenewal.mockReturnValue(22.99);
    pricing.setTldRate(reg('godaddy'), 'com', 8.99, 'acct-1');
    pricing.setTldRate(reg('godaddy'), 'com', 10.99);
    expect(
      pricing.resolvePricing(reg('godaddy'), 'a.com', undefined, 'acct-1'),
    ).toMatchObject({ renewal: 8.99, source: 'tld' });
    expect(pricing.resolvePricing(reg('godaddy'), 'a.com')).toMatchObject({
      renewal: 10.99,
      source: 'tld',
    });
    expect(
      pricing.resolvePricing(reg('godaddy'), 'a.com', undefined, 'acct-2'),
    ).toMatchObject({ renewal: 10.99, source: 'tld' });
  });
});
