import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExchangeRates } from '../../../shared/exchange-rates';
import type { Domain, RenewalPricing } from '../../../shared/ipc';
import { priceKey } from '../../lib/renewals';
import type { MarketListing } from '../../../shared/markets';
import { DomainsCards, binTotal } from './DomainsCards';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const inDays = (days: number) => new Date(NOW + days * DAY);
const row = (domainName: string, patch: Partial<Domain> = {}): Domain => ({
  registrar: 'dynadot',
  domainName,
  status: 'active',
  createdDate: null,
  expirationDate: inDays(200),
  renewalDate: null,
  autoRenew: true,
  locked: false,
  privacy: false,
  nameservers: [],
  syncedAt: new Date(NOW),
  deleted: false,
  source: 'registrar',
  ...patch,
});
const price = (d: Domain, renewal: number): [string, RenewalPricing] => [
  priceKey(d),
  {
    domain: d.domainName,
    registrar: d.registrar,
    renewal,
    currency: 'USD',
    source: 'tld',
  },
];
const noop = () => {};

/** The Owned view's cards as text: each label, then its value. */
function ownedCards(rows: Domain[], pricing: Record<string, RenewalPricing>) {
  const html = renderToStaticMarkup(
    createElement(DomainsCards, {
      view: 'owned',
      rows,
      listings: {},
      markets: [],
      listPrices: {},
      traffic: {},
      expiresWithin: (d) => {
        const t = d.expirationDate?.getTime() ?? Infinity;
        return t >= NOW && t <= NOW + 30 * DAY;
      },
      archiveLabelOf: () => null,
      pricing,
      currency: 'USD',
      numberFormat: 'us',
      fx: new ExchangeRates(),
      actions: {
        onExpiring: noop,
        onAutoRenew: noop,
        onMarketStates: noop,
        onPriceComparisons: noop,
        onListings: noop,
        onArchiveStatus: noop,
      },
    }),
  );
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('DomainsCards, Owned', () => {
  const renewing = row('renewing.com', { autoRenew: true });
  // Auto-renew takes care of it, however soon it expires.
  const soonButRenewing = row('soon-renewing.com', {
    autoRenew: true,
    expirationDate: inDays(5),
  });
  const off = row('off.com', { autoRenew: false, expirationDate: inDays(10) });
  // A name you added: DomBot can't tell, so it doesn't renew on its own.
  const added = row('added.net', {
    source: 'imported',
    autoRenew: false,
    autoRenewUnknown: true,
    expirationDate: inDays(20),
  });
  const later = row('later.org', {
    autoRenew: false,
    expirationDate: inDays(45),
  });
  const rows = [renewing, soonButRenewing, off, added, later];
  const pricing = Object.fromEntries([
    price(renewing, 10),
    price(soonButRenewing, 1_500),
    price(off, 20),
  ]);

  it('counts names expiring within 30 days that don’t renew on their own', () => {
    expect(ownedCards(rows, pricing)).toContain(
      'Expiring, 30 days 2 auto-renew off',
    );
  });

  it('shows the share that auto-renews and what those cost a year', () => {
    expect(ownedCards(rows, pricing)).toContain('Auto-renew 40% $1.5k/yr');
  });

  it('leaves the cost off when no auto-renewing name has a price', () => {
    const text = ownedCards(rows, {});
    expect(text).toContain('Auto-renew 40% Expiring');
  });
});

describe('Total BIN', () => {
  const listing = (
    market: MarketListing['market'],
    price: string | null,
    patch: Partial<MarketListing> = {},
  ): MarketListing =>
    ({
      market,
      accountId: market,
      name: 'a.com',
      displayName: null,
      status: 'active',
      statusRaw: 'active',
      forSale: true,
      price,
      buyNow: price != null,
      minOffer: null,
      floor: null,
      discount: null,
      currency: 'USD',
      leaseToOwn: null,
      tier: null,
      listedAt: null,
      updatedAt: null,
      ...patch,
    }) as MarketListing;
  // EUR at 1, USD at 1.25: €100 is $125.
  const fx = {
    convert: (amount: number | string, from: string, to: string) => {
      const rate: Record<string, number> = { EUR: 1, USD: 1.25 };
      if (!(from in rate) || !(to in rate)) return null;
      return {
        amount: (Number(amount) * rate[to]) / rate[from],
        period: null,
        provisional: false,
      };
    },
  };

  it('adds up each name’s highest live Buy Now price across the markets', () => {
    const total = binTotal([row('a.com'), row('b.com'), row('c.com')], {
      listings: {
        'a.com': [
          listing('afternic', '1000'),
          // €900 is $1,125: the highest.
          listing('sedo', '900', { currency: 'EUR' }),
          // Not live, so it doesn't count.
          listing('atom', '5000', { status: 'pending' }),
        ],
        'b.com': [
          // Offers only, and a hidden listing: neither has a live BIN.
          listing('afternic', null),
          listing('spaceship', '700', { forSale: false }),
        ],
        'c.com': [listing('spaceship', '2500')],
      },
      markets: ['afternic', 'sedo', 'atom', 'spaceship'],
      // Your asking prices don't count once markets are connected.
      listPrices: { 'b.com': { amount: '99999', currency: 'USD' } as never },
      currency: 'USD',
      fx,
    });
    expect(total).toEqual({ sum: 3625, count: 2, leftOut: 0 });
  });

  it('leaves out markets the filter leaves out, and prices it can’t convert', () => {
    const total = binTotal([row('a.com'), row('b.com')], {
      listings: {
        'a.com': [listing('afternic', '1000'), listing('sedo', '5000')],
        'b.com': [listing('sedo', '800', { currency: 'XYZ' as never })],
      },
      markets: ['afternic', 'sedo'],
      listPrices: {},
      currency: 'USD',
      fx,
    });
    expect(total).toEqual({ sum: 5000, count: 1, leftOut: 1 });
    expect(
      binTotal([row('a.com')], {
        listings: {
          'a.com': [listing('afternic', '1000'), listing('sedo', '5000')],
        },
        markets: ['afternic'],
        listPrices: {},
        currency: 'USD',
        fx,
      }),
    ).toEqual({ sum: 1000, count: 1, leftOut: 0 });
  });

  it('uses your asking prices without a market account', () => {
    expect(
      binTotal([row('a.com')], {
        listings: null,
        markets: [],
        listPrices: { 'a.com': { amount: '400', currency: 'EUR' } as never },
        currency: 'USD',
        fx,
      }),
    ).toEqual({ sum: 500, count: 1, leftOut: 0 });
  });
});
