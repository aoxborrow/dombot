import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../../markets/rate-limit';
import {
  SellerHubClient,
  type SellerHubListing,
} from '../../markets/spaceship';
import * as fx from '../../markets/spaceship/fixtures';
import {
  SpaceshipAdapter,
  checkSpaceshipChange,
  inputFor,
  listingFromSellerHub,
  saleFromSellerHub,
  txtVerificationValue,
} from './spaceship';

const clock: Clock = { now: () => 0, sleep: async () => {} };

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** An adapter over a fake SellerHub: listings by name, plus the account's own names. */
function adapter(
  listings: Record<string, Record<string, unknown>>,
  options: { held?: string[]; sales?: unknown[]; failHeld?: boolean } = {},
) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const reply = (status: number, b?: unknown) =>
      new Response(b === undefined ? null : JSON.stringify(b), { status });
    if (path === '/v1/domains') {
      if (options.failHeld) return reply(500, { detail: 'Down' });
      const held = options.held ?? [];
      return reply(200, fx.domainsPage(held, held.length));
    }
    if (path === '/v1/sellerhub/domains' && method === 'GET') {
      const rows = Object.values(listings);
      return reply(200, fx.listingsPage(rows, rows.length));
    }
    if (path === '/v1/sellerhub/domains' && method === 'POST') {
      const name = (body as { name: string }).name;
      const saved = fx.listing(name, { status: 'verifying', ...body });
      listings[name] = saved;
      return reply(201, saved);
    }
    if (path === '/v1/sellerhub/domains/reports/sold') {
      return reply(200, { items: options.sales ?? [] });
    }
    if (path === '/v1/sellerhub/verification-records') {
      return reply(200, fx.verificationRecords);
    }
    const m = /^\/v1\/sellerhub\/domains\/(.+)$/.exec(path);
    if (m) {
      const name = decodeURIComponent(m[1]);
      const current = listings[name];
      if (!current) return reply(404, { detail: 'Not found' });
      if (method === 'GET') return reply(200, current);
      if (method === 'DELETE') {
        delete listings[name];
        return reply(204);
      }
      if (method === 'PATCH') {
        listings[name] = { ...current, ...(body as object) };
        return reply(200, listings[name]);
      }
    }
    return reply(500, { detail: `Unexpected ${method} ${path}` });
  }) as typeof fetch;
  const client = new SellerHubClient({
    apiKey: 'key',
    apiSecret: 'secret',
    fetch: fetchImpl,
    clock,
    limiter: new RateLimiter(clock, 1_000_000),
    userAgent: 'DomBot-test',
  });
  return { a: new SpaceshipAdapter('acct', client), calls, listings };
}

function read(over: Partial<SellerHubListing> = {}): SellerHubListing {
  return {
    name: 'example.com',
    unicodeName: 'example.com',
    displayName: null,
    description: null,
    status: 'onSale',
    statusRaw: 'onSale',
    binPrice: '2500',
    binPriceEnabled: true,
    minPrice: '500',
    minPriceEnabled: true,
    ...over,
  };
}

describe('SellerHub listings in DomBot’s model', () => {
  it('maps a live listing', () => {
    const l = listingFromSellerHub(read(), 'acct', new Set(['example.com']));
    expect(l).toMatchObject({
      market: 'spaceship',
      accountId: 'acct',
      name: 'example.com',
      status: 'active',
      forSale: true,
      price: '2500',
      buyNow: true,
      minOffer: '500',
      currency: 'USD',
      extra: { market: 'spaceship', held: 'spaceship', description: null },
    });
  });

  it('maps every status', () => {
    const status = (s: SellerHubListing['status']) =>
      listingFromSellerHub(read({ status: s }), 'acct').status;
    expect(status('verifying')).toBe('pending');
    expect(status('onSaleStopped')).toBe('inactive');
    expect(status('failed')).toBe('rejected');
    expect(status('saleProcessing')).toBe('on_hold');
    expect(status('privateSale')).toBe('on_hold');
    expect(status('leaseActive')).toBe('on_hold');
    expect(status('sold')).toBe('sold');
    expect(status(null)).toBe('unknown');
    expect(
      listingFromSellerHub(read({ status: 'verifying' }), 'acct').forSale,
    ).toBe(false);
  });

  it('leaves out a price or minimum whose switch is off', () => {
    const l = listingFromSellerHub(
      read({ binPriceEnabled: false, minPriceEnabled: false }),
      'acct',
    );
    expect(l.price).toBeNull();
    expect(l.buyNow).toBe(false);
    expect(l.minOffer).toBeNull();
  });

  it('shows the display name, or the Unicode name of an IDN', () => {
    // SellerHub sends one for every listing, the name itself unless the
    // seller set capitals (seen live).
    expect(
      listingFromSellerHub(read({ displayName: 'example.com' }), 'acct')
        .displayName,
    ).toBeNull();
    expect(
      listingFromSellerHub(read({ displayName: 'Example.com' }), 'acct')
        .displayName,
    ).toBe('Example.com');
    expect(
      listingFromSellerHub(
        read({ name: 'xn--spceship-9ya.com', unicodeName: 'spáceship.com' }),
        'acct',
      ).displayName,
    ).toBe('spáceship.com');
  });

  it('marks names held elsewhere, and unknown when the list wasn’t read', () => {
    expect(
      listingFromSellerHub(read(), 'acct', new Set(['other.com'])).extra,
    ).toMatchObject({ held: 'elsewhere' });
    expect(listingFromSellerHub(read(), 'acct', null).extra).toMatchObject({
      held: null,
    });
  });
});

