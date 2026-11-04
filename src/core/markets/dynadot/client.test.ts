import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../rate-limit';
import { DynadotClient } from './client';
import { DynadotError } from './errors';
import * as fx from './fixtures';
import { amount, listingTypeOf } from './wire';

const KEY = 'key_SECRET_123';
const SECRET = 'secret_SECRET_456';

/** The signature worked out independently, as Dynadot's docs describe it. */
async function expectedSignature(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function fakeClock() {
  let now = Date.parse('2026-11-04T12:00:00Z');
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
  pathAndQuery: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
}

type Reply = { status?: number; body: unknown } | Error;

function client(respond: (call: Call) => Reply) {
  const { clock, sleeps } = fakeClock();
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      pathAndQuery: url.pathname + url.search,
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const reply = respond(call);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const dynadot = new DynadotClient({
    apiKey: KEY,
    apiSecret: SECRET,
    fetch: fetchImpl,
    userAgent: 'DomBot-test/1.0',
    clock,
    limiter: new RateLimiter(clock, 60),
  });
  return { dynadot, calls, sleeps };
}

async function caught(p: Promise<unknown>): Promise<DynadotError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof DynadotError) return error;
    throw error;
  }
  throw new Error('expected a DynadotError');
}

describe('transport', () => {
  it('signs each request as registrar-client does, with the key as a bearer token', async () => {
    const { dynadot, calls } = client(() => ({ body: fx.accountInfo }));
    await dynadot.accountInfo();
    const call = calls[0];
    expect(call.pathAndQuery).toBe('/restful/v2/accounts/info');
    expect(call.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(call.headers.get('x-signature')).toBe(
      await expectedSignature(`${KEY}\n/restful/v2/accounts/info\n\n`),
    );
    // The secret only signs; it never travels.
    expect(JSON.stringify([...call.headers])).not.toContain(SECRET);
  });

  it('reads the price level', async () => {
    const { dynadot } = client(() => ({ body: fx.accountInfo }));
    expect(await dynadot.accountInfo()).toEqual({
      username: 'example',
      priceLevel: 'Bulk Account',
    });
  });

  it('turns a refused call into an error with Dynadot’s reason', async () => {
    const { dynadot } = client(() => ({
      status: 401,
      body: {
        code: 401,
        message: 'Unauthorized',
        error: { description: 'The provided API key is invalid.' },
      },
    }));
    const error = await caught(dynadot.accountInfo());
    expect(error.code).toBe('AUTH');
    expect(error.message).toBe('The provided API key is invalid.');
  });

  it('waits out a 429 before trying a read again', async () => {
    let n = 0;
    const { dynadot, sleeps } = client(() =>
      n++ === 0
        ? {
            status: 429,
            body: { code: 429, message: 'Too Many Requests', error: {} },
          }
        : { body: fx.accountInfo },
    );
    await dynadot.accountInfo();
    expect(n).toBe(2);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });
});

describe('names in the account', () => {
  it('pages the domain list and says which names are for sale', async () => {
    const { dynadot, calls } = client((c) => {
      const page = Number(c.query.get('page'));
      return {
        body:
          page === 1
            ? fx.domainsPage(
                [
                  { name: 'lumenpost.com', forSale: true },
                  { name: 'quietfern.net', forSale: false },
                ],
                1,
                2,
                3,
              )
            : fx.domainsPage(
                [{ name: 'brightloom.com', forSale: true }],
                2,
                2,
                3,
              ),
      };
    });
    const read = await dynadot.accountDomains();
    expect(read.complete).toBe(true);
    expect(read.domains).toEqual([
      { name: 'lumenpost.com', forSale: true },
      { name: 'quietfern.net', forSale: false },
      { name: 'brightloom.com', forSale: true },
    ]);
    expect(calls[0].query.get('page_size')).toBe('200');
  });

  it('reads one listing, always asking for a currency', async () => {
    const { dynadot, calls } = client((c) =>
      c.query.get('currency')
        ? { body: fx.listingItem('lumenpost.com', 'BIN_MAKE_OFFER', '7999.00') }
        : { status: 400, body: fx.missingCurrency },
    );
    const listing = await dynadot.getListing('LumenPost.com');
    expect(calls[0].path).toBe(
      '/restful/v2/aftermarket/listings/lumenpost.com',
    );
    expect(calls[0].query.get('currency')).toBe('usd');
    expect(listing).toEqual({
      listingId: '21185431',
      name: 'lumenpost.com',
      price: '7999',
      type: 'bin_make_offer',
      typeRaw: 'BIN_MAKE_OFFER',
      pendingSale: false,
    });
  });

  it('answers null for a name with no listing', async () => {
    const { dynadot } = client(() => ({
      status: 404,
      body: fx.notFound('quietfern.net'),
    }));
    expect(await dynadot.getListing('quietfern.net')).toBeNull();
  });
});

describe('names held elsewhere', () => {
  it('reads the other-registrar list', async () => {
    const { dynadot } = client(() => ({ body: fx.otherRegistrarList }));
    const read = await dynadot.externalDomains();
    expect(read.complete).toBe(true);
    expect(read.domains).toEqual([
      {
        name: 'domanio.com',
        registrar: '101domain',
        status: 'Registered',
        verified: false,
        verifyStatusRaw: 'Unverified',
        listingType: null,
        listingTypeRaw: 'Not Set',
        price: null,
        transferStatus: null,
        updatedAt: '2026-11-03T17:53:25Z',
      },
      {
        name: 'lumenpost.io',
        registrar: null,
        status: 'Unregistered',
        verified: true,
        verifyStatusRaw: 'Verified',
        listingType: 'bin_make_offer',
        listingTypeRaw: 'Buy Now + Make Offer',
        price: '1500',
        transferStatus: null,
        updatedAt: '2026-10-09T21:04:44Z',
      },
    ]);
  });

  it('reads the account’s key and what it builds', async () => {
    const { dynadot, calls } = client(() => ({ body: fx.verification }));
    const v = await dynadot.verification('domanio.com');
    expect(calls[0].path).toBe(
      '/restful/v2/aftermarket/other_registrar/domanio.com/verification',
    );
    // Never asks for a new key.
    expect(calls[0].query.has('new_key')).toBe(false);
    expect(v).toEqual({
      name: 'domanio.com',
      verified: false,
      key: fx.KEY,
      txt: fx.KEY,
      nameservers: [
        'ns1.dyna-ns.net',
        'ns2.dyna-ns.net',
        `ns3-${fx.KEY}.dyna-ns.org`,
      ],
      cname: `ns1-${fx.KEY}.dyna-ns.net`,
    });
  });
});

describe('wire', () => {
  it('reads both spellings of a listing type', () => {
    expect(listingTypeOf('BIN')).toBe('bin');
    expect(listingTypeOf('MAKE_OFFER')).toBe('make_offer');
    expect(listingTypeOf('BIN_MAKE_OFFER')).toBe('bin_make_offer');
    expect(listingTypeOf('Buy Now')).toBe('bin');
    expect(listingTypeOf('Make Offer')).toBe('make_offer');
    expect(listingTypeOf('Buy Now + Make Offer')).toBe('bin_make_offer');
    expect(listingTypeOf('Not Set')).toBeNull();
  });

  it('keeps amounts canonical', () => {
    expect(amount('7999.00')).toBe('7999');
    expect(amount('7137.11')).toBe('7137.11');
    expect(amount('1,500.50')).toBe('1500.5');
    expect(amount('')).toBeNull();
    expect(amount('0.00')).toBeNull();
  });
});
