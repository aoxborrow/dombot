import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../rate-limit';
import { AtomClient } from './client';
import { AtomError, redact } from './errors';
import * as fx from './fixtures';
import { failureOf, isoDate } from './wire';

const TOKEN = 'tok_SECRET_123';
const USER = '4242';

function fakeClock() {
  let now = Date.parse('2026-10-28T12:00:00Z');
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
}

type Reply =
  { status?: number; body: unknown; headers?: Record<string, string> } | Error;

function client(respond: (call: Call) => Reply) {
  const { clock, sleeps } = fakeClock();
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      path: url.pathname.replace('/api/marketplace', ''),
      method: init?.method ?? 'GET',
      query: url.searchParams,
    };
    calls.push(call);
    const reply = respond(call);
    if (reply instanceof Error) throw reply;
    // Atom's errors come as text/html with HTTP 200, as observed.
    return new Response(
      typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      {
        status: reply.status ?? 200,
        headers: { 'content-type': 'text/html', ...reply.headers },
      },
    );
  }) as typeof fetch;
  const atom = new AtomClient({
    apiToken: TOKEN,
    userId: USER,
    fetch: fetchImpl,
    userAgent: 'DomBot-test/1.0',
    clock,
    limiter: new RateLimiter(clock, 60),
  });
  return { atom, calls, sleeps };
}

async function caught(p: Promise<unknown>): Promise<AtomError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof AtomError) return error;
    throw error;
  }
  throw new Error('expected an AtomError');
}

describe('transport', () => {
  it('sends the token and user id as query parameters', async () => {
    const { atom, calls } = client(() => ({ body: fx.details }));
    await atom.getListing('brightloom.com');
    expect(calls[0].path).toBe('/domain-details');
    expect(calls[0].query.get('api_token')).toBe(TOKEN);
    expect(calls[0].query.get('user_id')).toBe(USER);
    expect(calls[0].query.get('domain_name')).toBe('brightloom.com');
  });

  it('reads a failure out of an HTTP 200 body', async () => {
    const { atom } = client(() => ({ body: fx.invalidToken }));
    const error = await caught(atom.listListings());
    expect(error.code).toBe('AUTH');
    expect(error.status).toBe(200);
    expect(error.message).toBe(fx.invalidToken.message);
  });

  it('never puts the token in an error', async () => {
    const { atom } = client(
      () => new TypeError(`fetch failed for ?api_token=${TOKEN}`),
    );
    const error = await caught(atom.listListings());
    expect(error.code).toBe('NETWORK');
    expect(error.message).not.toContain(TOKEN);
    expect(redact(`x?api_token=${TOKEN}&user_id=${USER}`)).toBe(
      'x?api_token=<redacted>&user_id=<redacted>',
    );
  });

  it('retries a read after a 5xx or network failure', async () => {
    let n = 0;
    const { atom, calls, sleeps } = client(() =>
      ++n === 1 ? { status: 502, body: '' } : { body: fx.details },
    );
    expect((await atom.getListing('brightloom.com'))?.name).toBe(
      'brightloom.com',
    );
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
  });

  it('never retries a write, even after a network failure', async () => {
    const { atom, calls } = client(() => new TypeError('socket hang up'));
    const error = await caught(atom.updatePrice('brightloom.com', 3000));
    expect(error.code).toBe('NETWORK');
    expect(calls).toHaveLength(1);
  });

  it('pauses on 429 and reports a daily limit with its numbers', async () => {
    const { atom } = client(() => ({
      status: 429,
      body: fx.dailyLimit,
      headers: { 'retry-after': '5' },
    }));
    const error = await caught(atom.getAppraisal('brightloom.com'));
    expect(error.code).toBe('DAILY_LIMIT');
    expect(error.dailyLimit).toBe(10);
    expect(error.usedToday).toBe(10);
    expect(error.retryable).toBe(false);
  });

  it('rejects a body that is not JSON', async () => {
    const { atom } = client(() => ({ body: '<html>maintenance</html>' }));
    expect((await caught(atom.listCategories())).code).toBe('BAD_RESPONSE');
  });
});

describe('failureOf', () => {
  it('tells failure messages from success messages', () => {
    expect(failureOf(fx.missingToken)?.code).toBe('AUTH');
    expect(
      failureOf({ success: false, message: 'Domain not found' })?.code,
    ).toBe('NOT_FOUND');
    expect(failureOf(fx.ok)).toBeNull();
    expect(
      failureOf({ message: 'Price is outside the range for your tier' })?.code,
    ).toBe('REJECTED');
    // A record with a status field is data, not a failure.
    expect(
      failureOf(fx.listingRecord('a.com', { status: 'Pending' })),
    ).toBeNull();
  });
});