describe('SellerHub sales', () => {
  it('keys a sale by name and time, with the exact commission', () => {
    const s = saleFromSellerHub(
      {
        name: 'example.com',
        displayName: null,
        saleDateTime: '2026-10-02T23:30:00.000Z',
        salePrice: '1000',
        payout: '899.99',
        currency: 'USD',
        source: 'checkoutLink',
      },
      'acct',
    );
    expect(s).toMatchObject({
      market: 'spaceship',
      id: 'example.com:2026-10-02T23:30:00.000Z',
      soldOn: '2026-10-02',
      status: 'completed',
      kind: 'buy_now',
      price: '1000',
      net: '899.99',
      commission: '100.01',
      commissionEstimated: false,
      paidOutOn: null,
    });
  });

  it('keys a sale without a time by name', () => {
    const s = saleFromSellerHub(
      {
        name: 'example.com',
        displayName: null,
        saleDateTime: null,
        salePrice: null,
        payout: null,
        currency: 'USD',
        source: null,
      },
      'acct',
    );
    expect(s.id).toBe('example.com');
    expect(s.soldOn).toBeNull();
    expect(s.commission).toBeNull();
    expect(s.kind).toBe('unknown');
  });

  it('asks the sold report from the start of a day', async () => {
    const { a, calls } = adapter(
      {},
      { sales: [fx.sale('a.com', '2026-10-02T14:30:00.000Z')] },
    );
    const sales = await a.allSales('2026-10-01');
    expect(sales).toHaveLength(1);
    expect(calls[0].path).toBe('/v1/sellerhub/domains/reports/sold');
  });
});

describe('SellerHub changes', () => {
  it('refuses what SellerHub doesn’t have', () => {
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', floor: '100' }),
    ).toThrow(/floor/);
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', currency: 'EUR' }),
    ).toThrow(/USD/);
    // SellerHub drops cents (observed), so they're refused.
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', price: '1499.99' }),
    ).toThrow(/whole-dollar/);
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', minOffer: '250.5' }),
    ).toThrow(/whole-dollar/);
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', price: '1500.00' }),
    ).not.toThrow();
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', forSale: false }),
    ).toThrow(/delist/);
    expect(() =>
      checkSpaceshipChange({
        name: 'example.com',
        leaseToOwn: { enabled: true },
      }),
    ).toThrow(/lease-to-own/);
    expect(() =>
      checkSpaceshipChange({
        name: 'example.com',
        extra: { market: 'sedo', language: 'en' },
      }),
    ).toThrow(/sedo/);
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', displayName: 'Other.com' }),
    ).toThrow(/display name/);
    expect(() =>
      checkSpaceshipChange({ name: 'example.com', displayName: 'ExAmple.com' }),
    ).not.toThrow();
  });

  it('turns Buy It Now and Make an Offer on and off by price', () => {
    expect(inputFor({ name: 'a.com', price: '900' }, read())).toEqual({
      binPriceEnabled: true,
      binPrice: '900',
    });
    expect(inputFor({ name: 'a.com', price: null }, read())).toEqual({
      binPriceEnabled: false,
    });
    expect(
      inputFor(
        {
          name: 'a.com',
          minOffer: '50',
          extra: { market: 'spaceship', description: 'Short and sweet' },
        },
        null,
      ),
    ).toEqual({
      minPriceEnabled: true,
      minPrice: '50',
      description: 'Short and sweet',
    });
  });

  it('won’t leave a listing with neither Buy It Now nor offers', () => {
    expect(() =>
      inputFor(
        { name: 'a.com', price: null },
        read({ minPriceEnabled: false }),
      ),
    ).toThrow(/Buy It Now price, a minimum offer, or both/);
    expect(() => inputFor({ name: 'a.com' }, null)).toThrow();
  });
});

