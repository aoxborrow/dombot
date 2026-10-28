import { toAscii } from '../../../shared/domain-name';
import type { Domain, ListPrice } from '../../../shared/ipc';
import {
  fastTransferOf,
  searchesOf,
  type ListingStatus,
  type MarketInfo,
  type MarketListing,
  type MarketTraffic,
} from '../../../shared/markets';
import { formatMoney, type NumberFormatId } from '../../../shared/money';
import { cn } from '@/lib/utils';
import type { PurchaseColumn } from './purchase-columns';

// Domains table columns and the Listing filter for names on marketplaces
// (docs/markets.md). Built from the shared market shapes, so a new market
// shows up here with no changes.

export const MARKET_COLUMN_KEYS = new Set([
  'listing',
  'fastTransfer',
  'views30',
  'leads30',
  'searches30',
]);

/**
 * Listings get a column per connected market, `listing:afternic` and so on,
 * in the slot the layouts call `listing`. (A Markets-page table with every
 * market side by side may follow; a table cell holds one line.)
 */
export const listingColumnKey = (market: string) => `listing:${market}`;

/** A column that only exists once a market account is connected. */
export function isMarketColumnKey(key: string): boolean {
  return MARKET_COLUMN_KEYS.has(key) || key.startsWith('listing:');
}

const STATUS_LABEL: Record<ListingStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
  rejected: 'Rejected',
  on_hold: 'On hold',
  sold: 'Sold',
  unknown: 'Unknown',
};

const STATUS_DOT: Record<ListingStatus, string> = {
  active: 'bg-brand',
  pending: 'bg-amber-500',
  inactive: 'bg-muted-foreground',
  rejected: 'bg-destructive',
  on_hold: 'bg-amber-500',
  sold: 'bg-muted-foreground',
  unknown: 'bg-muted-foreground',
};

const FAST_TRANSFER_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  AWAITING_OPT_IN: 'Awaiting opt-in',
  INACTIVE: 'Inactive',
  INACTIVE_BUYNOW_HIGH: 'Price too high',
  INACTIVE_BUYNOW_MISSING: 'No Buy Now price',
  INELIGIBLE_REGISTRAR: 'Registrar not eligible',
  INELIGIBLE_TLD: 'TLD not eligible',
  PENDING_REVIEW: 'Pending review',
  USER_EXCLUDED: 'Turned off',
  UNKNOWN: 'Unknown',
};

type Listings = Record<string, MarketListing[]>;

function marketName(markets: MarketInfo[], id: string): string {
  return markets.find((m) => m.id === id)?.name ?? id;
}

/** What a hover over a listing says: status, prices and the market's extras. */
function describe(
  l: MarketListing,
  markets: MarketInfo[],
  money: (amount: string) => string,
): string {
  const parts = [`${marketName(markets, l.market)}: ${STATUS_LABEL[l.status]}`];
  if (!l.forSale) parts.push('hidden');
  if (l.price)
    parts.push(`${money(l.price)} ${l.buyNow ? 'Buy Now' : 'asking'}`);
  if (l.minOffer) parts.push(`${money(l.minOffer)} min offer`);
  if (l.floor) parts.push(`${money(l.floor)} floor`);
  const fastTransfer = fastTransferOf(l);
  if (fastTransfer) {
    parts.push(
      `Fast Transfer ${(FAST_TRANSFER_LABEL[fastTransfer] ?? fastTransfer).toLowerCase()}`,
    );
  }
  return parts.join(' · ');
}

