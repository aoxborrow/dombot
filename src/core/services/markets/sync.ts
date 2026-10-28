import {
  SEARCH_DATA_FLAG,
  searchesOf,
  type MarketListing,
  type MarketSale,
  type MarketStatsDay,
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
import { dropSaleEvents, recordSaleEvents, saleKey } from './sale-events';
import {
  dropAccountTraffic,
  snapshotSearches,
  syncDomainTraffic,
} from './traffic';

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
  dropAccountTraffic(accountId);
});

/** A sale is re-read for this long after it sold, while its status moves. */
const SALES_OVERLAP_DAYS = 45;
/** Stats read on an account's first sync, then on later ones. */
const FIRST_STATS_DAYS = 365;
const LATER_STATS_DAYS = 7;
/** How long a listing the market is still checking stays pending. */
const PENDING_KEEP_DAYS = 7;
const UNCONFIRMED_NOTE = 'Not listed after a week';
const VERIFYING_NOTE = 'Waiting on ownership checks';

const enabledIds = () => new Set(activeMarketAccounts().map((a) => a.id));

/** Synced listings of enabled accounts. */
export function marketListings(): MarketListing[] {
  const ids = enabledIds();
  return Object.values(listings.all()).filter((l) => ids.has(l.accountId));
}

/** One account's synced listing for a name, if it has one. */
export function marketListing(
  accountId: string,
  name: string,
): MarketListing | undefined {
  return listings.get(`${accountId}:${name}`);
}

/** Store listings a write returned, so the table shows them before a sync. */
export function putMarketListings(
  accountId: string,
  saved: readonly MarketListing[],
): void {
  if (saved.length) {
    void listings.setMany(saved.map((l) => [`${accountId}:${l.name}`, l]));
  }
}

/** Drop listings a market confirmed it delisted. */
export function dropMarketListings(
  accountId: string,
  names: readonly string[],
): void {
  for (const name of names) void listings.delete(`${accountId}:${name}`);
}

/** One stored sale by account and id. */
export function marketSale(
  accountId: string,
  saleId: string,
): MarketSale | undefined {
  return sales.get(`${accountId}:${saleId}`);
}

/** Every recorded sale, newest first, whichever account sold it. */
export function marketSales(): MarketSale[] {
  return Object.values(sales.all())
    .filter(isShownSale)
    .sort((a, b) => (b.soldOn ?? '').localeCompare(a.soldOn ?? ''));
}

/**
 * Whether a sale record counts as a sale. A completed Buy Now sale is always
 * paid out, so one with no payout date isn't the account's sale: Afternic's
 * sales list includes the account's purchases, and that's how they look
 * (docs/afternic-api-issues.md, issue 1). Leases, sales still under way, and
 * cancelled ones have no payout date either and are kept.
 */
