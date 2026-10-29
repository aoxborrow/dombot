import type { ListPrice } from './ipc';
import type { MarketListing } from './markets';

// The Domains Markets filter (docs/markets.md, "Domains table and actions"):
// which markets, then what a listing there is like. Every condition applies
// to one listing at a time, and a name matches when any market in play has a
// listing that meets them all; "Not listed" matches a market in play that
// has no listing for the name. Pure, so the table and its counts agree.

/** A listing's state, grouped as the table's icons group them. */
export type MarketState = 'active' | 'pending' | 'inactive' | 'rejected';
/** A state, or no listing on that market. */
export type MarketStateChoice = MarketState | 'none';
export const MARKET_STATE_CHOICES: readonly MarketStateChoice[] = [
  'active',
  'pending',
  'inactive',
  'rejected',
  'none',
];

/** A market price against your DomBot BIN price. */
export type PriceComparison = 'above' | 'below' | 'same';
export const PRICE_COMPARISONS: readonly PriceComparison[] = [
  'above',
  'below',
  'same',
];

export interface MarketFilter {
  /** The markets in play; empty means all of them. */
  markets: string[];
  states: MarketStateChoice[];
  comparisons: PriceComparison[];
  /** Bounds on the market's price, in `currency`; null is unbounded. */
  min: number | null;
  max: number | null;
  currency: string;
}

/**
 * The group a listing's state falls in: live (active), the market's to change
 * (pending, on hold), yours (inactive, hidden), or refused. Sold and unknown
 * listings are in none of them.
 */
export function marketState(l: MarketListing): MarketState | null {
  if (l.status === 'rejected') return 'rejected';
  if (l.status === 'pending' || l.status === 'on_hold') return 'pending';
  if (l.status === 'inactive') return 'inactive';
  if (l.status === 'active') return l.forSale ? 'active' : 'inactive';
  return null;
}

/** How a listing's price compares with your DomBot BIN price, when both are set. */
export function priceComparison(
  l: MarketListing,
  mine: ListPrice | undefined,
): PriceComparison | null {
  if (mine?.amount == null || l.price == null || mine.currency !== l.currency)
    return null;
  const diff = Number(l.price) - Number(mine.amount);
  return diff > 0 ? 'above' : diff < 0 ? 'below' : 'same';
}

/** Whether the filter narrows anything. */
export function isMarketFilterSet(f: MarketFilter): boolean {
  return (
    f.markets.length > 0 ||
    f.states.length > 0 ||
    f.comparisons.length > 0 ||
    f.min !== null ||
    f.max !== null
  );
}

/** Whether one listing meets the listing conditions. */
function listingMatches(
  l: MarketListing,
  mine: ListPrice | undefined,
  f: MarketFilter,
): boolean {
  const states = f.states.filter((s) => s !== 'none');
  // Only "Not listed" picked: a listing is the opposite.
  if (f.states.length > 0 && states.length === 0) return false;
  if (states.length > 0) {
    const state = marketState(l);
    if (!state || !states.includes(state)) return false;
  }
  if (f.comparisons.length > 0) {
    const c = priceComparison(l, mine);
    if (!c || !f.comparisons.includes(c)) return false;
  }
  if (f.min !== null || f.max !== null) {
    if (l.price == null || l.currency !== f.currency) return false;
    const price = Number(l.price);
    if (f.min !== null && price < f.min) return false;
    if (f.max !== null && price > f.max) return false;
  }
  return true;
}

/**
 * Whether a name passes: some market in play has a listing for it that meets
 * every condition, or has none while "Not listed" is picked.
 */
export function matchesMarketFilter(
  listings: readonly MarketListing[] | undefined,
  mine: ListPrice | undefined,
  f: MarketFilter,
  allMarkets: readonly string[],
): boolean {
  const markets = f.markets.length ? f.markets : allMarkets;
  return markets.some((market) => {
    const l = listings?.find((x) => x.market === market);
    if (!l) return f.states.includes('none');
    return listingMatches(l, mine, f);
  });
}
