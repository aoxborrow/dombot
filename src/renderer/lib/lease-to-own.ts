import { useEffect, useState } from 'react';

// Lease-to-own on a market listing (Afternic): on or off, and the most
// monthly payments a buyer can spread the price over. Afternic takes 2–60
// and works out each payment from the Buy Now price.

/** The months offered: 3, 6, 9, 12, then every 6 to 60. */
export const LEASE_MONTHS: readonly number[] = [
  3, 6, 9, 12, 18, 24, 30, 36, 42, 48, 54, 60,
];

/** What a new Afternic listing gets when nothing else says. */
export const DEFAULT_LEASE_MONTHS = 30;

/** The months to offer, with a listing's own value kept if it's not one. */
export function leaseMonthOptions(current: number | null): number[] {
  return current === null || LEASE_MONTHS.includes(current)
    ? [...LEASE_MONTHS]
    : [...LEASE_MONTHS, current].sort((a, b) => a - b);
}

/**
 * Afternic's commission discount on a lease, by its most payments: none to
 * 12 months, 5% to 24, 10% to 36, 15% beyond (Afternic's settings page).
 */
export function leaseCommissionDiscount(months: number): number {
  return months > 36 ? 15 : months > 24 ? 10 : months > 12 ? 5 : 0;
}

/** Each payment over `months`, in whole units; null without a price. */
export function monthlyPayment(
  price: number | null,
  months: number,
): number | null {
  return price && price > 0 ? Math.ceil(price / months) : null;
}

/** Afternic's lander for a listing (its `intakeStyle`), as people say it. */
export const LANDER_STYLES = {
  BUYNOW: 'Buy Now',
  PRICE_FORM: 'Price request',
  CUSTOM_LANDER: 'Custom',
} as const;
export type LanderStyle = keyof typeof LANDER_STYLES;

const isLanderStyle = (v: unknown): v is LanderStyle =>
  typeof v === 'string' && Object.hasOwn(LANDER_STYLES, v);

/** A market account's defaults for new listings (Afternic's settings). */
export interface LeaseDefaults {
  enabled: boolean | null;
  months: number | null;
  lander: LanderStyle | null;
}

/** The defaults from a market's listing settings (Afternic's). */
export function leaseDefaultsOf(raw: Record<string, unknown>): LeaseDefaults {
  return {
    enabled:
      typeof raw.leasingEnabled === 'boolean' ? raw.leasingEnabled : null,
    months: typeof raw.maxLeasePeriod === 'number' ? raw.maxLeasePeriod : null,
    lander: isLanderStyle(raw.intakeStyle) ? raw.intakeStyle : null,
  };
}

/**
 * The account's lease-to-own defaults, fetched from the market; null while
 * loading, when `accountId` is null, or when the market couldn't say.
 */
export function useLeaseDefaults(
  accountId: string | null,
): LeaseDefaults | null {
  const [defaults, setDefaults] = useState<{
    accountId: string;
    value: LeaseDefaults;
  } | null>(null);
  useEffect(() => {
    if (!accountId) return;
    let current = true;
    window.api
      .getMarketListingDefaults(accountId)
      .then((raw) => {
        if (current) setDefaults({ accountId, value: leaseDefaultsOf(raw) });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [accountId]);
  return defaults && defaults.accountId === accountId ? defaults.value : null;
}
