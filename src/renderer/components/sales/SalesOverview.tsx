import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeDollarSign,
  ChartNoAxesColumn,
  CircleCheck,
  CircleDollarSign,
  Eye,
  Percent,
  Receipt,
} from 'lucide-react';
import { toAscii, toUnicode } from '../../../shared/domain-name';
import { localDay } from '../../../shared/domain-events';
import { sellThrough } from '../../../shared/market-reports';
import type { MarketId } from '../../../shared/markets';
import {
  filterSaleRecords,
  NO_SALE_FILTER,
  saleTotals,
  salesByMonth,
  type SaleMonth,
  type SaleRecord,
} from '../../../shared/sales';
import { SALE_STEP_LABEL, isUnderWay, saleSourceLabel } from '../../lib/sales';
import { needsAttention, type AttentionItem } from '../../lib/sales-attention';
import { SEVERITY_DOT } from '../../lib/severity';
import { useAppStore } from '../../store/app';
import { StatCard } from '../StatCard';
import { MarketLogo } from '../RegistrarLogo';
import { MarketListingDialog } from '../domains/MarketListingDialog';
import { SaleAuthCode } from './SaleAuthCode';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The Sales overview (docs/sales-tab.md): what needs you, this year's
// numbers, and sales by month. The bell's sale alerts open here.

const DAY = 86_400_000;
/** Needs attention rows shown before "Show N more". */
const ATTENTION_SHOWN = 6;

/** The Needs attention items, from the store; the switch counts them too. */
export function useNeedsAttention(records: SaleRecord[]): AttentionItem[] {
  const catalog = useAppStore((s) => s.marketCatalog);
  const marketAccounts = useAppStore((s) => s.marketAccounts);
  const listings = useAppStore((s) => s.marketListings);
  const listPrices = useAppStore((s) => s.listPrices);
  const portfolio = useAppStore((s) => s.portfolio);
  const imported = useAppStore((s) => s.importedDomains);
  return useMemo(() => {
    // Only accounts that sync: a turned-off or unfinished one has no
    // listings stored, so every priced name would look unlisted there.
    const syncing = (marketAccounts ?? []).filter(
      (a) => a.enabled && a.configured,
    );
    const live = new Set(syncing.map((a) => a.id));
    const connected = new Set(syncing.map((a) => a.market));
    const owned = new Set([
      ...portfolio.filter((d) => !d.departed).map((d) => toAscii(d.domainName)),
      ...Object.keys(imported).map(toAscii),
    ]);
    return needsAttention({
      records,
      liveMarketAccounts: live,
      listings,
      listPrices,
      owned,
      markets: catalog.map((m) => m.id).filter((id) => connected.has(id)),
    });
  }, [
    records,
    marketAccounts,
    listings,
    listPrices,
    portfolio,
    imported,
    catalog,
  ]);
}

