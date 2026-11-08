import { isRateCurrency, type CurrencyCode } from './currencies';
import type { ExchangeRates } from './exchange-rates';
import type { MarketId, MarketListing } from './markets';

// Import listed price (Domains row and bulk menus, portfolio_asking_prices_import):
// copy what a market lists a name for into DomBot's asking price, so someone
// who priced their names on a market can start pricing in DomBot and list
// from there. Shared so the dialog and the MCP tool pick the same price.

/** Where to take the price from: one market, or the highest listing. */
export type ListedPriceSource = 'highest' | MarketId;

/** The asking price a listing gives, as whole canonical amounts. */
export interface ListedPrice {
  amount: string | null;
  minOffer: string | null;
  floor: string | null;
  currency: CurrencyCode;
  /** The listing it came from. */
  market: MarketId;
  accountId: string;
}

/** A positive amount rounded to whole units, or null. */
function whole(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

/** The listing's price as an asking price, or null when it lists none. */
function fromListing(l: MarketListing): ListedPrice | null {
  // An asking price is in one of the 30 currencies DomBot converts.
  if (!isRateCurrency(l.currency)) return null;
  const amount = whole(l.price);
  let minOffer = whole(l.minOffer);
  let floor = whole(l.floor);
  // DomBot keeps both under the BIN price; one above it is dropped.
  if (amount !== null) {
    if (minOffer !== null && Number(minOffer) > Number(amount)) minOffer = null;
    if (floor !== null && Number(floor) > Number(amount)) floor = null;
  }
  if (amount === null && minOffer === null && floor === null) return null;
  return {
    amount,
    minOffer,
    floor,
    currency: l.currency,
    market: l.market,
    accountId: l.accountId,
  };
}

/** One amount in USD, for comparing listings in different currencies. */
function inUsd(
  value: string | null,
  currency: string,
  rates: ExchangeRates | undefined,
): number {
  if (value === null) return -1;
  if (currency === 'USD' || !rates) return Number(value);
  return rates.convert(value, currency, 'USD')?.amount ?? Number(value);
}

/**
 * The asking price to import from a name's listings, or null when none of
 * them (on `source`, for one market) lists a price. A sold listing doesn't
 * count. With several, the highest BIN price wins, then the highest minimum
 * offer, then the highest floor, compared in USD when `rates` is given; the
 * winner's three amounts are taken together, never mixed across listings.
 */
export function listedPriceFor(
  listings: readonly MarketListing[] | undefined,
  source: ListedPriceSource,
  rates?: ExchangeRates,
): ListedPrice | null {
  let best: ListedPrice | null = null;
  let bestKey: number[] = [];
  for (const l of listings ?? []) {
    if (l.status === 'sold') continue;
    if (source !== 'highest' && l.market !== source) continue;
    const price = fromListing(l);
    if (!price) continue;
    const key = [price.amount, price.minOffer, price.floor].map((v) =>
      inUsd(v, price.currency, rates),
    );
    const better = key.findIndex((v, i) => v !== bestKey[i]);
    if (!best || (better >= 0 && key[better] > bestKey[better])) {
      best = price;
      bestKey = key;
    }
  }
  return best;
}
