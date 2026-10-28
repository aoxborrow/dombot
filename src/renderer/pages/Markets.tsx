import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { localDay } from '../../shared/domain-events';
import {
  mostSearched,
  salesByYear,
  salesTotal,
  sellThrough,
  trafficByMonth,
  type TrafficMonth,
} from '../../shared/market-reports';
import type { MarketListing } from '../../shared/markets';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatMoney,
} from '../../shared/money';
import { useAppStore } from '../store/app';
import { Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Empty as EmptyState,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Reporting across market accounts (docs/afternic-api.md, "Reporting"):
// traffic by month, the names that get it, sales by year, sell-through, and
// search demand. Everything comes from what market sync stored.

const MONTHS_SHOWN = 12;
const TOP_NAMES = 15;

export default function Markets() {
  const accounts = useAppStore((s) => s.marketAccounts);
  const listingsByName = useAppStore((s) => s.marketListings);
  const sales = useAppStore((s) => s.marketSales);
  const traffic = useAppStore((s) => s.marketTraffic);
  const settings = useAppStore((s) => s.settings);
  const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  const money = (amount: string, currency = 'USD') =>
    formatMoney(amount, currency, preferred, numberFormat, true);
  const count = (n: number) => n.toLocaleString();

  const listings = useMemo(
    () => Object.values(listingsByName).flat(),
    [listingsByName],
  );
  const months = useMemo(
    () => trafficByMonth(traffic.accountDays).slice(-MONTHS_SHOWN),
    [traffic.accountDays],
  );
  const last30 = useMemo(() => {
    const days = traffic.accountDays.slice(-30);
    return {
      views: days.reduce((n, d) => n + (d.views ?? 0), 0),
      leads: days.reduce((n, d) => n + (d.leads ?? 0), 0),
    };
  }, [traffic.accountDays]);
  const years = useMemo(() => salesByYear(sales), [sales]);
  const total = useMemo(() => salesTotal(years), [years]);
  const through = useMemo(
    () => sellThrough(sales, listings, localDay()),
    [sales, listings],
  );
  const searched = useMemo(() => mostSearched(listings), [listings]);
  const topNames = useMemo(
    () =>
      Object.entries(traffic.domains)
        .filter(([, t]) => t.views365 || t.leads365)
        .sort(
          ([a, x], [b, y]) =>
            y.leads365 - x.leads365 ||
            y.views365 - x.views365 ||
            a.localeCompare(b),
        )
        .slice(0, TOP_NAMES),
    [traffic.domains],
  );
  const priceOf = (name: string) => listingsByName[name]?.find((l) => l.price);
  const covered = Object.keys(traffic.domains).length;

  if (accounts !== null && accounts.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
        <h1 className="text-2xl font-bold sm:text-[32px]">Markets</h1>
        <EmptyState className="rounded-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Store />
            </EmptyMedia>
            <EmptyTitle>No market accounts yet</EmptyTitle>
            <EmptyDescription>
              Connect a marketplace like Afternic to see your listings&apos;
              traffic, leads and sales here, beside your registrar data.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/settings?tab=markets">Add a market account</Link>
            </Button>
          </EmptyContent>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold sm:text-[32px]">Markets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Traffic and sales from your marketplace accounts, as of their last
          sync.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Listed" value={count(listings.length)} />
        <Stat
          label="Views, last 30 days"
          value={count(last30.views)}
          note={`${count(last30.leads)} lead${last30.leads === 1 ? '' : 's'}`}
        />
        <Stat
          label="Sold, last 12 months"
          value={count(through.sold)}
          note={
            through.rate === null
              ? undefined
              : `${(through.rate * 100).toFixed(1)}% sell-through`
          }
        />
        <Stat
          label="Net, all time"
          value={money(total.net)}
          note={`${count(total.sold)} sale${total.sold === 1 ? '' : 's'}`}
        />
      </div>

      <MonthBars months={months} />

      <Section
        title="Names with the most interest"
        note={`Last 12 months, by leads then views. Traffic is fetched a slice of names per sync: ${count(covered)} of ${count(listings.length)} so far.`}
      >
        {topNames.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Views, 30 days</TableHead>
                <TableHead className="text-right">Listed price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topNames.map(([name, t]) => {
                const listed = priceOf(name);
                return (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(t.leads365)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(t.views365)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(t.views30)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {listed?.price
                        ? money(listed.price, listed.currency)
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Empty>No per-name traffic yet.</Empty>
        )}
      </Section>

      <Section
        title="Sales by year"
        note="Completed sales in USD. Commission is the market's; net is what you were paid."
      >
        {years.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Average</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {years.map((y) => (
                <TableRow key={y.year}>
                  <TableCell>
                    {y.year}
                    {(y.inProgress > 0 || y.cancelled > 0) && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[
                          y.inProgress && `${y.inProgress} in progress`,
                          y.cancelled && `${y.cancelled} cancelled`,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {y.sold}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(y.gross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {money(y.commission)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(y.net)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {y.average ? money(y.average) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>All years</TableCell>
                <TableCell className="text-right tabular-nums">
                  {total.sold}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(total.gross)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {money(total.commission)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(total.net)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {total.average ? money(total.average) : '—'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <Empty>No sales recorded yet.</Empty>
        )}
      </Section>

      {searched.length > 0 && (
        <Section
          title="Most searched"
          note="Searches on GoDaddy over the last 30 days (Discount Domain Club Domain Pro). A name searched a lot but priced high, or with few views, is worth a second look."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead className="text-right">Searches, 30 days</TableHead>
                <TableHead className="text-right">Unique</TableHead>
                <TableHead className="text-right">365 days</TableHead>
                <TableHead className="text-right">Listed price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searched.map((l: MarketListing) => (
                <TableRow key={`${l.accountId}:${l.name}`}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(l.extra.searches?.total.days30 ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(l.extra.searches?.unique.days30 ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.extra.searches?.total.days365 == null
                      ? '—'
                      : count(l.extra.searches.total.days365)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.price ? money(l.price, l.currency) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Card className="gap-1 rounded-md px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </Card>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      <Card className="rounded-md px-4 py-3">{children}</Card>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
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
 * Views by month, drawn like Renewals by month: one bar per month in a
 * faint full-height slot, its count always above it, and the year's totals
 * top right. One series, so no legend; leads are in each bar's hover title
 * and the summary, since they're far smaller than views. A visually hidden
 * table carries the same numbers.
 */
function MonthBars({ months }: { months: TrafficMonth[] }) {
  const max = Math.max(1, ...months.map((m) => m.views));
  const views = months.reduce((n, m) => n + m.views, 0);
  const leads = months.reduce((n, m) => n + m.leads, 0);
  const plural = (n: number, word: string) =>
    `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  return (
    <div className="@container flex flex-col gap-3 rounded-lg border bg-card p-4 pt-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-foreground/75">
          Views by month
        </h2>
        {months.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {plural(views, 'view')} · {plural(leads, 'lead')} over{' '}
            {months.length} month{months.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {months.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No traffic synced yet.
        </p>
      ) : (
        <div className="flex items-end gap-1.5 pt-2" aria-hidden>
          {months.map((m) => {
            const pct = (m.views / max) * 100;
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
                    title={`${label}: ${plural(m.views, 'view')} · ${plural(m.leads, 'lead')}`}
                  />
                  {m.views > 0 && (
                    <span
                      className="absolute left-1/2 hidden -translate-x-1/2 -translate-y-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums sm:block"
                      style={{ bottom: `${pct}%` }}
                    >
                      {m.views.toLocaleString()}
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
      )}
      <table className="sr-only">
        <caption>Views and leads by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Views</th>
            <th>Leads</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td>{m.views}</td>
              <td>{m.leads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
