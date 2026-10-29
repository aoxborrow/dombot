import { beforeAll, describe, expect, it } from 'vitest';
import { DomainEventType } from '../../../shared/domain-events';
import { MemoryDocStore } from '../../storage/doc-store';
import { configureStore, hydrateStores } from '../../storage/namespace';
import { listEvents } from '../domain-events';
import { connectMarketAccount, marketAccountViews } from './accounts';
import { trafficTotals } from './traffic';
import {
  marketAccountStats,
  marketListings,
  marketSales,
  syncMarketAccount,
} from './sync';

// Connect and sync a real Afternic account into an in-memory store, the way
// Settings → Markets does (`npm run test:live`). Nothing is written to
// Afternic. Skips without AFTERNIC_API_KEY and AFTERNIC_API_SECRET.

const apiKey = process.env.AFTERNIC_API_KEY;
const apiSecret = process.env.AFTERNIC_API_SECRET;

describe.skipIf(!apiKey || !apiSecret)('market sync (live, Afternic)', () => {
  let id: string;

  beforeAll(async () => {
    configureStore(new MemoryDocStore());
    await hydrateStores();
    const view = await connectMarketAccount('afternic', {
      apiKey: apiKey ?? '',
      apiSecret: apiSecret ?? '',
    });
    id = view.id;
    await syncMarketAccount(id);
  }, 120_000);

  it('records a clean sync on the account', () => {
    const [account] = marketAccountViews();
    expect(account.sync?.lastError).toBeNull();
    expect(account.sync?.listings).toBeGreaterThan(0);
    expect(account.sync?.sales).toBeGreaterThan(0);
  });

  it('stores every listing and sale', () => {
    expect(marketListings().length).toBe(
      marketAccountViews()[0].sync?.listings,
    );
    expect(marketSales().length).toBe(marketAccountViews()[0].sync?.sales);
    expect(marketAccountStats(id).length).toBeGreaterThan(300);
  });

  it('fetches per-name traffic for every listing in one desktop slice', () => {
    const [account] = marketAccountViews();
    const totals = trafficTotals(new Set([id]), 365);
    // Under the desktop budget, the first sync covers every listing.
    expect(totals.size).toBe(account.sync?.listings);
    expect(account.sync?.notes.some((n) => n.startsWith('Per-domain'))).toBe(
      false,
    );
  });

  it('writes one sold event per completed sale, and none twice', async () => {
    const completed = marketSales().filter((s) => s.status === 'completed');
    const sold = () =>
      listEvents().filter((e) => e.type === DomainEventType.Sold);
    // With no registrar portfolio in this store, nothing is held.
    expect(sold().length).toBe(completed.length);
    await syncMarketAccount(id);
    expect(sold().length).toBe(completed.length);
    expect(sold().every((e) => e.amount && e.currency === 'USD')).toBe(true);
  }, 120_000);
});
