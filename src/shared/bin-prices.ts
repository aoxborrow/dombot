import type { BinPrice } from './ipc';
import { toCurrencyCode } from './currencies';
import { parseCanonicalAmount } from './money';

// Your asking price for a name (docs/domain-import-export.md, "Asking price
// is a core feature"): the price, an optional minimum offer and floor, and
// one currency for all three. Shared so the service, the bundle import, and
// later the CSV import check a price the same way.

/** The amounts of an asking price as typed or imported (canonical decimals). */
export interface BinPriceFields {
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
export function toBinPrice(
  fields: BinPriceFields,
  updatedAt: number,
): BinPrice | null {
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
export function sameBinPrice(
  a: BinPrice | null | undefined,
  b: BinPrice | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.amount === b.amount &&
    (a.minOffer ?? null) === (b.minOffer ?? null) &&
    (a.floor ?? null) === (b.floor ?? null) &&
    a.currency === b.currency
  );
}
