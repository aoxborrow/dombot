import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from '../rate-limit';
import { SedoClient } from './client';
import { SedoError } from './errors';
import * as fx from './fixtures';

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
  fn: string;
  method: string;
  form: URLSearchParams;
  headers: Record<string, string>;
}

type Reply = { status?: number; body: string } | string;

function client(respond: (call: Call) => Reply) {
  const { clock, sleeps } = fakeClock();
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      fn: url.pathname.split('/').pop() ?? '',
      method: init?.method ?? 'GET',
      form: new URLSearchParams(String(init?.body ?? '')),
      headers: init?.headers as Record<string, string>,
    };
    calls.push(call);
    const reply = respond(call);
    const r = typeof reply === 'string' ? { body: reply } : reply;
    return new Response(r.body, { status: r.status ?? 200 });
  }) as typeof fetch;
  const sedo = new SedoClient({
    partnerId: '1234',
    signKey: 'sign',
    username: 'johndoe',
    password: 'secret',
    fetch: fetchImpl,
    userAgent: 'DomBot-test/1.0',
    clock,
    limiter: new RateLimiter(clock, 60),
  });
  return { sedo, calls, sleeps };
}

/** The names a DomainList call filtered on. */
const filtered = (form: URLSearchParams) =>
  [...form].filter(([k]) => k.startsWith('domain[')).map(([, v]) => v);

describe('transport', () => {
  it('POSTs a form with the credentials, never a query string', async () => {
    const { sedo, calls } = client(() => fx.checkMember);
    expect(await sedo.checkMember()).toBe(true);
    const [call] = calls;
    expect(call.method).toBe('POST');
    expect(call.fn).toBe('CheckMember');
    expect(call.headers['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(Object.fromEntries(call.form)).toEqual({
      partnerid: '1234',
      signkey: 'sign',
      username: 'johndoe',
      password: 'secret',
      output_method: 'xml',
    });
  });

  it('sends only the partner pair to public functions, nothing to lists', async () => {
    const { sedo, calls } = client((c) =>
      c.fn === 'DomainStatus' ? fx.domainStatus : fx.languages,
    );
    await sedo.domainStatus(['example.com']);
    await sedo.languages();
    expect(calls[0].form.has('password')).toBe(false);
    expect(calls[0].form.get('partnerid')).toBe('1234');
    expect(calls[1].form.has('partnerid')).toBe(false);
  });

  it('turns a fault document into a SedoError, with a hint', async () => {
    const { sedo } = client(() =>
      fx.faultOf('E6', 'Wrong password for this username'),
    );
    const error = await sedo.checkMember().catch((e) => e);
    expect(error).toBeInstanceOf(SedoError);
    expect(error.code).toBe('E6');
    expect(error.credentials).toBe(true);
    expect(error.message).toMatch(/Wrong password.*username and password/);
    expect(error.message).not.toMatch(/secret/);
  });

  it('reads a fault even when it comes with an error status', async () => {
    const { sedo } = client(() => ({
      status: 500,
      body: fx.faultOf('E12', 'You are not authorized to use this function'),
    }));
    const error = await sedo.checkMember().catch((e) => e);
    expect(error.code).toBe('E12');
  });

  it('retries E11 and E17 with backoff, then gives up', async () => {
    let n = 0;
    const { sedo, calls, sleeps } = client(() =>
      n++ < 2 ? fx.faultOf(n === 1 ? 'E11' : 'E17', 'busy') : fx.checkMember,
    );
    expect(await sedo.checkMember()).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 4000]);

    const busy = client(() => fx.faultOf('E17', 'We are busy'));
    const error = await busy.sedo.checkMember().catch((e) => e);
    expect(error.code).toBe('E17');
    expect(busy.calls).toHaveLength(4);
  });

  it('retries a busy write, but not a write whose response was lost', async () => {
    let n = 0;
    const busy = client(() =>
      n++ === 0 ? fx.faultOf('E11', 'busy') : fx.resultsOf([['example.com']]),
    );
    await busy.sedo.deleteListings(['example.com']);
    expect(busy.calls).toHaveLength(2);

    const lost = client(() => ({ status: 502, body: 'Bad gateway' }));
    const error = await lost.sedo
      .deleteListings(['example.com'])
      .catch((e) => e);
    expect(error.code).toBe('HTTP_502');
    expect(lost.calls).toHaveLength(1);
  });

  it('does not retry other faults', async () => {
    const { sedo, calls } = client(() => fx.faultOf('E5', 'no such user'));
    await expect(sedo.checkMember()).rejects.toThrow(/no such user/);
    expect(calls).toHaveLength(1);
  });

  it('refuses to start without all four credentials', () => {
    expect(
      () =>
        new SedoClient({
          partnerId: '1',
          signKey: '',
          username: 'u',
          password: 'p',
        }),
    ).toThrow(/sign key/);
  });
});

