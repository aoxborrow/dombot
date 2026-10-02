import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import { exportBundle, importBundle } from '../storage/bundle';
import { getAskingPrices, setAskingPrices } from './asking-prices';
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

describe('asking prices', () => {
  it('saves by domain name in canonical form and survives Clear cache', async () => {
    setAskingPrices([
      price('Münich.DE', '2500', {
        minOffer: '500',
        floor: '1000.5',
        currency: 'eur',
      }),
    ]);
    expect(getAskingPrices()).toEqual({
      'xn--mnich-kva.de': {
        amount: '2500.00',
        minOffer: '500.00',
        floor: '1000.50',
        currency: 'EUR',
        updatedAt: expect.any(Number),
      },
    });
    clearAll();
    await flushWrites();
    expect(Object.keys(await store.list('domain-asking-prices'))).toEqual([
      'xn--mnich-kva.de',
    ]);
  });

  it('keeps offers without a price, and reads zero as blank', () => {
    setAskingPrices([price('a.com', '0', { minOffer: '250' })]);
    expect(getAskingPrices()['a.com']).toMatchObject({
      amount: null,
      minOffer: '250.00',
    });
  });

  it('clears a price when every amount is blank', () => {
    setAskingPrices([price('a.com', '100')]);
    setAskingPrices([price('a.com', null, { currency: null })]);
    expect(getAskingPrices()).toEqual({});
  });

  it('refuses a minimum offer or floor above the price, and writes nothing', () => {
    expect(() =>
      setAskingPrices([
        price('a.com', '100'),
        price('b.com', '100', { minOffer: '200' }),
      ]),
    ).toThrow('b.com: The minimum offer is above the asking price.');
    expect(() =>
      setAskingPrices([price('b.com', '100', { floor: '101' })]),
    ).toThrow('The floor price is above the asking price.');
    expect(getAskingPrices()).toEqual({});
  });

  it('checks the currency and its decimal places', () => {
    expect(() =>
      setAskingPrices([price('a.com', '100', { currency: null })]),
    ).toThrow('Choose a currency');
    expect(() =>
      setAskingPrices([price('a.com', '500.5', { currency: 'JPY' })]),
    ).toThrow('JPY uses no decimal places.');
    expect(() =>
      setAskingPrices([price('a.com', '-1', { currency: 'USD' })]),
    ).toThrow("Asking price can't be negative.");
  });

  it('sets many names in one call and leaves unchanged ones alone', async () => {
    setAskingPrices([price('a.com', '100'), price('b.com', '200')]);
    const first = getAskingPrices()['a.com'].updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    setAskingPrices([price('a.com', '100'), price('b.com', '300')]);
    expect(getAskingPrices()['a.com'].updatedAt).toBe(first);
    expect(getAskingPrices()['b.com'].amount).toBe('300.00');
  });

  it('is removed by Delete', () => {
    setAskingPrices([price('a.com', '100')]);
    deleteDomains(['a.com']);
    expect(getAskingPrices()).toEqual({});
  });

  it('travels in the data bundle', async () => {
    setAskingPrices([price('a.com', '100', { floor: '80' })]);
    const text = exportBundle({ version: 'test', platform: 'test' });
    configureStore(new MemoryDocStore());
    await hydrateStores();
    expect(getAskingPrices()).toEqual({});
    await importBundle(text);
    expect(getAskingPrices()['a.com']).toMatchObject({
      amount: '100.00',
      floor: '80.00',
      currency: 'USD',
    });
  });
});
