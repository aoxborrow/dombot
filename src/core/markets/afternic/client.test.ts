import { describe, expect, it } from 'vitest';
import { AfternicClient } from './client';
import { AfternicError } from './errors';
import * as fx from './fixtures';
import { RateLimiter, type Clock } from './rate-limit';

/** Time that only moves when someone sleeps. */
function fakeClock(start = Date.parse('2026-10-27T12:00:00Z')) {
  let now = start;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (now += ms) };
}

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
  raw: unknown;
}

type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/** A fetch that records each call and answers from `respond`. */
function fakeFetch(respond: (call: Call) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers,
      body:
        init?.body && headers['content-type'] === 'application/json'
          ? JSON.parse(String(init.body))
          : undefined,
      raw: init?.body,
    };
    calls.push(call);
    const reply = await respond(call);
    const text =
      reply.body === undefined
        ? ''
        : typeof reply.body === 'string'
          ? reply.body
          : JSON.stringify(reply.body);
    return new Response(text || null, {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}

function client(respond: Parameters<typeof fakeFetch>[0]) {
  const { clock, sleeps } = fakeClock();
  const fetch = fakeFetch(respond);
  const afternic = new AfternicClient({
    apiKey: 'key',
    apiSecret: 'secret',
    userAgent: 'DomBot-test/1.0',
    fetch: fetch.impl,
    clock,
    limiter: new RateLimiter(clock),
  });
  return { afternic, calls: fetch.calls, sleeps };
}

const page = (domains: unknown[], total: number) => ({
  body: { domains, pagination: { total } },
});

describe('requests', () => {
  it('sends auth, a User-Agent and a fresh request id', async () => {
    const { afternic, calls } = client(() => ({ body: fx.settings }));
    await afternic.getAccountSettings();
    await afternic.getAccountSettings();
    const [first, second] = calls;
    expect(first.url.pathname).toBe(
      '/v3/aftermarket/customers/my/accountSettings',
    );
    expect(first.headers.authorization).toBe('sso-key key:secret');
    expect(first.headers['user-agent']).toBe('DomBot-test/1.0');
    expect(first.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers['x-request-id']).not.toBe(
      second.headers['x-request-id'],
    );
  });

  it('refuses to start without both credentials', () => {
    expect(() => new AfternicClient({ apiKey: 'k', apiSecret: '' })).toThrow(
      /key and a secret/,
    );
  });
});

describe('listings', () => {
  it('asks for every include and converts price filters to microunits', async () => {
    const { afternic, calls } = client(() => page([fx.domainFull], 1));
    const result = await afternic.listListings({
      buyNowMin: 500,
      listStatus: ['ACTIVE', 'PENDING'],
      listedFrom: new Date('2026-01-01T00:00:00.500Z'),
    });
    expect(result.total).toBe(1);
    expect(result.listings[0].buyNow).toBe(2499);
    const q = calls[0].url.searchParams;
    expect(q.get('includes')).toBe(
      'fastTransferStatus,featured,registrar,searches',
    );
    expect(q.get('buynowMin')).toBe('500000000');
    expect(q.get('listStatus')).toBe('ACTIVE,PENDING');
    expect(q.get('listedAtStartDate')).toBe('2026-01-01T00:00:00Z');
    expect(q.has('limit')).toBe(false);
  });

  it('walks every page in name order', async () => {
    const all = fx.manyDomains(1234);
    const { afternic, calls } = client((call) => {
      const offset = Number(call.url.searchParams.get('offset'));
      const limit = Number(call.url.searchParams.get('limit'));
      return page(all.slice(offset, offset + limit), all.length);
    });
    const result = await afternic.allListings();
    expect(result.listings).toHaveLength(1234);
    expect(result.changedDuringRead).toBe(false);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual([
      '0',
      '500',
      '1000',
    ]);
    expect(calls[0].url.searchParams.get('order')).toBe('NAME_ASC');
  });

  it('flags a portfolio that changed while it was being read', async () => {
    let total = 600;
    const { afternic } = client((call) => {
      const offset = Number(call.url.searchParams.get('offset'));
      const result = page(fx.manyDomains(offset ? 101 : 500, offset), total);
      total = 601;
      return result;
    });
    const result = await afternic.allListings();
    expect(result.changedDuringRead).toBe(true);
  });

  it('returns null for a name that is not listed', async () => {
    const { afternic, calls } = client(() => ({
      status: 404,
      body: { code: 'RESOURCE_NOT_FOUND', message: 'not found' },
    }));
    expect(await afternic.getListing('Example.COM')).toBeNull();
    expect(calls[0].url.pathname).toMatch(/\/domains\/example\.com$/);
  });

  it('rejects a name that is not a domain before calling', async () => {
    const { afternic, calls } = client(() => ({ body: fx.domainFull }));
    await expect(afternic.getListing('not a domain')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('fetches many names in batches of 500, deduplicated', async () => {
    const names = fx.manyDomains(1200).map((d) => d.name);
    const { afternic, calls } = client((call) => {
      const { names: batch } = call.body as { names: string[] };
      return {
        body: { domains: batch.map((name) => ({ ...fx.domainBare, name })) },
      };
    });
    const listings = await afternic.getListings([
      ...names,
      names[0].toUpperCase(),
    ]);
    expect(listings).toHaveLength(1200);
    expect(
      calls.map((c) => (c.body as { names: string[] }).names.length),
    ).toEqual([500, 500, 200]);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toMatch(/\/domains\/\$each\/get$/);
  });
});

describe('stats', () => {
  it('sends endDate as startDate, which the API counts back from', async () => {
    const { afternic, calls } = client(() => ({ body: fx.stats }));
    const stats = await afternic.getDomainStats('example.com', {
      days: 90,
      endDate: '2026-10-01',
    });
    expect(stats).toHaveLength(2);
    const q = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toMatch(/\/stats\/example\.com$/);
    expect(q.get('days')).toBe('90');
    expect(q.get('startDate')).toBe('2026-10-01T00:00:00Z');
  });

  it('defaults to 30 days ending now and checks the range', async () => {
    const { afternic, calls } = client(() => ({ body: fx.stats }));
    await afternic.getAccountStats();
    expect(calls[0].url.searchParams.get('days')).toBe('30');
    expect(calls[0].url.searchParams.has('startDate')).toBe(false);
    await expect(afternic.getAccountStats({ days: 366 })).rejects.toThrow(
      /1–365/,
    );
  });
});

describe('sales', () => {
  it('reads all of history in pages of 100, newest first', async () => {
    const sales = Array.from({ length: 230 }, (_, i) => ({
      ...fx.saleBuyNow,
      transactionId: `t${i}`,
    }));
    const { afternic, calls } = client((call) => {
      const offset = Number(call.url.searchParams.get('offset'));
      return {
        body: {
          sales: sales.slice(offset, offset + 100),
          pagination: { total: sales.length },
        },
      };
    });
    const result = await afternic.allSales();
    expect(result).toHaveLength(230);
    expect(calls).toHaveLength(3);
    const q = calls[0].url.searchParams;
    expect(q.get('limit')).toBe('100');
    expect(q.get('order')).toBe('SOLD_AT_DESC');
    expect(q.get('soldAtStartDate')).toBe('2000-01-01T00:00:00Z');
    expect(q.get('soldAtEndDate')).toBe('2026-10-27T12:00:00Z');
  });

  it('returns null for an unknown transaction', async () => {
    const { afternic } = client(() => ({ status: 404, body: '' }));
    expect(await afternic.getSale('nope')).toBeNull();
  });
});

describe('retries', () => {
  it('waits out a 429 for everyone on the key, then retries', async () => {
    let n = 0;
    const { afternic, calls, sleeps } = client(() =>
      n++ === 0
        ? {
            status: 429,
            body: { code: 'RATE_LIMIT_EXCEEDED' },
            headers: { 'retry-after': '7' },
          }
        : { body: fx.settings },
    );
    await afternic.getAccountSettings();
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(7000);
  });

  it('backs off on server errors and gives up after three retries', async () => {
    const { afternic, calls, sleeps } = client(() => ({
      status: 500,
      body: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' },
    }));
    const error = await afternic.getAccountSettings().catch((e) => e);
    expect(error).toBeInstanceOf(AfternicError);
    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(calls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('does not retry a client error', async () => {
    const { afternic, calls } = client(() => ({
      status: 400,
      body: fx.salesLimitError,
    }));
    await expect(afternic.listSales({ limit: 1000 })).rejects.toThrow(
      /at most 100/,
    );
    expect(calls).toHaveLength(1);
  });

  it('turns a network failure into a retryable error', async () => {
    const { afternic, calls } = client(() => {
      throw new TypeError('fetch failed');
    });
    const error = await afternic.getAccountSettings().catch((e) => e);
    expect(error.code).toBe('NETWORK');
    expect(error.status).toBe(0);
    expect(calls).toHaveLength(4);
    expect(error.message).not.toMatch(/secret/);
  });
});

describe('RateLimiter', () => {
  it('lets a burst of 150 through, then spaces requests out', async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < 150; i++) await limiter.take();
    expect(sleeps).toEqual([]);
    await limiter.take();
    expect(sleeps).toEqual([400]);
  });

  it('holds everyone during a pause', async () => {
    const { clock, sleeps } = fakeClock();
    const limiter = new RateLimiter(clock);
    limiter.pause(5000);
    await Promise.all([limiter.take(), limiter.take()]);
    expect(sleeps).toEqual([5000]);
  });

  it('refills over time', async () => {
    const { clock, sleeps, advance } = fakeClock();
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < 150; i++) await limiter.take();
    advance(60_000);
    for (let i = 0; i < 150; i++) await limiter.take();
    expect(sleeps).toEqual([]);
  });
});

describe('listing writes', () => {
  it('creates a listing with only the fields given', async () => {
    const { afternic, calls } = client(() => ({
      status: 201,
      body: fx.domainBare,
    }));
    const listing = await afternic.createListing({
      name: 'Example.NET',
      buyNow: 2500,
      minOffer: 100,
    });
    expect(listing.name).toBe('example.net');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({
      name: 'example.net',
      buynowPrice: 2_500_000_000,
      minbidPrice: 100_000_000,
    });
  });

  it('never retries a create', async () => {
    const { afternic, calls } = client(() => ({ status: 503, body: '' }));
    await expect(
      afternic.createListing({ name: 'example.net', buyNow: 1 }),
    ).rejects.toBeInstanceOf(AfternicError);
    expect(calls).toHaveLength(1);
  });

  it('validates before sending', async () => {
    const { afternic, calls } = client(() => ({ status: 201 }));
    await expect(
      afternic.createListing({ name: 'example.net', minOffer: 5 }),
    ).rejects.toThrow(/at least \$20/);
    expect(calls).toHaveLength(0);
  });

  it('updates, then reads the listing back after a 204', async () => {
    const { afternic, calls } = client((call) =>
      call.method === 'PATCH'
        ? { status: 204 }
        : { body: { ...fx.domainFull, floorPrice: 1_000_000_000 } },
    );
    const listing = await afternic.updateListing('example.com', {
      floor: 1000,
    });
    expect(listing.floor).toBe(1000);
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'GET']);
    expect(calls[0].url.searchParams.get('resource')).toBe('true');
    expect(calls[0].body).toEqual({ floorPrice: 1_000_000_000 });
  });

  it('retries an update, which lands the same either way', async () => {
    let n = 0;
    const { afternic, calls } = client((call) =>
      call.method === 'PATCH' && n++ === 0
        ? { status: 500, body: '' }
        : { body: fx.domainFull },
    );
    await afternic.updateListing('example.com', { hidden: false });
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH']);
  });

  it('deletes, and says false when the name was not listed', async () => {
    const { afternic } = client((call) =>
      call.url.pathname.endsWith('example.com')
        ? { status: 204 }
        : { status: 404, body: { code: 'RESOURCE_NOT_FOUND' } },
    );
    expect(await afternic.deleteListing('example.com')).toBe(true);
    expect(await afternic.deleteListing('example.net')).toBe(false);
  });

  it('upserts in batches of 500 with one result per name', async () => {
    const inputs = fx
      .manyDomains(1001)
      .map((d) => ({ name: d.name, buyNow: 499 }));
    const { afternic, calls } = client((call) => {
      const { domains } = call.body as { domains: { name: string }[] };
      return {
        body: Object.fromEntries(
          domains.map((d) => [
            d.name,
            { code: 200, domain: { ...fx.domainBare, name: d.name } },
          ]),
        ),
      };
    });
    const results = await afternic.upsertListings(inputs);
    expect(results).toHaveLength(1001);
    expect(results.every((r) => r.ok)).toBe(true);
    const sizes = calls.map(
      (c) => (c.body as { domains: unknown[] }).domains.length,
    );
    expect(sizes).toEqual([500, 500, 1]);
    expect((calls[0].body as { domains: object[] }).domains[0]).toEqual({
      name: inputs[0].name,
      buynowPrice: 499_000_000,
    });
  });

  it('keeps going when one batch fails as a whole', async () => {
    let n = 0;
    const { afternic } = client((call) => {
      const { names } = call.body as { names: string[] };
      return n++ === 0
        ? { status: 400, body: { code: 'BAD_REQUEST', message: 'nope' } }
        : {
            body: Object.fromEntries(
              names.map((name) => [name, { code: 204 }]),
            ),
          };
    });
    const names = fx.manyDomains(600).map((d) => d.name);
    const results = await afternic.deleteListings(names);
    expect(results.filter((r) => !r.ok)).toHaveLength(500);
    expect(results[0].error).toEqual({ code: 'BAD_REQUEST', message: 'nope' });
    expect(results.slice(500).every((r) => r.ok)).toBe(true);
  });

  it('relists with a mode', async () => {
    const { afternic, calls } = client(() => ({
      body: { 'example.com': { code: 200 } },
    }));
    const [result] = await afternic.relistListings(['example.com'], 'RESYNC');
    expect(result.ok).toBe(true);
    expect(calls[0].url.pathname).toMatch(/\/domains\/\$each\/relist$/);
    expect(calls[0].body).toEqual({ names: ['example.com'], mode: 'RESYNC' });
  });
});

describe('settings and sale writes', () => {
  it('sends only the settings given', async () => {
    const { afternic, calls } = client(() => ({ status: 204 }));
    await afternic.updateAccountSettings({ maxLeasePeriod: 36 });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].body).toEqual({ maxLeasePeriod: 36 });
  });

  it('sends an auth code, trimmed', async () => {
    const { afternic, calls } = client(() => ({ status: 204 }));
    await afternic.updateSale('t-1', { authCode: '  abc123 ' });
    expect(calls[0].url.pathname).toMatch(/\/sales\/t-1$/);
    expect(calls[0].body).toEqual({ authCode: 'abc123' });
    await expect(afternic.updateSale('t-1', { authCode: ' ' })).rejects.toThrow(
      /empty/,
    );
  });

  it('sends a message once, never retrying', async () => {
    const { afternic, calls } = client(() => ({ status: 500, body: '' }));
    await expect(afternic.sendSaleMessage('t-1', 'Hello')).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toMatch(/\/sales\/t-1\/sendMessage$/);
    expect(calls[0].body).toEqual({ message: 'Hello' });
  });

  it('checks message length', async () => {
    const { afternic, calls } = client(() => ({ status: 204 }));
    await expect(
      afternic.sendSaleMessage('t-1', 'x'.repeat(1001)),
    ).rejects.toThrow(/1000 characters/);
    expect(calls).toHaveLength(0);
  });
});

