import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import {
  getPurchases,
  importPurchases,
  setPurchase,
  setSale,
} from './purchases';

let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

describe('purchases', () => {
  it('saves by domain name and keeps the record when the cache is cleared', async () => {
    setPurchase({
      domainName: 'Example.COM',
      purchaseDate: '2020-01-02',
      amount: '0',
      currency: 'usd',
      notes: '  hand reg  ',
    });
    expect(getPurchases()['example.com']).toEqual({
      purchaseDate: '2020-01-02',
      amount: '0.00',
      currency: 'USD',
      notes: 'hand reg',
      saleDate: null,
      saleAmount: null,
      saleCurrency: null,
    });
    clearAll();
    expect(getPurchases()['example.com']?.amount).toBe('0.00');
    await flushWrites();
    expect(await store.get('domain-purchases', 'example.com')).toMatchObject({
      currency: 'USD',
    });
  });

  it('deletes the record when every field is cleared', () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: null,
      currency: null,
      notes: '',
    });
    expect(
      setPurchase({
        domainName: 'a.com',
        purchaseDate: null,
        amount: null,
        currency: null,
        notes: '   ',
      }),
    ).toBeNull();
    expect(getPurchases()['a.com']).toBeUndefined();
  });

  it('keeps a sale when the purchase is saved, and the purchase when the sale is saved', () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: '10',
      currency: 'USD',
      notes: 'hand reg',
    });
    setSale({
      domainName: 'a.com',
      saleDate: '2024-06-01',
      amount: '500',
      currency: 'USD',
      notes: 'sold on Afternic',
    });
    expect(getPurchases()['a.com']).toMatchObject({
      purchaseDate: '2020-01-01',
      amount: '10.00',
      saleDate: '2024-06-01',
      saleAmount: '500.00',
      notes: 'sold on Afternic',
    });
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-02',
      amount: '12',
      currency: 'USD',
      notes: 'sold on Afternic',
    });
    expect(getPurchases()['a.com']).toMatchObject({
      purchaseDate: '2020-01-02',
      amount: '12.00',
      saleDate: '2024-06-01',
      saleAmount: '500.00',
    });
  });

  it('rejects a negative amount and yen with a fraction', () => {
    expect(() =>
      setPurchase({
        domainName: 'a.com',
        purchaseDate: null,
        amount: '-1',
        currency: 'USD',
        notes: '',
      }),
    ).toThrow(/negative/);
    expect(() =>
      setPurchase({
        domainName: 'a.com',
        purchaseDate: null,
        amount: '1.5',
        currency: 'JPY',
        notes: '',
      }),
    ).toThrow(/no decimal/);
  });

  it('imports the good rows when one row is bad', () => {
    const result = importPurchases([
      {
        domainName: 'ok.com',
        purchaseDate: null,
        amount: '10',
        currency: 'EUR',
        notes: '',
      },
      {
        domainName: 'nope',
        purchaseDate: null,
        amount: '10',
        currency: 'EUR',
        notes: '',
      },
    ]);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(getPurchases()['ok.com']?.currency).toBe('EUR');
  });
});
