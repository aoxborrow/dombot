import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SellerHubClient } from './client';
import type { SellerHubListing } from './types';

// SellerHub writes on one test name (`npm run test:live`). Skips unless
// SPACESHIP_LIVE_WRITES=1 and SPACESHIP_TEST_DOMAIN are set, beside the key.
// Use only domanio.com, domainio.com or testbot.io (listed on SellerHub
// already, passed 2026-11-07). A name SellerHub didn't list before is
// listed, repriced and delisted again; one it did list is repriced and put
// back as it was.

const apiKey = process.env.SPACESHIP_API_KEY;
const apiSecret = process.env.SPACESHIP_API_SECRET;
const domain = process.env.SPACESHIP_TEST_DOMAIN;
const enabled =
  process.env.SPACESHIP_LIVE_WRITES === '1' && apiKey && apiSecret && domain;

describe.skipIf(!enabled)('SellerHub client (live writes)', () => {
  let hub: SellerHubClient;
  let before: SellerHubListing | null = null;

  beforeAll(async () => {
    hub = new SellerHubClient({
      apiKey: apiKey ?? '',
      apiSecret: apiSecret ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
    before = await hub.getListing(domain ?? '');
  });

  afterAll(async () => {
    if (!hub || !domain) return;
    if (!before) {
      await hub.deleteListing(domain);
      return;
    }
    await hub.updateListing(domain, {
      binPriceEnabled: before.binPriceEnabled,
      ...(before.binPrice && { binPrice: before.binPrice }),
      minPriceEnabled: before.minPriceEnabled,
      ...(before.minPrice && { minPrice: before.minPrice }),
    });
  });

  it('lists the name, or finds it listed', async () => {
    const saved = before
      ? await hub.getListing(domain ?? '')
      : await hub.createListing(domain ?? '', {
          binPriceEnabled: true,
          binPrice: '999999',
          minPriceEnabled: true,
          minPrice: '99999',
        });
    expect(saved?.name).toBe(domain);
    expect(['verifying', 'onSale']).toContain(saved?.status);
  });

  it('reprices and turns offers off, answering with what it saved', async () => {
    const saved = await hub.updateListing(domain ?? '', {
      binPriceEnabled: true,
      binPrice: '999998',
      minPriceEnabled: false,
    });
    expect(saved?.binPrice).toBe('999998');
    expect(saved?.binPriceEnabled).toBe(true);
    expect(saved?.minPriceEnabled).toBe(false);
  });

  // The spec allows two decimal places; SellerHub keeps whole dollars, so
  // the adapter refuses cents. If this starts failing, it takes them.
  it('drops the cents', async () => {
    const saved = await hub.updateListing(domain ?? '', {
      binPrice: '999997.99',
    });
    expect(saved?.binPrice).toBe('999997');
  });
});
