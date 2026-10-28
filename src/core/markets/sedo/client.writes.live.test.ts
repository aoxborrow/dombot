import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SedoClient } from './client';
import type { SedoListing, SedoListingInput } from './types';

// Live write round trips (`SEDO_LIVE_WRITES=1 npm run test:live`). Every
// write touches only SEDO_TEST_DOMAIN, a name you own and keep for this, and
// puts it back the way it was (or delists it again if it wasn't listed).
// Off unless SEDO_LIVE_WRITES=1 and SEDO_TEST_DOMAIN are set, so a plain
// `npm run test:live` stays read-only.
//
// First run 2026-10-28 on domainio.com (docs/sedo-api.md, "Observed").

const env = {
  partnerId: process.env.SEDO_PARTNER_ID,
  signKey: process.env.SEDO_SIGN_KEY,
  username: process.env.SEDO_USERNAME,
  password: process.env.SEDO_PASSWORD,
};
const TEST_NAME = process.env.SEDO_TEST_DOMAIN;
const enabled =
  Object.values(env).every(Boolean) &&
  process.env.SEDO_LIVE_WRITES === '1' &&
  Boolean(TEST_NAME);

const asInput = (l: SedoListing): SedoListingInput => ({
  name: l.name,
  categories: l.categories,
  forSale: l.forSale,
  price: l.price,
  minPrice: l.minPrice,
  fixedPrice: l.fixedPrice,
  currency: l.currency,
  language: l.language,
});

describe.skipIf(!enabled)('Sedo (live writes, one test name)', () => {
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
  const name = TEST_NAME ?? '';
  let before: SedoListing | null = null;
  let inserted = false;

  /** The listing once Sedo shows it; inserts take seconds (seen: ~15). */
  async function listedWithin(ms: number): Promise<SedoListing | null> {
    for (const until = Date.now() + ms; ;) {
      const [l] = await sedo.getListings([name]);
      if (l || Date.now() > until) return l ?? null;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  afterAll(async () => {
    // Put it back: the original listing, or no listing. An insert still
    // being checked isn't deletable yet, so wait for it first.
    if (before) await sedo.editListings([asInput(before)]);
    else {
      if (inserted) await listedWithin(120_000);
      await sedo.deleteListings([name]);
    }
  }, 180_000);

  it('lists the test name (or finds it listed)', async () => {
    [before = null] = await sedo.getListings([name]);
    if (before) return;
    // A name another Sedo account lists can't be inserted (E3131, seen
    // live); pick one that's on no Sedo account.
    const [status] = await sedo.domainStatus([name]);
    if (status?.onSedo) {
      throw new Error(
        `${name} is on Sedo in another account; choose a SEDO_TEST_DOMAIN that isn't.`,
      );
    }
    const [r] = await sedo.insertListings([
      {
        name,
        forSale: true,
        price: '4999',
        minPrice: '500',
        fixedPrice: false,
        currency: 'USD',
        language: 'en',
      },
    ]);
    expect(r.ok).toBe(true);
    inserted = true;
    const listed = await listedWithin(120_000);
    // Seen live: in the list within seconds, but not for sale yet.
    console.info('Listed after insert: %o', listed);
    expect(listed).not.toBeNull();
  }, 180_000);

  it('changes one field and keeps the rest', async () => {
    const [now] = await sedo.getListings([name]);
    expect(now).toBeDefined();
    const price = now.price === '5555' ? '5556' : '5555';
    const [r] = await sedo.updateListings([{ name, price }]);
    expect(r.ok).toBe(true);
    // An edit shows at once (seen live).
    const [after] = await sedo.getListings([name]);
    expect(after).toMatchObject({
      price,
      minPrice: now.minPrice,
      fixedPrice: now.fixedPrice,
      currency: now.currency,
      categories: now.categories,
    });
  });
});
