import { useMemo } from 'react';
import {
  BadgeDollarSign,
  ChartNoAxesColumn,
  CircleDollarSign,
  Hourglass,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { saleTotals, type SaleRecord } from '../../../shared/sales';
import { StatCard } from '../StatCard';

// The cards above the Sales table: the filtered sales added up, so a filter
// on market, TLD, registrar or date shows that slice's totals. One currency
// at a time: amounts are never converted or combined, so with several the
// cards show the one most sales were in and say so.

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "45 days", "8 months", "2.4 years". */
export function heldFor(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

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
      others: totals.filter((x) => x !== main).map((x) => x.currency),
    };
  }, [rows]);
  const c = t?.currency ?? null;
  // Partial figures say how many sales they cover.
  const of = (count: number, what: string) =>
    t && count < t.sold ? `${count} of ${t.sold} ${what}` : null;
  const dash = '—';

  return (
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
            others.length && `${c} only; also ${others.join(', ')}`,
          ]
            .filter(Boolean)
            .join(' · ') || 'Completed sales'
        }
      />
      <StatCard
        size="sm"
        icon={Receipt}
        accentClass="text-sky-500"
        label="Gross"
        value={t?.grossCount ? money(t.gross, c)! : dash}
        hint={
          t?.feesCount
            ? `${money(t.fees, c)} fees${of(t.feesCount, 'with fees') ? ` · ${of(t.feesCount, 'with fees')}` : ''}`
            : 'What buyers paid'
        }
      />
      <StatCard
        size="sm"
        icon={CircleDollarSign}
        accentClass="text-brand-500"
        label="Net"
        value={t?.netCount ? money(t.net, c)! : dash}
        hint={of(t?.netCount ?? 0, 'sales') ?? 'After commission and fees'}
      />
      <StatCard
        size="sm"
        icon={ChartNoAxesColumn}
        accentClass="text-amber-500"
        label="Average sale"
        value={t?.average ? money(t.average, c)! : dash}
        hint={
          t?.grossCount ? `Over ${plural(t.grossCount, 'sale')}` : 'No sales'
        }
      />
      <StatCard
        size="sm"
        icon={TrendingUp}
        accentClass="text-rose-500"
        label="Profit"
        value={t?.profitCount ? money(t.profit, c)! : dash}
        hint={
          t?.profitCount
            ? [
                t.roi !== null &&
                  `${Math.round(t.roi * 100).toLocaleString()}% ROI`,
                of(t.profitCount, 'with a cost'),
              ]
                .filter(Boolean)
                .join(' · ') || 'Net less what you paid'
            : 'Needs what you paid'
        }
      />
      <StatCard
        size="sm"
        icon={Hourglass}
        accentClass="text-orange-500"
        label="Average hold"
        value={t?.holdingDays != null ? heldFor(t.holdingDays) : dash}
        hint={
          t?.holdingCount
            ? (of(t.holdingCount, 'with dates') ?? 'Bought to sold')
            : 'Needs a purchase date'
        }
      />
    </div>
  );
}