describe('dates', () => {
  it('reads Atom’s dates as UTC', () => {
    expect(isoDate('May 02, 2026 17:45:10')).toBe('2026-05-02T17:45:10Z');
    expect(isoDate('Sep 8, 2025')).toBe('2025-09-08T00:00:00Z');
    expect(isoDate('2026-03-14 09:30:00')).toBe('2026-03-14T09:30:00Z');
    expect(isoDate('2026-08-19T10:00:00+02:00')).toBe(
      '2026-08-19T08:00:00.000Z',
    );
    expect(isoDate('soon')).toBeNull();
  });
});

describe('listings', () => {
  it('reads a listing record', async () => {
    const { atom } = client(() => ({ body: fx.details }));
    expect(await atom.getListing('brightloom.com')).toEqual({
      name: 'brightloom.com',
      displayName: 'BrightLoom.com',
      id: '100002',
      type: 'standard',
      typeRaw: 'Standard',
      status: 'Seller Approved',
      price: 2400,
      discount: null,
      primaryCategory: 'Technology',
      description:
        'BrightLoom.com is a bright, memorable name for a fast-growing brand.',
      listedAt: null,
    });
  });

  it('reads a $0 price as Make an Offer, and the full price over a partner price', async () => {
    const { atom } = client(({ path }) => ({
      body: path === '/domains' ? [fx.makeOffer] : [fx.syndicated],
    }));
    expect((await atom.listListings()).items[0]).toMatchObject({
      price: null,
      primaryCategory: null,
      description: null,
    });
    const { items } = await atom.listSyndicationAuthorized();
    expect(items).toEqual(['quillnest.io']);
    const { atom: details } = client(() => ({ body: fx.syndicated }));
    expect((await details.getListing('quillnest.io'))?.price).toBe(4200);
  });

  it('reads Atom’s "Wrong Domain name" as not listed', async () => {
    const { atom } = client(() => ({ body: fx.notListed }));
    expect(await atom.getListing('nope.com')).toBeNull();
  });

  it('walks every page in one pass, without a tier filter', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `n${i}.com`);
    const { atom, calls } = client(({ query }) => {
      const page = Number(query.get('page'));
      return {
        body: fx.listingsPage(
          page === 1 ? names.slice(0, 100) : page === 2 ? names.slice(100) : [],
        ),
      };
    });
    const { listings, complete } = await atom.allListings();
    expect(complete).toBe(true);
    expect(listings).toHaveLength(150);
    expect(listings[0].type).toBe('premium');
    expect(
      calls.map((c) => [c.query.get('type'), c.query.get('page')]),
    ).toEqual([
      [null, '1'],
      [null, '2'],
    ]);
  });

  it('stops and says so when Atom ignores the page number', async () => {
    const names = Array.from({ length: 100 }, (_, i) => `n${i}.com`);
    const { atom } = client(() => ({ body: fx.listingsPage(names) }));
    const { listings, complete } = await atom.allListings();
    expect(complete).toBe(false);
    expect(listings).toHaveLength(100);
  });
});

