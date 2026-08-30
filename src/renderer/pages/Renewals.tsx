import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  Info,
  RefreshCw,
  TriangleAlert,
  Wallet,
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

/** USD with cents, e.g. "$12.99". */
function usdCents(n: number): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Renewals() {
  const {
    portfolio,
    portfolioLoadedAt,
    portfolioRegistrarLabels,
    pricing,
    pricingLoading,
    loadPricingAll,
    refreshPricing,
    setManualPrice,
  } = useAppStore();

  const hasPortfolio = portfolioLoadedAt !== null && portfolio.length > 0;
  const hasPricing = Object.keys(pricing).length > 0;

  // Auto-load pricing the first time the portfolio is available and nothing's
  // been fetched yet; the numbers fill in progressively as quotes arrive.
  useEffect(() => {
    if (hasPortfolio && !hasPricing && !pricingLoading) {
      void loadPricingAll(portfolio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPortfolio]);

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
        <PageHeader
          loading={pricingLoading}
          onLoad={undefined}
          onRefresh={undefined}
          summary={summary}
        />
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
      <PageHeader
        loading={pricingLoading}
        onLoad={hasPricing ? undefined : () => void loadPricingAll(portfolio)}
        onRefresh={hasPricing ? () => void refreshPricing() : undefined}
        summary={summary}
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CircleDollarSign className="size-4" />}
          label="Yearly renewals"
          value={usd(summary.yearly)}
          hint={`${usd(monthly)}/mo · avg ${usdCents(summary.avgPerDomain)}/domain`}
        />
        <StatCard
          icon={<Wallet className="size-4" />}
          label="Committed (auto-renew)"
          value={usd(summary.yearlyAutoRenew)}
          hint={`${usd(summary.yearly - summary.yearlyAutoRenew)} discretionary`}
        />
        <StatCard
          icon={<CalendarClock className="size-4" />}
          label="Due next 90 days"
          value={usd(due90.yearly)}
          hint={`${due90.count} domain${due90.count === 1 ? '' : 's'} renewing`}
        />
        <StatCard
          icon={<Info className="size-4" />}
          label="Coverage"
          value={`${summary.priced}/${summary.total}`}
          hint={coverageHint(summary)}
        />
      </div>

      {summary.unpriced > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            {summary.unpriced} domain{summary.unpriced === 1 ? '' : 's'} without
            a price
          </AlertTitle>
          <AlertDescription>
            Spaceship and NameBright expose no pricing API, and some lookups can
            miss. Enter prices by hand below to complete the totals.
            {summary.estimated > 0 &&
              ` ${summary.estimated} more are TLD-rate estimates (premium names may renew for more).`}
          </AlertDescription>
        </Alert>
      )}

      {/* Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownTable
          title="By registrar"
          heading="Registrar"
          groups={byRegistrar}
        />
        <BreakdownTable title="By TLD" heading="TLD" groups={byTld} />
      </div>

      {/* Renewal calendar */}
      <RenewalCalendar months={months} />

      {/* Manual price editor */}
      {needsPrice.length > 0 && (
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
  onLoad,
  onRefresh,
  summary,
}: {
  loading: boolean;
  onLoad?: () => void;
  onRefresh?: () => void;
  summary: ReturnType<typeof summarize>;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">Renewals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading
            ? `Pricing… ${summary.priced}/${summary.total}`
            : summary.priced > 0
              ? `Forward-looking renewal costs from current registrar quotes · ${summary.priced}/${summary.total} priced`
              : 'Annual renewal costs across your whole portfolio.'}
        </p>
      </div>
      {onLoad && (
        <Button onClick={onLoad} disabled={loading}>
          {loading ? 'Loading…' : 'Load pricing'}
        </Button>
      )}
      {onRefresh && (
        <Button variant="outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Refresh prices
        </Button>
      )}
    </div>
  );
}

function coverageHint(summary: ReturnType<typeof summarize>): string {
  const parts: string[] = [];
  if (summary.estimated > 0) parts.push(`${summary.estimated} estimated`);
  if (summary.manual > 0) parts.push(`${summary.manual} manual`);
  if (summary.unpriced > 0) parts.push(`${summary.unpriced} missing`);
  return parts.length > 0 ? parts.join(' · ') : 'all priced from API';
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

// ── Breakdown table ──────────────────────────────────────────────────────────

function BreakdownTable({
  title,
  heading,
  groups,
}: {
  title: string;
  heading: string;
  groups: Group[];
}) {
  const max = Math.max(1, ...groups.map((g) => g.yearly));
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{heading}</TableHead>
              <TableHead className="text-right">Domains</TableHead>
              <TableHead className="text-right">Yearly</TableHead>
              <TableHead className="text-right">Avg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.key}>
                <TableCell className="relative">
                  {/* Spend bar behind the label. */}
                  <span
                    className="absolute inset-y-1 left-0 rounded-sm bg-primary/10"
                    style={{ width: `${(g.yearly / max) * 100}%` }}
                    aria-hidden
                  />
                  <span className="relative font-medium">{g.label}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {g.priced < g.count ? `${g.priced}/${g.count}` : g.count}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {usd(g.yearly)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {g.priced > 0 ? usdCents(g.yearly / g.priced) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Renewal calendar ─────────────────────────────────────────────────────────

function RenewalCalendar({ months }: { months: MonthBucket[] }) {
  const max = Math.max(1, ...months.map((m) => m.yearly));
  const total = months.reduce((sum, m) => sum + m.yearly, 0);
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Next 12 months{' '}
        <span className="font-normal text-muted-foreground/70">
          · {usd(total)} due in window
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {months.map((m) => (
          <div key={m.key} className="rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground">
              {m.label}
            </div>
            <div className="mt-1 font-semibold tabular-nums">
              {m.yearly > 0 ? usd(m.yearly) : '—'}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(m.yearly / max) * 100}%` }}
              />
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {m.count} domain{m.count === 1 ? '' : 's'}
            </div>
          </div>
        ))}
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
      <h2 className="text-sm font-semibold text-muted-foreground">
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
