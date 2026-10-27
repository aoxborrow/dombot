import { describe, expect, it } from 'vitest';
import { toListing, toSale, toSettings, toStats } from './convert';
import { errorFromResponse } from './errors';
import * as fx from './fixtures';
import { registrarFromAfternic } from './registrars';
import { dollarsToMicro, microToDecimal, microToDollars } from './wire';

describe('money', () => {
  it('turns microunits into exact decimal strings', () => {
    expect(microToDecimal(1_479_090_000)).toBe('1479.09');
    expect(microToDecimal(499_000_000)).toBe('499');
    expect(microToDecimal(149_700_000)).toBe('149.7');
    expect(microToDecimal(1)).toBe('0.000001');
    expect(microToDecimal(0)).toBe('0');
    expect(microToDecimal(-5_500_000)).toBe('-5.5');
  });

  it('keeps listing prices to whole dollars both ways', () => {
    expect(microToDollars(2_500_000_000)).toBe(2500);
    expect(() => microToDollars(2_500_500_000)).toThrow(/whole-dollar/);
    expect(dollarsToMicro(2500)).toBe(2_500_000_000);
    expect(() => dollarsToMicro(2500.5)).toThrow(/whole dollars/);
    expect(() => dollarsToMicro(-1)).toThrow(/whole dollars/);
  });
});

describe('toListing', () => {
  it('converts prices and keeps the includes', () => {
    expect(toListing(fx.domainFull)).toEqual({
      name: 'example.com',
      displayName: 'Example.com',
      buyNow: 2499,
      minOffer: 1000,
      floor: null,
      leasingEnabled: false,
      maxLeasePeriod: 12,
      landingPage: 'SALES_TYPE',
      intakeStyle: 'PRICE_FORM',
      showLanderBuynowOption: true,
      showLanderMakeOfferOption: false,
      showLanderLeaseToOwnOption: true,
      featured: false,
      hidden: false,
      listStatus: 'ACTIVE',
      createdAt: '2023-04-12T06:53:36Z',
      updatedAt: '2026-04-10T00:30:29Z',
      registrarRaw: 'GODADDY',
      registrar: 'godaddy',
      fastTransferStatus: 'ACTIVE',
      offerCount: null,
      searches: null,
    });
  });

  it('reads a zero Buy Now price as unset and missing includes as null', () => {
    const listing = toListing(fx.domainBare);
    expect(listing.buyNow).toBeNull();
    expect(listing.minOffer).toBe(100);
    expect(listing.featured).toBeNull();
    expect(listing.registrar).toBeNull();
    expect(listing.fastTransferStatus).toBeNull();
  });

  it('reads search counts and offer counts when sent', () => {
    const listing = toListing(fx.domainWithSearches);
    expect(listing.offerCount).toBe(3);
    expect(listing.registrar).toBe('dynadot');
    expect(listing.searches).toEqual({
      total: { days30: 120, days90: 300, days365: 1100 },
      unique: { days30: 40, days90: 95, days365: 410 },
    });
  });

  it('falls back to the name when displayName is blank', () => {
    expect(toListing({ ...fx.domainBare, displayName: '' }).displayName).toBe(
      'example.net',
    );
  });
});

describe('toSale', () => {
  it('converts a Buy Now sale and works out the net', () => {
    const sale = toSale(fx.saleBuyNow);
    expect(sale).toMatchObject({
      name: 'example.com',
      saleType: 'BUYNOW',
      status: 'COMPLETED',
      salePrice: '499',
      saleTotal: '499',
      commission: '149.7',
      net: '349.3',
      disbursedAt: '2026-10-13T07:00:00.000Z',
      lease: null,
    });
  });

  it('keeps a lease total to the cent and reads its installments', () => {
    const sale = toSale(fx.saleLeased);
    expect(sale.salePrice).toBe('1479.09');
    expect(sale.net).toBe('1109.32');
    expect(sale.saleTotal).toBeNull();
    expect(sale.lease).toEqual({
      installmentAmount: '73.95',
      totalInstallments: 16,
      totalInstallmentsPaid: 16,
      prevInstallmentDate: '2026-03-23',
      nextInstallmentDate: null,
    });
  });
});

describe('toStats and toSettings', () => {
  it('trims stats dates to the day', () => {
    expect(toStats(fx.stats)).toEqual([
      { date: '2026-08-02', views: 3, leads: 0 },
      { date: '2026-08-03', views: 5, leads: 1 },
    ]);
    expect(toStats({})).toEqual([]);
  });

  it('passes settings through', () => {
    expect(toSettings(fx.settings).maxLeasePeriod).toBe(60);
    expect(toSettings({}).selfBrokerEnabled).toBeNull();
  });
});

describe('registrarFromAfternic', () => {
  it.each([
    ['GODADDY', 'godaddy'],
    ['GoDaddy.com, LLC', 'godaddy'],
    ['Dynadot Inc', 'dynadot'],
    ['Dynadot, LLC', 'dynadot'],
    ['NameCheap, Inc.', 'namecheap'],
    ['Spaceship, Inc.', 'spaceship'],
    ['Name.com, Inc.', 'namecom'],
    ['101domain GRS Limited', '101domain'],
  ])('%s → %s', (raw, name) => {
    expect(registrarFromAfternic(raw)).toBe(name);
  });

  it.each(['UNKNOWN', 'Unknown .DE registrar', 'Sav.com, LLC', '', null])(
    '%s → null',
    (raw) => {
      expect(registrarFromAfternic(raw)).toBeNull();
    },
  );
});

describe('errorFromResponse', () => {
  it('reads code, message and field errors', () => {
    const error = errorFromResponse(
      400,
      JSON.stringify(fx.salesLimitError),
      'req-1',
      null,
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe(
      'Invalid Query Parameters — limit: limit must be at most 100',
    );
    expect(error.requestId).toBe('req-1');
    expect(error.retryable).toBe(false);
  });

  it('handles a plain-text body and Retry-After', () => {
    const error = errorFromResponse(429, '', 'req-2', '12');
    expect(error.code).toBe('HTTP_429');
    expect(error.message).toBe('HTTP 429');
    expect(error.retryAfter).toBe(12);
    expect(error.retryable).toBe(true);
    expect(
      errorFromResponse(404, '404 page not found', 'r', null).message,
    ).toBe('404 page not found');
  });
});