describe('listings', () => {
  it('reads the docs’ DomainList example', async () => {
    const { sedo, calls } = client(() => fx.domainList);
    const rows = await sedo.listListings();
    expect(rows[0]).toEqual({
      name: 'example.com',
      categories: [1, 2, 3],
      forSale: true,
      price: '99.99',
      minPrice: null,
      fixedPrice: true,
      currency: 'USD',
      language: 'en',
      insertedAt: null,
      earningsTotal: null,
      keywords: null,
    });
    expect(calls[0].fn).toBe('DomainList');
    expect(calls[0].form.get('results')).toBe('100');
    expect(calls[0].form.get('startfrom')).toBe('0');
  });

  it('walks every page until a short one', async () => {
    const names = Array.from({ length: 230 }, (_, i) => `name${i}.com`);
    const { sedo, calls } = client((c) => {
      const from = Number(c.form.get('startfrom'));
      return fx.listOf(
        names.slice(from, from + 100).map((domain) => ({ domain })),
      );
    });
    expect(await sedo.allListings()).toHaveLength(230);
    expect(calls.map((c) => c.form.get('startfrom'))).toEqual([
      '0',
      '100',
      '200',
    ]);
    expect(calls[0].fn).toBe('DomainListExtended');
  });

  it('reads an empty account as no listings, whether empty or E15', async () => {
    expect(await client(() => fx.listOf([])).sedo.allListings()).toEqual([]);
    expect(
      await client(() =>
        fx.faultOf('E15', 'There is no data'),
      ).sedo.allListings(),
    ).toEqual([]);
  });

  it('filters by name in batches of 100', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `n${i}.com`);
    const { sedo, calls } = client((c) =>
      fx.listOf(filtered(c.form).map((domain) => ({ domain }))),
    );
    expect(await sedo.getListings(names)).toHaveLength(150);
    expect(calls.map((c) => filtered(c.form).length)).toEqual([100, 50]);
  });

  it('reads DomainStatus, string currency and all', async () => {
    const { sedo } = client(() => fx.domainStatus);
    expect(
      (await sedo.domainStatus(['example.com', 'example.net']))[0],
    ).toEqual({
      name: 'example.com',
      onSedo: true,
      forSale: true,
      price: '500',
      currency: 'EUR',
      visitorsPerMonth: 0,
    });
  });
});

describe('parking', () => {
  it('asks for the last 31 days of one name', async () => {
    const { sedo, calls } = client(() => fx.parkingStats);
    const rows = await sedo.dailyParkingStats('example.com');
    expect(rows).toEqual([
      {
        name: 'example.com',
        date: '2017-01-01',
        visitors: 0,
        clicks: 0,
        earnings: null,
        final: false,
      },
    ]);
    expect(Object.fromEntries(calls[0].form)).toMatchObject({
      period: '1',
      domain: 'example.com',
      startfrom: '0',
      results: '0',
    });
  });

  it('reads no statistics as no rows', async () => {
    const { sedo } = client(() =>
      fx.faultOf('E2102', 'Statistics do not exist'),
    );
    expect(await sedo.dailyParkingStats()).toEqual([]);
  });

  it('reads payments under either field name', async () => {
    const { sedo, calls } = client(() =>
      fx.parkingPayments.replace('>0<', '>12.5<'),
    );
    expect(await sedo.parkingPayments('2017-01-01')).toEqual([
      { month: '2017-01-01', earnings: '12.5' },
    ]);
    expect(calls[0].form.get('date')).toBe('2017-01-01');
  });
});

