import { beforeAll, describe, expect, it } from 'vitest';
import { createSedoAdapter } from './sedo';

// The adapter against the real API, read-only (`npm run test:live`). Skips
// unless SEDO_PARTNER_ID, SEDO_SIGN_KEY, SEDO_USERNAME and SEDO_PASSWORD
// are all set. Never run yet (docs/sedo-api.md, "Unverified").

const credentials = {
  partnerId: process.env.SEDO_PARTNER_ID,
  signKey: process.env.SEDO_SIGN_KEY,
  username: process.env.SEDO_USERNAME,
  password: process.env.SEDO_PASSWORD,
};
const configured = Object.values(credentials).every(Boolean);

describe.skipIf(!configured)('Sedo adapter (live)', () => {
  // Built in beforeAll: a suite that skips still runs this body.
  let sedo: ReturnType<typeof createSedoAdapter>;
  beforeAll(() => {
    sedo = createSedoAdapter('live-test', credentials, {
      userAgent: 'DomBot-live-tests/1.0',
    });
  });

  it('tests the connection', async () => {
    const result = await sedo.test();
    expect(result.listings).toBeNull();
  });

  it('maps every listing into the shared shape', async () => {
    const { listings, complete } = await sedo.allListings();
    expect(complete).toBe(true);
    for (const l of listings) {
      expect(l.market).toBe('sedo');
      expect(l.status).toBe('active');
      if (l.buyNow) expect(l.price).not.toBeNull();
      expect(l.floor).toBeNull();
    }
  });

  it('reads at most 31 days of account stats', async () => {
    const days = await sedo.accountStats(365);
    expect(days.length).toBeLessThanOrEqual(31);
    for (const d of days) expect(d.source).toBe('market');
  });
});
