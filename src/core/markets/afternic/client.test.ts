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
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
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
      'fastTransferStatus,featured,offerCount,registrar,searches',
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
