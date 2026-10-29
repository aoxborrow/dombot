import { describe, expect, it } from 'vitest';
import { AfternicClient } from './client';
import { AfternicError } from './errors';

// Read-only checks against the real API (`npm run test:live`). Needs
// AFTERNIC_API_KEY and AFTERNIC_API_SECRET; skips without them. The account
// must have at least one listing and one sale. TEST_NAME is the listing the
// write tests use (docs/afternic-api.md, "Testing").

const apiKey = process.env.AFTERNIC_API_KEY;
const apiSecret = process.env.AFTERNIC_API_SECRET;
const TEST_NAME = process.env.AFTERNIC_TEST_DOMAIN ?? 'domanio.com';

describe.skipIf(!apiKey || !apiSecret)('Afternic (live, read-only)', () => {
  const afternic = new AfternicClient({
    apiKey: apiKey ?? '',
    apiSecret: apiSecret ?? '',
    userAgent: 'DomBot-live-tests/1.0',
  });

  it('lists every listing with whole-dollar prices', async () => {
    const { listings, changedDuringRead } = await afternic.allListings();
    expect(listings.length).toBeGreaterThan(0);
    expect(changedDuringRead).toBe(false);
    expect(new Set(listings.map((l) => l.name)).size).toBe(listings.length);
    for (const l of listings) {
      expect(l.name).toBe(l.name.toLowerCase());
      if (l.buyNow != null) expect(Number.isInteger(l.buyNow)).toBe(true);
    }
    // The includes come back on at least some listings.
    expect(listings.some((l) => l.fastTransferStatus)).toBe(true);
    expect(listings.some((l) => l.registrarRaw)).toBe(true);
  });

  it('pages a listing query the same as one big read', async () => {
    const first = await afternic.listListings({ limit: 2, order: 'NAME_ASC' });
    const second = await afternic.listListings({
      limit: 2,
      offset: 2,
      order: 'NAME_ASC',
    });
    expect(first.listings).toHaveLength(2);
    expect(first.total).toBe(second.total);
    expect(first.listings[1].name < second.listings[0].name).toBe(true);
  });

  it('gets the test listing alone and in a batch', async () => {
    const one = await afternic.getListing(TEST_NAME);
    expect(one?.name).toBe(TEST_NAME);
    const many = await afternic.getListings([
      TEST_NAME,
      'dombot-not-listed-0000.com',
    ]);
    expect(many.map((l) => l.name)).toEqual([TEST_NAME]);
    expect(await afternic.getListing('dombot-not-listed-0000.com')).toBeNull();
  });

  it('reads a year of account stats ending today', async () => {
    const stats = await afternic.getAccountStats({ days: 365 });
    expect(stats).toHaveLength(365);
    const today = new Date().toISOString().slice(0, 10);
    // The window ends on the day asked for, which is why `endDate` exists.
    expect(stats.at(-1)?.date).toBe(today);
  });

  it('reads stats for one listing', async () => {
    const stats = await afternic.getDomainStats(TEST_NAME, { days: 7 });
    expect(stats.length).toBeGreaterThan(0);
    expect(stats.length).toBeLessThanOrEqual(7);
  });

  it('reads all sales, with amounts as decimals', async () => {
    const sales = await afternic.allSales();
    expect(sales.length).toBeGreaterThan(0);
    for (const s of sales) {
      expect(s.transactionId).toBeTruthy();
      if (s.salePrice) expect(s.salePrice).toMatch(/^\d+(\.\d+)?$/);
    }
    const sale = await afternic.getSale(sales[0].transactionId);
    expect(sale?.name).toBe(sales[0].name);
  });

  it('reads account settings', async () => {
    const settings = await afternic.getAccountSettings();
    expect(settings.landingPage).toMatch(/^(SALES|PARKING)_TYPE$/);
  });

  // Where the API disagrees with its docs. If one of these starts failing,
  // Afternic changed it: update the client and docs/afternic-api.md.
  it('still caps sales pages at 100', async () => {
    const error = await afternic.listSales({ limit: 101 }).catch((e) => e);
    expect(error).toBeInstanceOf(AfternicError);
    expect((error as AfternicError).status).toBe(400);
  });
});
