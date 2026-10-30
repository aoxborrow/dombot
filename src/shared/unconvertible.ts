import { isRateCurrency } from './currencies';
import { DomainEventType, type DomainEvent } from './domain-events';
import { toAscii } from './domain-name';
import type { ListPrice, RenewalPricing } from './ipc';

// Amounts saved in a currency outside the 30 DomBot converts, from before it
// limited entry to them (docs/exchange-rates.md). They're kept and shown as
// recorded, but totals can't include them, so the bell lists them for you to
// change. Derived from what's stored, never stored itself.

export type UnconvertibleKind =
  'purchase' | 'sale' | 'asking price' | 'renewal price';

export interface UnconvertibleAmount {
  /** `toAscii` name. */
  domain: string;
  kind: UnconvertibleKind;
  currency: string;
}

const EVENT_KINDS: Partial<Record<DomainEventType, UnconvertibleKind>> = {
  [DomainEventType.Registered]: 'purchase',
  [DomainEventType.Purchased]: 'purchase',
  [DomainEventType.Sold]: 'sale',
};

/**
 * Every purchase, sale, asking price and manual renewal price in a currency
 * DomBot can't convert, one per name and kind, by name. Renewal prices a
 * registrar reports aren't yours to change, so only manual ones count.
 */
export function unconvertibleAmounts(
  events: readonly DomainEvent[],
  listPrices: Record<string, ListPrice>,
  pricing: Record<string, RenewalPricing>,
): UnconvertibleAmount[] {
  const found = new Map<string, UnconvertibleAmount>();
  const add = (domain: string, kind: UnconvertibleKind, currency: string) => {
    if (!isRateCurrency(currency))
      found.set(`${domain}\n${kind}`, { domain, kind, currency });
  };
  for (const e of events) {
    const kind = EVENT_KINDS[e.type];
    if (kind && e.amount && e.currency) add(e.domain, kind, e.currency);
  }
  for (const [domain, price] of Object.entries(listPrices))
    add(domain, 'asking price', price.currency);
  for (const p of Object.values(pricing))
    if (p.source === 'manual' && p.renewal !== null)
      add(toAscii(p.domain), 'renewal price', p.currency);
  return [...found.values()].sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.kind.localeCompare(b.kind),
  );
}
