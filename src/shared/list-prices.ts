import type { ListPrice } from './ipc';
import { toCurrencyCode } from './currencies';
import { parseCanonicalAmount } from './money';

// Your asking price for a name (docs/domain-import-export.md, "BIN price is
// a core feature"): the price, an optional minimum offer and floor, and
// one currency for all three. Shared so the service, the bundle import, and
// later the CSV import check a price the same way.

/** The amounts of an asking price as typed or imported (canonical decimals). */
export interface ListPriceFields {
  amount: string | null | undefined;
  minOffer: string | null | undefined;
  floor: string | null | undefined;
  currency: string | null | undefined;
}

/**
 * A canonical amount as a whole number ("4850.00" → "4850"): prices are
 * whole amounts, so cents are an error. Null for blank.
 */
export function wholeAmount(
  canonical: string | null | undefined,
  label: string,
): string | null {
  if (canonical == null || canonical === '') return null;
  const [int, frac = ''] = canonical.split('.');
  if (/[1-9]/.test(frac)) throw new Error(`${label}: use a whole amount.`);
  return int.replace(/^0+(?=\d)/, '') || '0';
}

/** A whole amount, with zero read as blank (no price is a zero price). */
function amountOf(
  raw: string | null | undefined,
  currency: string,
  label: string,
): string | null {
  const parsed = wholeAmount(
    parseCanonicalAmount(raw ?? '', currency, label),
    label,
  );
  return parsed !== null && Number(parsed) > 0 ? parsed : null;
}

/**
 * The record to store for these fields, or null when every amount is blank
 * (the price is cleared). Throws when a field doesn't hold.
 */
export function toListPrice(
  fields: ListPriceFields,
  updatedAt: number,
): ListPrice | null {
  const blank = [fields.amount, fields.minOffer, fields.floor].every(
    (v) => !v?.trim(),
  );
  if (blank) return null;
  const currency = fields.currency?.trim()
    ? toCurrencyCode(fields.currency)
    : null;
  if (!currency) {
    throw new Error(
      fields.currency?.trim()
        ? `Unknown currency ${fields.currency.trim().toUpperCase()}.`
        : 'Choose a currency for the pricing.',
    );
  }
  const amount = amountOf(fields.amount, currency, 'BIN price');
  const minOffer = amountOf(fields.minOffer, currency, 'Minimum offer');
  const floor = amountOf(fields.floor, currency, 'Floor price');
  if (amount === null && minOffer === null && floor === null) return null;
  if (amount !== null) {
    if (minOffer !== null && Number(minOffer) > Number(amount)) {
      throw new Error('The minimum offer is above the BIN price.');
    }
    if (floor !== null && Number(floor) > Number(amount)) {
      throw new Error('The floor price is above the BIN price.');
    }
  }
  return {
    amount,
    ...(minOffer !== null ? { minOffer } : {}),
    ...(floor !== null ? { floor } : {}),
    currency,
    updatedAt,
  };
}

/** True when two records hold the same price (ignoring when they were set). */
export function sameListPrice(
  a: ListPrice | null | undefined,
  b: ListPrice | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.amount === b.amount &&
    (a.minOffer ?? null) === (b.minOffer ?? null) &&
    (a.floor ?? null) === (b.floor ?? null) &&
    a.currency === b.currency
  );
}

// The Pricing filter (Domains and portfolio_query): which part of an asking
// price a name has, and ranges on its BIN price, minimum offer and floor.
// "For sale" isn't stored; it's any of the three.

/** What a name's asking price holds. `none`: no amount at all. */
export type AskingKind = 'forSale' | 'bin' | 'minOffer' | 'floor' | 'none';

export const ASKING_KINDS: readonly AskingKind[] = [
  'forSale',
  'bin',
  'minOffer',
  'floor',
  'none',
];

/** Whole-amount bounds; null is unbounded. */
export interface AmountRange {
  min: number | null;
  max: number | null;
}

export interface AskingFilter {
  /** Any of these. Empty or missing doesn't filter. */
  kinds?: readonly AskingKind[];
  bin?: AmountRange;
  minOffer?: AmountRange;
  floor?: AmountRange;
  /** Ranges only match prices in this currency (amounts aren't converted). */
  currency?: string;
}

const set = (v: string | null | undefined): v is string =>
  v != null && Number(v) > 0;

/** True when the asking price has this kind. */
export function hasAskingKind(
  price: ListPrice | undefined,
  kind: AskingKind,
): boolean {
  const bin = set(price?.amount);
  const offer = set(price?.minOffer);
  const floor = set(price?.floor);
  switch (kind) {
    case 'forSale':
      return bin || offer || floor;
    case 'bin':
      return bin;
    case 'minOffer':
      return offer;
    case 'floor':
      return floor;
    case 'none':
      return !bin && !offer && !floor;
  }
}

const bounded = (r: AmountRange | undefined): r is AmountRange =>
  r != null && (r.min != null || r.max != null);

/** True when the filter sets a range. */
export function hasAskingRange(filter: AskingFilter): boolean {
  return (
    bounded(filter.bin) || bounded(filter.minOffer) || bounded(filter.floor)
  );
}

/**
 * True when a name's asking price passes the filter. A range needs that
 * amount: a name without a BIN price is outside any BIN range.
 */
export function matchesAsking(
  price: ListPrice | undefined,
  filter: AskingFilter,
): boolean {
  if (
    filter.kinds?.length &&
    !filter.kinds.some((k) => hasAskingKind(price, k))
  )
    return false;
  const within = (value: string | null | undefined, r: AmountRange) => {
    if (!set(value)) return false;
    if (filter.currency && price?.currency !== filter.currency) return false;
    const n = Number(value);
    return (r.min == null || n >= r.min) && (r.max == null || n <= r.max);
  };
  if (bounded(filter.bin) && !within(price?.amount, filter.bin)) return false;
  if (bounded(filter.minOffer) && !within(price?.minOffer, filter.minOffer))
    return false;
  if (bounded(filter.floor) && !within(price?.floor, filter.floor))
    return false;
  return true;
}