export function marketColumns({
  listings,
  markets,
  listingMarkets,
  listPrices,
  traffic,
  preferredCurrency,
  numberFormat,
}: {
  listings: Listings;
  /** The markets that get a listing column: those with an account. */
  listingMarkets: readonly string[];
  /** Per-name traffic totals, by `toAscii` name. */
  traffic: MarketTraffic['domains'];
  markets: MarketInfo[];
  listPrices: Record<string, ListPrice>;
  preferredCurrency: string;
  numberFormat: NumberFormatId;
}): PurchaseColumn[] {
  const of = (d: Domain) => listings[toAscii(d.domainName)] ?? [];
  const money = (amount: string, currency = 'USD') =>
    formatMoney(amount, currency, preferredCurrency, numberFormat, true);
  const dash = <span className="text-muted-foreground">—</span>;
  // A number column that shows a dash where nothing's known yet.
  const count = (
    key: string,
    label: string,
    valueOf: (d: Domain) => number | undefined,
  ): PurchaseColumn => ({
    key,
    label,
    align: 'right',
    hideOnMobile: true,
    render: (d) => {
      const n = valueOf(d);
      return n === undefined ? (
        dash
      ) : (
        <span className={cn('tabular-nums', !n && 'text-muted-foreground')}>
          {n.toLocaleString()}
        </span>
      );
    },
    sortValue: (d) => valueOf(d) ?? null,
  });

  // One market's column: its price (or "Offers"), a status dot, and the
  // status when it isn't active. A name can only be in one account per
  // market, so there's at most one listing here.
  const listingColumn = (market: string): PurchaseColumn => {
    const on = (d: Domain) => of(d).find((l) => l.market === market);
    return {
      key: listingColumnKey(market),
      label: marketName(markets, market),
      align: 'right',
      hideOnMobile: true,
      render: (d) => {
        const l = on(d);
        if (!l) return dash;
        // Flag a market price that isn't the asking price you set in DomBot.
        const mine = listPrices[toAscii(d.domainName)];
        const differs =
          mine?.amount != null &&
          l.price != null &&
          mine.currency === l.currency &&
          Number(mine.amount) !== Number(l.price);
        const title = [
          describe(l, markets, (a) => money(a, l.currency)),
          differs &&
            `Your BIN price in DomBot is ${money(mine.amount!, mine.currency)}`,
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums',
              !l.forSale && 'opacity-60',
            )}
            title={title}
          >
            <span
              aria-hidden
              className={cn('size-2 rounded-full', STATUS_DOT[l.status])}
            />
            <span
              className={cn(differs && 'text-amber-600 dark:text-amber-400')}
            >
              {l.price ? money(l.price, l.currency) : 'Offers'}
            </span>
            {l.status !== 'active' && (
              <span className="text-muted-foreground">
                {STATUS_LABEL[l.status].toLowerCase()}
              </span>
            )}
          </span>
        );
      },
      // By price; an offers-only listing sorts below priced ones.
      sortValue: (d) => {
        const l = on(d);
        return l ? (l.price ? Number(l.price) : 0) : null;
      },
    };
  };

  return [
    ...listingMarkets.map(listingColumn),
    {
      key: 'fastTransfer',
      label: 'Fast Transfer',
      hideOnMobile: true,
      render: (d) => {
        const status = of(d).map(fastTransferOf).find(Boolean);
        return status ? (
          <span className={cn(status !== 'ACTIVE' && 'text-muted-foreground')}>
            {FAST_TRANSFER_LABEL[status] ?? status}
          </span>
        ) : (
          dash
        );
      },
      sortValue: (d) => of(d).map(fastTransferOf).find(Boolean) ?? null,
    },
    count(
      'views30',
      'Views (30d)',
      (d) => traffic[toAscii(d.domainName)]?.views30,
    ),
    count(
      'leads30',
      'Leads (30d)',
      (d) => traffic[toAscii(d.domainName)]?.leads30,
    ),
    count(
      'searches30',
      'Searches (30d)',
      (d) => of(d).map(searchesOf).find(Boolean)?.total.days30 ?? undefined,
    ),
  ];
}

/** A name's keys for the Listing filter: `market:status`, or `none`. */
export function listingKeys(list: MarketListing[] | undefined): string[] {
  return list?.length ? list.map((l) => `${l.market}:${l.status}`) : ['none'];
}

/** The Listing filter's options, with how many of `rows` each matches. */
export function listingFilterOptions(
  rows: Domain[],
  listings: Listings,
  markets: MarketInfo[],
): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of rows) {
    for (const key of new Set(listingKeys(listings[toAscii(d.domainName)]))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const label = (key: string) => {
    if (key === 'none') return 'Not listed';
    const [market, status] = key.split(':');
    return `${marketName(markets, market)}: ${STATUS_LABEL[status as ListingStatus] ?? status}`;
  };
  return [...counts]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) =>
      a.value === 'none'
        ? 1
        : b.value === 'none'
          ? -1
          : a.label.localeCompare(b.label),
    );
}
