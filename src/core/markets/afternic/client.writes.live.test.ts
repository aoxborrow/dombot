import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AfternicClient } from './client';
import { AfternicError } from './errors';
import type { AfternicListing, ListingFields } from './types';

// Live write round trips (`AFTERNIC_LIVE_WRITES=1 npm run test:live`). Every
// write touches only TEST_NAME, a listing kept for this, and puts it back
// the way it was. Off unless AFTERNIC_LIVE_WRITES is set, so a plain
// `npm run test:live` stays read-only.

const apiKey = process.env.AFTERNIC_API_KEY;
const apiSecret = process.env.AFTERNIC_API_SECRET;
const writes = process.env.AFTERNIC_LIVE_WRITES === '1';
const TEST_NAME = process.env.AFTERNIC_TEST_DOMAIN ?? 'domanio.com';
const NOT_LISTED = 'dombot-not-listed-0000.com';

/** The writable settings of a listing, to put it back exactly. */
function fieldsOf(l: AfternicListing): ListingFields {
  return {
    displayName: l.displayName,
    buyNow: l.buyNow,
    minOffer: l.minOffer ?? undefined,
    floor: l.floor,
    leasingEnabled: l.leasingEnabled,
    maxLeasePeriod: l.maxLeasePeriod ?? undefined,
    landingPage: l.landingPage ?? undefined,
    intakeStyle: l.intakeStyle ?? undefined,
    showLanderBuynowOption: l.showLanderBuynowOption,
    showLanderMakeOfferOption: l.showLanderMakeOfferOption,
    showLanderLeaseToOwnOption: l.showLanderLeaseToOwnOption,
    hidden: l.hidden,
  };
}

const priced = (l: AfternicListing | null) => ({
  buyNow: l?.buyNow,
  minOffer: l?.minOffer,
  floor: l?.floor,
  hidden: l?.hidden,
  leasingEnabled: l?.leasingEnabled,
  maxLeasePeriod: l?.maxLeasePeriod,
  intakeStyle: l?.intakeStyle,
});

describe.skipIf(!apiKey || !apiSecret || !writes)(
  `Afternic (live, writes ${TEST_NAME})`,
  () => {
    const afternic = new AfternicClient({
      apiKey: apiKey ?? '',
      apiSecret: apiSecret ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
    let original: AfternicListing;

    beforeAll(async () => {
      const listing = await afternic.getListing(TEST_NAME);
      if (!listing) throw new Error(`${TEST_NAME} must be listed to test.`);
      original = listing;
    });

    // Whatever happens above, leave the listing as it was.
    afterAll(async () => {
      if (!original) return;
      const now = await afternic.getListing(TEST_NAME);
      if (!now) {
        await afternic.createListing({
          name: TEST_NAME,
          ...fieldsOf(original),
        });
      } else {
        await afternic.updateListing(TEST_NAME, fieldsOf(original));
      }
      expect(priced(await afternic.getListing(TEST_NAME))).toEqual(
        priced(original),
      );
    });

    it('changes a price and puts it back', async () => {
      const bumped = await afternic.updateListing(TEST_NAME, {
        buyNow: (original.buyNow ?? 1000) + 1,
      });
      expect(bumped.buyNow).toBe((original.buyNow ?? 1000) + 1);
      expect(bumped.floor).toBe(original.floor);
      const back = await afternic.updateListing(TEST_NAME, {
        buyNow: original.buyNow,
      });
      expect(priced(back)).toEqual(priced(original));
    });

    it('hides the listing and shows it again', async () => {
      expect(
        (await afternic.updateListing(TEST_NAME, { hidden: true })).hidden,
      ).toBe(true);
      expect(
        (await afternic.updateListing(TEST_NAME, { hidden: original.hidden }))
          .hidden,
      ).toBe(original.hidden);
    });

    it('upserts the listing unchanged', async () => {
      const [result] = await afternic.upsertListings([
        { name: TEST_NAME, buyNow: original.buyNow },
      ]);
      expect(result.ok).toBe(true);
      expect(priced(await afternic.getListing(TEST_NAME))).toEqual(
        priced(original),
      );
    });

    it('reports a per-name failure for a name that is not listed', async () => {
      const [result] = await afternic.deleteListings([NOT_LISTED]);
      expect(result.name).toBe(NOT_LISTED);
      expect(result.ok).toBe(false);
      expect(await afternic.deleteListing(NOT_LISTED)).toBe(false);
    });

    it('refuses to create a listing that exists', async () => {
      const error = await afternic
        .createListing({ name: TEST_NAME, buyNow: original.buyNow })
        .catch((e) => e);
      expect(error).toBeInstanceOf(AfternicError);
      expect((error as AfternicError).status).toBe(409);
    });

    it('relists with RESYNC', async () => {
      const [result] = await afternic.relistListings([TEST_NAME], 'RESYNC');
      expect(result.name).toBe(TEST_NAME);
      expect(result.ok).toBe(true);
    });

    it('saves account settings unchanged', async () => {
      const before = await afternic.getAccountSettings();
      await afternic.updateAccountSettings({
        maxLeasePeriod: before.maxLeasePeriod ?? undefined,
      });
      expect(await afternic.getAccountSettings()).toEqual(before);
    });

    // Delisting sends the listing back to PENDING for a few minutes after
    // it's re-created, so this one also needs AFTERNIC_LIVE_DELIST=1.
    it.skipIf(process.env.AFTERNIC_LIVE_DELIST !== '1')(
      'delists and re-lists the name with the same settings',
      async () => {
        expect(await afternic.deleteListing(TEST_NAME)).toBe(true);
        expect(await afternic.getListing(TEST_NAME)).toBeNull();
        const created = await afternic.createListing({
          name: TEST_NAME,
          ...fieldsOf(original),
        });
        expect(priced(created)).toEqual(priced(original));
      },
    );
  },
);
