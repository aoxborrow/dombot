import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AtomClient } from './client';
import type { AtomListing } from './types';

// Live write round trips (`ATOM_LIVE_WRITES=1 npm run test:live`). Every
// write touches only ATOM_TEST_DOMAIN, a Standard listing kept for this,
// and puts it back the way it was. Off unless ATOM_LIVE_WRITES=1 and
// ATOM_TEST_DOMAIN are set, so a plain `npm run test:live` stays read-only.
// Never boosts, never adds Premium, never touches another listing.
//
// Never run yet: written before there was a key (docs/atom-api.md).

const apiToken = process.env.ATOM_API_TOKEN;
const userId = process.env.ATOM_USER_ID;
const TEST_NAME = process.env.ATOM_TEST_DOMAIN?.trim().toLowerCase();
const enabled =
  Boolean(apiToken && userId && TEST_NAME) &&
  process.env.ATOM_LIVE_WRITES === '1';

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
    // Refuse anything but a listed Standard name: these tests delist it.
    if (!found || found.type !== 'standard' || found.price === null) {
      throw new Error(`${name} must be a Standard listing with a price.`);
    }
    before = found;
  });

  afterAll(async () => {
    if (!before) return;
    const now = await atom.getListing(name);
    if (!now)
      await atom.createListing(name, {
        price: before.price!,
        type: 'standard',
      });
    if (now?.price !== before.price)
      await atom.updatePrice(name, before.price!);
    if (before.discount !== (now?.discount ?? null)) {
      await atom.setDiscount(name, before.discount ?? 0);
    }
    if (
      before.primaryCategory &&
      now?.primaryCategory !== before.primaryCategory
    ) {
      await atom.setPrimaryCategory(name, before.primaryCategory);
    }
    if (before.description && now?.description !== before.description) {
      await atom.setDescription(name, before.description);
    }
  });

  it('reprices and restores', async () => {
    await atom.updatePrice(name, before.price! + 100);
    expect((await atom.getListing(name))?.price).toBe(before.price! + 100);
    await atom.updatePrice(name, before.price!);
    expect((await atom.getListing(name))?.price).toBe(before.price);
  });

  it('sets and clears a discount', async () => {
    await atom.setDiscount(name, 100);
    expect((await atom.getListing(name))?.discount).toBe(100);
    await atom.setDiscount(name, 0);
    expect((await atom.getListing(name))?.discount).toBeNull();
  });

  it('sets the category and description, then restores them', async () => {
    const [category] = await atom.listPrimaryCategories();
    await atom.setPrimaryCategory(name, category.name);
    await atom.setDescription(name, `${name}: a DomBot live test description.`);
    const now = await atom.getListing(name);
    expect(now?.primaryCategory).toBe(category.name);
    expect(now?.description).toContain('DomBot live test');
  });

  it('asks Atom to verify DNS', async () => {
    await atom.verifyDns(name);
  });

  it('delists and lists again', async () => {
    await atom.deleteListing(name);
    expect(await atom.getListing(name)).toBeNull();
    await atom.createListing(name, { price: before.price!, type: 'standard' });
    expect((await atom.getListing(name))?.price).toBe(before.price);
  });
});
