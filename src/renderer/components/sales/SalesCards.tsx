import { useMemo } from 'react';
import {
  ArrowRightLeft,
  BadgeDollarSign,
  CircleDollarSign,
  Hand,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { saleTotals, type SaleRecord } from '../../../shared/sales';
import { isPending } from '../../lib/sales';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Sales table: the sales the view and filters leave,
// added up, so a filter on market, TLD, registrar or date shows that
// slice's totals. In the table's column order: how many, gross (with the
// average), net (with fees), profit (with ROI); holding time stays in the
// table. One currency at a time: amounts are never converted or combined,
// and a line under the cards says which sales another currency leaves out.
// The Pending view swaps net and profit (nothing's paid yet) for what the
// pending sales wait on: you, or the transfer.

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
  pendingView,
  money,
}: {
  /** The sales the table shows. */
  rows: readonly SaleRecord[];
  /** The Pending view: only unfinished sales. */
  pendingView: boolean;
  money: (amount: string | null, currency: string | null) => string | null;
}) {
  const { t, others, pending, waiting, value } = useMemo(() => {
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
      // What a pending sale waits on: you (a code or payee details for
      // the market), or the name moving to the buyer.
      waiting: {
        authCode: rows.filter((r) => r.step === 'auth_code').length,
        payee: rows.filter((r) => r.step === 'payee_details').length,
        market: rows.filter((r) => r.step === 'transfer').length,
        held: rows.filter((r) => r.awaitingTransfer).length,
      },
      // A pending sale's price, finished or not, in the main currency.
      value: rows
        .filter((r) => r.price !== null && r.currency === main?.currency)
        .reduce((n, r) => n + Number(r.price), 0),
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
    <div className="flex flex-col gap-1">
      <StatCardRow>
        <StatCard
          size="sm"
          icon={BadgeDollarSign}
          accentClass="text-violet-500"
          label="Sales"
          // Finished and under way; cancelled ones aren't sales.
          value={((t?.sold ?? 0) + (t?.inProgress ?? 0)).toLocaleString()}
          // The Pending view's cards are a label and a number, so both
          // are bigger.
          hint={
            pendingView
              ? undefined
              : hint(
                  pending > 0 && `${pending} pending`,
                  t?.cancelled && `${t.cancelled} cancelled`,
                )
          }
        />
        {pendingView ? (
          // Gross counts finished sales; most pending ones aren't yet.
          <StatCard
            size="sm"
            icon={Receipt}
            accentClass="text-sky-500"
            label="Value"
            value={value && c ? money(value.toFixed(2), c)! : dash}
          />
        ) : (
          <StatCard
            size="sm"
            icon={Receipt}
            accentClass="text-sky-500"
            label="Gross"
            value={t?.grossCount ? money(t.gross, c)! : dash}
            hint={hint(t?.average && `${money(t.average, c)} avg`)}
          />
        )}
        {pendingView && (
          <StatCard
            size="sm"
            icon={Hand}
            accentClass="text-amber-500"
            label="Needs action"
            // An auth code or payee details for the market.
            value={(waiting.authCode + waiting.payee).toLocaleString()}
          />
        )}
        {pendingView && (
          <StatCard
            size="sm"
            icon={ArrowRightLeft}
            accentClass="text-sky-500"
            label="Awaiting transfer"
            // At the market, or a name still in your account.
            value={(waiting.market + waiting.held).toLocaleString()}
          />
        )}
        {!pendingView && (
          <StatCard
            size="sm"
            icon={CircleDollarSign}
            accentClass="text-brand-500"
            label="Net"
            value={t?.netCount ? money(t.net, c)! : dash}
            hint={hint(
              t?.feesCount && `${money(t.fees, c)} fees`,
              of(t?.netCount ?? 0, 'known'),
            )}
          />
        )}
        {!pendingView && (
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
        )}
      </StatCardRow>
      {others.length > 0 && (
        // Quiet, on the right: a footnote to the cards.
        <p className="text-right text-[11px] text-muted-foreground/40 sm:text-xs">
          In {c}.{' '}
          {others
            .map((o) => `${plural(o.count, 'sale')} in ${o.currency}`)
            .join(', ')}{' '}
          left out; filter by Currency to see{' '}
          {others.length === 1 && others[0].count === 1 ? 'it' : 'them'}.
        </p>
      )}
    </div>
  );
}
