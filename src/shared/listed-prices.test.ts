import { describe, expect, it } from 'vitest';
import { ExchangeRates } from './exchange-rates';
import { listedPriceFor } from './listed-prices';
import type { MarketListing } from './markets';

const listing = (over: Partial<MarketListing> = {}): MarketListing =>
  ({
    market: 'afternic',
    accountId: 'a',
    name: 'example.com',
    status: 'active',
    forSale: true,
    price: '5000',
    minOffer: null,
    floor: null,
    currency: 'USD',
    ...over,
  }) as MarketListing;

describe('listedPriceFor', () => {
  it('copies a listing’s BIN price, minimum offer and floor', () => {
    expect(
      listedPriceFor(
        [listing({ price: '5000', minOffer: '1000', floor: '3000' })],
        'afternic',
      ),
    ).toEqual({
      amount: '5000',
      minOffer: '1000',
      floor: '3000',
      currency: 'USD',
      market: 'afternic',
      accountId: 'a',
    });
  });

  it('keeps to the chosen market', () => {
    const listings = [listing(), listing({ market: 'sedo', price: '9000' })];
    expect(listedPriceFor(listings, 'afternic')?.amount).toBe('5000');
    expect(listedPriceFor(listings, 'atom')).toBeNull();
    expect(listedPriceFor(listings, 'highest')?.market).toBe('sedo');
  });

  it('takes the highest BIN, then minimum offer, then floor', () => {
    const listings = [
      listing({ accountId: 'x', price: null, minOffer: '800' }),
      listing({ accountId: 'y', price: '5000', floor: '100' }),
      listing({ accountId: 'z', price: '5000', floor: '200' }),
    ];
    expect(listedPriceFor(listings, 'highest')?.accountId).toBe('z');
    expect(
      listedPriceFor(
        [listings[0], listing({ price: null, minOffer: '500' })],
        'highest',
      )?.minOffer,
    ).toBe('800');
  });

  it('compares across currencies in USD when rates are given', () => {
    const rates = new ExchangeRates(
      {},
      new Map([['2024-03', { USD: 1.1 } as never]]),
    );
    const listings = [
      listing({ price: '1050' }),
      listing({ market: 'sedo', price: '1000', currency: 'EUR' }),
    ];
    expect(listedPriceFor(listings, 'highest')?.currency).toBe('USD');
    expect(listedPriceFor(listings, 'highest', rates)?.currency).toBe('EUR');
  });

  it('fills a minimum offer or floor the winner lacks from the others', () => {
    const rates = new ExchangeRates(
      {},
      new Map([['2024-03', { USD: 1.1 } as never]]),
    );
    const listings = [
      listing({ market: 'atom', price: '3000' }),
      listing({ price: '2500', minOffer: '750', floor: '2000' }),
      listing({ market: 'sedo', price: '2500', minOffer: '900' }),
      // Above the winner's BIN price: never used.
      listing({ market: 'dynadot', price: '1000', floor: '5000' }),
    ];
    expect(listedPriceFor(listings, 'highest')).toMatchObject({
      market: 'atom',
      amount: '3000',
      minOffer: '900',
      floor: '2000',
    });
    // Another currency fills in only with rates, converted and rounded.
    const eur = [
      listing({ market: 'atom', price: '3000' }),
      listing({
        market: 'sedo',
        price: '2000',
        minOffer: '500',
        currency: 'EUR',
      }),
    ];
    expect(listedPriceFor(eur, 'highest')?.minOffer).toBeNull();
    expect(listedPriceFor(eur, 'highest', rates)?.minOffer).toBe('550');
    // A winner's own amounts are kept.
    expect(
      listedPriceFor(
        [listing({ minOffer: '100' }), listing({ price: '10', minOffer: '9' })],
        'highest',
      )?.minOffer,
    ).toBe('100');
  });

  it('rounds to whole amounts and drops amounts above the BIN price', () => {
    expect(
      listedPriceFor(
        [listing({ price: '1479.6', minOffer: '2000', floor: '0' })],
        'highest',
      ),
    ).toMatchObject({ amount: '1480', minOffer: null, floor: null });
  });

  it('skips sold listings and listings without a price', () => {
    expect(
      listedPriceFor(
        [listing({ status: 'sold' }), listing({ price: null })],
        'highest',
      ),
    ).toBeNull();
    expect(listedPriceFor(undefined, 'highest')).toBeNull();
  });
});
