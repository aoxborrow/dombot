import type {
  MarketListing,
  MarketSale,
  MarketStatsDay,
} from '../../../shared/markets';
import { localDay } from '../../../shared/domain-events';
import { broadcastPortfolioChanged } from '../../events';
import {
  MARKET_LISTINGS_NAMESPACE,
  MARKET_SALES_NAMESPACE,
  MARKET_STATS_NAMESPACE,
} from '../../storage/names';
import { Namespace } from '../../storage/namespace';
import { getCachedPortfolio } from '../registrars';
import {
  activeMarketAccounts,
  getMarketSyncState,
  marketAccount,
  marketAdapter,
  onMarketAccountRemoved,
  setMarketSyncState,
} from './accounts';
import { recordSaleEvents } from './sale-events';

// Market sync (docs/markets.md, "Sync"): each enabled account's listings,
// sales and account stats, read through its adapter into storage that is
// the same shape for every market.
//
// Listings are a cache, keyed `${accountId}:${name}` like the registrar
// caches, so a 10,000-name portfolio is 10,000 small rows rather than one
// huge one. Sales and stats are kept: they're history.

const listings = new Namespace<MarketListing>(MARKET_LISTINGS_NAMESPACE, {
  cache: true,
});
const sales = new Namespace<MarketSale>(MARKET_SALES_NAMESPACE);
/** One row per account: its daily stats by date. */
const stats = new Namespace<Record<string, MarketStatsDay>>(
  MARKET_STATS_NAMESPACE,
);

onMarketAccountRemoved((accountId) => {
  for (const key of Object.keys(listings.all())) {
    if (key.startsWith(`${accountId}:`)) void listings.delete(key);
  }
  void stats.delete(accountId);
});

/** A sale is re-read for this long after it sold, while its status moves. */
const SALES_OVERLAP_DAYS = 45;
/** Stats read on an account's first sync, then on later ones. */
const FIRST_STATS_DAYS = 365;
const LATER_STATS_DAYS = 7;

const enabledIds = () => new Set(activeMarketAccounts().map((a) => a.id));

/** Synced listings of enabled accounts. */
export function marketListings(): MarketListing[] {
  const ids = enabledIds();
  return Object.values(listings.all()).filter((l) => ids.has(l.accountId));
}

/** Every recorded sale, newest first, whichever account sold it. */
export function marketSales(): MarketSale[] {
  return Object.values(sales.all()).sort((a, b) =>
    (b.soldOn ?? '').localeCompare(a.soldOn ?? ''),
  );
}

/** An account's stored daily stats, oldest first. */
export function marketAccountStats(accountId: string): MarketStatsDay[] {
  return Object.values(stats.get(accountId) ?? {}).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accountSales(accountId: string): MarketSale[] {
  return Object.values(sales.all()).filter((s) => s.accountId === accountId);
}

/** Names a connected registrar account holds now, per the cached portfolio. */
function heldNames(): Set<string> {
  return new Set(
    (getCachedPortfolio()?.domains ?? []).map((d) =>
      d.domainName.toLowerCase(),
    ),
  );
}

/**
 * Sync one market account. Never throws: a failure is recorded on the
 * account (and shown on its card), keeping what the last sync found.
 */
export async function syncMarketAccount(accountId: string): Promise<void> {
  const account = marketAccount(accountId);
  const previous = getMarketSyncState(accountId);
  const notes = previous?.notes ?? [];
  try {
    const adapter = marketAdapter(accountId);
    const caps = adapter.capabilities;

    // Listings: replace the account's rows, unless the read may be torn, in
    // which case add and update only, so no name is dropped by mistake.
    const read = await adapter.allListings();
    const prefix = `${accountId}:`;
    const fresh = new Map(read.listings.map((l) => [prefix + l.name, l]));
    if (read.complete) {
      for (const key of Object.keys(listings.all())) {
        if (key.startsWith(prefix) && !fresh.has(key))
          void listings.delete(key);
      }
    }
    void listings.setMany([...fresh]);

    // Sales: all of history the first time, then a window back from the
    // newest, since a recent sale's status keeps moving.
    if (caps.sales && adapter.allSales) {
      const known = accountSales(accountId);
      const newest = known
        .map((s) => s.soldOn ?? '')
        .sort()
        .at(-1);
      const since = newest
        ? new Date(Date.parse(newest) - SALES_OVERLAP_DAYS * 86_400_000)
            .toISOString()
            .slice(0, 10)
        : undefined;
      const read = await adapter.allSales(since);
      void sales.setMany(read.map((s) => [`${accountId}:${s.id}`, s]));
      recordSaleEvents(accountSales(accountId), heldNames(), localDay());
    }

    if (caps.accountStats && adapter.accountStats) {
      const kept = stats.get(accountId) ?? {};
      const days = await adapter.accountStats(
        Object.keys(kept).length ? LATER_STATS_DAYS : FIRST_STATS_DAYS,
      );
      for (const d of days) kept[d.date] = d;
      void stats.set(accountId, kept);
    }

    setMarketSyncState(accountId, {
      at: Date.now(),
      lastError: null,
      listings: read.listings.length,
      sales: accountSales(accountId).length,
      incomplete: !read.complete,
      notes,
    });
  } catch (error) {
    setMarketSyncState(accountId, {
      at: Date.now(),
      lastError: `${account.label}: ${errorMessage(error)}`,
      listings: previous?.listings ?? 0,
      sales: previous?.sales ?? 0,
      incomplete: previous?.incomplete ?? false,
      notes,
    });
  }
  broadcastPortfolioChanged();
}

/**
 * Sync every enabled market account, one at a time (each market's rate
 * limit is per account anyway). With `ifOlderThanMs`, skips accounts synced
 * more recently than that.
 */
export async function syncMarkets(ifOlderThanMs?: number): Promise<number> {
  let ran = 0;
  for (const account of activeMarketAccounts()) {
    const at = getMarketSyncState(account.id)?.at ?? 0;
    if (ifOlderThanMs !== undefined && Date.now() - at < ifOlderThanMs) {
      continue;
    }
    await syncMarketAccount(account.id);
    ran++;
  }
  return ran;
}
