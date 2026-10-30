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
import {
  CircleArrowDown,
  CircleArrowUp,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  Clock,
  EyeOff,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketLogo } from '../RegistrarLogo';
import {
  EditableEmpty,
  EDITABLE_VALUE,
  PurchaseCell,
  type PurchaseColumn,
} from './purchase-columns';

// Domains table columns for names on marketplaces
// (docs/markets.md). Built from the shared market shapes, so a new market
// shows up here with no changes.

export const MARKET_COLUMN_KEYS = new Set([
  'listed',
  'listing',
  'fastTransfer',
  'views',
  'leads',
  'searches',
]);

/**
 * Listings get a column per connected market, `listing:afternic` and so on,
 * in the slot the layouts call `listing`: the Listings view's columns. Owned
 * has the one `listed` column instead, a logo per market, so it stays the
 * same width however many markets are connected.
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
/**
 * The icon at the left of a listing cell: one per cell, the most pressing
 * state wins (rejected, waiting, not selling, a price apart from DomBot's,
 * then all good). An eye-slash is visibility you control (inactive or
 * hidden), a clock is the market's to change (pending, on hold), a red
 * warning is refused. Every price that isn't live is faded. The tooltip
 * has the rest.
 */
function cellState(
  l: MarketListing,
  /** Market price minus your DomBot BIN price; 0 when equal or unknown. */
  diff: number,
): { icon: LucideIcon; className: string; label: string; faded: boolean } {
  const quiet = 'text-muted-foreground';
  if (l.status === 'rejected')
    return {
      icon: TriangleAlert,
      className: 'text-destructive',
      label: 'Rejected',
      faded: true,
    };
  if (l.status === 'pending' || l.status === 'on_hold')
    return {
      icon: Clock,
      className: 'text-muted-foreground',
      label: STATUS_LABEL[l.status],
      faded: true,
    };
  if (l.status === 'inactive')
    return {
      icon: EyeOff,
      className: quiet,
      label: 'Inactive',
      faded: true,
    };
  if (l.status === 'sold')
    return {
      icon: CircleDollarSign,
      className: quiet,
      label: 'Sold',
      faded: true,
    };
  if (l.status === 'unknown')
    return {
      icon: CircleHelp,
      className: quiet,
      label: 'Unknown',
      faded: true,
    };
  if (!l.forSale)
    return { icon: EyeOff, className: quiet, label: 'Hidden', faded: true };
  if (diff)
    return {
      icon: diff > 0 ? CircleArrowUp : CircleArrowDown,
      className: 'text-amber-600 dark:text-amber-400',
      label: diff > 0 ? 'Above your price' : 'Below your price',
      faded: false,
    };
  return {
    icon: CircleCheck,
    className: 'text-brand/70',
    label: 'Active',
    faded: false,
  };
}

/** A listing's price minus your DomBot BIN price; 0 when equal or unknown. */
function priceDiff(l: MarketListing, mine: ListPrice | undefined): number {
  return mine?.amount != null && l.price != null && mine.currency === l.currency
    ? Number(l.price) - Number(mine.amount)
    : 0;
}

