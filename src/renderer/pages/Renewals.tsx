import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import type { Domain } from '../../shared/ipc';
import { useAppStore } from '../store/app';
import {
  dueWithin,
  groupBy,
  priceOf,
  summarize,
  tldOf,
  upcomingByMonth,
  type Group,
  type MonthBucket,
} from '../lib/renewals';
import { cn } from '@/lib/utils';
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

/** Whole-dollar USD, e.g. "$1,240". */
function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
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

// Categorical palette — deliberately desaturated so the charts sit calmly on
// the muted cards instead of reading as bright primaries. Plus a neutral
// "Other" gray.
const DONUT_PALETTE = [
  '#6690bf', // muted blue
  '#5fa387', // muted green
  '#c2a05f', // muted gold
  '#8f88bf', // muted periwinkle
  '#bf8fa8', // muted mauve
  '#5f9e9e', // muted teal
  '#bf8477', // muted terracotta
  '#7f89b8', // muted indigo
];
const OTHER_COLOR = '#8a94a3';

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
    portfolio,
    portfolioLoadedAt,
    portfolioRegistrarLabels,
    pricing,
    setManualPrice,
  } = useAppStore();

  const hasPortfolio = portfolioLoadedAt !== null && portfolio.length > 0;
  const hasPricing = Object.keys(pricing).length > 0;
  // Pricing is computed locally in main and arrives with the portfolio (and is
  // re-read after each Sync), so "loading" is just the brief gap before it lands.
  const pricingLoading = hasPortfolio && !hasPricing;

  const summary = useMemo(
    () => summarize(portfolio, pricing),
    [portfolio, pricing],
  );
  const byRegistrar = useMemo(
    () =>
      groupBy(
        portfolio,
        pricing,
        (d) => d.registrar,
        (id) => registrarLabel(id, portfolioRegistrarLabels),
      ),
    [portfolio, pricing, portfolioRegistrarLabels],
  );
  const byTld = useMemo(
    () =>
      groupBy(
        portfolio,
        pricing,
        (d) => tldOf(d.domainName),
        (t) => (t ? `.${t}` : '—'),
      ),
    [portfolio, pricing],
  );
  const months = useMemo(
    () => upcomingByMonth(portfolio, pricing, 12),
    [portfolio, pricing],
  );
  const due90 = useMemo(
    () => dueWithin(portfolio, pricing, 90),
    [portfolio, pricing],
  );

  // Donut slices: registrar by domain count, registrar by spend, TLD by count.
  const regCount = useMemo(
    () => toSlices(byRegistrar, (g) => g.count),
    [byRegistrar],
  );
  const regSpend = useMemo(
    () => toSlices(byRegistrar, (g) => g.yearly),
    [byRegistrar],
  );
  const tldCount = useMemo(() => toSlices(byTld, (g) => g.count), [byTld]);
  const regSpendTotal = regSpend.reduce((s, x) => s + x.value, 0);

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
      <div className="mx-auto max-w-[1400px]">
        <PageHeader loading={pricingLoading} summary={summary} />
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
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader loading={pricingLoading} summary={summary} />

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Globe}
          accentClass="text-blue-500"
          label="Total domains"
          value={count(summary.total)}
          hint={`${byRegistrar.length} registrar${
            byRegistrar.length === 1 ? '' : 's'
          } · ${byTld.length} TLD${byTld.length === 1 ? '' : 's'}`}
        />
        <StatCard
          icon={CircleDollarSign}
          accentClass="text-emerald-500"
          label="Yearly renewals"
          value={usd(summary.yearly)}
          hint={`${usd(monthly)}/mo · ${usd(summary.yearlyAutoRenew)} auto-renews, ${usd(
            summary.yearly - summary.yearlyAutoRenew,
          )} manual`}
        />
        <StatCard
          icon={CalendarClock}
          accentClass="text-amber-500"
          label="Due next 90 days"
          value={usd(due90.yearly)}
          hint={`${due90.count} domain${due90.count === 1 ? '' : 's'} renewing`}
        />
      </div>

      {/* Spend over time — sits between the totals and the composition donuts so
          the two rows of three never read as paired. */}
      <MonthlyBarChart months={months} />

      {/* Composition */}
      <div className="grid gap-4 lg:grid-cols-3">
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

