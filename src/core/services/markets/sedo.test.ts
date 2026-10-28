import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../../markets/rate-limit';
import { SedoClient, type SedoListing } from '../../markets/sedo';
import * as fx from '../../markets/sedo/fixtures';
import { buildAdapter, isMarketId, marketInfo } from './registry';
import {
  SEDO_CAPABILITIES,
  SedoAdapter,
  checkSedoChange,
  listingFromSedo,
  mergeSedoChange,
} from './sedo';

const NOW = Date.parse('2026-10-28T12:00:00Z');

function adapter(respond: (fn: string, form: URLSearchParams) => string) {
  const calls: { fn: string; form: URLSearchParams }[] = [];
  const clock: Clock = { now: () => NOW, sleep: async () => {} };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const fn = new URL(String(input)).pathname.split('/').pop() ?? '';
    const form = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ fn, form });
    return new Response(respond(fn, form));
  }) as typeof fetch;
  const client = new SedoClient({
    partnerId: '1',
    signKey: 's',
    username: 'u',
    password: 'p',
    fetch: fetchImpl,
    userAgent: 'test',
    clock,
    limiter: new RateLimiter(clock, 1000),
  });
  return { sedo: new SedoAdapter('acct', client, () => NOW), calls };
}

const listed = (l: Partial<SedoListing> = {}): SedoListing => ({
  name: 'example.com',
  categories: [104],
  forSale: true,
  price: '900',
  minPrice: '100',
  fixedPrice: false,
  currency: 'EUR',
  language: 'de',
  insertedAt: '2020-01-01T00:00:00Z',
  earningsTotal: '0.94',
  keywords: [
    {
      keyword: 'example',
      market: 'us',
      views: 1,
      clicks: 0,
      earnings: null,
      rpm: null,
      inserted: null,
    },
  ],
  ...l,
});

/** Names in a write's domainentry fields. */
const entries = (form: URLSearchParams) =>
  [...form]
    .filter(([k]) => /^domainentry\[\d+\]\[domain\]$/.test(k))
    .map(([, v]) => [v] as [string]);

describe('listingFromSedo', () => {
  it('maps a listing into the shared shape', () => {
    expect(listingFromSedo(listed(), 'acct')).toEqual({
      market: 'sedo',
      accountId: 'acct',
      name: 'example.com',
      displayName: null,
      status: 'active',
      statusRaw: 'for sale',
      forSale: true,
      price: '900',
      buyNow: false,
      minOffer: '100',
      floor: null,
      discount: null,
      currency: 'EUR',
      leaseToOwn: null,
      tier: null,
      listedAt: '2020-01-01T00:00:00Z',
      updatedAt: null,
      extra: {
        market: 'sedo',
        categories: [104],
        language: 'de',
        parkingEarnings: '0.94',
        keywords: ['example'],
      },
    });
  });

  it('is Buy Now only with a fixed price and a price', () => {
    expect(listingFromSedo(listed({ fixedPrice: true }), 'a').buyNow).toBe(
      true,
    );
    expect(
      listingFromSedo(listed({ fixedPrice: true, price: null }), 'a').buyNow,
    ).toBe(false);
    expect(listingFromSedo(listed({ forSale: false }), 'a')).toMatchObject({
      status: 'active',
      forSale: false,
      statusRaw: 'not for sale',
    });
  });
});

describe('changes', () => {
  it('rejects what Sedo has no field for', () => {
    expect(() => checkSedoChange({ name: 'a.com', floor: '100' })).toThrow(
      /no floor/,
    );
    expect(() =>
      checkSedoChange({ name: 'a.com', leaseToOwn: { enabled: true } }),
    ).toThrow(/lease-to-own/);
    expect(() =>
      checkSedoChange({ name: 'a.com', currency: 'JPY' as never }),
    ).toThrow(/EUR, USD or GBP/);
    expect(() =>
      checkSedoChange({
        name: 'a.com',
        extra: { market: 'afternic', featured: true },
      }),
    ).toThrow(/afternic/);
    // Clearing a floor Sedo doesn't have is fine.
    expect(() => checkSedoChange({ name: 'a.com', floor: null })).not.toThrow();
  });

  it('merges a change into the current listing', () => {
    expect(
      mergeSedoChange({ name: 'example.com', price: '1200' }, listed()),
    ).toEqual({
      name: 'example.com',
      categories: [104],
      forSale: true,
      price: '1200',
      minPrice: '100',
      fixedPrice: false,
      currency: 'EUR',
      language: 'de',
    });
  });

  it('gives a new name a Buy Now price in USD and English by default', () => {
    expect(mergeSedoChange({ name: 'new.com', price: '2500' }, null)).toEqual({
      name: 'new.com',
      categories: [],
      forSale: true,
      price: '2500',
      minPrice: null,
      fixedPrice: true,
      currency: 'USD',
      language: 'en',
    });
    expect(
      mergeSedoChange({ name: 'new.com', minOffer: '100' }, null).fixedPrice,
    ).toBe(false);
  });

  it('refuses a Buy Now price under 199, and a minimum above the price', () => {
    expect(() =>
      mergeSedoChange({ name: 'a.com', price: '150', buyNow: true }, null),
    ).toThrow(/at least 199/);
    expect(
      mergeSedoChange({ name: 'a.com', price: '150', buyNow: false }, null)
        .fixedPrice,
    ).toBe(false);
    expect(() =>
      mergeSedoChange({ name: 'a.com', price: '500', minOffer: '600' }, null),
    ).toThrow(/above the price/);
  });
});

