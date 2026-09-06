import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Domain, RenewalPricing } from '../../shared/ipc';
import {
  dueWithin,
  groupBy,
  summarize,
  tldOf,
  upcomingByMonth,
} from './renewals';

const NOW = new Date('2026-06-15T12:00:00Z');

function domain(partial: Partial<Domain> & { domainName: string }): Domain {
  return {
    registrar: 'dynadot',
    status: 'active',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(0),
    deleted: false,
    ...partial,
  };
}

function price(
  d: Domain,
  renewal: number | null,
  source: RenewalPricing['source'] = 'base',
): [string, RenewalPricing] {
  return [
    `${d.registrar}:${d.domainName}`,
    { domain: d.domainName, registrar: d.registrar, renewal, currency: 'USD', source },
  ];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('tldOf', () => {
  it('takes everything after the first dot, lowercased', () => {
    expect(tldOf('Example.CO.UK')).toBe('co.uk');
    expect(tldOf('example.com')).toBe('com');
  });
  it('is empty when there is no dot', () => expect(tldOf('localhost')).toBe(''));
});

describe('summarize', () => {
  it('counts priced/unpriced, sources, and sums', () => {
    const a = domain({ domainName: 'a.com', autoRenew: true });
    const b = domain({ domainName: 'b.com' });
    const c = domain({ domainName: 'c.com' }); // unpriced
    const pricing = Object.fromEntries([
      price(a, 10, 'base'),
      price(b, 20, 'manual'),
    ]);
    const s = summarize([a, b, c], pricing);

    expect(s.total).toBe(3);
    expect(s.priced).toBe(2);
    expect(s.unpriced).toBe(1);
    expect(s.base).toBe(1);
    expect(s.manual).toBe(1);
    expect(s.yearly).toBe(30);
    expect(s.yearlyAutoRenew).toBe(10); // only a has autoRenew
    expect(s.avgPerDomain).toBe(15);
  });

  it('treats a null renewal as unpriced', () => {
    const a = domain({ domainName: 'a.com' });
    const s = summarize([a], Object.fromEntries([price(a, null)]));
    expect(s.priced).toBe(0);
    expect(s.unpriced).toBe(1);
  });

  it('handles empty input with a zero average', () => {
    const s = summarize([], {});
    expect(s).toMatchObject({ total: 0, priced: 0, yearly: 0, avgPerDomain: 0 });
  });
});

describe('groupBy', () => {
  it('groups, sums known renewals, and sorts by spend desc then count', () => {
    const a = domain({ domainName: 'a.com', registrar: 'dynadot' });
    const b = domain({ domainName: 'b.com', registrar: 'dynadot' });
    const c = domain({ domainName: 'c.net', registrar: 'porkbun' });
    const pricing = Object.fromEntries([price(a, 5), price(b, 5), price(c, 50)]);

    const groups = groupBy(
      [a, b, c],
      pricing,
      (d) => d.registrar,
      (k) => k.toUpperCase(),
    );
    expect(groups.map((g) => g.key)).toEqual(['porkbun', 'dynadot']); // 50 > 10
    expect(groups[0]).toMatchObject({ label: 'PORKBUN', count: 1, priced: 1, yearly: 50 });
    expect(groups[1]).toMatchObject({ count: 2, priced: 2, yearly: 10 });
  });

  it('breaks a spend tie by count desc', () => {
    const a = domain({ domainName: 'a.com', registrar: 'dynadot' });
    const b = domain({ domainName: 'b.net', registrar: 'porkbun' });
    const c = domain({ domainName: 'c.net', registrar: 'porkbun' });
    // Both groups sum to 0 (unpriced) → tie broken by count.
    const groups = groupBy([a, b, c], {}, (d) => d.registrar, (k) => k);
    expect(groups[0].key).toBe('porkbun');
    expect(groups[0].count).toBe(2);
  });
});

describe('upcomingByMonth', () => {
  it('returns a continuous strip of `months` buckets including empty ones', () => {
    const buckets = upcomingByMonth([], {}, 3);
    expect(buckets.map((b) => b.key)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(buckets.map((b) => b.label)).toEqual(['Jun 2026', 'Jul 2026', 'Aug 2026']);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('crosses a year boundary', () => {
    const buckets = upcomingByMonth([], {}, 8); // Jun..Jan
    expect(buckets[buckets.length - 1].key).toBe('2027-01');
  });

  it('buckets by renewal month and folds past-due into the current month', () => {
    const past = domain({ domainName: 'past.com', renewalDate: new Date('2026-01-01') });
    const soon = domain({ domainName: 'soon.com', renewalDate: new Date('2026-07-10') });
    const pricing = Object.fromEntries([price(past, 10), price(soon, 20)]);
    const buckets = upcomingByMonth([past, soon], pricing, 3);

    const jun = buckets.find((b) => b.key === '2026-06')!;
    const jul = buckets.find((b) => b.key === '2026-07')!;
    expect(jun).toMatchObject({ count: 1, priced: 1, yearly: 10 }); // past folded in
    expect(jul).toMatchObject({ count: 1, priced: 1, yearly: 20 });
  });

  it('skips renewals beyond the window and invalid/missing dates', () => {
    const far = domain({ domainName: 'far.com', renewalDate: new Date('2027-12-01') });
    const none = domain({ domainName: 'none.com', renewalDate: null, expirationDate: null });
    const buckets = upcomingByMonth([far, none], {}, 3);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('falls back to expirationDate when renewalDate is missing', () => {
    const d = domain({ domainName: 'x.com', expirationDate: new Date('2026-07-05') });
    const buckets = upcomingByMonth([d], {}, 3);
    expect(buckets.find((b) => b.key === '2026-07')!.count).toBe(1);
  });
});

describe('dueWithin', () => {
  it('counts domains due within the cutoff and sums only priced ones', () => {
    const soon = domain({ domainName: 'soon.com', renewalDate: new Date('2026-06-20') });
    const unpriced = domain({ domainName: 'u.com', renewalDate: new Date('2026-06-18') });
    const later = domain({ domainName: 'later.com', renewalDate: new Date('2026-08-01') });
    const pricing = Object.fromEntries([price(soon, 12)]);

    const r = dueWithin([soon, unpriced, later], pricing, 30);
    expect(r.count).toBe(2); // soon + unpriced, both within 30 days
    expect(r.yearly).toBe(12); // only soon is priced
  });

  it('includes a renewal exactly at the cutoff boundary', () => {
    const at = domain({
      domainName: 'at.com',
      renewalDate: new Date(NOW.getTime() + 10 * 86_400_000),
    });
    expect(dueWithin([at], {}, 10).count).toBe(1);
  });
});
