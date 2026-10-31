import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExchangeRates } from '../../../shared/exchange-rates';
import type { Domain, RenewalPricing } from '../../../shared/ipc';
import { priceKey } from '../../lib/renewals';
import { DomainsCards } from './DomainsCards';

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