function describe(
  l: MarketListing,
  markets: MarketInfo[],
  money: (amount: string) => string,
): string {
  const parts = [`${marketName(markets, l.market)}: ${STATUS_LABEL[l.status]}`];
  if (l.tier) parts.push(`${l.tier[0].toUpperCase()}${l.tier.slice(1)}`);
  if (!l.forSale) parts.push('hidden');
  if (l.price) parts.push(`${money(l.price)} Buy Now`);
  if (l.minOffer) parts.push(`${money(l.minOffer)} min offer`);
  if (l.floor) parts.push(`${money(l.floor)} floor`);
  if (l.discount) {
    parts.push(
      `${money(l.discount.amount)} off${l.discount.until ? ` until ${l.discount.until}` : ''}`,
    );
  }
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
  onEditListing,
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
  /** Opens one market's listing of a name, to edit or list it there. */
  onEditListing?: (domain: Domain, market: string) => void;
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
    tooltip?: string,
    /** Breaks ties in the sort; a smaller number than any count. */
    then?: (d: Domain) => number | undefined,
  ): PurchaseColumn => ({
    key,
    label,
    tooltip,
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
    sortValue: (d) => {
      const n = valueOf(d);
      return n === undefined ? null : n + (then?.(d) ?? 0) / 1e9;
    },
  });

  // One market's column: its price (or "Offers"), a status dot, and the
  // status when it isn't active. A name can only be in one account per
  // market, so there's at most one listing here. A click opens that
  // listing's editor, or lists the name there.
  const listingColumn = (market: string): PurchaseColumn => {
    const on = (d: Domain) => of(d).find((l) => l.market === market);
    const listingCell = (d: Domain) => {
      const l = on(d);
      if (!l) return onEditListing ? <EditableEmpty /> : dash;
      // Compare with the asking price you set in DomBot.
      const mine = listPrices[toAscii(d.domainName)];
      const diff = priceDiff(l, mine);
      const state = cellState(l, diff);
      const title = [
        describe(l, markets, (a) => money(a, l.currency)),
        diff &&
          `${money(String(Math.abs(diff)), l.currency)} ${diff > 0 ? 'above' : 'below'} your DomBot BIN price of ${money(mine!.amount!, mine!.currency)}`,
      ]
        .filter(Boolean)
        .join('\n');
      const Icon = state.icon;
      return (
        <span
          className="flex w-full items-center justify-between gap-2 whitespace-nowrap"
          title={title}
        >
          <Icon
            aria-label={state.label}
            className={cn(
              'size-4 shrink-0',
              state.className,
              // Grey icons dim with their price; red stays red.
              state.faded && l.status !== 'rejected' && 'opacity-50',
            )}
            strokeWidth={1.75}
          />
          <span
            className={cn(
              'text-[13px] text-muted-foreground tabular-nums compact:text-[11px]',
              EDITABLE_VALUE,
              state.faded && 'opacity-50',
            )}
          >
            {l.price ? money(l.price, l.currency) : 'Offers'}
          </span>
        </span>
      );
    };
    return {
      key: listingColumnKey(market),
      label: marketName(markets, market),
      align: 'right',
      // Shown on phones too: they're what Listings is for.
      render: (d) => {
        const cell = listingCell(d);
        if (!onEditListing) return cell;
        return (
          <PurchaseCell
            domain={d}
            onEdit={(domain) => onEditListing(domain, market)}
            align="right"
            empty={!on(d)}
            editLabel={`${marketName(markets, market)} listing`}
          >
            {cell}
          </PurchaseCell>
        );
      },
      // By price; an offers-only listing sorts below priced ones.
      sortValue: (d) => {
        const l = on(d);
        return l ? (l.price ? Number(l.price) : 0) : null;
      },
    };
  };

  // Owned's one market column: every connected market's logo, always in
  // the same order, coloured as its listing cell's icon would be, or dim
  // where the name isn't listed. Each logo is a button that opens that
  // market's listing editor (or lists the name there); its tooltip says
  // what that market has.
  const listed: PurchaseColumn = {
    key: 'listed',
    label: 'Listed',
    hideOnMobile: true,
    render: (d) => {
      const mine = listPrices[toAscii(d.domainName)];
      const slots = listingMarkets.map((m) => ({
        market: m,
        listing: of(d).find((l) => l.market === m),
      }));
      return (
        <span className="flex items-center gap-0.5">
          {slots.map(({ market, listing }) => {
            const state =
              listing && cellState(listing, priceDiff(listing, mine));
            const name = marketName(markets, market);
            const logo = (
              <MarketLogo
                market={market}
                label={`${name}: ${state?.label ?? 'Not listed'}`}
                className={cn(
                  'size-4',
                  !state
                    ? 'text-muted-foreground/30'
                    : [
                        state.className,
                        state.faded &&
                          listing.status !== 'rejected' &&
                          'opacity-50',
                      ],
                )}
              />
            );
            const title = listing
              ? describe(listing, markets, (a) => money(a, listing.currency))
              : `${name}: Not listed`;
            if (!onEditListing)
              return (
                <span key={market} className="p-0.5" title={title}>
                  {logo}
                </span>
              );
            return (
              <button
                key={market}
                type="button"
                data-cell-action
                title={`${title}\nClick to ${listing ? 'edit the listing' : `list it on ${name}`}`}
                aria-label={`${listing ? 'Edit' : 'Add'} ${name} listing for ${d.domainName}`}
                className="cursor-pointer rounded-sm p-0.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => onEditListing(d, market)}
              >
                {logo}
              </button>
            );
          })}
        </span>
      );
    },
    // Most markets selling it first.
    sortValue: (d) => {
      const n = of(d).filter((l) => listingMarkets.includes(l.market));
      if (!n.length) return null;
      return (
        n.filter((l) => l.status === 'active' && l.forSale).length +
        n.length / 100
      );
    },
  };

  return [
    listed,
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
    // Interest over the last 12 months: sort by Leads, then Views, for the
    // names buyers look at most.
    count('views', 'Views', (d) => traffic[toAscii(d.domainName)]?.views365),
    count(
      'leads',
      'Leads',
      (d) => traffic[toAscii(d.domainName)]?.leads365,
      undefined,
      (d) => traffic[toAscii(d.domainName)]?.views365,
    ),
    count(
      'searches',
      'Searches',
      (d) => {
        const n = of(d)
          .map((l) => searchesOf(l)?.total.days365)
          .filter((x): x is number => x != null);
        return n.length ? Math.max(...n) : undefined;
      },
      'Searches for the name on GoDaddy over the last 12 months. Afternic sends these only to Discount Domain Club Domain Pro members.',
    ),
  ];
}