describe('writes', () => {
  it('sends each write once with its parameters', async () => {
    const { atom, calls } = client(() => ({ body: fx.ok }));
    expect(await atom.createListing('brightloom.com', { price: 2500 })).toEqual(
      {
        message: fx.ok.message,
      },
    );
    await atom.updatePrice('brightloom.com', 3000);
    await atom.setDiscount('brightloom.com', 200);
    await atom.setPrimaryCategory('brightloom.com', 'Technology');
    await atom.setDescription('brightloom.com', 'A bright name');
    await atom.verifyDns('brightloom.com');
    await atom.deleteListing('brightloom.com');
    expect(
      calls.map((c) => [
        c.method,
        c.path,
        Object.fromEntries(
          [...c.query].filter(([k]) => k !== 'api_token' && k !== 'user_id'),
        ),
      ]),
    ).toEqual([
      [
        'GET',
        '/add-domain',
        {
          domain_name: 'brightloom.com',
          domain_type: 'standard',
          price: '2500',
        },
      ],
      [
        'GET',
        '/update-selling-price',
        { domain_name: 'brightloom.com', selling_price: '3000' },
      ],
      [
        'GET',
        '/add-discount',
        { domain_name: 'brightloom.com', discount: '200' },
      ],
      [
        'GET',
        '/assign-primary-category',
        { domain_name: 'brightloom.com', category_name: 'Technology' },
      ],
      [
        'POST',
        '/update-description',
        { domain_name: 'brightloom.com', domain_description: 'A bright name' },
      ],
      ['GET', '/verify-dns', { domain_name: 'brightloom.com' }],
      ['GET', '/remove-domain', { domain_name: 'brightloom.com' }],
    ]);
  });

  it('refuses Premium listings and non-whole prices before sending', async () => {
    const { atom, calls } = client(() => ({ body: fx.ok }));
    await expect(
      atom.createListing('brightloom.com', {
        price: 2500,
        type: 'premium' as never,
      }),
    ).rejects.toThrow(/Premium/);
    await expect(atom.updatePrice('brightloom.com', 99.5)).rejects.toThrow(
      /whole/,
    );
    expect(calls).toHaveLength(0);
  });

  it('reads Atom’s 12-hour DNS check limit as try-later', async () => {
    const { atom } = client(() => ({
      body: {
        success: false,
        message: 'DNS check Request in progress, please try again after 12 hrs',
      },
    }));
    const error = await caught(atom.verifyDns('brightloom.com'));
    expect(error.code).toBe('TRY_LATER');
    expect(error.retryable).toBe(false);
  });

  it('reads verify-dns’s success answer as success', async () => {
    const { atom } = client(() => ({
      body: { success: true, message: 'DNS check request accepted' },
    }));
    expect(await atom.verifyDns('brightloom.com')).toEqual({
      message: 'DNS check request accepted',
    });
  });

  it('turns a write refusal into an AtomError', async () => {
    const { atom } = client(() => ({
      body: { message: 'This method only supports Standard listings' },
    }));
    const error = await caught(atom.deleteListing('quillnest.com'));
    expect(error.code).toBe('REJECTED');
  });

  it('uploads grading in batches of 100', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `g${i}.com`);
    const { atom, calls } = client(() => ({
      body: { message: 'Domains uploaded' },
    }));
    await atom.submitForGrading(names);
    expect(calls).toHaveLength(2);
    expect(calls[0].query.get('domains_data')?.split(',')).toHaveLength(100);
    expect(calls[1].method).toBe('POST');
  });
});

describe('sales, analytics and the rest', () => {
  it('reads sales', async () => {
    const { atom } = client(() => ({ body: fx.sales }));
    const [recent, older] = await atom.allSales();
    expect(recent).toEqual({
      id: 'quillnest.io:2026-05-02',
      name: 'quillnest.io',
      type: 'premium',
      soldOn: '2026-05-02',
      terms: 'Outright',
      transferStatus: 'AuthCode Sent',
      price: 4200,
      commission: null,
      // Atom sends 0 when it doesn't say.
      net: null,
      paidOutOn: null,
      listedOn: '2020-12-03',
      installments: null,
    });
    expect(older).toMatchObject({ soldOn: '2025-09-08', transferStatus: null });
  });

  it('reads analytics', async () => {
    const { atom } = client(() => ({ body: fx.analytics }));
    expect(await atom.getAnalytics('brightloom.com')).toEqual({
      name: 'brightloom.com',
      views: 412,
      shortlists: 37,
      offers: 2,
    });
  });

  it('reads categories, grading and appraisal', async () => {
    const replies: Record<string, unknown> = {
      '/categories': fx.categories,
      '/primary-categories': fx.primaryCategories,
      '/get-grade-domain-result': fx.grading,
      '/domain-appraisal': fx.appraisal,
    };
    const { atom } = client(({ path }) => ({ body: replies[path] }));
    expect(await atom.listCategories()).toEqual([
      { id: '9', name: 'Fitness & Gym' },
      { id: '56', name: 'Music & Audio' },
    ]);
    // A message beside the list is data, not a failure.
    expect(await atom.listPrimaryCategories()).toEqual([
      { id: null, name: 'Technology' },
      { id: null, name: 'Health & Wellness' },
    ]);
    expect((await atom.getGradingResults()).items).toEqual([
      {
        name: 'brightloom.com',
        brandFit: true,
        premiumFit: false,
        status: 'Graded',
        submittedOn: '2026-10-01',
      },
    ]);
    expect(await atom.getAppraisal('brightloom.com')).toMatchObject({
      estimate: 3400,
      score: 6.2,
      positiveSignals: ['Registered in 12 TLDs', 'Aged Domain (6 Years)'],
      rootWords: ['bright', 'loom'],
      registeredOn: '2020-07-05',
      listed: true,
      binPrice: 2400,
      usedToday: 1,
      dailyLimit: 10,
    });
  });

  it('reads an empty grading list', async () => {
    const { atom } = client(() => ({ body: fx.noGrading }));
    expect((await atom.getGradingResults()).items).toEqual([]);
  });
});
