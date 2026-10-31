import { multiAccountRegistrars } from '../lib/registrar-accounts';
import { domainKey } from '../../shared/account-key';
import { useMemo, useState } from 'react';
import {
  AlarmClock,
  Building2,
  CalendarClock,
  CalendarSync,
  ChartColumn,
  Globe,
  IterationCw,
  RefreshCwOff,
} from 'lucide-react';
import type { Domain } from '../../shared/ipc';
import { importedRows } from '../../shared/imported-domains';
import { toAscii } from '../../shared/domain-name';
import { ownershipByDomain, standingOf } from '../../shared/ownership';
import { useAppStore } from '../store/app';
import { StatCard, StatCardRow } from '../components/StatCard';
import { ToolbarSwitch } from '../components/data-table/FilterToolbar';
import { FilterDropdown } from '../components/data-table/FilterBar';
import {
  importedRegistrarName,
  importedRegistrarValue,
  registrarFilterOptions,
  registrarFilterValue,
} from '../lib/registrar-filter';
import {
  dueWithin,
  groupBy,
  leavesOut,
  priceOf,
  summarize,
  tldOf,
  upcomingByMonth,
  wholeMoney,
  type Group,
  type MonthBucket,
} from '../lib/renewals';
import { periodLabel } from '../../shared/exchange-rates';
import { DEFAULT_CURRENCY } from '../../shared/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
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

type RegistrarLabels = Record<string, string>;

function registrarLabel(id: string, labels: RegistrarLabels): string {
  return labels[id] ?? id;
}

/** Grouped count, e.g. "1,050". */
function count(n: number): string {
  return n.toLocaleString('en-US');
}

// ── Donut slices ─────────────────────────────────────────────────────────────

interface Slice {
  label: string;
  value: number;
  color: string;
}

// Categorical palette — a full spread of hues around the wheel at a shared,
// slightly muted depth so no single slice reads brighter than the rest. Ordered
// most-common-first with adjacent slices set to contrast; royal blue anchors
// the largest slice. The dark brand green is kept out of the charts (it read as
// a heavy anchor) in favor of a brighter grass green. Plus a neutral gray
// "Other" for the folded tail.
const DONUT_PALETTE = [
  '#35509e', // royal blue
  '#b39a3c', // ochre gold
  '#3f9e57', // green
  '#b0603a', // terracotta
  '#2e8f96', // teal
  '#b0505f', // dusty rose
  '#6b5b9a', // muted violet
  '#5a7a92', // slate blue
];
const OTHER_COLOR = '#8a8f88';

/** Rank groups by `value`, keep the top N as their own slices, and fold the
 * long tail into a single "Other" slice so the donut stays legible. */
function toSlices(
  groups: Group[],
  value: (g: Group) => number,
  topN = 8,
): Slice[] {
  const ranked = groups
    .filter((g) => value(g) > 0)
    .sort((a, b) => value(b) - value(a));
  const slices: Slice[] = ranked.slice(0, topN).map((g, i) => ({
    label: g.label,
    value: value(g),
    color: DONUT_PALETTE[i % DONUT_PALETTE.length],
  }));
  const rest = ranked.slice(topN);
  const restTotal = rest.reduce((sum, g) => sum + value(g), 0);
  if (restTotal > 0) {
    slices.push({
      label: `Other (${rest.length})`,
      value: restTotal,
      color: OTHER_COLOR,
    });
  }
  return slices;
}

