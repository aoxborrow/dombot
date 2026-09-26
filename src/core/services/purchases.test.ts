import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import { getPurchases, importPurchases, setPurchase } from './purchases';

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
