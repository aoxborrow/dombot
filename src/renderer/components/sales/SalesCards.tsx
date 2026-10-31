import { useMemo } from 'react';
import {
  ArrowRightLeft,
  CircleDollarSign,
  Clock,
  Coins,
  Gem,
  Receipt,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import type { ExchangeRates } from '../../../shared/exchange-rates';
import { recordIn, saleTotalsIn, type SaleRecord } from '../../../shared/sales';
import { cn } from '@/lib/utils';
import { compactMoney } from '../../lib/renewals';
import { isPending } from '../../lib/sales';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Sales table: the sales the view and filters leave,
// added up, so a filter on market, TLD, registrar or date shows that
// slice's totals. In the table's column order: how many, gross (with the
// average), net (with how many lack fees), profit (with ROI), then fees
// (their share of the price) as a fifth from 1200px; holding time stays in the
// table. All in one currency, your preferred one (or the one the Currency
// filter picks): a sale in another is converted at its month's average
// (docs/exchange-rates.md), and the line under the cards says how many
// were, and which sales DomBot couldn't convert and left out.
// The Pending view swaps gross, net and profit (nothing's paid yet) for
// what the pending sales wait on, you or the transfer, then what they're
// worth: their price and, as a fifth, the net expected.

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
  currency,
  fx,
  money,
}: {
  /** The sales the table shows. */
  rows: readonly SaleRecord[];
  /** The Pending view: only unfinished sales. */
  pendingView: boolean;
  /** What the totals are in. */
  currency: string;
  fx: ExchangeRates;
  money: (amount: string | null, currency: string | null) => string | null;
}) {
  const { t, count, pending, waiting, value, expected } = useMemo(() => {
    // Each sale in `currency`; one DomBot can't convert is left out.
    const converted = rows.flatMap((r) => {
      const c = recordIn(r, currency, fx);
      return c ? [c.record] : [];
    });
    return {
      t: saleTotalsIn(rows, currency, fx),
      // Sales without a price still count as sales (the first card), just
      // not toward the money.
      count: rows.filter((r) => r.status !== 'cancelled').length,
      pending: rows.filter(isPending).length,
      // What a pending sale waits on: you (a code or payee details for
      // the market), or the name moving to the buyer.
      waiting: {
        authCode: rows.filter((r) => r.step === 'auth_code').length,
        payee: rows.filter((r) => r.step === 'payee_details').length,
        market: rows.filter((r) => r.step === 'transfer').length,
        held: rows.filter((r) => r.awaitingTransfer).length,
      },
      // A pending sale's price, finished or not.
      value: converted
        .filter((r) => r.price !== null)
        .reduce((n, r) => n + Number(r.price), 0),
      // What you'd be paid: each net (price less fees), where the fees
      // are known; how many aren't.
      expected: converted.reduce(
        (e, r) => {
          if (r.price === null) return e;
          const net =
            r.net ??
            (r.fees === null ? null : Number(r.price) - Number(r.fees));
          return net === null
            ? { ...e, unknown: e.unknown + 1 }
            : { ...e, net: e.net + Number(net), known: e.known + 1 };
        },
        { net: 0, known: 0, unknown: 0 },
      ),
    };
  }, [rows, currency, fx]);
  const c = currency;
  const dash = '—';
  // Fees over what the buyers paid for the sales with both known.
  const feeTotal = t.feesCount ? Number(t.fees) : 0;
  const feeShare =
    t.netCount && feeTotal
      ? Math.round((feeTotal / (feeTotal + Number(t.net))) * 100)
      : null;

  return (
    <StatCardRow
      fifthAt={pendingView ? undefined : 2}
      note={
        <>
          Totals for the filtered data below, in {c}.
          {t.converted > 0 &&
            ` ${plural(t.converted, 'sale')} in ${t.convertedFrom.join(', ')} converted at ${
              t.converted === 1 ? 'its' : 'each'
            } month’s average (ECB)${t.provisional ? ', or a recent rate until it’s out' : ''}.`}
          {t.leftOut.length > 0 &&
            ` ${t.leftOut
              .map((o) => `${plural(o.count, 'sale')} in ${o.currency}`)
              .join(', ')} left out: DomBot can’t convert ${
              t.leftOut.length === 1 ? 'it' : 'them'
            }.`}
        </>
      }
    >
      <StatCard
        size="sm"
        icon={pendingView ? Clock : Receipt}
        accentClass="text-violet-400"
        label={pendingView ? 'Pending sales' : 'Sales'}
        // Finished and under way; cancelled ones aren't sales.
        value={[
          {
            value: count.toLocaleString(),
            unit:
              !pendingView && pending > 0 ? `${pending} pending` : undefined,
          },
        ]}
      />
      {!pendingView && (
        <StatCard
          size="sm"
          icon={CircleDollarSign}
          accentClass="text-sky-400"
          label="Gross"
          value={[
            {
              value: t.grossCount ? money(t.gross, c)! : dash,
              // With Fees beside it (from 1200px), the average; without,
              // the fees, so four cards still show them.
              unit: (
                <>
                  {t.feesCount ? (
                    <span className="wide:hidden">
                      {compactMoney(feeTotal, c)} fees
                    </span>
                  ) : null}
                  {t.average ? (
                    <span className={cn(t.feesCount ? 'max-wide:hidden' : '')}>
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
          icon={TriangleAlert}
          accentClass="text-amber-400"
          label="Needs action"
          // An auth code or payee details for the market.
          value={(waiting.authCode + waiting.payee).toLocaleString()}
        />
      )}
      {pendingView && (
        <StatCard
          size="sm"
          icon={ArrowRightLeft}
          accentClass="text-sky-400"
          label="Awaiting transfer"
          // At the market, or a name still in your account.
          value={(waiting.market + waiting.held).toLocaleString()}
        />
      )}
      {pendingView && (
        // Gross counts finished sales; most pending ones aren't yet.
        <StatCard
          size="sm"
          icon={Gem}
          accentClass="text-sky-400"
          label="Pending value"
          value={value && c ? money(value.toFixed(2), c)! : dash}
        />
      )}
      {!pendingView && (
        <StatCard
          size="sm"
          icon={Wallet}
          accentClass="text-brand-400"
          label="Net"
          value={[
            {
              value: t.netCount ? money(t.net, c)! : dash,
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
          accentClass="text-rose-400"
          label="Profit"
          value={[
            {
              value: t.profitCount ? money(t.profit, c)! : dash,
              unit:
                t.profitCount && t.roi !== null
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
          accentClass="text-amber-400"
          label="Fees"
          value={[
            {
              value: t.feesCount ? money(t.fees, c)! : dash,
              unit:
                t.feesCount < t.sold
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
          icon={Wallet}
          accentClass="text-brand-400"
          label="Expected net"
          value={[
            {
              // Blank, not 0, when no pending sale's net is known.
              value: expected.known ? money(expected.net.toFixed(2), c)! : dash,
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
