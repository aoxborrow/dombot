import { beforeAll, describe, expect, it } from 'vitest';
import { SedoClient } from './client';
import { SedoError } from './errors';

// Read-only checks against the real Sedo API (`npm run test:live`). Skips
// unless SEDO_PARTNER_ID, SEDO_SIGN_KEY, SEDO_USERNAME and SEDO_PASSWORD
// are all set.
//
// Never run yet: written before there were credentials. The first run is
// the check of everything marked UNVERIFIED in this folder; the order to
// work through is in docs/sedo-api.md, "Unverified". Several tests here
// record a behavior rather than assert one: read their output.

const env = {
  partnerId: process.env.SEDO_PARTNER_ID,
  signKey: process.env.SEDO_SIGN_KEY,
  username: process.env.SEDO_USERNAME,
  password: process.env.SEDO_PASSWORD,
};
const configured = Object.values(env).every(Boolean);

describe.skipIf(!configured)('Sedo (live, read-only)', () => {
  // Built in beforeAll: a suite that skips still runs this body.
  let sedo: SedoClient;
  beforeAll(() => {
    sedo = new SedoClient({
      partnerId: env.partnerId ?? '',
      signKey: env.signKey ?? '',
      username: env.username ?? '',
      password: env.password ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
  });

  it('knows the account (CheckMember)', async () => {
    expect(await sedo.checkMember()).toBe(true);
  });

  it('reports a wrong password as fault E6', async () => {
    const wrong = new SedoClient({
      partnerId: env.partnerId ?? '',
      signKey: env.signKey ?? '',
      username: env.username ?? '',
      password: 'dombot-wrong-password',
      userAgent: 'DomBot-live-tests/1.0',
      maxRetries: 0,
    });
    const error = await wrong.checkMember().catch((e) => e);
    expect(error).toBeInstanceOf(SedoError);
    // Which HTTP status comes with a fault is one of the open questions.
    console.info('Sedo fault: code %s, HTTP %d', error.code, error.status);
    expect(error.code).toBe('E6');
  });

  it('lists every listing in the documented shape', async () => {
    const listings = await sedo.allListings(true);
    console.info('Sedo listings: %d', listings.length);
    expect(new Set(listings.map((l) => l.name)).size).toBe(listings.length);
    for (const l of listings) {
      expect(l.name).toBe(l.name.toLowerCase());
      expect(['EUR', 'USD', 'GBP']).toContain(l.currency);
      if (l.price) expect(l.price).toMatch(/^\d+(\.\d+)?$/);
      expect(l.categories.length).toBeLessThanOrEqual(3);
    }
    // The insert date's format: a string or a UNIX timestamp, per the docs.
    console.info(
      'Insert dates: %o',
      listings.slice(0, 3).map((l) => l.insertedAt),
    );
  });

  it('pages by offset, in the same order as one read', async () => {
    // Sedo's order isn't by name (checked live); pages must still line up.
    const all = await sedo.allListings(false);
    const page = await sedo.listListings({ startFrom: 2, results: 2 });
    expect(page.map((l) => l.name)).toEqual(all.slice(2, 4).map((l) => l.name));
  });

  it('gets listings by name, and leaves unknown names out', async () => {
    const [one] = await sedo.listListings({ results: 1 });
    if (!one) return;
    const got = await sedo.getListings([
      one.name,
      'dombot-not-listed-0000.com',
    ]);
    expect(got.map((l) => l.name)).toEqual([one.name]);
    const [status] = await sedo.domainStatus([one.name]);
    expect(status.onSedo).toBe(true);
    console.info('DomainStatus: %o', status);
  });

  it('reads parking statistics and payments', async () => {
    const account = await sedo.dailyParkingStats();
    console.info(
      'Account parking days: %d, first %o',
      account.length,
      account[0],
    );
    for (const d of account) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const months = await sedo.monthlyParkingStats();
    console.info('Monthly rows: %d', months.length);
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const payments = await sedo.parkingPayments(
      lastMonth.toISOString().slice(0, 10),
    );
    console.info('Payments: %o', payments);
  });

  it('reads one name’s daily parking stats', async () => {
    const [one] = await sedo.listListings({ results: 1 });
    if (!one) return;
    const days = await sedo.dailyParkingStats(one.name).catch((e) => e);
    // UNVERIFIED: whether period 1 with a domain gives that name's days.
    console.info('Per-name stats for %s: %o', one.name, days);
  });

  it('reads categories and languages', async () => {
    const categories = await sedo.categories();
    expect(categories.length).toBeGreaterThan(10);
    const languages = await sedo.languages();
    expect(languages.some((l) => l.code === 'en')).toBe(true);
  });
});
