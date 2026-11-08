import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../rate-limit';
import { PAGE_SIZE, SellerHubClient } from './client';
import { SpaceshipError } from './errors';
import * as fx from './fixtures';
import { amountOf, money } from './wire';

const KEY = 'key_SECRET_123';
const SECRET = 'secret_SECRET_456';

function fakeClock() {
  let now = Date.parse('2026-11-07T12:00:00Z');
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return { clock, sleeps };
}

interface Call {
  path: string;
  method: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

type Reply =
  { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

function client(respond: (call: Call) => Reply) {
  const { clock, sleeps } = fakeClock();
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      path: url.pathname.replace(/^\/api/, ''),
      method: init?.method ?? 'GET',
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = respond(call);
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return new Response(
      reply.body === undefined ? null : JSON.stringify(reply.body),
      { status, headers: reply.headers },
    );
  }) as typeof fetch;
  const c = new SellerHubClient({
    apiKey: KEY,
    apiSecret: SECRET,
    fetch: fetchImpl,
    clock,
    limiter: new RateLimiter(clock, 1_000_000),
    userAgent: 'DomBot-test',
  });
  return { c, calls, sleeps };
}

describe('SellerHub client', () => {
  it('sends the key and secret as headers, never in the URL', async () => {
    const { c, calls } = client(() => ({
      body: fx.listingsPage([fx.listing('example.com')], 1),
    }));
    await c.listingsPage();
    expect(calls[0].headers.get('x-api-key')).toBe(KEY);
    expect(calls[0].headers.get('x-api-secret')).toBe(SECRET);
    expect(calls[0].path).toBe('/v1/sellerhub/domains');
    expect(String(calls[0].query)).not.toContain('SECRET');
    expect(calls[0].query.get('take')).toBe(String(PAGE_SIZE));
    expect(calls[0].query.get('skip')).toBe('0');
  });

  it('reads a listing: names, status, prices and their switches', async () => {
    const { c } = client(() => ({
      body: fx.listingsPage(
        [
          fx.idnListing,
          fx.listing('Example.COM', {
            binPriceEnabled: false,
            minPrice: undefined,
            minPriceEnabled: false,
            status: 'somethingNew',
          }),
        ],
        2,
      ),
    }));
    const { listings, total } = await c.listingsPage();
    expect(total).toBe(2);
    expect(listings[0]).toEqual({
      name: 'xn--spceship-9ya.com',
      unicodeName: 'spáceship.com',
      displayName: 'SpáceShip.com',
      description: 'Premium domain for sale',
      status: 'onSale',
      statusRaw: 'onSale',
      binPrice: '2500',
      binPriceEnabled: true,
      minPrice: '500',
      minPriceEnabled: true,
    });
    expect(listings[1]).toMatchObject({
      name: 'example.com',
      status: null,
      statusRaw: 'somethingNew',
      binPrice: '2500',
      binPriceEnabled: false,
      minPrice: null,
      minPriceEnabled: false,
    });
  });

  it('walks every page by skip until the total', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `n${i}.com`);
    const { c, calls } = client(({ query }) => {
      const skip = Number(query.get('skip'));
      return {
        body: fx.listingsPage(
          names.slice(skip, skip + PAGE_SIZE).map((n) => fx.listing(n)),
          names.length,
        ),
      };
    });
    const { listings, complete } = await c.allListings();
    expect(listings).toHaveLength(150);
    expect(complete).toBe(true);
    expect(calls.map((x) => x.query.get('skip'))).toEqual(['0', '100']);
  });

  it('says incomplete when the pages don’t add up to the total', async () => {
    const { c } = client(() => ({
      body: fx.listingsPage([fx.listing('a.com')], 3),
    }));
    const { complete } = await c.allListings();
    expect(complete).toBe(false);
  });

  it('answers null for a name that isn’t listed', async () => {
    const { c } = client(() => ({
      status: 404,
      body: { detail: 'The requested object was not found.' },
    }));
    expect(await c.getListing('missing.com')).toBeNull();
  });

  it('creates a listing with the Unicode name and money objects', async () => {
    const { c, calls } = client(() => ({
      status: 201,
      body: fx.listing('xn--spceship-9ya.com', { status: 'verifying' }),
    }));
    const saved = await c.createListing('xn--spceship-9ya.com', {
      binPriceEnabled: true,
      binPrice: '2500',
      minPriceEnabled: true,
      minPrice: '499.5',
    });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/v1/sellerhub/domains');
    expect(calls[0].body).toEqual({
      name: 'spáceship.com',
      binPriceEnabled: true,
      binPrice: { amount: '2500', currency: 'USD' },
      minPriceEnabled: true,
      minPrice: { amount: '499.5', currency: 'USD' },
    });
    expect(saved?.status).toBe('verifying');
  });

  it('patches only the fields given', async () => {
    const { c, calls } = client(() => ({ body: fx.listing('example.com') }));
    await c.updateListing('example.com', { binPriceEnabled: false });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].path).toBe('/v1/sellerhub/domains/example.com');
    expect(calls[0].body).toEqual({ binPriceEnabled: false });
  });

  it('deletes, taking 204 and a name that isn’t there', async () => {
    const { c, calls } = client(({ path }) =>
      path.endsWith('gone.com')
        ? { status: 404, body: { detail: 'Not found' } }
        : { status: 204 },
    );
    await c.deleteListing('example.com');
    await c.deleteListing('gone.com');
    expect(calls.map((x) => x.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('never retries a write, even on a network error', async () => {
    const { c, calls } = client(() => new TypeError('fetch failed'));
    const error = await c
      .updateListing('example.com', { binPriceEnabled: true })
      .catch((e) => e);
    expect(error).toBeInstanceOf(SpaceshipError);
    expect(error.code).toBe('NETWORK');
    expect(calls).toHaveLength(1);
  });

  it('retries a read after a server error', async () => {
    let n = 0;
    const { c, calls, sleeps } = client(() =>
      n++ === 0
        ? { status: 503, body: { detail: 'Unavailable' } }
        : { body: fx.listingsPage([], 0) },
    );
    await c.listingsPage();
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
  });

  it('says what to add when the key has no SellerHub scope', async () => {
    const { c } = client(() => ({
      status: 403,
      body: { detail: 'Forbidden' },
      headers: { 'spaceship-error-code': 'application.forbidden' },
    }));
    const error = await c.listingsPage().catch((e) => e);
    expect(error).toBeInstanceOf(SpaceshipError);
    expect(error.code).toBe('SCOPE');
    expect(error.message).toMatch(/sellerhub:read/);
    expect(error.spaceshipCode).toBe('application.forbidden');
  });

  it('shows a validation error’s field', async () => {
    const { c } = client(() => ({ status: 422, body: fx.validationError }));
    const error = await c
      .updateListing('example.com', { binPrice: '1' })
      .catch((e) => e);
    expect(error.code).toBe('INVALID');
    expect(error.message).toBe(
      'The request is invalid. binPrice.amount: Must be a positive amount',
    );
  });

  it('keeps the key out of every error', async () => {
    const { c } = client(() => ({
      status: 401,
      body: { detail: 'Unauthorized' },
    }));
    const error = await c.listingsPage().catch((e) => e);
    expect(error.code).toBe('AUTH');
    expect(String(error.message)).not.toContain(KEY);
    expect(String(error.message)).not.toContain(SECRET);
  });

  it('pauses after a 429 for as long as Retry-After says', async () => {
    let n = 0;
    const { c, sleeps } = client(() =>
      n++ === 0
        ? {
            status: 429,
            body: { detail: 'Too many requests' },
            headers: { 'retry-after': '7' },
          }
        : { body: fx.listingsPage([], 0) },
    );
    await c.listingsPage();
    expect(sleeps).toContain(7000);
  });

  it('follows the sold report’s cursor, with the time range', async () => {
    const { c, calls } = client(({ query }) =>
      query.get('cursor')
        ? { body: { items: [fx.sale('b.com', null)] } }
        : {
            body: {
              items: [fx.sale('a.com', '2026-10-02T14:30:00.000Z')],
              cursor: 'abc_123',
            },
          },
    );
    const sales = await c.soldDomains({ from: '2026-10-01T00:00:00.000Z' });
    expect(calls[0].query.get('saleDateTimeFrom')).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(calls[1].query.get('cursor')).toBe('abc_123');
    expect(sales).toEqual([
      {
        name: 'a.com',
        displayName: null,
        saleDateTime: '2026-10-02T14:30:00.000Z',
        salePrice: '1000',
        payout: '900',
        currency: 'USD',
        source: 'forSalePage',
      },
      expect.objectContaining({ name: 'b.com', saleDateTime: null }),
    ]);
  });

  it('stops on a cursor it has seen', async () => {
    const { c, calls } = client(() => ({
      body: { items: [fx.sale('a.com', null)], cursor: 'same' },
    }));
    await c.soldDomains();
    expect(calls).toHaveLength(2);
  });

  it('reads the verification options', async () => {
    const { c } = client(() => ({ body: fx.verificationRecords }));
    const options = await c.verificationRecords();
    expect(options).toHaveLength(2);
    expect(options[0].records).toEqual([
      { type: 'TXT', name: '@', value: fx.VERIFICATION_TOKEN },
    ]);
  });

  it('reads the account’s own names from the registrar list', async () => {
    const { c, calls } = client(() => ({
      body: fx.domainsPage(['held.com', 'xn--spceship-9ya.com'], 2),
    }));
    const { names, complete } = await c.accountDomainNames();
    expect(calls[0].path).toBe('/v1/domains');
    expect(names).toEqual(['held.com', 'xn--spceship-9ya.com']);
    expect(complete).toBe(true);
  });
});

describe('SellerHub money', () => {
  it('reads amounts canonically', () => {
    expect(amountOf({ amount: '2500.00', currency: 'USD' })).toBe('2500');
    expect(amountOf({ amount: '10.90', currency: 'USD' })).toBe('10.9');
    expect(amountOf({ amount: '0.00', currency: 'USD' })).toBe('0');
    expect(amountOf(undefined)).toBeNull();
  });

  it('writes at most two decimal places', () => {
    expect(money('2500')).toEqual({ amount: '2500', currency: 'USD' });
    expect(money('100.00')).toEqual({ amount: '100', currency: 'USD' });
    expect(money('10.5')).toEqual({ amount: '10.5', currency: 'USD' });
    expect(money('1.005')).toEqual({ amount: '1', currency: 'USD' });
    expect(() => money('abc')).toThrow();
  });
});
