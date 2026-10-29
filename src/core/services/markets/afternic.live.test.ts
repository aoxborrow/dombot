import { describe, expect, it } from 'vitest';
import { createAfternicAdapter } from './afternic';

// The adapter against the real API, read-only (`npm run test:live`). Skips
// without AFTERNIC_API_KEY and AFTERNIC_API_SECRET.

const apiKey = process.env.AFTERNIC_API_KEY;
const apiSecret = process.env.AFTERNIC_API_SECRET;

describe.skipIf(!apiKey || !apiSecret)('Afternic adapter (live)', () => {
  const afternic = createAfternicAdapter(
    'live-test',
    { apiKey, apiSecret },
    { userAgent: 'DomBot-live-tests/1.0' },
  );

  it('tests the connection', async () => {
    const result = await afternic.test();
    expect(result.listings).toBeGreaterThan(0);
  });

  it('maps every listing into the shared shape', async () => {
    const { listings, complete } = await afternic.allListings();
    expect(complete).toBe(true);
    for (const l of listings) {
      expect(l.currency).toBe('USD');
      expect(l.status).not.toBe('unknown');
      if (l.price) expect(l.price).toMatch(/^\d+$/);
    }
  });

  it('maps every sale, with a day for each', async () => {
    const sales = await afternic.allSales();
    expect(sales.length).toBeGreaterThan(0);
    for (const s of sales) {
      expect(s.soldOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.status).not.toBe('unknown');
      expect(Object.keys(s)).not.toContain('authCode');
    }
  });

  it('reads account stats as shared daily rows', async () => {
    const days = await afternic.accountStats(7);
    expect(days.length).toBeGreaterThan(0);
    expect(days[0]).toMatchObject({ market: 'afternic', source: 'market' });
  });
});
