import { useMemo } from 'react';
import {
  BadgeDollarSign,
  CircleDollarSign,
  Hourglass,
  Receipt,
  Scissors,
  TrendingUp,
} from 'lucide-react';
import { saleTotals, type SaleRecord } from '../../../shared/sales';
import { StatCard } from '../StatCard';

// The cards above the Sales table: the filtered sales added up, in the
// table's column order, so a filter on market, TLD, registrar or date shows
// that slice's totals. One currency at a time: amounts are never converted
// or combined. The line under the cards is the one place that says so; a
// card's own hint is only for what it can't cover (sales without fees, or
// without a cost).

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "45 days", "8 months", "2.4 years". */
export function heldFor(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

// A blank hint keeps the cards the same height.
const BLANK = ' ';

export function SalesCards({
  rows,
  money,
}: {
  /** The sales the table shows. */
  rows: readonly SaleRecord[];
  money: (amount: string | null, currency: string | null) => string | null;
}) {
  const { t, others } = useMemo(() => {
    const totals = saleTotals(rows).filter((x) => x.currency);
    const main = totals.find((x) => x.sold) ?? totals[0] ?? null;
    return {
      t: main,
      others: totals
        .filter((x) => x !== main)
        .map((x) => ({
          currency: x.currency,
          count: x.sold + x.inProgress + x.cancelled,
        })),
    };
  }, [rows]);
  const c = t?.currency ?? null;
  // Only a partial figure says how many sales it covers.
  const of = (count: number, what: string) =>
    t && count < t.sold ? `${count} of ${t.sold} ${what}` : null;
  const dash = '—';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          size="sm"
          icon={BadgeDollarSign}
          accentClass="text-violet-500"
          label="Sold"
          value={(t?.sold ?? 0).toLocaleString()}
          hint={
            [
              t?.inProgress && `${t.inProgress} under way`,
              t?.cancelled && `${t.cancelled} cancelled`,
            ]
              .filter(Boolean)
              .join(' · ') || BLANK
          }
        />
        <StatCard
          size="sm"
          icon={Receipt}
          accentClass="text-sky-500"
          label="Gross"
          value={t?.grossCount ? money(t.gross, c)! : dash}
          hint={t?.average ? `${money(t.average, c)} average` : BLANK}
        />
        <StatCard
          size="sm"
          icon={Scissors}
          accentClass="text-amber-500"
          label="Fees"
          value={t?.feesCount ? money(t.fees, c)! : dash}
          hint={of(t?.feesCount ?? 0, 'known') ?? BLANK}
        />
        <StatCard
          size="sm"
          icon={CircleDollarSign}
          accentClass="text-brand-500"
          label="Net"
          value={t?.netCount ? money(t.net, c)! : dash}
          hint={of(t?.netCount ?? 0, 'known') ?? BLANK}
        />
        <StatCard
          size="sm"
          icon={Hourglass}
          accentClass="text-orange-500"
          label="Held, average"
          value={t?.holdingDays != null ? heldFor(t.holdingDays) : dash}
          hint={of(t?.holdingCount ?? 0, 'with dates') ?? BLANK}
        />
        <StatCard
          size="sm"
          icon={TrendingUp}
          accentClass="text-rose-500"
          label="Profit"
          value={t?.profitCount ? money(t.profit, c)! : dash}
          hint={
            [
              t?.profitCount &&
                t.roi !== null &&
                `${Math.round(t.roi * 100).toLocaleString()}% ROI`,
              of(t?.profitCount ?? 0, 'with a cost'),
            ]
              .filter(Boolean)
              .join(' · ') || BLANK
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Totals of the sales in the table below, as filtered
        {c ? `, in ${c}` : ''}.
        {others.length > 0 &&
          ` ${others
            .map((o) => `${plural(o.count, 'sale')} in ${o.currency}`)
            .join(', ')} left out; filter by Currency to see ${
            others.length === 1 && others[0].count === 1 ? 'it' : 'them'
          }.`}
      </p>
    </div>
  );
}
