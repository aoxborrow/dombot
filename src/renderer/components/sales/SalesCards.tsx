import { useMemo } from 'react';
import {
  ArrowRightLeft,
  BadgeDollarSign,
  CircleDollarSign,
  Hand,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import type { ExchangeRates } from '../../../shared/exchange-rates';
import { recordIn, saleTotalsIn, type SaleRecord } from '../../../shared/sales';
import { isPending } from '../../lib/sales';
import { StatCard, StatCardRow } from '../StatCard';

// The cards above the Sales table: the sales the view and filters leave,
// added up, so a filter on market, TLD, registrar or date shows that
// slice's totals. In the table's column order: how many, gross (with the
// average), net (with fees), profit (with ROI); holding time stays in the
// table. All in one currency, your preferred one (or the one the Currency
// filter picks): a sale in another is converted at its month's average
// (docs/exchange-rates.md), and the line under the cards says how many
// were, and which sales DomBot couldn't convert and left out.
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
  const { t, pending, waiting, value } = useMemo(() => {
    return {
      t: saleTotalsIn(rows, currency, fx),
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
      value: rows.reduce((n, r) => {
        const price = recordIn(r, currency, fx)?.record.price;
        return price ? n + Number(price) : n;
      }, 0),
    };
  }, [rows, currency, fx]);
  const c = currency;
  // Only a partial figure says how many sales it covers.
  const of = (count: number, what: string) =>
    count < t.sold ? `${count} of ${t.sold} ${what}` : null;
  const hint = (...parts: (string | null | false | 0 | undefined)[]) =>
    parts.filter(Boolean).join(' · ') || BLANK;
  const dash = '—';

  return (
    <StatCardRow
      note={
        <>
          Totals for the table below, in {c}.
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
        icon={BadgeDollarSign}
        accentClass="text-violet-500"
        label="Sales"
        // Finished and under way; cancelled ones aren't sales.
        value={(t.sold + t.inProgress).toLocaleString()}
        // The Pending view's cards are a label and a number, so both
        // are bigger.
        hint={
          pendingView
            ? undefined
            : hint(
                pending > 0 && `${pending} pending`,
                t.cancelled && `${t.cancelled} cancelled`,
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
          value={t.grossCount ? money(t.gross, c)! : dash}
          hint={hint(t.average && `${money(t.average, c)} avg`)}
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
          value={t.netCount ? money(t.net, c)! : dash}
          hint={hint(
            t.feesCount && `${money(t.fees, c)} fees`,
            of(t.netCount, 'known'),
          )}
        />
      )}
      {!pendingView && (
        <StatCard
          size="sm"
          icon={TrendingUp}
          accentClass="text-rose-500"
          label="Profit"
          value={t.profitCount ? money(t.profit, c)! : dash}
          hint={hint(
            t.profitCount &&
              t.roi !== null &&
              `${Math.round(t.roi * 100).toLocaleString()}% ROI`,
            of(t.profitCount, 'with a cost'),
          )}
        />
      )}
    </StatCardRow>
  );
}