describe('SellerHub adapter', () => {
  it('tests with one listing’s page and reports the total', async () => {
    const { a, calls } = adapter({ 'a.com': fx.listing('a.com') });
    expect(await a.test()).toEqual({ listings: 1, notes: [] });
    expect(calls[0].path).toBe('/v1/sellerhub/domains');
  });

  it('syncs every listing, marking the ones the account holds', async () => {
    const { a } = adapter(
      { 'a.com': fx.listing('a.com'), 'b.com': fx.listing('b.com') },
      { held: ['a.com'] },
    );
    const { listings, complete } = await a.allListings();
    expect(complete).toBe(true);
    expect(listings.map((l) => [l.name, l.extra])).toEqual([
      ['a.com', { market: 'spaceship', held: 'spaceship', description: null }],
      ['b.com', { market: 'spaceship', held: 'elsewhere', description: null }],
    ]);
  });

  it('still syncs when the account’s own names can’t be read', async () => {
    const { a } = adapter({ 'a.com': fx.listing('a.com') }, { failHeld: true });
    const { listings } = await a.allListings();
    expect(listings[0].extra).toMatchObject({ held: null });
  });

  it('creates a new listing, pending while SellerHub verifies it', async () => {
    const { a, calls } = adapter({});
    const [r] = await a.writeListings([
      { name: 'new.com', price: '2500', minOffer: '400' },
    ]);
    expect(r).toMatchObject({ ok: true, pending: true, error: null });
    expect(r.saved).toMatchObject({ status: 'pending', price: '2500' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/sellerhub/domains/new.com',
      'POST /v1/sellerhub/domains',
      'GET /v1/domains',
    ]);
  });

  it('changes a listed name with a patch', async () => {
    const { a, calls, listings } = adapter({
      'a.com': fx.listing('a.com'),
    });
    const [r] = await a.writeListings([{ name: 'a.com', price: '3000' }]);
    expect(r).toMatchObject({ ok: true, pending: false, adjusted: [] });
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      body: {
        binPriceEnabled: true,
        binPrice: { amount: '3000', currency: 'USD' },
      },
    });
    expect(listings['a.com'].binPrice).toEqual({
      amount: '3000',
      currency: 'USD',
    });
  });

  it('leaves a listing a sale holds alone', async () => {
    const { a, calls } = adapter({
      'a.com': fx.listing('a.com', { status: 'saleProcessing' }),
    });
    const [r] = await a.writeListings([{ name: 'a.com', price: '1' }]);
    expect(r.error?.code).toBe('ON_HOLD');
    const [d] = await a.deleteListings(['a.com']);
    expect(d.error?.code).toBe('ON_HOLD');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('fails a change it can’t make without sending it', async () => {
    const { a, calls } = adapter({ 'a.com': fx.listing('a.com') });
    const [r] = await a.writeListings([{ name: 'a.com', floor: '100' }]);
    expect(r.error?.code).toBe('UNSUPPORTED');
    expect(calls).toHaveLength(0);
  });

  it('delists, and counts a name that isn’t listed as delisted', async () => {
    const { a, calls, listings } = adapter({ 'a.com': fx.listing('a.com') });
    const results = await a.deleteListings(['a.com', 'gone.com']);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(listings['a.com']).toBeUndefined();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('reads the account’s TXT verification value', async () => {
    const { a } = adapter({});
    expect(await a.verificationId()).toBe(fx.VERIFICATION_TOKEN);
  });

  it('takes only a lone TXT record at the apex as the value', () => {
    expect(
      txtVerificationValue([
        {
          records: [
            { type: 'A', name: '_spaceship_verify', value: '192.0.2.1' },
          ],
        },
      ]),
    ).toBeNull();
    expect(
      txtVerificationValue([
        { records: [{ type: 'TXT', name: '@', value: 'token' }] },
      ]),
    ).toBe('token');
  });
});