describe('SedoAdapter.writeListings', () => {
  it('edits listed names, inserts new ones as pending', async () => {
    const { sedo, calls } = adapter((fn, form) =>
      fn === 'DomainList'
        ? fx.listOf([
            {
              domain: 'listed.com',
              price: '900.00',
              minprice: '100.00',
              currency: 0,
              language: 'de',
            },
          ])
        : fx.resultsOf(entries(form)),
    );
    const results = await sedo.writeListings([
      { name: 'Listed.com', price: '950' },
      { name: 'new.com', price: '2500' },
      { name: 'bad.com', floor: '10' },
    ]);
    expect(calls.map((c) => c.fn)).toEqual([
      'DomainList',
      'DomainEdit',
      'DomainInsert',
    ]);
    expect(results.map((r) => [r.name, r.ok, r.pending])).toEqual([
      ['listed.com', true, false],
      ['new.com', true, true],
      ['bad.com', false, false],
    ]);
    expect(results[0].saved).toMatchObject({
      price: '950',
      minOffer: '100',
      currency: 'EUR',
      status: 'active',
    });
    expect(results[1].saved).toMatchObject({
      status: 'pending',
      price: '2500',
      buyNow: true,
      listedAt: '2026-10-28T12:00:00Z',
    });
    expect(results[2].error?.code).toBe('UNSUPPORTED');
    expect(calls[1].form.get('domainentry[0][currency]')).toBe('0');
    expect(calls[2].form.get('domainentry[0][domainlanguage]')).toBe('en');
  });

  it('reports Sedo’s per-name faults', async () => {
    const { sedo } = adapter((fn) =>
      fn === 'DomainList'
        ? fx.listOf([])
        : fx.resultsOf([
            [
              'new.com',
              ['E3122', 'Inserting this domain violates German trademark law.'],
            ],
          ]),
    );
    const [r] = await sedo.writeListings([{ name: 'new.com', price: '500' }]);
    expect(r).toMatchObject({
      ok: false,
      pending: false,
      saved: null,
      error: { code: 'E3122' },
    });
  });

  it('takes at most 50 changes a call', async () => {
    const { sedo } = adapter(() => fx.listOf([]));
    const changes = Array.from({ length: 51 }, (_, i) => ({
      name: `n${i}.com`,
    }));
    await expect(sedo.writeListings(changes)).rejects.toThrow(/At most 50/);
  });
});

describe('SedoAdapter reads', () => {
  it('treats a name Sedo doesn’t have as already delisted', async () => {
    const { sedo } = adapter(() =>
      fx.resultsOf([
        ['gone.com', ['E4101', 'The domain is not yet in our database']],
        ['locked.com', ['E5101', 'This domain is currently being transferred']],
      ]),
    );
    const results = await sedo.deleteListings(['gone.com', 'locked.com']);
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['gone.com', true],
      ['locked.com', false],
    ]);
  });

  it('maps parking stats to visitors, clicks and earnings', async () => {
    const { sedo, calls } = adapter(() =>
      fx.parkingStats.replace(
        '<earnings type="xsd:double">0<',
        '<earnings type="xsd:double">1.25<',
      ),
    );
    const [day] = await sedo.domainStats('example.com', 365);
    expect(day).toMatchObject({
      market: 'sedo',
      name: 'example.com',
      date: '2017-01-01',
      views: 0,
      clicks: 0,
      leads: null,
      earnings: '1.25',
    });
    expect(calls[0].form.get('period')).toBe('1');
  });

  it('has no traffic for a name outside Sedo’s parking', async () => {
    const { sedo } = adapter(() =>
      fx.faultOf('E2104', 'The domain name either does not belong to you'),
    );
    expect(await sedo.domainStats('elsewhere.com', 7)).toEqual([]);
  });

  it('tests the connection with CheckMember', async () => {
    const { sedo } = adapter(() => fx.checkMember);
    const result = await sedo.test();
    expect(result.listings).toBeNull();
    expect(result.notes[0]).toMatch(/no sales/);
    const bad = adapter(() => fx.checkMember.replace('>1<', '>0<'));
    await expect(bad.sedo.test()).rejects.toThrow(/doesn’t recognize/);
  });
});

describe('registry', () => {
  it('offers Sedo with its four credential fields', () => {
    expect(isMarketId('sedo')).toBe(true);
    const info = marketInfo('sedo');
    expect(info.configFields.map((f) => f.name)).toEqual([
      'partnerId',
      'signKey',
      'username',
      'password',
    ]);
    expect(info.capabilities).toBe(SEDO_CAPABILITIES);
    expect(() => buildAdapter('sedo', 'a', { partnerId: '1' })).toThrow(
      /Sign key is required/,
    );
    expect(
      buildAdapter('sedo', 'a', {
        partnerId: '1',
        signKey: 's',
        username: 'u',
        password: 'p',
      }).market,
    ).toBe('sedo');
  });
});
