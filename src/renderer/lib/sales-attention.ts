import type { ListPrice } from '../../shared/ipc';
import { hasAskingKind } from '../../shared/list-prices';
import { priceComparison } from '../../shared/market-filter';
import type { MarketId, MarketListing } from '../../shared/markets';
import type { SaleRecord } from '../../shared/sales';
import { domainsLink } from './domains-link';
import { isUnderWay } from './sales';

// The Sales overview's Needs attention list (docs/sales-tab.md): sales
// waiting on you, listings a market refused or has sat on, market prices
// below yours, and the many-name cases as one row that opens Domains with
// the Markets filter set. Pure, so it can be tested apart from the page.

/** A pending listing older than this is stuck. */
export const STUCK_DAYS = 7;
/** Past this many names, a kind of listing problem shows as one grouped row. */
export const GROUP_OVER = 3;

export type AttentionItem =
  | { kind: 'sale'; key: string; record: SaleRecord }
  | {
      kind: 'listing';
      key: string;
      reason: 'rejected' | 'stuck' | 'below';
      listing: MarketListing;
      /** Your DomBot BIN price, for `below`. */
      mine?: ListPrice;
    }
  | {
      kind: 'group';
      key: string;
      reason: 'rejected' | 'stuck' | 'below' | 'unlisted';
      market: MarketId;
      count: number;
      /** Domains, filtered to these names. */
      link: string;
    };

const DAY = 86_400_000;

export function needsAttention({
  records,
  liveMarketAccounts,
  listings,
  listPrices,
  owned,
  markets,
  now = Date.now(),
}: {
  records: readonly SaleRecord[];
  /** Market account ids still connected: only they can be acted through. */
  liveMarketAccounts: ReadonlySet<string>;
  /** Listings by `toAscii` name. */
  listings: Readonly<Record<string, MarketListing[]>>;
  listPrices: Readonly<Record<string, ListPrice>>;
  /** Names you own (Owned view), by `toAscii`. */
  owned: ReadonlySet<string>;
  /** Connected markets, in catalog order. */
  markets: readonly MarketId[];
  now?: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Sales waiting on you, oldest first: they've waited longest.
  for (const r of [...records].reverse()) {
    if (
      isUnderWay(r) &&
      r.step &&
      r.marketAccountId &&
      liveMarketAccounts.has(r.marketAccountId)
    )
      items.push({ kind: 'sale', key: `sale:${r.id}`, record: r });
  }

  for (const market of markets) {
    const found: Record<
      'rejected' | 'stuck' | 'below',
      { listing: MarketListing; mine?: ListPrice }[]
    > = { rejected: [], stuck: [], below: [] };
    let unlisted = 0;
    for (const name of [...owned].sort()) {
      const l = listings[name]?.find((x) => x.market === market);
      const mine = listPrices[name];
      if (!l) {
        if (hasAskingKind(mine, 'forSale')) unlisted++;
        continue;
      }
      if (l.status === 'rejected') found.rejected.push({ listing: l });
      else if (
        (l.status === 'pending' || l.status === 'on_hold') &&
        l.listedAt &&
        now - Date.parse(l.listedAt) > STUCK_DAYS * DAY
      )
        found.stuck.push({ listing: l });
      else if (priceComparison(l, mine) === 'below')
        found.below.push({ listing: l, mine });
    }
    const link = {
      rejected: domainsLink({ markets: [market], states: ['rejected'] }),
      stuck: domainsLink({ markets: [market], states: ['pending'] }),
      below: domainsLink({ markets: [market], comparisons: ['below'] }),
    };
    for (const reason of ['rejected', 'stuck', 'below'] as const) {
      const list = found[reason];
      if (list.length > GROUP_OVER)
        items.push({
          kind: 'group',
          key: `group:${reason}:${market}`,
          reason,
          market,
          count: list.length,
          link: link[reason],
        });
      else
        for (const { listing, mine } of list)
          items.push({
            kind: 'listing',
            key: `listing:${reason}:${market}:${listing.name}`,
            reason,
            listing,
            ...(mine ? { mine } : {}),
          });
    }
    if (unlisted)
      items.push({
        kind: 'group',
        key: `group:unlisted:${market}`,
        reason: 'unlisted',
        market,
        count: unlisted,
        link: domainsLink({
          markets: [market],
          states: ['none'],
          asking: ['forSale'],
        }),
      });
  }
  return items;
}
