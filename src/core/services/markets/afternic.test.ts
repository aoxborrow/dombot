import { describe, expect, it } from 'vitest';
import { AfternicClient } from '../../markets/afternic';
import { toListing, toSale } from '../../markets/afternic/convert';
import * as fx from '../../markets/afternic/fixtures';
import { RateLimiter, type Clock } from '../../markets/afternic/rate-limit';
import { MarketUnsupportedError } from '../../markets/types';
import {
  AfternicAdapter,
  adjustedFields,
  changeToAfternic,
  listingFromAfternic,
  saleFromAfternic,
} from './afternic';

describe('listingFromAfternic', () => {
  it('maps an Afternic listing into the shared shape', () => {
    const listing = listingFromAfternic(toListing(fx.domainFull), 'acct-1');
    expect(listing).toMatchObject({
      market: 'afternic',
      accountId: 'acct-1',
      name: 'example.com',
      displayName: 'Example.com',
      status: 'active',
      statusRaw: 'ACTIVE',
      forSale: true,
      price: '2499',
      buyNow: true,
      minOffer: '1000',
      floor: null,
      discount: null,
      currency: 'USD',
      leaseToOwn: { enabled: false, maxPayments: 12 },
      tier: null,
    });
    expect(listing.extra).toMatchObject({
      market: 'afternic',
      intakeStyle: 'PRICE_FORM',
      fastTransferStatus: 'ACTIVE',
      registrar: 'godaddy',
    });
  });

  it('reads a listing with no price as offers only, and pending', () => {
    const listing = listingFromAfternic(toListing(fx.domainBare), 'a');
    expect(listing.price).toBeNull();
    expect(listing.buyNow).toBe(false);
    expect(listing.status).toBe('pending');
    // The display name only shows when it differs from the name.
    expect(listing.displayName).toBeNull();
  });

  it('maps statuses, keeping the raw one', () => {
    const status = (listStatus: string, hidden = false) => {
      const l = listingFromAfternic(
        toListing({
          ...fx.domainBare,
          listStatus: listStatus as never,
          hidden,
        }),
        'a',
      );
      return [l.status, l.forSale];
    };
    expect(status('FAILED_COMPLIANCE')).toEqual(['rejected', true]);
    expect(status('INACTIVE')).toEqual(['inactive', true]);
    expect(status('ON_HOLD')).toEqual(['on_hold', true]);
    expect(status('SOLD')).toEqual(['sold', true]);
    expect(status('HIDDEN')).toEqual(['active', false]);
    expect(status('ACTIVE', true)).toEqual(['active', false]);
  });

  it('carries search counts through', () => {
    const listing = listingFromAfternic(toListing(fx.domainWithSearches), 'a');
    expect(listing.extra).toMatchObject({
      market: 'afternic',
      searches: { total: { days30: 120 } },
    });
  });
});

describe('saleFromAfternic', () => {
  it('maps a completed Buy Now sale and leaves the auth code out', () => {
    const sale = saleFromAfternic(toSale(fx.saleBuyNow), 'a');
    expect(sale).toEqual({
      market: 'afternic',
      accountId: 'a',
      id: fx.saleBuyNow.transactionId,
      name: 'example.com',
      soldOn: '2026-10-08',
      status: 'completed',
      statusRaw: 'COMPLETED',
      kind: 'buy_now',
      price: '499',
      commission: '149.7',
      commissionEstimated: false,
      net: '349.3',
      currency: 'USD',
      installments: null,
      paidOutOn: '2026-10-13',
      action: null,
      authCodeSent: true,
    });
    expect(JSON.stringify(sale)).not.toContain('not-a-real-code');
  });

  it('says nothing about the auth code when the read leaves it out', () => {
    expect(
      saleFromAfternic(toSale({ ...fx.saleBuyNow, authCode: undefined }), 'a')
        .authCodeSent,
    ).toBeNull();
  });

  it('maps a lease and a cancelled sale', () => {
    const lease = saleFromAfternic(toSale(fx.saleLeased), 'a');
    expect(lease.kind).toBe('lease');
    expect(lease.installments).toEqual({
      amount: '73.95',
      paid: 16,
      total: 16,
      next: null,
    });
    expect(saleFromAfternic(toSale(fx.saleCancelled), 'a').status).toBe(
      'cancelled',
    );
  });

  it('says what the seller has to do next', () => {
    const action = (status: string) =>
      saleFromAfternic(
        toSale({ ...fx.saleBuyNow, status: status as never }),
        'a',
      );
    expect(action('AWAITING_AUTH_CODE')).toMatchObject({
      status: 'in_progress',
      action: 'auth_code',
    });
    expect(action('PENDING_TRANSFER').action).toBe('transfer');
    expect(action('AWAITING_PAYEE_UPDATE').action).toBe('payee_details');
    // The name has moved: only the payout is left.
    expect(action('CONFIRMED_TRANSFER')).toMatchObject({
      status: 'in_progress',
      action: 'payout',
    });
    expect(action('SCHEDULED_PAYOUT').action).toBe('payout');
    expect(action('LEASE_FULLY_PAID').status).toBe('completed');
  });
});

