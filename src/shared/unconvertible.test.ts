import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import type { ListPrice, RenewalPricing } from './ipc';
import { unconvertibleAmounts } from './unconvertible';

const event = (
  domain: string,
  type: DomainEvent['type'],
  currency: string | null,
): DomainEvent =>
  ({
    id: `${domain}-${type}`,
    domain,
    type,
    source: 'user',
    date: '2024-01-01',
    amount: currency ? '10' : null,
    currency,
    createdAt: 1,
    updatedAt: 1,
  }) as DomainEvent;

const renewal = (
  domain: string,
  currency: string,
  source: RenewalPricing['source'],
): RenewalPricing => ({
  domain,
  registrar: 'dynadot',
  renewal: 12,
  currency,
  source,
});

describe('unconvertibleAmounts', () => {
  it('lists what you entered outside the 30, one per name and kind', () => {
    const events = [
      event('b.com', 'purchased', 'TWD'),
      event('b.com', 'registered', 'TWD'),
      event('a.com', 'sold', 'KES'),
      event('a.com', 'purchased', 'USD'),
      event('c.com', 'sold', null),
      event('d.com', 'renewed', 'TWD'),
    ];
    const listPrices: Record<string, ListPrice> = {
      'c.com': { amount: '500', currency: 'ARS', updatedAt: 1 },
      'e.com': { amount: '500', currency: 'EUR', updatedAt: 1 },
    };
    const pricing = {
      'dynadot:Münich.de': renewal('Münich.de', 'TWD', 'manual'),
      'dynadot:f.com': renewal('f.com', 'TWD', 'api'),
    };
    expect(unconvertibleAmounts(events, listPrices, pricing)).toEqual([
      { domain: 'a.com', kind: 'sale', currency: 'KES' },
      { domain: 'b.com', kind: 'purchase', currency: 'TWD' },
      { domain: 'c.com', kind: 'asking price', currency: 'ARS' },
      { domain: 'xn--mnich-kva.de', kind: 'renewal price', currency: 'TWD' },
    ]);
  });

  it('is empty when everything is in the 30', () => {
    expect(
      unconvertibleAmounts([event('a.com', 'purchased', 'JPY')], {}, {}),
    ).toEqual([]);
  });
});