// The "Set prices manually" editor is hidden for now; the state and handlers
// stay wired up so it can be switched back on later.
const MANUAL_PRICING_ENABLED = false;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Renewals() {
  const {
    portfolio: syncedDomains,
    importedDomains,
    portfolioLoadedAt,
    portfolioRegistrarLabels,
    pricing,
    setManualPrice,
    domainEvents,
    registrationLookups,
  } = useAppStore();

  // The names in Owned (synced, and the ones you added by hand), less those
  // you've sold that the buyer hasn't taken yet. Archive is never counted
  // (docs/owned-and-archive.md).
  const allDomains = useMemo(() => {
    const ownership = ownershipByDomain(domainEvents);
    return [
      ...syncedDomains,
      ...importedRows(importedDomains, syncedDomains),
    ].filter((d) => {
      const key = toAscii(d.domainName);
      const st = standingOf(
        d,
        ownership.get(key),
        registrationLookups[key]?.registered,
      );
      return !st.archived && !st.salePending;
    });
  }, [syncedDomains, importedDomains, domainEvents, registrationLookups]);
  const accounts = useAppStore((s) => s.registrars);
  const multipleAccounts = useMemo(
    () => multiAccountRegistrars(accounts, allDomains),
    [accounts, allDomains],
  );
  // The Registrar filter, as on Domains: accounts, then the registrars of
  // the names you added; several at once. Counts are over every name.
  const [registrar, setRegistrar] = useState<string[]>([]);
  const inRegistrar = useMemo(
    () =>
      registrar.length === 0
        ? allDomains
        : allDomains.filter((d) =>
            registrar.includes(
              registrarFilterValue(d, portfolioRegistrarLabels),
            ),
          ),
    [allDomains, registrar, portfolioRegistrarLabels],
  );
  const registrarFilter = (
    <FilterDropdown
      // Full width on phones, like the search on the other pages.
      className="w-56 max-sm:w-full"
      field={{
        key: 'registrar',
        label: 'Registrar',
        icon: Building2,
        options: registrarFilterOptions(
          allDomains,
          portfolioRegistrarLabels,
          multipleAccounts,
        ),
        selected: registrar,
        onChange: setRegistrar,
        plural: 'registrars',
      }}
    />
  );
  // Every name, only the ones that renew on their own, or only the ones you
  // renew by hand (auto-renew off, or unknown for a name you added).
  const [renewing, setRenewing] = useState<'all' | 'auto' | 'manual'>('all');
  const autoRenews = (d: Domain) => d.autoRenew && !d.autoRenewUnknown;
  const autoRenewing = useMemo(
    () => inRegistrar.filter(autoRenews),
    [inRegistrar],
  );
  const manual = useMemo(
    () => inRegistrar.filter((d) => !autoRenews(d)),
    [inRegistrar],
  );
  const portfolio =
    renewing === 'auto'
      ? autoRenewing
      : renewing === 'manual'
        ? manual
        : inRegistrar;
  const renewSwitch = (
    <ToolbarSwitch
      fillOnPhone
      label="Which renewals to count"
      // Three don't fit a phone with their counts, and Auto-renew needs
      // more than a third.
      className="max-sm:[&_.tabular-nums]:hidden max-sm:[&_[role=radio]]:flex-auto max-sm:[&_[role=radio]]:whitespace-nowrap"
      options={[
        {
          id: 'all',
          label: 'All',
          icon: CalendarClock,
          count: inRegistrar.length,
          active: renewing === 'all',
          onClick: () => setRenewing('all'),
        },
        {
          id: 'auto',
          label: 'Auto-renew',
          icon: IterationCw,
          count: autoRenewing.length,
          active: renewing === 'auto',
          onClick: () => setRenewing('auto'),
        },
        {
          id: 'manual',
          // Just Manual on a phone, where three share the width.
          label: (
            <>
              Manual<span className="max-sm:hidden"> renew</span>
            </>
          ),
          icon: RefreshCwOff,
          count: manual.length,
          active: renewing === 'manual',
          onClick: () => setRenewing('manual'),
        },
      ]}
    />
  );
  // The switch and the filter narrow what's counted, not whether there's a
  // portfolio.
  const hasPortfolio =
    allDomains.length > 0 &&
    (portfolioLoadedAt !== null ||
      allDomains.some((d) => d.source === 'imported'));

  // Totals are in your preferred currency. A price in another one is
  // converted at the newest exchange rate held (a renewal is ahead of you);
  // one DomBot can't convert is left out and said so.
  const currency = useAppStore(
    (s) => s.settings?.preferredCurrency ?? DEFAULT_CURRENCY,
  );
  const fx = useAppStore((s) => s.exchangeRates);
  const usd = (n: number) => wholeMoney(n, currency);
  const summary = useMemo(
    () => summarize(portfolio, pricing, currency, fx),
    [portfolio, pricing, currency, fx],
  );
  const leftOutNote = leavesOut(summary.leftOut);
  // Under the cards when a price was converted or left out.
  const conversionNote = useMemo(() => {
    const notes: string[] = [];
    if (summary.converted > 0) {
      const period = fx.ratesFor(null)?.period;
      notes.push(
        `In ${currency}: ${summary.converted} converted from ${summary.convertedFrom.join(', ')}${
          period ? ` at ${periodLabel(period)} (ECB)` : ''
        }.`,
      );
    }
    if (leftOutNote) notes.push(`${leftOutNote}.`);
    return notes.length ? notes.join(' ') : null;
  }, [summary, fx, currency, leftOutNote]);
  // By registrar, as the Registrar filter groups them: a name you added
  // with no registrar DomBot knows goes under the one you typed, or
  // Unknown, never a blank slice.
  const byRegistrar = useMemo(() => {
    const importedLabels = new Map<string, string>();
    const keyOf = (d: Domain) => {
      if (d.registrar) return d.registrar;
      const label = importedRegistrarName(d, portfolioRegistrarLabels);
      const key = importedRegistrarValue(label);
      importedLabels.set(key, label || 'Unknown');
      return key;
    };
    return groupBy(
      portfolio,
      pricing,
      keyOf,
      (key) =>
        importedLabels.get(key) ??
        registrarLabel(key, portfolioRegistrarLabels),
      currency,
      fx,
    );
  }, [portfolio, pricing, portfolioRegistrarLabels, currency, fx]);
  // Unknown isn't a registrar.
  const registrarCount = byRegistrar.filter(
    (g) => g.key !== importedRegistrarValue(''),
  ).length;
  const byTld = useMemo(
    () =>
      groupBy(
        portfolio,
        pricing,
        (d) => tldOf(d.domainName),
        (t) => (t ? `.${t}` : '—'),
        currency,
        fx,
      ),
    [portfolio, pricing, currency, fx],
  );
  const months = useMemo(
    () => upcomingByMonth(portfolio, pricing, 12, currency, fx),
    [portfolio, pricing, currency, fx],
  );
  const due30 = useMemo(
    () => dueWithin(portfolio, pricing, 30, currency, fx),
    [portfolio, pricing, currency, fx],
  );
  const due90 = useMemo(
    () => dueWithin(portfolio, pricing, 90, currency, fx),
    [portfolio, pricing, currency, fx],
  );

  // Donut slices: registrar and TLD, each by domain count and by yearly spend.
  const regCount = useMemo(
    () => toSlices(byRegistrar, (g) => g.count),
    [byRegistrar],
  );
  const regSpend = useMemo(
    () => toSlices(byRegistrar, (g) => g.yearly),
    [byRegistrar],
  );
  const tldCount = useMemo(() => toSlices(byTld, (g) => g.count), [byTld]);
  const tldSpend = useMemo(() => toSlices(byTld, (g) => g.yearly), [byTld]);
  const regSpendTotal = regSpend.reduce((s, x) => s + x.value, 0);
  const tldSpendTotal = tldSpend.reduce((s, x) => s + x.value, 0);

  // Domains that can't be priced automatically or already carry a manual price —
  // the working set for the inline editor.
  const needsPrice = useMemo(
    () =>
      portfolio.filter((d) => {
        const p = priceOf(d, pricing);
        return p?.source === 'unavailable' || p?.source === 'manual';
      }),
    [portfolio, pricing],
  );

  if (!hasPortfolio) {
    return (
      <div className="mx-auto w-full max-w-[1400px]">
        <PageHeader />
        <Empty className="mt-6 rounded-lg border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No portfolio loaded</EmptyTitle>
            <EmptyDescription>
              Load your domains on the Domains tab first — the renewals
              dashboard is built from that portfolio.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const monthly = summary.yearly / 12;

  return (
    // 13px between rows and cards, as on Domains, Sales and Activity.
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[13px]">
      <PageHeader
        view={
          renewing === 'auto'
            ? 'Auto-renew'
            : renewing === 'manual'
              ? 'Manual renew'
              : 'All'
        }
      />

      {/* Totals: the small two-row cards Domains and Sales have, in your
          currency. The line under them says what was converted or left out. */}
      <StatCardRow {...(conversionNote ? { note: conversionNote } : {})}>
        <StatCard
          size="sm"
          icon={Globe}
          accentClass="text-blue-500"
          label="Domains"
          value={[
            {
              value: count(summary.total),
              unit: `${registrarCount} registrar${
                registrarCount === 1 ? '' : 's'
              }`,
            },
          ]}
        />
        <StatCard
          size="sm"
          icon={ChartColumn}
          accentClass="text-sky-500"
          label="Monthly avg"
          value={usd(monthly)}
        />
        <StatCard
          size="sm"
          icon={CalendarSync}
          accentClass="text-brand-500"
          label="Yearly"
          value={[{ value: usd(summary.yearly) }]}
        />
        <StatCard
          size="sm"
          icon={AlarmClock}
          accentClass="text-amber-500"
          label="Due, 30 days"
          value={[
            {
              value: usd(due30.yearly),
              unit: `${due30.count} name${due30.count === 1 ? '' : 's'}`,
            },
          ]}
        />
        <StatCard
          size="sm"
          icon={CalendarClock}
          accentClass="text-orange-500"
          label="Due, 90 days"
          value={[
            {
              value: usd(due90.yearly),
              unit: `${due90.count} name${due90.count === 1 ? '' : 's'}`,
            },
          ]}
        />
      </StatCardRow>

      {/* A toolbar over the chart and donuts, as over the other pages'
          tables: the view first (a row of its own under lg, as there),
          then the registrars. */}
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="max-lg:basis-full">{renewSwitch}</div>
        {registrarFilter}
      </div>

      {/* Spend over time, between the totals and the composition donuts. */}
      <MonthlyBarChart months={months} fmt={usd} />

      {/* Composition: two pairs (count + spend), one row per dimension. */}
      <div className="grid gap-[13px] md:grid-cols-2">
        <DonutCard
          title="Domains by registrar"
          slices={regCount}
          centerValue={count(summary.total)}
          centerLabel="domains"
          fmt={count}
        />
        <DonutCard
          title="Spend by registrar"
          slices={regSpend}
          centerValue={usd(regSpendTotal)}
          centerLabel="per year"
          fmt={usd}
        />
        <DonutCard
          title="Domains by TLD"
          slices={tldCount}
          centerValue={count(summary.total)}
          centerLabel="domains"
          fmt={count}
        />
        <DonutCard
          title="Spend by TLD"
          slices={tldSpend}
          centerValue={usd(tldSpendTotal)}
          centerLabel="per year"
          fmt={usd}
        />
      </div>

      {/* Manual price editor */}
      {MANUAL_PRICING_ENABLED && needsPrice.length > 0 && (
        <PriceEditor
          domains={needsPrice}
          labels={portfolioRegistrarLabels}
          pricing={pricing}
          onSave={setManualPrice}
        />
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

/** The title, and the view beside it: the same height and type as the other pages' title rows. */
function PageHeader({ view }: { view?: string }) {
  return (
    <div className="mb-1 min-h-9">
      <h1 className="mt-1.5 flex min-w-0 items-baseline gap-2.5 text-2xl font-bold leading-none sm:mt-0.5 sm:text-[32px]">
        Renewals
        {/* The view, as on Domains. */}
        {view && (
          <span className="text-sm font-semibold uppercase tracking-wider text-brand sm:text-base">
            {view}
          </span>
        )}
      </h1>
    </div>
  );
}

// ── Monthly bar chart ────────────────────────────────────────────────────────

/** "leaves out 2 renewals in TWD", for a hint after a dot; null stays null. */
function lower(note: string | null): string | null {
  return note && note[0].toLowerCase() + note.slice(1);
}

// The bars are all a single flat blue — the month labels already tell them
// apart, so per-bar hues just added noise.
const BAR_COLOR = '#35509e';

function MonthlyBarChart({
  months,
  fmt: usd,
}: {
  months: MonthBucket[];
  /** Whole amounts in the page's currency. */
  fmt: (n: number) => string;
}) {
  const max = Math.max(1, ...months.map((m) => m.yearly));
  const total = months.reduce((sum, m) => sum + m.yearly, 0);
  return (
    // @container: the month labels are sized to the card, not the viewport,
    // since the card's width depends on the page's grid and padding.
    <div className="@container flex flex-col gap-3 rounded-lg border bg-card p-4 pt-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-foreground/75">
          Renewals by month
        </h2>
        <span className="text-xs text-muted-foreground">
          {usd(total)} over 12 months
        </span>
      </div>
      <div className="flex items-end gap-1.5 pt-2">
        {months.map((m) => {
          const pct = (m.yearly / max) * 100;
          return (
            <div
              key={m.key}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="relative h-[154px] w-full">
                {/* Faint full-height track so the chart keeps a readable grid
                    even where a month is empty or very short. */}
                <div
                  className="absolute inset-x-0 inset-y-0 rounded-t-[5px] rounded-b-[3px] bg-muted/30"
                  aria-hidden
                />
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-[5px] rounded-b-[3px] transition-[filter] hover:brightness-110"
                  style={{
                    height: `${pct}%`,
                    backgroundColor: BAR_COLOR,
                  }}
                  title={`${m.label}: ${usd(m.yearly)}${
                    m.leftOut.length ? ` (${lower(leavesOut(m.leftOut))})` : ''
                  } · ${m.count} domain${m.count === 1 ? '' : 's'}`}
                />
                {m.yearly > 0 && (
                  <span
                    // Hidden on phones, where 12 centered figures overlap; the
                    // per-bar amount is still in the bar's hover title.
                    className="absolute left-1/2 hidden -translate-x-1/2 -translate-y-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums sm:block"
                    style={{ bottom: `${pct}%` }}
                  >
                    {usd(m.yearly)}
                  </span>
                )}
              </div>
              {/* The full "Sep 2026" only once the card is wide enough for all
                  twelve on one line (@3xl ≈ 768px). Narrower, just the month
                  abbreviation: the full label is wider than a bar there, and
                  letting it wrap broke unevenly ("May 2026" fit where
                  "Sep 2026" didn't), so both are nowrap. */}
              <span className="hidden text-xs whitespace-nowrap text-muted-foreground @3xl:block">
                {m.label}
              </span>
              <span className="text-[10px] whitespace-nowrap text-muted-foreground sm:text-xs @3xl:hidden">
                {m.label.slice(0, 3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Donut ────────────────────────────────────────────────────────────────────

function Donut({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: Slice[];
  centerValue: string;
  centerLabel: string;
}) {
  const size = 132;
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const gap = slices.length > 1 ? 1.5 : 0;
  // Arc length of each slice and its cumulative start offset — computed purely
  // (no running mutation) so the map below just reads them by index.
  const lengths =
    total > 0 ? slices.map((s) => (s.value / total) * circumference) : [];
  const offsets = lengths.map((_, i) =>
    lengths.slice(0, i).reduce((sum, l) => sum + l, 0),
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${centerValue} ${centerLabel}`}
    >
      {total === 0 ? (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
      ) : (
        <g transform={`rotate(-90 ${c} ${c})`}>
          {slices.map((s, i) => {
            const draw = Math.max(0, lengths[i] - gap);
            return (
              <circle
                key={s.label}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${draw} ${circumference - draw}`}
                strokeDashoffset={-offsets[i]}
              />
            );
          })}
        </g>
      )}
      <text
        x={c}
        y={c - 5}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-current text-sm font-bold text-foreground"
      >
        {centerValue}
      </text>
      <text
        x={c}
        y={c + 11}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-current text-[10px] text-muted-foreground"
      >
        {centerLabel}
      </text>
    </svg>
  );
}

function DonutCard({
  title,
  slices,
  centerValue,
  centerLabel,
  fmt,
}: {
  title: string;
  slices: Slice[];
  centerValue: string;
  centerLabel: string;
  fmt: (n: number) => string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 pt-[14px]">
      <h2 className="text-[15px] font-semibold text-foreground/75">{title}</h2>
      <div className="flex items-center gap-4">
        <Donut
          slices={slices}
          centerValue={centerValue}
          centerLabel={centerLabel}
        />
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
          {slices.length === 0 && (
            <li className="text-muted-foreground">No data yet</li>
          )}
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto flex shrink-0 items-baseline gap-1 tabular-nums">
                <span>{fmt(s.value)}</span>
                {total > 0 && (
                  <span className="text-muted-foreground/60">
                    {Math.round((s.value / total) * 100)}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Manual price editor ──────────────────────────────────────────────────────

function PriceEditor({
  domains,
  labels,
  pricing,
  onSave,
}: {
  domains: Domain[];
  labels: RegistrarLabels;
  pricing: ReturnType<typeof useAppStore.getState>['pricing'];
  onSave: (
    domain: string,
    price: { amount: string; currency: string } | null,
  ) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-foreground/75">
        Set prices manually{' '}
        <span className="font-normal text-muted-foreground/70">
          · registrars with no pricing API, or your own overrides
        </span>
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Registrar</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[220px] text-right">
                Annual price
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((d) => {
              const p = priceOf(d, pricing);
              return (
                <PriceEditorRow
                  key={domainKey(d)}
                  domain={d}
                  label={registrarLabel(d.registrar, labels)}
                  current={p?.source === 'manual' ? p.renewal : null}
                  currency={p?.currency ?? 'USD'}
                  isManual={p?.source === 'manual'}
                  onSave={onSave}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PriceEditorRow({
  domain,
  label,
  current,
  currency,
  isManual,
  onSave,
}: {
  domain: Domain;
  label: string;
  current: number | null;
  /** The price's currency (USD for a name with no price yet). */
  currency: string;
  isManual: boolean;
  onSave: (
    domain: string,
    price: { amount: string; currency: string } | null,
  ) => Promise<void>;
}) {
  const [value, setValue] = useState(current != null ? String(current) : '');
  const [saving, setSaving] = useState(false);

  const parsed = value.trim() === '' ? null : Number(value);
  const invalid = parsed !== null && (Number.isNaN(parsed) || parsed < 0);
  const dirty = value.trim() !== (current != null ? String(current) : '');

  async function save() {
    if (invalid) return;
    setSaving(true);
    try {
      await onSave(
        domain.domainName,
        parsed === null ? null : { amount: String(parsed), currency },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-mono">{domain.domainName}</TableCell>
      <TableCell>{label}</TableCell>
      <TableCell>
        {isManual ? (
          <Badge variant="secondary">manual</Badge>
        ) : (
          <Badge variant="outline">no price</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            placeholder="—"
            aria-invalid={invalid}
            className="h-8 w-28 text-right tabular-nums"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={saving || invalid || !dirty}
            onClick={() => void save()}
          >
            {saving ? '…' : 'Save'}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