describe('changeToAfternic', () => {
  it('turns shared amounts into whole dollars and forSale into hidden', () => {
    expect(
      changeToAfternic({
        name: 'example.com',
        price: '2500.00',
        minOffer: '100',
        floor: null,
        forSale: false,
        leaseToOwn: { enabled: true, maxPayments: 24 },
        extra: { market: 'afternic', intakeStyle: 'BUYNOW' },
      }),
    ).toEqual({
      name: 'example.com',
      buyNow: 2500,
      minOffer: 100,
      floor: null,
      hidden: true,
      leasingEnabled: true,
      maxLeasePeriod: 24,
      landingPage: undefined,
      intakeStyle: 'BUYNOW',
      showLanderBuynowOption: undefined,
      showLanderMakeOfferOption: undefined,
      showLanderLeaseToOwnOption: undefined,
      featured: undefined,
    });
  });

  it('rejects what Afternic cannot do, naming the field', () => {
    const reject = (change: object) => {
      try {
        changeToAfternic({ name: 'example.com', ...change });
      } catch (error) {
        expect(error).toBeInstanceOf(MarketUnsupportedError);
        return (error as MarketUnsupportedError).field;
      }
      return 'accepted';
    };
    expect(reject({ currency: 'EUR' })).toBe('currency');
    expect(reject({ minOffer: null })).toBe('minOffer');
    expect(reject({ currency: 'USD', price: '1' })).toBe('accepted');
    expect(() =>
      changeToAfternic({ name: 'example.com', price: '99.50' }),
    ).toThrow(/whole amount/);
  });
});

describe('adjustedFields', () => {
  it('lists what was saved differently', () => {
    const saved = listingFromAfternic(toListing(fx.domainFull), 'a');
    expect(
      adjustedFields(
        {
          name: 'example.com',
          price: '2499.00',
          floor: '500',
          leaseToOwn: { enabled: false, maxPayments: 36 },
        },
        saved,
      ),
    ).toEqual([
      { field: 'floor', asked: '500', saved: null },
      { field: 'leaseToOwn.maxPayments', asked: 36, saved: 12 },
    ]);
  });
});

describe('AfternicAdapter', () => {
  const clock: Clock = { now: () => 0, sleep: async () => undefined };

  function adapter(respond: (path: string, body: unknown) => unknown) {
    const calls: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname.split('/my')[1]}`);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify(respond(url.pathname, body)), {
        status: 200,
      });
    }) as typeof globalThis.fetch;
    const client = new AfternicClient({
      apiKey: 'k',
      apiSecret: 's',
      fetch,
      clock,
      limiter: new RateLimiter(clock),
    });
    return { adapter: new AfternicAdapter('acct-1', client), calls };
  }

  it('writes, reads back, and reports a lease length Afternic capped', async () => {
    const { adapter: afternic, calls } = adapter((path, body) => {
      if (path.endsWith('/upsert')) {
        const { domains } = body as { domains: { name: string }[] };
        return Object.fromEntries(domains.map((d) => [d.name, { code: 200 }]));
      }
      // The read-back: Afternic kept 12 payments, not the 36 asked for.
      return { domains: [{ ...fx.domainFull, maxLeasePeriod: 12 }] };
    });
    const [result] = await afternic.writeListings([
      {
        name: 'Example.com',
        price: '2499',
        leaseToOwn: { enabled: true, maxPayments: 36 },
      },
    ]);
    expect(calls).toEqual([
      'POST /domains/$each/upsert',
      'POST /domains/$each/get',
    ]);
    expect(result.ok).toBe(true);
    expect(result.name).toBe('example.com');
    expect(result.saved?.price).toBe('2499');
    expect(result.adjusted).toEqual([
      { field: 'leaseToOwn.enabled', asked: true, saved: false },
      { field: 'leaseToOwn.maxPayments', asked: 36, saved: 12 },
    ]);
  });

  it('reads one sale, saying whether Afternic has its auth code', async () => {
    let code: string | null = null;
    const { adapter: afternic, calls } = adapter(() => ({
      ...fx.saleBuyNow,
      status: 'AWAITING_AUTH_CODE',
      authCode: code,
    }));
    const id = fx.saleBuyNow.transactionId;
    expect(await afternic.getSale(id)).toMatchObject({
      action: 'auth_code',
      authCodeSent: false,
    });
    code = 'not-a-real-code';
    const sale = await afternic.getSale(id);
    expect(sale?.authCodeSent).toBe(true);
    expect(JSON.stringify(sale)).not.toContain('not-a-real-code');
    expect(calls).toEqual([`GET /sales/${id}`, `GET /sales/${id}`]);
  });

  it('fails an unsupported change without sending it, and sends the rest', async () => {
    const { adapter: afternic, calls } = adapter((path, body) => {
      const { domains } = body as { domains: { name: string }[] };
      return Object.fromEntries(
        domains.map((d) => [
          d.name,
          { code: 200, domain: { ...fx.domainBare, name: d.name } },
        ]),
      );
    });
    const results = await afternic.writeListings([
      { name: 'example.com', currency: 'EUR', price: '100' },
      { name: 'example.net', price: '100' },
    ]);
    expect(results.map((r) => [r.name, r.ok, r.error?.code])).toEqual([
      ['example.com', false, 'UNSUPPORTED'],
      ['example.net', true, undefined],
    ]);
    expect(results[1].pending).toBe(true);
    expect(calls).toEqual(['POST /domains/$each/upsert']);
  });

  it('counts deleting a name that was not listed as done', async () => {
    const { adapter: afternic } = adapter(() => ({
      'example.com': { code: 204 },
      'example.net': { code: 404 },
      'example.org': {
        code: 422,
        error: { code: 'VALIDATION_ERROR', message: 'on hold' },
      },
    }));
    const results = await afternic.deleteListings([
      'example.com',
      'example.net',
      'example.org',
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2].error?.message).toBe('on hold');
  });

  it('flags whether the account gets search data', async () => {
    const { adapter: afternic } = adapter(() => ({
      domains: [fx.domainFull],
      pagination: { total: 50 },
    }));
    expect(await afternic.test()).toEqual({
      listings: 50,
      notes: [],
      status: [{ label: 'Discount Domain Club Domain Pro', on: false }],
    });
  });
});
