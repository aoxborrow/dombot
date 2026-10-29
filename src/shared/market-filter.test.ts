import { describe, expect, it } from 'vitest';
import type { ListPrice } from './ipc';
import {
  isMarketFilterSet,
  marketState,
  matchesMarketFilter,
  priceComparison,
  type MarketFilter,
} from './market-filter';
import type { MarketListing } from './markets';

const listing = (over: Partial<MarketListing> = {}): MarketListing =>
  ({
    market: 'afternic',
    accountId: 'a',
    name: 'example.com',
    status: 'active',
    forSale: true,
    price: '5000',
    currency: 'USD',
    ...over,
  }) as MarketListing;

const mine = { amount: '5000', currency: 'USD' } as ListPrice;
const ALL = ['afternic', 'atom', 'sedo'];
const filter = (over: Partial<MarketFilter> = {}): MarketFilter => ({
  markets: [],
  states: [],
  comparisons: [],
  min: null,
  max: null,
  currency: 'USD',
  ...over,
});

describe('marketState', () => {
  it('groups statuses as the table icons do', () => {
    expect(marketState(listing())).toBe('active');
    expect(marketState(listing({ forSale: false }))).toBe('inactive');
    expect(marketState(listing({ status: 'inactive' }))).toBe('inactive');
    expect(marketState(listing({ status: 'on_hold' }))).toBe('pending');
    expect(marketState(listing({ status: 'rejected' }))).toBe('rejected');
    expect(marketState(listing({ status: 'sold' }))).toBeNull();
  });
});

describe('priceComparison', () => {
  it('compares with your BIN price in the same currency', () => {
    expect(priceComparison(listing({ price: '6000' }), mine)).toBe('above');
    expect(priceComparison(listing({ price: '4000' }), mine)).toBe('below');
    expect(priceComparison(listing(), mine)).toBe('same');
    expect(priceComparison(listing({ currency: 'EUR' }), mine)).toBeNull();
    expect(priceComparison(listing({ price: null }), mine)).toBeNull();
    expect(priceComparison(listing(), undefined)).toBeNull();
  });
});

describe('matchesMarketFilter', () => {
  const both = [
    listing({ market: 'afternic', status: 'pending' }),
    listing({ market: 'sedo', price: '4000' }),
  ];

  it('is off until something is set', () => {
    expect(isMarketFilterSet(filter())).toBe(false);
    expect(isMarketFilterSet(filter({ markets: ['sedo'] }))).toBe(true);
  });

  it('with only markets ticked, finds names listed there', () => {
    const f = filter({ markets: ['atom'] });
    expect(matchesMarketFilter(both, mine, f, ALL)).toBe(false);
    expect(
      matchesMarketFilter(both, mine, filter({ markets: ['sedo'] }), ALL),
    ).toBe(true);
  });

  it('checks every condition against the same listing', () => {
    // Afternic is pending at your price; Sedo is active below it.
    const f = filter({ states: ['pending'], comparisons: ['below'] });
    expect(matchesMarketFilter(both, mine, f, ALL)).toBe(false);
    expect(
      matchesMarketFilter(
        both,
        mine,
        filter({ states: ['active'], comparisons: ['below'] }),
        ALL,
      ),
    ).toBe(true);
  });

  it('narrows to the ticked markets', () => {
    const f = filter({ markets: ['afternic'], comparisons: ['below'] });
    expect(matchesMarketFilter(both, mine, f, ALL)).toBe(false);
  });

  it('finds names missing from a market in play', () => {
    const notListed = filter({ states: ['none'] });
    // Atom has no listing, so all markets + Not listed matches.
    expect(matchesMarketFilter(both, mine, notListed, ALL)).toBe(true);
    expect(
      matchesMarketFilter(
        both,
        mine,
        { ...notListed, markets: ['afternic', 'sedo'] },
        ALL,
      ),
    ).toBe(false);
    expect(matchesMarketFilter(undefined, mine, notListed, ALL)).toBe(true);
  });

  it('bounds the market price', () => {
    expect(matchesMarketFilter(both, mine, filter({ min: 4500 }), ALL)).toBe(
      true,
    );
    expect(matchesMarketFilter(both, mine, filter({ min: 6000 }), ALL)).toBe(
      false,
    );
    expect(
      matchesMarketFilter(
        both,
        mine,
        filter({ markets: ['sedo'], max: 4500 }),
        ALL,
      ),
    ).toBe(true);
  });
});
