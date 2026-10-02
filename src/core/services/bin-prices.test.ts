import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import { exportBundle, importBundle } from '../storage/bundle';
import { getBinPrices, setBinPrices } from './bin-prices';
import { deleteDomains } from './domain-history';

let store: MemoryDocStore;
beforeEach(async () => {
  await flushWrites().catch(() => {});
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

const price = (
  domainName: string,
  amount: string | null,
  extra: Partial<{
    minOffer: string | null;
    floor: string | null;
    currency: string | null;
  }> = {},
) => ({
  domainName,
  amount,
  minOffer: null,
  floor: null,
  currency: 'USD',
  ...extra,
});

describe('BIN prices', () => {
  it('saves by domain name as whole amounts and survives Clear cache', async () => {
    setBinPrices([
      price('Münich.DE', '2500.00', {
        minOffer: '500',
        floor: '1000',
        currency: 'eur',
      }),
    ]);
    expect(getBinPrices()).toEqual({
      'xn--mnich-kva.de': {
        amount: '2500',
        minOffer: '500',
        floor: '1000',
        currency: 'EUR',
        updatedAt: expect.any(Number),
      },
    });
    clearAll();
    await flushWrites();
    expect(Object.keys(await store.list('domain-bin-prices'))).toEqual([
      'xn--mnich-kva.de',
    ]);
  });

  it('keeps offers without a price, and reads zero as blank', () => {
    setBinPrices([price('a.com', '0', { minOffer: '250' })]);
    expect(getBinPrices()['a.com']).toMatchObject({
      amount: null,
      minOffer: '250',
    });
  });

  it('clears a price when every amount is blank', () => {
    setBinPrices([price('a.com', '100')]);
    setBinPrices([price('a.com', null, { currency: null })]);
    expect(getBinPrices()).toEqual({});
  });

  it('refuses a minimum offer or floor above the price, and writes nothing', () => {
    expect(() =>
      setBinPrices([
        price('a.com', '100'),
        price('b.com', '100', { minOffer: '200' }),
      ]),
    ).toThrow('b.com: The minimum offer is above the BIN price.');
    expect(() =>
      setBinPrices([price('b.com', '100', { floor: '101' })]),
    ).toThrow('The floor price is above the BIN price.');
    expect(getBinPrices()).toEqual({});
  });

  it('checks the currency and its decimal places', () => {
    expect(() =>
      setBinPrices([price('a.com', '100', { currency: null })]),
    ).toThrow('Choose a currency');
    expect(() =>
      setBinPrices([price('a.com', '500.5', { currency: 'JPY' })]),
    ).toThrow('JPY uses no decimal places.');
    expect(() =>
      setBinPrices([price('a.com', '-1', { currency: 'USD' })]),
    ).toThrow("BIN price can't be negative.");
    expect(() =>
      setBinPrices([price('a.com', '99.50', { currency: 'USD' })]),
    ).toThrow('BIN price: use a whole amount.');
  });

  it('sets many names in one call and leaves unchanged ones alone', async () => {
    setBinPrices([price('a.com', '100'), price('b.com', '200')]);
    const first = getBinPrices()['a.com'].updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    setBinPrices([price('a.com', '100'), price('b.com', '300')]);
    expect(getBinPrices()['a.com'].updatedAt).toBe(first);
    expect(getBinPrices()['b.com'].amount).toBe('300');
  });

  it('is removed by Delete', () => {
    setBinPrices([price('a.com', '100')]);
    deleteDomains(['a.com']);
    expect(getBinPrices()).toEqual({});
  });

  it('travels in the data bundle', async () => {
    setBinPrices([price('a.com', '100', { floor: '80' })]);
    const text = exportBundle({ version: 'test', platform: 'test' });
    configureStore(new MemoryDocStore());
    await hydrateStores();
    expect(getBinPrices()).toEqual({});
    await importBundle(text);
    expect(getBinPrices()['a.com']).toMatchObject({
      amount: '100',
      floor: '80',
      currency: 'USD',
    });
  });
});