describe('reference lists', () => {
  it('flattens categories with their parents', async () => {
    const { sedo } = client(() => fx.categories);
    expect(await sedo.categories()).toEqual([
      { id: 104, name: 'Consumer Goods', parentId: null },
      { id: 10, name: 'General', parentId: 104 },
      { id: 243, name: 'Electronics', parentId: 104 },
      { id: 244, name: 'General', parentId: 243 },
      { id: 248, name: 'CDs', parentId: 243 },
    ]);
  });

  it('reads languages', async () => {
    const { sedo, calls } = client(() => fx.languages);
    expect(await sedo.languages('de')).toEqual([
      { code: 'af', name: 'Afrikaans' },
      { code: 'en', name: 'English' },
    ]);
    expect(calls[0].form.get('lan')).toBe('de');
  });
});

describe('writes', () => {
  it('inserts in batches of 50 with every required field', async () => {
    const inputs = Array.from({ length: 120 }, (_, i) => ({
      name: `n${i}.com`,
      forSale: true,
      price: '500',
      minPrice: null,
      fixedPrice: true,
      currency: 'EUR' as const,
      language: 'en',
      categories: [104],
    }));
    const { sedo, calls } = client((c) => {
      const names = [...c.form]
        .filter(([k]) => /^domainentry\[\d+\]\[domain\]$/.test(k))
        .map(([, v]) => [v] as [string]);
      return fx.resultsOf(names);
    });
    const results = await sedo.insertListings(inputs);
    expect(results).toHaveLength(120);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual([
      'DomainInsert',
      'DomainInsert',
      'DomainInsert',
    ]);
    expect(Object.fromEntries(calls[0].form)).toMatchObject({
      'domainentry[0][domain]': 'n0.com',
      'domainentry[0][category][0]': '104',
      'domainentry[0][forsale]': '1',
      'domainentry[0][price]': '500',
      'domainentry[0][minprice]': '0',
      'domainentry[0][fixedprice]': '1',
      'domainentry[0][currency]': '0',
      'domainentry[0][domainlanguage]': 'en',
    });
  });

  it('fails an insert without a language before sending it', async () => {
    const { sedo, calls } = client(() => fx.resultsOf([]));
    const [r] = await sedo.insertListings([
      {
        name: 'example.com',
        forSale: true,
        price: '500',
        minPrice: null,
        fixedPrice: false,
        currency: 'USD',
      },
    ]);
    expect(r).toMatchObject({ ok: false, code: 'INVALID' });
    expect(calls).toHaveLength(0);
  });

  it('reports per-name faults from a batch', async () => {
    const { sedo } = client(() =>
      fx.resultsOf([
        ['example.com'],
        [
          'example.net',
          ['E3121', 'This domain name is already listed in your account'],
        ],
      ]),
    );
    const results = await sedo.editListings(
      ['example.com', 'example.net'].map((name) => ({
        name,
        forSale: true,
        price: '99.99',
        minPrice: null,
        fixedPrice: true,
        currency: 'USD' as const,
      })),
    );
    expect(results[1]).toEqual({
      name: 'example.net',
      ok: false,
      code: 'E3121',
      message: 'This domain name is already listed in your account',
    });
  });

  it('updates by reading, merging and writing the whole listing', async () => {
    const { sedo, calls } = client((c) =>
      c.fn === 'DomainList'
        ? fx.listOf([
            {
              domain: 'example.com',
              price: '900.00',
              minprice: '100.00',
              fixedprice: 0,
              currency: 0,
              language: 'de',
              categories: [104, 243],
            },
          ])
        : fx.resultsOf([['example.com']]),
    );
    const [r] = await sedo
      .updateListings([
        { name: 'Example.com', price: '750' },
        { name: 'missing.com', price: '1' },
      ])
      .then((rs) => {
        expect(rs[1]).toMatchObject({ ok: false, code: 'NOT_LISTED' });
        return rs;
      });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(['DomainList', 'DomainEdit']);
    expect(Object.fromEntries(calls[1].form)).toMatchObject({
      'domainentry[0][domain]': 'example.com',
      'domainentry[0][price]': '750',
      'domainentry[0][minprice]': '100',
      'domainentry[0][fixedprice]': '0',
      'domainentry[0][currency]': '0',
      'domainentry[0][domainlanguage]': 'de',
      'domainentry[0][category][1]': '243',
    });
    expect(calls[1].form.has('domainentry[1][domain]')).toBe(false);
  });

  it('refuses a price Sedo wouldn’t take', async () => {
    const { sedo } = client(() => fx.resultsOf([]));
    const [r] = await sedo.editListings([
      {
        name: 'example.com',
        forSale: true,
        price: '1,000',
        minPrice: null,
        fixedPrice: true,
        currency: 'USD',
      },
    ]);
    expect(r).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('deletes in batches of 50', async () => {
    const names = Array.from({ length: 60 }, (_, i) => `n${i}.com`);
    const { sedo, calls } = client((c) =>
      fx.resultsOf(
        [...c.form]
          .filter(([k]) => k.startsWith('domains['))
          .map(([, v]) => [v] as [string]),
      ),
    );
    expect(await sedo.deleteListings(names)).toHaveLength(60);
    expect(calls.map((c) => c.form.getAll('domains[0]'))).toEqual([
      ['n0.com'],
      ['n50.com'],
    ]);
  });
});

describe('behavior checked live', () => {
  const NOT_YOURS = fx.faultOf(
    'E2104',
    'The domain name either does not belong to you, or is not in our parking system database',
  );

  it('splits a name lookup until unlisted names drop out', async () => {
    const listed = new Set(['a.com', 'c.com', 'd.com']);
    const { sedo, calls } = client((c) => {
      const names = filtered(c.form);
      // Sedo fails the whole call if any name isn't on the account.
      return names.every((n) => listed.has(n))
        ? fx.listOf(names.map((domain) => ({ domain })))
        : NOT_YOURS;
    });
    const got = await sedo.getListings(['a.com', 'b.com', 'c.com', 'd.com']);
    expect(got.map((l) => l.name).sort()).toEqual(['a.com', 'c.com', 'd.com']);
    expect(calls.map((c) => filtered(c.form).join(','))).toEqual([
      'a.com,b.com,c.com,d.com',
      'a.com,b.com',
      'a.com',
      'b.com',
      'c.com,d.com',
    ]);
  });

  it('reads a month without payments as none', async () => {
    const { sedo } = client(() =>
      fx.faultOf(
        'E2102',
        'Statistics for this date do not exist in our database',
      ),
    );
    expect(await sedo.parkingPayments('2026-09-01')).toEqual([]);
  });
});

it('adds a hint to a per-name fault Sedo explains badly', async () => {
  const { sedo } = client(() =>
    fx.resultsOf([
      [
        'taken.com',
        [
          'E3131',
          'The domain has already been found in another account. Ownership of this domain will be verified further.',
        ],
      ],
    ]),
  );
  const [r] = await sedo.deleteListings(['taken.com']);
  expect(r.message).toMatch(/another account.*watch the account’s email/);
});

it('explains E3124 on a name Sedo is still checking', async () => {
  const { sedo } = client(() =>
    fx.resultsOf([
      [
        'new.com',
        [
          'E3124',
          "Sorry, you cannot change your domain's status from Not for Sale to For Sale, because there are either open bids on your domain or your domain is currently in transfer",
        ],
      ],
    ]),
  );
  const [r] = await sedo.deleteListings(['new.com']);
  expect(r.message).toMatch(/still checking it/);
});
