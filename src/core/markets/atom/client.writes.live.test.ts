import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AtomClient } from './client';
import { AtomError } from './errors';
import type { AtomListing } from './types';

// Live write round trips (`ATOM_LIVE_WRITES=1 npm run test:live`). Every
// write touches only ATOM_TEST_DOMAIN, a Standard or Plus listing kept for
// this, and puts it back the way it was: price (or Make an Offer), category,
// listed. Off unless ATOM_LIVE_WRITES=1 and ATOM_TEST_DOMAIN are set, so a
// plain `npm run test:live` stays read-only. Never boosts, never adds
// Premium, never touches another listing.
//
// Two things can't be undone, so they're opt-in: a description can't be
// cleared (ATOM_TEST_DESCRIPTION=1 sets one), and a delisted name may need
// verifying again before it's live (ATOM_LIVE_RELIST=1 delists and re-adds).
//
// What these showed is in docs/atom-api.md, "Observed" (2026-10-28).

const apiToken = process.env.ATOM_API_TOKEN;
const userId = process.env.ATOM_USER_ID;
const TEST_NAME = process.env.ATOM_TEST_DOMAIN?.trim().toLowerCase();
const enabled =
  Boolean(apiToken && userId && TEST_NAME) &&
  process.env.ATOM_LIVE_WRITES === '1';
const relist = process.env.ATOM_LIVE_RELIST === '1';
const describeIt = process.env.ATOM_TEST_DESCRIPTION === '1';

describe.skipIf(!enabled)('Atom (live writes, one test name)', () => {
  // Built in beforeAll: a suite that skips still runs this body.
  let atom: AtomClient;
  const name = TEST_NAME ?? '';
  let before: AtomListing;
  /** The tier to re-add as: Atom keeps a name's tier anyway. */
  let tier: 'standard' | 'plus';

  beforeAll(async () => {
    atom = new AtomClient({
      apiToken: apiToken ?? '',
      userId: userId ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
    const found = await atom.getListing(name);
    // Refuse anything but a listed Standard or Plus name.
    if (!found || (found.type !== 'standard' && found.type !== 'plus')) {
      throw new Error(`${name} must be a Standard or Plus listing.`);
    }
    before = found;
    tier = found.type;
  });

  afterAll(async () => {
    if (!before) return;
    const now = await atom.getListing(name);
    // Adding updates in place, so this also re-lists a delisted name.
    if (!now || now.price !== before.price) {
      if (before.price === null && now?.price != null) {
        await atom.updatePrice(name, 0);
      } else {
        await atom.createListing(name, {
          price: before.price ?? 0,
          type: tier,
        });
      }
    }
    if (
      before.primaryCategory &&
      (await atom.getListing(name))?.primaryCategory !== before.primaryCategory
    ) {
      await atom.setPrimaryCategory(name, before.primaryCategory);
    }
  });

  it('can’t price a Make an Offer listing with a price update', async () => {
    if (before.price !== null) return;
    const ack = await atom.updatePrice(name, 500);
    expect(ack.message).toMatch(/success/i);
    expect((await atom.getListing(name))?.price).toBeNull();
  });

  it('prices one by adding it again, keeping its tier', async () => {
    const ack = await atom.createListing(name, { price: 600, type: tier });
    expect(ack.message).toMatch(/success/i);
    const now = await atom.getListing(name);
    expect(now?.price).toBe(600);
    expect(now?.type).toBe(before.type);
  });

  it('reprices a priced listing', async () => {
    await atom.updatePrice(name, 650);
    expect((await atom.getListing(name))?.price).toBe(650);
  });

  it('discounts in dollars, refuses 0, and clears on a price update', async () => {
    await atom.setDiscount(name, 50);
    const discounted = await atom.getListing(name);
    expect(discounted?.discount).toBe(50);
    await expect(atom.setDiscount(name, 0)).rejects.toThrow();
    const tooMuch = await atom.setDiscount(name, 650).catch((e: unknown) => e);
    expect(tooMuch).toBeInstanceOf(AtomError);
    expect((tooMuch as AtomError).message).toMatch(/greater than \$195/);
    await atom.updatePrice(name, 650);
    expect((await atom.getListing(name))?.discount).toBeNull();
  });

  it('turns it back into Make an Offer with a price of 0', async () => {
    await atom.updatePrice(name, 0);
    expect((await atom.getListing(name))?.price).toBeNull();
  });

  it('changes the category and back, and refuses an unknown one', async () => {
    const categories = await atom.listPrimaryCategories();
    // Names with "&" are always refused (observed), so pick one without.
    const other = categories.find(
      (c) => c.name !== before.primaryCategory && !c.name.includes('&'),
    )!;
    await atom.setPrimaryCategory(name, other.name);
    expect((await atom.getListing(name))?.primaryCategory).toBe(other.name);
    for (const bad of ['Not A Real Category', 'Fitness & Gym']) {
      const wrong = await atom
        .setPrimaryCategory(name, bad)
        .catch((e: unknown) => e);
      expect((wrong as AtomError).message).toMatch(/Wrong category name/);
    }
    if (before.primaryCategory) {
      await atom.setPrimaryCategory(name, before.primaryCategory);
      expect((await atom.getListing(name))?.primaryCategory).toBe(
        before.primaryCategory,
      );
    }
  });

  it.skipIf(!describeIt)(
    'sets a description, and refuses an empty one (ATOM_TEST_DESCRIPTION=1)',
    async () => {
      await atom.setDescription(name, `A DomBot live test description.`);
      expect((await atom.getListing(name))?.description).toContain(
        'DomBot live test',
      );
      const empty = await atom.setDescription(name, '').catch((e) => e);
      expect((empty as AtomError).message).toMatch(/empty/);
    },
  );

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
    'delists, then lists again by adding (ATOM_LIVE_RELIST=1)',
    async () => {
      await atom.deleteListing(name);
      expect(await atom.getListing(name)).toBeNull();
      await atom.createListing(name, { price: before.price ?? 0, type: tier });
      const back = await atom.getListing(name);
      expect(back?.price).toBe(before.price);
      expect(back?.type).toBe(before.type);
    },
  );
});
