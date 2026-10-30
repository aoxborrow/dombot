import { useMemo } from 'react';
import { BadgeDollarSign, Receipt, TrendingUp } from 'lucide-react';
import { saleTotals, type SaleRecord } from '../../../shared/sales';
import { isPending } from '../../lib/sales';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Sales table: the filtered sales added up, so a filter
// on market, TLD, registrar or date shows that slice's totals. Three cards:
// how many sales, what they brought in (the average and fees under it), and
// the profit (with ROI). Net and holding time stay in the table. One
// currency at a time: amounts are never converted or combined. The line
// under the cards is the one place that says so; a card's own hint is only
// for what it can't cover.

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "45 days", "8 months", "2.4 years". */
export function heldFor(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

// A blank hint keeps the cards the same height.
const BLANK = '\u00a0';

export function SalesCards({
  rows,
  money,
}: {
  /** The sales the table shows. */
  rows: readonly SaleRecord[];
  money: (amount: string | null, currency: string | null) => string | null;
}) {
  const { t, others, pending } = useMemo(() => {
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
      pending: rows.filter(isPending).length,
    };
  }, [rows]);
  const c = t?.currency ?? null;
  // Only a partial figure says how many sales it covers.
  const of = (count: number, what: string) =>
    t && count < t.sold ? `${count} of ${t.sold} ${what}` : null;
  const hint = (...parts: (string | null | false | 0 | undefined)[]) =>
    parts.filter(Boolean).join(' · ') || BLANK;
  const dash = '—';

  return (
    <StatCardRow
      note={
        <>
          Totals of the sales in the table below, as filtered
          {c ? `, in ${c}` : ''}.
          {others.length > 0 &&
            ` ${others
              .map((o) => `${plural(o.count, 'sale')} in ${o.currency}`)
              .join(', ')} left out; filter by Currency to see ${
              others.length === 1 && others[0].count === 1 ? 'it' : 'them'
            }.`}
        </>
      }
    >
      <StatCard
        size="sm"
        icon={BadgeDollarSign}
        accentClass="text-violet-500"
        label="Sales"
        // Finished and under way; cancelled ones aren't sales.
        value={((t?.sold ?? 0) + (t?.inProgress ?? 0)).toLocaleString()}
        hint={hint(
          pending > 0 && `${pending} pending`,
          t?.cancelled && `${t.cancelled} cancelled`,
        )}
      />
      <StatCard
        size="sm"
        icon={Receipt}
        accentClass="text-sky-500"
        label="Gross"
        value={t?.grossCount ? money(t.gross, c)! : dash}
        hint={hint(
          t?.average && `${money(t.average, c)} avg`,
          t?.feesCount && `${money(t.fees, c)} fees`,
        )}
      />
      <StatCard
        size="sm"
        icon={TrendingUp}
        accentClass="text-rose-500"
        label="Profit"
        value={t?.profitCount ? money(t.profit, c)! : dash}
        hint={hint(
          t?.profitCount &&
            t.roi !== null &&
            `${Math.round(t.roi * 100).toLocaleString()}% ROI`,
          of(t?.profitCount ?? 0, 'with a cost'),
        )}
      />
    </StatCardRow>
  );
}
