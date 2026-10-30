import { useMemo } from 'react';
import { BadgeDollarSign, CircleDollarSign, Eye, Store } from 'lucide-react';
import { localDay } from '../../../shared/domain-events';
import { sellThrough } from '../../../shared/market-reports';
import type {
  MarketListing,
  MarketSale,
  MarketStatsDay,
} from '../../../shared/markets';
import { formatMoney, type NumberFormatId } from '../../../shared/money';
import { StatCard } from '../StatCard';

// The small cards above the Owned table (docs/sales-tab.md, "Domains"):
// what's listed, what sold and what it netted over 12 months, and the last
// 30 days' views. Shown once a market account is connected or a sale exists.

const DAY = 86_400_000;
const daysAgo = (today: string, n: number) =>
  new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);

const cents = (amount: string | null | undefined) =>
  amount ? Math.round(Number(amount) * 100) : 0;

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function DomainsSummary({
  listings,
  sales,
  accountDays,
  preferredCurrency,
  numberFormat,
  onListed,
}: {
  listings: Record<string, MarketListing[]>;
  sales: readonly MarketSale[];
  accountDays: readonly MarketStatsDay[];
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  /** Sets the Markets filter to the listed names. */
  onListed: () => void;
}) {
  const today = localDay();
  const all = useMemo(() => Object.values(listings).flat(), [listings]);
  const listed = useMemo(() => {
    const names = Object.entries(listings).filter(([, ls]) => ls.length > 0);
    return {
      names: names.length,
      markets: new Set(all.map((l) => l.market)).size,
    };
  }, [listings, all]);
  const through = useMemo(
    () => sellThrough(sales, all, today),
    [sales, all, today],
  );
  // Net over 12 months in the currency most sales were in: amounts in two
  // currencies are never added together.
  const year = useMemo(() => {
    const since = daysAgo(today, 365);
    const done = sales.filter(
      (s) => s.status === 'completed' && s.soldOn && s.soldOn >= since,
    );
    const byCurrency = new Map<string, MarketSale[]>();
    for (const s of done)
      (
        byCurrency.get(s.currency) ??
        byCurrency.set(s.currency, []).get(s.currency)!
      ).push(s);
    const [currency, list] = [...byCurrency].sort(
      (a, b) => b[1].length - a[1].length,
    )[0] ?? [preferredCurrency, []];
    const gross = list.reduce((n, s) => n + cents(s.price), 0);
    const net = list.reduce(
      (n, s) =>
        n +
        (s.net != null ? cents(s.net) : cents(s.price) - cents(s.commission)),
      0,
    );
    return {
      currency,
      count: list.length,
      gross: (gross / 100).toFixed(2),
      net: (net / 100).toFixed(2),
      others: byCurrency.size - (list.length ? 1 : 0),
    };
  }, [sales, today, preferredCurrency]);
  const last30 = useMemo(() => {
    const since = daysAgo(today, 30);
    const days = accountDays.filter((d) => d.date > since);
    return {
      views: days.reduce((n, d) => n + (d.views ?? 0), 0),
      leads: days.reduce((n, d) => n + (d.leads ?? 0), 0),
    };
  }, [accountDays, today]);
  const money = (amount: string) =>
    formatMoney(amount, year.currency, preferredCurrency, numberFormat, true);

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
        value={money(year.net)}
        hint={`${plural(year.count, 'sale')} · ${money(year.gross)} gross${
          year.others
            ? ` · +${year.others} other ${year.others === 1 ? 'currency' : 'currencies'}`
            : ''
        }`}
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
