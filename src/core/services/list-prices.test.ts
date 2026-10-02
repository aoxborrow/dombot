import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import { exportBundle, importBundle } from '../storage/bundle';
import { getListPrices, setListPrices } from './list-prices';
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
    setListPrices([
      price('Münich.DE', '2500.00', {
        minOffer: '500',
        floor: '1000',
        currency: 'eur',
      }),
    ]);
    expect(getListPrices()).toEqual({
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
    expect(Object.keys(await store.list('domain-list-prices'))).toEqual([
      'xn--mnich-kva.de',
    ]);
  });

  it('keeps offers without a price, and reads zero as blank', () => {
    setListPrices([price('a.com', '0', { minOffer: '250' })]);
    expect(getListPrices()['a.com']).toMatchObject({
      amount: null,
      minOffer: '250',
    });
  });

  it('clears a price when every amount is blank', () => {
    setListPrices([price('a.com', '100')]);
    setListPrices([price('a.com', null, { currency: null })]);
    expect(getListPrices()).toEqual({});
  });

  it('refuses a minimum offer or floor above the price, and writes nothing', () => {
    expect(() =>
      setListPrices([
        price('a.com', '100'),
        price('b.com', '100', { minOffer: '200' }),
      ]),
    ).toThrow('b.com: The minimum offer is above the BIN price.');
    expect(() =>
      setListPrices([price('b.com', '100', { floor: '101' })]),
    ).toThrow('The floor price is above the BIN price.');
    expect(getListPrices()).toEqual({});
  });

  it('checks the currency and its decimal places', () => {
    expect(() =>
      setListPrices([price('a.com', '100', { currency: null })]),
    ).toThrow('Choose a currency');
    expect(() =>
      setListPrices([price('a.com', '500.5', { currency: 'JPY' })]),
    ).toThrow('JPY uses no decimal places.');
    expect(() =>
      setListPrices([price('a.com', '-1', { currency: 'USD' })]),
    ).toThrow("BIN price can't be negative.");
    expect(() =>
      setListPrices([price('a.com', '99.50', { currency: 'USD' })]),
    ).toThrow('BIN price: use a whole amount.');
  });

  it('sets many names in one call and leaves unchanged ones alone', async () => {
    setListPrices([price('a.com', '100'), price('b.com', '200')]);
    const first = getListPrices()['a.com'].updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    setListPrices([price('a.com', '100'), price('b.com', '300')]);
    expect(getListPrices()['a.com'].updatedAt).toBe(first);
    expect(getListPrices()['b.com'].amount).toBe('300');
  });

  it('is removed by Delete', () => {
    setListPrices([price('a.com', '100')]);
    deleteDomains(['a.com']);
    expect(getListPrices()).toEqual({});
  });

  it('travels in the data bundle', async () => {
    setListPrices([price('a.com', '100', { floor: '80' })]);
    const text = exportBundle({ version: 'test', platform: 'test' });
    configureStore(new MemoryDocStore());
    await hydrateStores();
    expect(getListPrices()).toEqual({});
    await importBundle(text);
    expect(getListPrices()['a.com']).toMatchObject({
      amount: '100',
      floor: '80',
      currency: 'USD',
    });
  });
});
