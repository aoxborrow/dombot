import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AtomClient } from './client';
import { AtomError } from './errors';
import type { AtomListing } from './types';

// Live write round trips (`ATOM_LIVE_WRITES=1 npm run test:live`). Every
// write touches only ATOM_TEST_DOMAIN, a Standard listing kept for this, and
// puts it back the way it was. Off unless ATOM_LIVE_WRITES=1 and
// ATOM_TEST_DOMAIN are set, so a plain `npm run test:live` stays read-only.
// Never boosts, never adds Premium, never touches another listing.
//
// Works on a priced listing or a Make an Offer one (price 0). Steps that
// can't be undone on the test name are skipped: a category or description
// it doesn't have yet can't be cleared again. Delisting and re-adding also
// needs ATOM_LIVE_RELIST=1, since Atom may want the name verified again.
//
// Run on a Make an Offer listing (2026-10-28): see docs/atom-api.md,
// "Observed", for what Atom did.

const apiToken = process.env.ATOM_API_TOKEN;
const userId = process.env.ATOM_USER_ID;
const TEST_NAME = process.env.ATOM_TEST_DOMAIN?.trim().toLowerCase();
const enabled =
  Boolean(apiToken && userId && TEST_NAME) &&
  process.env.ATOM_LIVE_WRITES === '1';
const relist = process.env.ATOM_LIVE_RELIST === '1';

describe.skipIf(!enabled)('Atom (live writes, one Standard test name)', () => {
  // Built in beforeAll: a suite that skips still runs this body.
  let atom: AtomClient;
  const name = TEST_NAME ?? '';
  let before: AtomListing;

  beforeAll(async () => {
    atom = new AtomClient({
      apiToken: apiToken ?? '',
      userId: userId ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
    const found = await atom.getListing(name);
    // Refuse anything but a listed Standard name.
    if (!found || found.type !== 'standard') {
      throw new Error(`${name} must be a Standard listing.`);
    }
    before = found;
  });

  afterAll(async () => {
    if (!before) return;
    const now = await atom.getListing(name);
    if (!now) {
      await atom.createListing(name, {
        price: before.price ?? 0,
        type: 'standard',
      });
      return;
    }
    if (now.price !== before.price) {
      await atom.updatePrice(name, before.price ?? 0);
    }
    if (before.discount !== now.discount) {
      await atom.setDiscount(name, before.discount ?? 0);
    }
  });

  it('reprices and restores', async () => {
    if (before.price === null) {
      // Observed: Atom answers success and keeps Make an Offer.
      const ack = await atom.updatePrice(name, 500);
      expect(ack.message).toMatch(/success/i);
      expect((await atom.getListing(name))?.price).toBeNull();
      await atom.updatePrice(name, 0);
      return;
    }
    await atom.updatePrice(name, before.price + 100);
    expect((await atom.getListing(name))?.price).toBe(before.price + 100);
    await atom.updatePrice(name, before.price);
    expect((await atom.getListing(name))?.price).toBe(before.price);
  });

  it.skipIf(!process.env.ATOM_TEST_DISCOUNT)(
    'sets and clears a discount (priced listing only; ATOM_TEST_DISCOUNT=1)',
    async () => {
      if (before.price === null) return;
      await atom.setDiscount(name, 100);
      expect((await atom.getListing(name))?.discount).toBe(100);
      await atom.setDiscount(name, 0);
      expect((await atom.getListing(name))?.discount).toBeNull();
    },
  );

  it('sets the category and description back to what they were', async () => {
    // Only a value the name already has can be put back.
    if (before.primaryCategory) {
      await atom.setPrimaryCategory(name, before.primaryCategory);
    }
    if (before.description) await atom.setDescription(name, before.description);
    const now = await atom.getListing(name);
    expect(now?.primaryCategory).toBe(before.primaryCategory);
    expect(now?.description).toBe(before.description);
  });

  it('asks Atom to verify DNS (once per account every 12 hours)', async () => {
    try {
      const ack = await atom.verifyDns(name);
      expect(ack.message).toMatch(/accepted/i);
    } catch (error) {
      expect(error).toBeInstanceOf(AtomError);
      expect((error as AtomError).code).toBe('TRY_LATER');
    }
  });

  it.skipIf(!relist)(
    'delists and lists again (ATOM_LIVE_RELIST=1)',
    async () => {
      await atom.deleteListing(name);
      expect(await atom.getListing(name)).toBeNull();
      await atom.createListing(name, {
        price: before.price ?? 0,
        type: 'standard',
      });
      expect((await atom.getListing(name))?.price).toBe(before.price);
    },
  );
});