describe('bulk jobs', () => {
  const RESULTS_HEAD = 'operation,domain,result,errorMessage\n';

  /** A fake Afternic that runs a job over `polls` checks. */
  function jobServer(
    results: string,
    options: { polls?: number; finalState?: string; tooMany?: boolean } = {},
  ) {
    let checks = 0;
    return {
      respond: (call: Call): Reply => {
        const path = call.url.pathname;
        if (call.method === 'POST' && path.endsWith('/jobs')) {
          return options.tooMany
            ? {
                status: 400,
                body: { code: 'TOO_MANY_JOBS', message: 'Unable to create' },
              }
            : { status: 201, body: { jobId: 'job-1' } };
        }
        if (call.method === 'GET' && path.endsWith('/jobs')) {
          return {
            body: {
              jobs: [
                { jobId: 'old', type: 'BULK_JOB', jobState: 'COMPLETED' },
                { jobId: 'waiting', type: 'BULK_JOB', jobState: 'CREATED' },
              ],
            },
          };
        }
        if (path.endsWith('/upload')) return { status: 202 };
        if (path.endsWith('/results')) return { body: results };
        const done = ++checks > (options.polls ?? 1);
        return {
          body: {
            jobId: 'job-1',
            type: 'BULK_JOB',
            jobState: done ? (options.finalState ?? 'COMPLETED') : 'RUNNING',
            percentComplete: done ? 100 : 50,
          },
        };
      },
    };
  }

  it('creates, uploads, waits and maps the results to each name', async () => {
    const server = jobServer(
      RESULTS_HEAD +
        '\uFEFFUPDATE_OR_ADD,example.com,UPDATE_PROCESSED,\n' +
        'UPDATE_OR_ADD,example.net,FAILED,failed to parse buynowprice\n',
      { polls: 2 },
    );
    let body = '';
    const { afternic, calls, sleeps } = client((call) => {
      if (call.url.pathname.endsWith('/upload')) body = String(call.raw);
      return server.respond(call);
    });
    const progress: number[] = [];
    const run = await afternic.runJob(
      [
        { name: 'Example.com', buyNow: 2500 },
        { name: 'example.net', buyNow: 10 },
        { name: 'example.org', hidden: true },
      ],
      {
        description: 'reprice',
        onProgress: (job) => progress.push(job.percentComplete ?? 0),
      },
    );
    expect(run.job.state).toBe('COMPLETED');
    expect(run.results.map((r) => [r.name, r.ok, r.error?.code])).toEqual([
      ['example.com', true, undefined],
      ['example.net', false, 'FAILED'],
      ['example.org', false, 'NO_RESULT'],
    ]);
    expect(calls[0].url.searchParams.get('type')).toBe('BULK_JOB');
    expect(calls[0].body).toEqual({ description: 'reprice' });
    const upload = calls.find((c) => c.url.pathname.endsWith('/upload'));
    expect(upload?.headers['content-type']).toBe('text/csv');
    expect(body.split('\r\n')[1]).toBe('example.com,2500,,,,,,,,,');
    expect(sleeps).toEqual([2000, 2000]);
    expect(progress).toEqual([50, 50, 100]);
  });

  it('reports every name failed when the job fails', async () => {
    const server = jobServer('', { finalState: 'FAILED' });
    const { afternic } = client(server.respond);
    const run = await afternic.runJob([{ name: 'example.com', buyNow: 1 }]);
    expect(run.results[0]).toMatchObject({
      ok: false,
      error: { code: 'JOB_FAILED' },
    });
  });

  it('reuses a waiting job at the limit of three', async () => {
    const server = jobServer(
      RESULTS_HEAD + 'UPDATE_OR_ADD,example.com,NO_CHANGE,\n',
      { tooMany: true },
    );
    const { afternic, calls } = client(server.respond);
    const run = await afternic.runJob([{ name: 'example.com', buyNow: 1 }]);
    expect(run.results[0].ok).toBe(true);
    const upload = calls.find((c) => c.url.pathname.endsWith('/upload'));
    expect(upload?.url.pathname).toMatch(/\/jobs\/waiting\/upload$/);
  });

  it('never retries an upload', async () => {
    const { afternic, calls } = client(() => ({ status: 503, body: '' }));
    await expect(afternic.uploadJob('job-1', 'Domain\r\n')).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('stops waiting at the timeout and says the job is still going', async () => {
    const server = jobServer('', { polls: 1_000 });
    const { afternic } = client(server.respond);
    const error = await afternic
      .runJob([{ name: 'example.com', buyNow: 1 }], {
        pollMs: 60_000,
        timeoutMs: 120_000,
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AfternicError);
    expect(error.code).toBe('JOB_TIMEOUT');
    expect(error.message).toMatch(/job-1/);
  });

  it('closes and cancels jobs', async () => {
    const { afternic, calls } = client(() => ({ status: 204 }));
    await afternic.closeJob('job-1');
    await afternic.cancelJob('job-2');
    expect(calls.map((c) => c.body)).toEqual([
      { jobState: 'CLOSED' },
      { jobState: 'CANCELED' },
    ]);
  });
});
