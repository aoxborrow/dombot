import { useMemo } from 'react';
import { BadgeDollarSign, CircleDollarSign, Eye, Store } from 'lucide-react';
import { localDay } from '../../../shared/domain-events';
import { marketState } from '../../../shared/market-filter';
import { sellThrough } from '../../../shared/market-reports';
import type { MarketListing, MarketStatsDay } from '../../../shared/markets';
import { formatMoney, type NumberFormatId } from '../../../shared/money';
import {
  filterSaleRecords,
  NO_SALE_FILTER,
  saleTotals,
  type SaleRecord,
} from '../../../shared/sales';
import { StatCard } from '../StatCard';

// The small cards above the Owned table (docs/sales-tab.md, "Domains"):
// what's listed, what sold and what it netted over 12 months (every sale,
// private ones too), and the last 30 days' views. Shown once a market account
// is connected or a sale exists.

const DAY = 86_400_000;
const daysAgo = (today: string, n: number) =>
  new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function DomainsSummary({
  listings,
  owned,
  sales,
  accountDays,
  preferredCurrency,
  numberFormat,
  onListed,
}: {
  listings: Record<string, MarketListing[]>;
  /** Names you own (the Owned view), by `toAscii`. */
  owned: ReadonlySet<string>;
  /** Every sale record (src/shared/sales.ts). */
  sales: readonly SaleRecord[];
  accountDays: readonly MarketStatsDay[];
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  /** Sets the Markets filter to the listed names. */
  onListed: () => void;
}) {
  const today = localDay();
  const all = useMemo(() => Object.values(listings).flat(), [listings]);
  // What the Listed card's click shows: names you own with a listing in
  // one of the Markets filter's states (not sold or unknown).
  const listed = useMemo(() => {
    const live = [...owned].flatMap((name) =>
      (listings[name] ?? []).filter((l) => marketState(l) !== null),
    );
    return {
      names: new Set(live.map((l) => l.name)).size,
      markets: new Set(live.map((l) => l.market)).size,
    };
  }, [listings, owned]);
  const through = useMemo(
    () => sellThrough(sales, all, today),
    [sales, all, today],
  );
  // Net over 12 months in the currency most sales were in: amounts in two
  // currencies are never added together.
  const year = useMemo(() => {
    const { records } = filterSaleRecords(sales, {
      ...NO_SALE_FILTER,
      from: daysAgo(today, 365),
    });
    const totals = saleTotals(records).filter((t) => t.currency && t.sold);
    return {
      main: totals[0] ?? null,
      others: Math.max(0, totals.length - 1),
    };
  }, [sales, today]);
  const last30 = useMemo(() => {
    const since = daysAgo(today, 30);
    const days = accountDays.filter((d) => d.date > since);
    return {
      views: days.reduce((n, d) => n + (d.views ?? 0), 0),
      leads: days.reduce((n, d) => n + (d.leads ?? 0), 0),
    };
  }, [accountDays, today]);
  const main = year.main;
  const money = (amount: string) =>
    formatMoney(
      amount,
      main?.currency ?? preferredCurrency,
      preferredCurrency,
      numberFormat,
      true,
    );

  return (
    <div className="hidden grid-cols-2 gap-2.5 sm:grid lg:grid-cols-4">
      <StatCard
        size="sm"
        icon={Store}
        accentClass="text-blue-500"
        label="Listed"
        value={listed.names.toLocaleString()}
        hint={`On ${plural(listed.markets, 'market')}`}
        onClick={onListed}
      />
      <StatCard
        size="sm"
        icon={BadgeDollarSign}
        accentClass="text-violet-500"
        label="Sold, last 12 months"
        to="/sales"
        value={through.sold.toLocaleString()}
        hint={
          through.rate === null
            ? 'Nothing listed'
            : `${(through.rate * 100).toFixed(1)}% sell-through`
        }
      />
      <StatCard
        size="sm"
        icon={CircleDollarSign}
        accentClass="text-brand-500"
        label="Net, last 12 months"
        to="/sales?view=sales"
        // Net is unknown until a sale's fees are.
        value={main?.netCount ? money(main.net) : '—'}
        hint={
          main
            ? [
                // Net is known only where fees are.
                main.netCount < main.sold
                  ? `${main.netCount} of ${plural(main.sold, 'sale')}`
                  : plural(main.sold, 'sale'),
                `${money(main.gross)} gross`,
                year.others &&
                  `+${year.others} other ${year.others === 1 ? 'currency' : 'currencies'}`,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'No sales yet'
        }
      />
      <StatCard
        size="sm"
        icon={Eye}
        accentClass="text-amber-500"
        label="Views, last 30 days"
        value={last30.views.toLocaleString()}
        hint={plural(last30.leads, 'lead')}
      />
    </div>
  );
}