export function isShownSale(sale: MarketSale): boolean {
  return !(
    sale.status === 'completed' &&
    sale.kind === 'buy_now' &&
    !sale.paidOutOn
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
  // Notes that earlier versions wrote at connect time and that the card now
  // shows another way (a status flag, the market's help text).
  const notes = (previous?.notes ?? []).filter(
    (n) =>
      !n.startsWith('No search data on this account') &&
      !n.startsWith('Sedo’s API has no sales'),
  );
  let status = previous?.status ?? [];
  try {
    const adapter = marketAdapter(accountId);
    const caps = adapter.capabilities;

    // Listings: replace the account's rows, unless the read may be torn, in
    // which case add and update only, so no name is dropped by mistake.
    const read = await adapter.allListings();
    const prefix = `${accountId}:`;
    const fresh = new Map(read.listings.map((l) => [prefix + l.name, l]));
    // A market that checks new listings before adding them (Sedo) leaves
    // them out of its list meanwhile: keep DomBot's pending row for a while,
    // then drop it and say so, since the market may have refused it.
    let unconfirmed = 0;
    if (read.complete) {
      for (const [key, row] of Object.entries(listings.all())) {
        if (!key.startsWith(prefix) || fresh.has(key)) continue;
        if (caps.asyncInsert && row.status === 'pending') {
          const since = Date.parse(row.listedAt ?? '') || 0;
          if (Date.now() - since < PENDING_KEEP_DAYS * 86_400_000) continue;
          unconfirmed++;
        }
        void listings.delete(key);
      }
    }
    // A name DomBot listed for sale that the market lists but not for sale
    // yet is still being checked (Sedo verifies ownership of every new name,
    // through the registry or a TXT record, on its site). Keep it pending
    // until the market puts it up for sale.
    let verifying = 0;
    if (caps.asyncInsert) {
      for (const [key, row] of fresh) {
        const cached = listings.get(key);
        if (cached?.status === 'pending' && cached.forSale && !row.forSale) {
          fresh.set(key, {
            ...row,
            status: 'pending',
            listedAt: row.listedAt ?? cached.listedAt,
          });
          verifying++;
        }
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
      const all = accountSales(accountId);
      // Undo sold events written before the payout rule existed.
      dropSaleEvents(all.filter((s) => !isShownSale(s)).map(saleKey));
      recordSaleEvents(all.filter(isShownSale), heldNames(), localDay());
    }

    if (caps.accountStats && adapter.accountStats) {
      const kept = stats.get(accountId) ?? {};
      const days = await adapter.accountStats(
        Object.keys(kept).length ? LATER_STATS_DAYS : FIRST_STATS_DAYS,
      );
      for (const d of days) kept[d.date] = d;
      void stats.set(accountId, kept);
    }

    // Search counts come only to Discount Domain Club Domain Pro members, so
    // the listings say whether the account is one.
    if (caps.searchCounts && read.listings.length) {
      status = [
        ...status.filter((f) => f.label !== SEARCH_DATA_FLAG),
        {
          label: SEARCH_DATA_FLAG,
          on: read.listings.some((l) => searchesOf(l) != null),
        },
      ];
    }

    // Last, and in a slice: per-name traffic is the slow part.
    snapshotSearches(accountId, read.listings);
    let trafficNote: string | null = null;
    if (caps.domainStats) {
      const t = await syncDomainTraffic(adapter, read.listings);
      if (t.error) {
        trafficNote = `Per-domain traffic paused after ${t.fetched} names: ${t.error}. The next sync carries on.`;
      }
    }

    const kept = notes.filter(
      (n) =>
        !n.startsWith('Per-domain traffic') &&
        !n.startsWith(VERIFYING_NOTE) &&
        !(unconfirmed && n.startsWith(UNCONFIRMED_NOTE)),
    );
    if (trafficNote) kept.push(trafficNote);
    if (unconfirmed) {
      kept.push(
        `${UNCONFIRMED_NOTE}: ${unconfirmed} ${unconfirmed === 1 ? 'name' : 'names'} DomBot sent never showed up. The market may have refused ${unconfirmed === 1 ? 'it' : 'them'}; check the account's email.`,
      );
    }
    if (verifying) {
      kept.push(
        `${VERIFYING_NOTE}: ${verifying} ${verifying === 1 ? 'name' : 'names'} DomBot listed ${verifying === 1 ? "isn't" : "aren't"} for sale yet while the market checks that you own ${verifying === 1 ? 'it' : 'them'}. Finish the verification on the market's site (through the registry, or a TXT record it gives you).`,
      );
    }
    setMarketSyncState(accountId, {
      at: Date.now(),
      lastError: null,
      listings: read.listings.length,
      sales: accountSales(accountId).filter(isShownSale).length,
      incomplete: !read.complete,
      notes: kept,
      status,
    });
  } catch (error) {
    setMarketSyncState(accountId, {
      at: Date.now(),
      lastError: `${account.label}: ${errorMessage(error)}`,
      listings: previous?.listings ?? 0,
      sales: previous?.sales ?? 0,
      incomplete: previous?.incomplete ?? false,
      notes,
      status,
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