function PageHeader({
  loading,
  summary,
}: {
  loading: boolean;
  summary: ReturnType<typeof summarize>;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[32px] font-bold">Renewals</h1>
        <p className="-mt-0.5 text-sm text-muted-foreground">
          {loading
            ? `Pricing… ${summary.priced}/${summary.total}`
            : summary.priced > 0
              ? `Forward-looking renewal costs · ${summary.priced}/${summary.total} priced · refresh with Sync on the Domains tab`
              : 'Annual renewal costs across your whole portfolio.'}
        </p>
      </div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  accentClass,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  /** Tailwind text-color for the background watermark (rendered at a low group
   * opacity), e.g. "text-emerald-500". */
  accentClass: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card px-4 pt-[9px] pb-[11px]">
      <Icon
        className={cn(
          // Fade the whole shape as a group (opacity-[0.15]) rather than using a
          // translucent stroke color — a semi-transparent stroke composites to
          // bright spots wherever the icon's paths overlap.
          'pointer-events-none absolute -right-4 -bottom-6 size-[123px] opacity-[0.15]',
          accentClass,
        )}
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="relative">
        <div className="text-[15px] text-foreground/75">{label}</div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

// ── Monthly bar chart ────────────────────────────────────────────────────────

// A calm subset of the donut palette for the bars — the cool/gold tones only,
// dropping the mauve/periwinkle/terracotta/indigo so 12 bars don't read as a
// rainbow.
const BAR_PALETTE = ['#6690bf', '#5fa387', '#c2a05f', '#5f9e9e'];

function MonthlyBarChart({ months }: { months: MonthBucket[] }) {
  const max = Math.max(1, ...months.map((m) => m.yearly));
  const total = months.reduce((sum, m) => sum + m.yearly, 0);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 pt-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold text-foreground/75">
          Renewals by month
        </h2>
        <span className="text-xs text-muted-foreground">
          {usd(total)} over 12 months
        </span>
      </div>
      <div className="flex items-end gap-1.5 pt-2">
        {months.map((m, i) => {
          const pct = (m.yearly / max) * 100;
          // Cycle the calm palette so adjacent months stay distinct without the
          // rainbow effect.
          const color = BAR_PALETTE[i % BAR_PALETTE.length];
          return (
            <div
              key={m.key}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="relative h-48 w-full">
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
                    // Subtle top-lit gradient (a touch lighter at the top) for
                    // depth rather than a flat fill.
                    backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${color} 80%, white), ${color})`,
                  }}
                  title={`${m.label}: ${usd(m.yearly)} · ${m.count} domain${
                    m.count === 1 ? '' : 's'
                  }`}
                />
                {m.yearly > 0 && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 -translate-y-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
                    style={{ bottom: `${pct}%` }}
                  >
                    {usd(m.yearly)}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{m.label}</span>
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
    registrar: string,
    domain: string,
    price: number | null,
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
                Annual price (USD)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((d) => {
              const p = priceOf(d, pricing);
              return (
                <PriceEditorRow
                  key={`${d.registrar}:${d.domainName}`}
                  domain={d}
                  label={registrarLabel(d.registrar, labels)}
                  current={p?.source === 'manual' ? p.renewal : null}
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
  isManual,
  onSave,
}: {
  domain: Domain;
  label: string;
  current: number | null;
  isManual: boolean;
  onSave: (
    registrar: string,
    domain: string,
    price: number | null,
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
      await onSave(domain.registrar, domain.domainName, parsed);
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
