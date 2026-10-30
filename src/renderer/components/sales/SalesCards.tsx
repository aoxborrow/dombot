import { useMemo } from 'react';
import {
  ArrowRightLeft,
  BadgeDollarSign,
  CircleDollarSign,
  Coins,
  Hand,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { saleTotals, type SaleRecord } from '../../../shared/sales';
import { cn } from '@/lib/utils';
import { compactMoney } from '../../lib/renewals';
import { isPending } from '../../lib/sales';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Sales table: the sales the view and filters leave,
// added up, so a filter on market, TLD, registrar or date shows that
// slice's totals. In the table's column order: how many, gross (with the
// average), net (with how many lack fees), profit (with ROI), then fees
// (their share of the price) as a fifth from 1200px; holding time stays in the
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
  const { t, others, pending, waiting, value, expected } = useMemo(() => {
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
      // What you'd be paid: each net (price less fees), where the fees
      // are known; how many aren't.
      expected: rows.reduce(
        (e, r) => {
          if (r.price === null || r.currency !== main?.currency) return e;
          const net =
            r.net ??
            (r.fees === null ? null : Number(r.price) - Number(r.fees));
          return net === null
            ? { ...e, unknown: e.unknown + 1 }
            : { ...e, net: e.net + Number(net) };
        },
        { net: 0, unknown: 0 },
      ),
    };
  }, [rows]);
  const c = t?.currency ?? null;
  const dash = '—';
  // Fees over what the buyers paid for the sales with both known.
  const feeTotal = t?.feesCount ? Number(t.fees) : 0;
  const feeShare =
    t?.netCount && feeTotal
      ? Math.round((feeTotal / (feeTotal + Number(t.net))) * 100)
      : null;

  return (
    <StatCardRow
      fifthAt={pendingView ? undefined : 2}
      note={
        <>
          Totals for the filtered data below, in {c ?? 'one currency'}.
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
        label={pendingView ? 'Pending sales' : 'Sales'}
        // Finished and under way; cancelled ones aren't sales.
        value={[
          {
            value: ((t?.sold ?? 0) + (t?.inProgress ?? 0)).toLocaleString(),
            unit:
              !pendingView && pending > 0 ? `${pending} pending` : undefined,
          },
        ]}
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
          value={[
            {
              value: t?.grossCount ? money(t.gross, c)! : dash,
              // With Fees beside it (from 1200px), the average; without,
              // the fees, so four cards still show them.
              unit: (
                <>
                  {t?.feesCount && c ? (
                    <span className="wide:hidden">
                      {compactMoney(feeTotal, c)} fees
                    </span>
                  ) : null}
                  {t?.average && c ? (
                    <span className={cn(t?.feesCount ? 'max-wide:hidden' : '')}>
                      {compactMoney(Number(t.average), c)} avg
                    </span>
                  ) : null}
                </>
              ),
            },
          ]}
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
          value={[
            {
              value: t?.netCount ? money(t.net, c)! : dash,
              // What the buyers paid that you kept.
              unit:
                feeShare === null ? undefined : `${100 - feeShare}% of price`,
            },
          ]}
        />
      )}
      {!pendingView && (
        <StatCard
          size="sm"
          icon={TrendingUp}
          accentClass="text-rose-500"
          label="Profit"
          value={[
            {
              value: t?.profitCount ? money(t.profit, c)! : dash,
              unit:
                t?.profitCount && t.roi !== null
                  ? `${Math.round(t.roi * 100).toLocaleString()}% ROI`
                  : undefined,
            },
          ]}
        />
      )}
      {/* The fifth card, from 1200px, between Gross and Net (fifthAt). */}
      {!pendingView && (
        <StatCard
          size="sm"
          icon={Coins}
          accentClass="text-amber-500"
          label="Fees"
          value={[
            {
              value: t?.feesCount ? money(t.fees, c)! : dash,
              unit:
                t && t.feesCount < t.sold
                  ? `${t.sold - t.feesCount} missing`
                  : feeShare === null
                    ? undefined
                    : `${feeShare}% of price`,
            },
          ]}
        />
      )}
      {pendingView && (
        <StatCard
          size="sm"
          icon={CircleDollarSign}
          accentClass="text-brand-500"
          label="Expected net"
          value={[
            {
              value: c && value ? money(expected.net.toFixed(2), c)! : dash,
              unit: expected.unknown
                ? `${expected.unknown} without fees`
                : undefined,
            },
          ]}
        />
      )}
    </StatCardRow>
  );
}