export function SalesOverview({
  records,
  money,
  preferredCurrency,
}: {
  records: SaleRecord[];
  money: (amount: string | null, currency: string | null) => string | null;
  preferredCurrency: string;
}) {
  const catalog = useAppStore((s) => s.marketCatalog);
  const marketAccounts = useAppStore((s) => s.marketAccounts);
  const listings = useAppStore((s) => s.marketListings);
  const traffic = useAppStore((s) => s.marketTraffic);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<{
    name: string;
    market: string;
  } | null>(null);
  const today = localDay();
  const marketName = (id: string) => saleSourceLabel(id as MarketId, catalog);

  const items = useNeedsAttention(records);

  // This year's sales, in the currency most of them were in; null when
  // nothing sold this year (the cards show dashes, never all-time figures).
  // Under way counts every sale still going, dated or not.
  const year = useMemo(() => {
    const { records: kept } = filterSaleRecords(records, {
      ...NO_SALE_FILTER,
      from: `${today.slice(0, 4)}-01-01`,
    });
    const totals = saleTotals(kept).filter((t) => t.currency && t.sold);
    return {
      main: totals[0] ?? null,
      others: Math.max(0, totals.length - 1),
      underWay: records.filter(isUnderWay).length,
      // The chart's currency when nothing sold this year: the one most
      // sales were in.
      fallback: saleTotals(records).find((t) => t.currency)?.currency ?? null,
    };
  }, [records, today]);
  const currency = year.main?.currency || year.fallback || preferredCurrency;
  const through = useMemo(
    () => sellThrough(records, Object.values(listings).flat(), today),
    [records, listings, today],
  );
  const months = useMemo(
    () => salesByMonth(records, currency, today, 12),
    [records, currency, today],
  );
  const views30 = useMemo(() => {
    const since = new Date(Date.parse(today) - 30 * DAY)
      .toISOString()
      .slice(0, 10);
    return traffic.accountDays
      .filter((d) => d.date > since)
      .reduce(
        (n, d) => ({
          views: n.views + (d.views ?? 0),
          leads: n.leads + (d.leads ?? 0),
        }),
        { views: 0, leads: 0 },
      );
  }, [traffic.accountDays, today]);
  const t = year.main;
  const plural = (n: number, word: string) =>
    `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  // Amounts in another currency aren't in these figures.
  const other = year.others ? `, ${currency} only` : '';

  return (
    <div className="flex flex-col gap-6 pb-12">
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-foreground/75">
          Needs attention
        </h2>
        {items.length ? (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {(showAll ? items : items.slice(0, ATTENTION_SHOWN)).map((item) => (
              <AttentionRow
                key={item.key}
                today={today}
                item={item}
                marketName={marketName}
                website={(id) => catalog.find((m) => m.id === id)?.website}
                money={money}
                onEditListing={(name, market) => setEditing({ name, market })}
              />
            ))}
            {items.length > ATTENTION_SHOWN && (
              <li>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll
                    ? 'Show fewer'
                    : `Show ${items.length - ATTENTION_SHOWN} more`}
                </button>
              </li>
            )}
          </ul>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-brand" />
            Nothing needs you right now.
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={BadgeDollarSign}
          accentClass="text-violet-500"
          label="Sold this year"
          value={(t?.sold ?? 0).toLocaleString()}
          hint={
            year.underWay
              ? `${year.underWay} under way`
              : `${plural(records.filter((r) => r.status === 'completed').length, 'sale')} all time`
          }
        />
        <StatCard
          icon={Receipt}
          accentClass="text-sky-500"
          label="Gross this year"
          value={t?.sold ? money(t.gross, currency)! : '—'}
          hint={`What buyers paid${other}`}
        />
        <StatCard
          icon={CircleDollarSign}
          accentClass="text-brand-500"
          label="Net this year"
          value={t?.netCount ? money(t.net, currency)! : '—'}
          hint={
            t && t.netCount < t.sold
              ? `${t.netCount} of ${plural(t.sold, 'sale')} with fees`
              : 'After commission and fees'
          }
        />
        <StatCard
          icon={ChartNoAxesColumn}
          accentClass="text-amber-500"
          label="Average sale"
          value={t?.average ? money(t.average, currency)! : '—'}
          hint={t?.sold ? `Over ${plural(t.sold, 'sale')}` : 'None this year'}
        />
        <StatCard
          icon={Percent}
          accentClass="text-rose-500"
          label="Sell-through"
          value={
            through.rate === null ? '—' : `${(through.rate * 100).toFixed(1)}%`
          }
          hint={
            through.rate === null
              ? 'Nothing listed'
              : `${through.sold} of ${through.available} listed, 12 months`
          }
        />
        {(marketAccounts?.length ?? 0) > 0 && (
          <StatCard
            icon={Eye}
            accentClass="text-orange-500"
            label="Views, 30 days"
            value={views30.views.toLocaleString()}
            hint={plural(views30.leads, 'lead')}
          />
        )}
      </div>

      <MonthBars
        months={months}
        money={(amount) => money(amount, currency) ?? '—'}
        currency={currency}
      />

      {editing && (
        <MarketListingDialog
          domain={{ domainName: toUnicode(editing.name) }}
          market={editing.market}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AttentionRow({
  today,
  item,
  marketName,
  website,
  money,
  onEditListing,
}: {
  /** YYYY-MM-DD. */
  today: string;
  item: AttentionItem;
  marketName: (id: string) => string;
  website: (id: string) => string | undefined;
  money: (amount: string | null, currency: string | null) => string | null;
  onEditListing: (name: string, market: string) => void;
}) {
  let market: string;
  let name: string | null = null;
  let what: string;
  let action: React.ReactNode;
  let severity: 'high' | 'low' = 'low';
  if (item.kind === 'sale') {
    const r = item.record;
    market = r.source;
    name = r.name;
    severity = 'high';
    what = `${marketName(market)} sale, ${money(r.price, r.currency) ?? 'no price'}: ${SALE_STEP_LABEL[r.step!].toLowerCase()}`;
    const site = website(market);
    action =
      r.step === 'auth_code' ? (
        <SaleAuthCode
          accountId={r.marketAccountId!}
          saleId={r.marketSaleId!}
          name={r.name}
        />
      ) : site ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => void window.api.openExternal(site)}
        >
          Open {marketName(market)}
        </Button>
      ) : null;
  } else if (item.kind === 'listing') {
    const l = item.listing;
    market = l.market;
    name = l.name;
    const days = l.listedAt
      ? Math.floor((Date.parse(today) - Date.parse(l.listedAt)) / DAY)
      : null;
    what =
      item.reason === 'rejected'
        ? `Rejected on ${marketName(market)}`
        : item.reason === 'stuck'
          ? `Pending on ${marketName(market)}${days !== null ? ` for ${days} days` : ''}`
          : `${marketName(market)} price ${money(l.price, l.currency)} is below your ${money(item.mine?.amount ?? null, item.mine?.currency ?? null)}`;
    if (item.reason === 'rejected') severity = 'high';
    action = (
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        onClick={() => onEditListing(l.name, l.market)}
      >
        {item.reason === 'below' ? 'Edit listing' : 'Open listing'}
      </Button>
    );
  } else {
    market = item.market;
    const n = item.count;
    const names = `${n.toLocaleString()} name${n === 1 ? '' : 's'}`;
    what =
      item.reason === 'unlisted'
        ? `${names} with a price, not listed on ${marketName(market)}`
        : item.reason === 'rejected'
          ? `${names} rejected on ${marketName(market)}`
          : item.reason === 'stuck'
            ? `${names} pending on ${marketName(market)} for over a week`
            : `${names} below your price on ${marketName(market)}`;
    if (item.reason === 'rejected') severity = 'high';
    action = (
      <Button asChild size="sm" variant="outline" className="h-7">
        <Link to={item.link}>Show in Domains</Link>
      </Button>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
      <span
        className={cn('size-2 shrink-0 rounded-full', SEVERITY_DOT[severity])}
        aria-hidden
      />
      <MarketLogo
        market={market}
        label={marketName(market)}
        className="size-4 p-[1.5px] text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        {name && <span className="font-mono">{toUnicode(name)}</span>}
        {name && ' '}
        <span className={cn(name && 'text-muted-foreground')}>{what}</span>
      </span>
      <span className="ml-auto">{action}</span>
    </li>
  );
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const monthLabel = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];

/**
 * Sales by month, drawn like Renewals by month: one bar per month (what
 * buyers paid, in one currency) in a faint full-height slot, the amount
 * above it and the count in its title. A visually hidden table carries the
 * same numbers. From PR #183's monthly trend.
 */
function MonthBars({
  months,
  money,
  currency,
}: {
  months: SaleMonth[];
  money: (amount: string) => string;
  currency: string;
}) {
  const max = Math.max(1, ...months.map((m) => Number(m.gross)));
  const sold = months.reduce((n, m) => n + m.sold, 0);
  const gross = months.reduce((n, m) => n + Number(m.gross), 0);
  return (
    <div className="@container flex flex-col gap-3 rounded-lg border bg-card p-4 pt-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-foreground/75">
          Sales by month
        </h2>
        <span className="text-xs text-muted-foreground">
          {sold.toLocaleString()} sale{sold === 1 ? '' : 's'} ·{' '}
          {money(String(gross))} over 12 months, in {currency}
        </span>
      </div>
      <div className="flex items-end gap-1.5 pt-2" aria-hidden>
        {months.map((m) => {
          const pct = (Number(m.gross) / max) * 100;
          const label = `${monthLabel(m.month)} ${m.month.slice(0, 4)}`;
          return (
            <div
              key={m.month}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="relative h-[154px] w-full">
                <div className="absolute inset-0 rounded-t-[5px] rounded-b-[3px] bg-muted/30" />
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-[5px] rounded-b-[3px] bg-brand transition-[filter] hover:brightness-110"
                  style={{ height: `${pct}%` }}
                  title={`${label}: ${m.sold} sale${m.sold === 1 ? '' : 's'} · ${money(m.gross)}`}
                />
                {m.sold > 0 && (
                  <span
                    className="absolute left-1/2 hidden -translate-x-1/2 -translate-y-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums sm:block"
                    style={{ bottom: `${pct}%` }}
                  >
                    {money(m.gross)}
                  </span>
                )}
              </div>
              <span className="hidden text-xs whitespace-nowrap text-muted-foreground @3xl:block">
                {label}
              </span>
              <span className="text-[10px] whitespace-nowrap text-muted-foreground sm:text-xs @3xl:hidden">
                {monthLabel(m.month)}
              </span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Sales by month, in {currency}</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Sales</th>
            <th>Gross</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td>{m.sold}</td>
              <td>{m.gross}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
