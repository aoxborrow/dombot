import type { BinPrice, BinPriceInput } from '../../shared/ipc';
import {
  assertDomainName,
  isDomainKey,
  toAscii,
} from '../../shared/domain-name';
import { sameBinPrice, toBinPrice } from '../../shared/bin-prices';
import { Namespace } from '../storage/namespace';

// Asking prices (docs/domain-import-export.md, "Prices"): what you'd sell a
// name for, keyed by `toAscii(name)` so the price follows the name between
// accounts and works the same for synced and manual names. User data: never
// cleared by "Clear cache", always exported.

export const BIN_PRICES_NAMESPACE = 'domain-bin-prices';

const prices = new Namespace<BinPrice>(BIN_PRICES_NAMESPACE);

/** Every asking price, keyed by `toAscii(name)`. */
export function getBinPrices(): Record<string, BinPrice> {
  return prices.all();
}

/**
 * Set or clear (every amount blank) many names' asking prices in one write.
 * Every input is checked before anything is written, so one bad price saves
 * nothing. A name whose price is unchanged isn't rewritten.
 */
export function setBinPrices(inputs: BinPriceInput[]): void {
  const now = Date.now();
  const writes = new Map<string, BinPrice>();
  const clears = new Set<string>();
  for (const input of inputs) {
    const key = assertDomainName(input.domainName);
    let next: BinPrice | null;
    try {
      next = toBinPrice(input, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid price.';
      throw new Error(
        inputs.length > 1 ? `${input.domainName.trim()}: ${message}` : message,
      );
    }
    if (next) {
      writes.set(key, next);
      clears.delete(key);
    } else {
      clears.add(key);
      writes.delete(key);
    }
  }
  const changed = [...writes].filter(
    ([key, next]) => !sameBinPrice(prices.get(key), next),
  );
  if (changed.length > 0) void prices.setMany(changed);
  for (const key of clears) if (prices.get(key)) void prices.delete(key);
}

/** Removes names' asking prices (Delete: nothing about the name is kept). */
export function deleteBinPrices(domains: string[]): void {
  for (const domain of domains) {
    const key = toAscii(domain);
    if (prices.get(key)) void prices.delete(key);
  }
}

/** An asking price read from a data bundle, re-checked; null when it doesn't hold. */
export function cleanBinPrice(key: string, value: unknown): BinPrice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!isDomainKey(key) || toAscii(key) !== key) return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' ? x : null);
  if (typeof v.updatedAt !== 'number') return null;
  try {
    return toBinPrice(
      {
        amount: text(v.amount),
        minOffer: text(v.minOffer),
        floor: text(v.floor),
        currency: text(v.currency),
      },
      v.updatedAt,
    );
  } catch {
    return null;
  }
}
