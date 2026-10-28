import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SedoClient } from './client';
import type { SedoListing, SedoListingInput } from './types';

// Live write round trips (`SEDO_LIVE_WRITES=1 npm run test:live`). Every
// write touches only SEDO_TEST_DOMAIN, a name you own and keep for this, and
// puts it back the way it was (or delists it again if it wasn't listed).
// Off unless SEDO_LIVE_WRITES=1 and SEDO_TEST_DOMAIN are set, so a plain
// `npm run test:live` stays read-only.
//
// Never run yet: written before there were credentials (docs/sedo-api.md).

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

  afterAll(async () => {
    // Put it back: the original listing, or no listing.
    if (before) await sedo.editListings([asInput(before)]);
    else await sedo.deleteListings([name]);
  });

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
    console.info('Insert result: %o', r);
    expect(r.ok).toBe(true);
    // UNVERIFIED: how long Sedo's checks take. Report whether it shows yet.
    console.info(
      'Listed right after insert: %o',
      await sedo.getListings([name]),
    );
  });

  it('changes one field and keeps the rest', async () => {
    const [now] = await sedo.getListings([name]);
    if (!now) {
      console.info('Not listed yet (Sedo still checking); skipping the edit.');
      return;
    }
    const price = now.price === '5555' ? '5556' : '5555';
    const [r] = await sedo.updateListings([{ name, price }]);
    expect(r.ok).toBe(true);
    const [after] = await sedo.getListings([name]);
    // UNVERIFIED: that an edit shows at once.
    expect(after).toMatchObject({
      price,
      minPrice: now.minPrice,
      fixedPrice: now.fixedPrice,
      currency: now.currency,
      categories: now.categories,
    });
  });
});
