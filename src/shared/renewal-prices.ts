import { toCurrencyCode, type CurrencyCode } from './currencies';
import { parseCanonicalAmount } from './money';

// Your manual yearly renewal price for a name, in any currency
// (docs/domain-import-export.md, "Renewal prices in any currency"). Shared so
// the pricing service, migration 3, and the bundle import read it one way.

/** A manual renewal price as stored in `domain-prices`. */
export interface RenewalPrice {
  /** Canonical decimal in `currency`, e.g. "18.99". */
  amount: string;
  currency: CurrencyCode;
}

/**
 * A manual renewal price in its stored form, or null when it doesn't hold. A
 * bare number is the old USD form (before schema 3 and bundle v7). A zero
 * price is no price.
 */
export function toRenewalPrice(value: unknown): RenewalPrice | null {
  let amountRaw: string;
  let currencyRaw: unknown;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    amountRaw = (Math.round(value * 100) / 100).toFixed(2);
    currencyRaw = 'USD';
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.amount !== 'string') return null;
    amountRaw = v.amount;
    currencyRaw = v.currency;
  } else {
    return null;
  }
  const currency =
    typeof currencyRaw === 'string' ? toCurrencyCode(currencyRaw) : null;
  if (!currency) return null;
  let amount: string | null;
  try {
    amount = parseCanonicalAmount(amountRaw, currency, 'Renewal price');
  } catch {
    return null;
  }
  return amount !== null && Number(amount) > 0 ? { amount, currency } : null;
}
