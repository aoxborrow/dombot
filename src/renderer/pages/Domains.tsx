import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Lock,
  LockOpen,
  RefreshCw,
  RefreshCwOff,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Aftermarket, Domain, MarketListing } from '../../shared/ipc';
import { STALE_AFTER_MS } from '../../shared/ipc';
import { useAppStore } from '../store/app';
import { csvFilename, domainsToCsv } from '../lib/csv';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── Column model ────────────────────────────────────────────────────────────

type SortValue = string | number;

/** id → nicely capitalized registrar name, e.g. dynadot → "Dynadot". */
type RegistrarLabels = Record<string, string>;

interface Column {
  key: string;
  label: string;
  /** Cell renderer. */
  render: (d: Domain, labels: RegistrarLabels) => React.ReactNode;
  /** Value used for sorting; null/empty sorts last regardless of direction. */
  sortValue: (d: Domain, labels: RegistrarLabels) => SortValue | null;
  /** Right-align numeric-ish columns. */
  align?: 'left' | 'right';
  /** Comes from lazily-fetched per-domain detail; shows a loading placeholder
   * until that row's detail arrives. */
  detail?: boolean;
  /** Narrow column (trims header padding) — for the yes/no flag columns. */
  compact?: boolean;
}

/** Everything after the first dot, e.g. "example.co.uk" → "co.uk". */
function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

/** A registrar's display name, falling back to its raw id. */
function registrarLabel(id: string, labels: RegistrarLabels): string {
  return labels[id] ?? id;
}

function toTime(date: Date | null): number | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function fmtDate(date: Date | null): string {
  const t = toTime(date);
  return t === null ? '—' : new Date(t).toISOString().slice(0, 10);
}

/** Coarse "time ago" for the last-refreshed label, e.g. "3 hours ago". */
function timeAgo(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  const units: [label: string, secs: number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [label, size] of units) {
    const n = Math.floor(secs / size);
    if (n >= 1) return `${n} ${label}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

/** Whether a fetch timestamp is at or past the staleness threshold. */
function isStale(fetchedAt: number): boolean {
  return Date.now() - fetchedAt >= STALE_AFTER_MS;
}

/** Days until expiry, for the color-coded expiry cell. */
function daysUntil(date: Date | null): number | null {
  const t = toTime(date);
  return t === null ? null : Math.round((t - Date.now()) / 86_400_000);
}

/** Placeholder shown in a detail cell while that row's detail is loading. */
function CellSkeleton({ align }: { align?: 'left' | 'right' }) {
  return (
    <span
      className={cn(
        'inline-block h-3 animate-pulse rounded bg-muted',
        align === 'right' ? 'w-4' : 'w-24',
      )}
      aria-label="Loading…"
    />
  );
}

/** Formats a listing's price, e.g. "$11,231", or "Offer" for offer-only. */
function fmtPrice(l: MarketListing): string {
  if (l.price == null) return l.canMakeOffer ? 'Offer' : '—';
  return `$${l.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const AFTERNIC = 'afternic';

/** The Afternic listing for a domain, if any. */
function afternicListing(
  info: Aftermarket | null | undefined,
): MarketListing | null {
  return (
    info?.listings.find((l) => l.platform.toLowerCase() === AFTERNIC) ?? null
  );
}

/**
 * The numeric Afternic buy-it-now price for a domain, or null when there's no
 * listing or it's offer-only (no fixed price). Used by the price filter, which
 * compares against a numeric range — so offer-only and unlisted both count as
 * "no price".
 */
function afternicPriceOf(info: Aftermarket | null | undefined): number | null {
  return afternicListing(info)?.price ?? null;
}

/**
 * Parses a price-filter input. Empty → no bound (null value, no error). A valid
 * non-negative number → that value. Anything else → an error message and null
 * value so the bound is ignored until corrected.
 */
function parsePriceInput(raw: string): {
  value: number | null;
  error: string | null;
} {
  const s = raw.trim();
  if (s === '') return { value: null, error: null };
  if (!/^\d*\.?\d+$/.test(s)) return { value: null, error: 'Numbers only' };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, error: 'Numbers only' };
  return { value: n, error: null };
}

/** Afternic price cell, linking to the DomDB detail page. */
function AfternicCell({
  info,
  loading,
  onOpen,
}: {
  info: Aftermarket | null | undefined;
  loading: boolean;
  onOpen: (url: string) => void;
}) {
  if (loading && info === undefined) return <CellSkeleton align="right" />;
  const listing = afternicListing(info);
  if (!listing || !info || (listing.price == null && !listing.canMakeOffer)) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  // Offer-only listings show a muted "Offer" label so they don't read as a
  // price; listings with a buy-it-now price show the tabular figure.
  const offerOnly = listing.price == null;
  return (
    <button
      type="button"
      onClick={() => onOpen(info.detailUrl)}
      title={`Afternic: ${fmtPrice(listing)}`}
      className="group inline-flex items-baseline gap-1 hover:underline"
    >
      {/* Icon leads so the price/offer stays flush to the cell's right edge,
          aligned with the "—" shown for unlisted domains. */}
      <ExternalLink className="size-3 self-center text-muted-foreground/60 opacity-0 group-hover:opacity-100" />
      {offerOnly ? (
        <span className="text-xs font-normal tracking-wide text-muted-foreground uppercase">
          Offer
        </span>
      ) : (
        <span className="font-medium tabular-nums">{fmtPrice(listing)}</span>
      )}
    </button>
  );
}

/**
 * On/off state shown with column-appropriate icons: the `on` icon (emphasized)
 * when enabled, its muted `off` counterpart when disabled.
 */
function StateIcon({
  value,
  on: On,
  off: Off,
  onLabel,
  offLabel,
}: {
  value: boolean;
  on: LucideIcon;
  off: LucideIcon;
  onLabel: string;
  offLabel: string;
}) {
  return value ? (
    <On className="mx-auto size-4 text-emerald-500" aria-label={onLabel} />
  ) : (
    <Off
      className="mx-auto size-4 text-muted-foreground/50"
      aria-label={offLabel}
    />
  );
}

type LifecycleTone = 'redemption' | 'expired' | 'grace' | 'hold';

/**
 * A distinct fill color per lifecycle state, most→least urgent — all solid
 * warning pills: red, orange, amber, rose. Amber takes dark text for contrast.
 */
const LIFECYCLE_TONE: Record<LifecycleTone, string> = {
  redemption: 'bg-red-600 text-white',
  expired: 'bg-orange-500 text-white',
  grace: 'bg-amber-400 text-amber-950',
  hold: 'bg-rose-500 text-white',
};

/**
 * Detects a lifecycle problem from the normalized `status` string. There's no
 * dedicated flag across registrars, so we match the substrings each surfaces:
 * Gandi emits raw EPP codes, GoDaddy/Cloudflare/Spaceship lifecycle enums, and
 * Namecheap/Namesilo an "expired" once detail is fetched. Returns a short label
 * + tone, or null for healthy domains.
 */
function domainLifecycle(
  status: string,
): { label: string; tone: LifecycleTone } | null {
  const s = status.toLowerCase();
  if (/redemption|pending_?delete|recoverable|restorable/.test(s)) {
    return { label: 'Redemption', tone: 'redemption' };
  }
  if (/expired/.test(s)) return { label: 'Expired', tone: 'expired' };
  if (/grace|autorenewperiod|renewperiod/.test(s)) {
    return { label: 'Grace', tone: 'grace' };
  }
  if (/hold/.test(s)) return { label: 'Hold', tone: 'hold' };
  return null;
}

/** A distinctly-colored pill per lifecycle state; nothing when healthy. */
function LifecycleBadge({ status }: { status: string }) {
  const flag = domainLifecycle(status);
  if (!flag) return null;
  return (
    <Badge
      className={cn(
        'border-transparent px-1.5 py-0 text-[11px]',
        LIFECYCLE_TONE[flag.tone],
      )}
      title={`Registry status: ${status}`}
    >
      {flag.label}
    </Badge>
  );
}

const COLUMNS: Column[] = [
  {
    key: 'domainName',
    label: 'Domain',
    render: (d) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono">{d.domainName}</span>
        <LifecycleBadge status={d.status} />
      </span>
    ),
    sortValue: (d) => d.domainName.toLowerCase(),
  },
  {
    key: 'registrar',
    label: 'Registrar',
    render: (d, labels) => registrarLabel(d.registrar, labels),
    sortValue: (d, labels) => registrarLabel(d.registrar, labels).toLowerCase(),
  },
  {
    key: 'createdDate',
    label: 'Created',
    align: 'right',
    render: (d) => (
      <span className="font-mono text-muted-foreground">
        {fmtDate(d.createdDate)}
      </span>
    ),
    sortValue: (d) => toTime(d.createdDate),
  },
  {
    key: 'expirationDate',
    label: 'Expires',
    render: (d) => {
      const days = daysUntil(d.expirationDate);
      const color = expiryColor(days);
      return (
        <span
          className={cn(
            'inline-flex items-baseline gap-2.5 font-mono tabular-nums',
            color,
          )}
          title={dueLabel(days)}
        >
          <span>{fmtDate(d.expirationDate)}</span>
          {days !== null && (
            <span className="text-xs opacity-60">{relativeDays(days)}</span>
          )}
        </span>
      );
    },
    sortValue: (d) => toTime(d.expirationDate),
  },
  {
    key: 'autoRenew',
    label: 'Renew',
    align: 'right',
    compact: true,
    render: (d) => (
      <StateIcon
        value={d.autoRenew}
        on={RefreshCw}
        off={RefreshCwOff}
        onLabel="auto-renew on"
        offLabel="auto-renew off"
      />
    ),
    sortValue: (d) => (d.autoRenew ? 1 : 0),
  },
  {
    key: 'locked',
    label: 'Locked',
    align: 'right',
    detail: true,
    compact: true,
    render: (d) => (
      <StateIcon
        value={d.locked}
        on={Lock}
        off={LockOpen}
        onLabel="locked"
        offLabel="unlocked"
      />
    ),
    sortValue: (d) => (d.locked ? 1 : 0),
  },
  {
    key: 'privacy',
    label: 'Privacy',
    align: 'right',
    detail: true,
    compact: true,
    render: (d) => (
      <StateIcon
        value={d.privacy}
        on={EyeOff}
        off={Eye}
        onLabel="privacy on"
        offLabel="privacy off"
      />
    ),
    sortValue: (d) => (d.privacy ? 1 : 0),
  },
  {
    key: 'nameservers',
    label: 'Nameservers',
    detail: true,
    render: (d) =>
      d.nameservers.length === 0 ? (
        <span className="text-muted-foreground/50">—</span>
      ) : (
        <span
          className="block max-w-[260px] truncate font-mono text-xs text-muted-foreground"
          title={d.nameservers.join('\n')}
        >
          {d.nameservers.join(', ')}
        </span>
      ),
    sortValue: (d) => d.nameservers[0]?.toLowerCase() ?? '',
  },
];

function dueLabel(days: number | null): string {
  if (days === null) return 'No expiry date';
  if (days < 0) return `Expired ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

/** Compact relative form shown next to the date, e.g. "30d", "today", "5d ago". */
function relativeDays(days: number): string {
  if (days < 0) return `${-days}d ago`;
  if (days === 0) return 'today';
  return `${days}d`;
}

/**
 * Urgency heat ramp for the expiry date: red (expired or ≤14 days) → orange
 * (≤30) → yellow (≤60, a heads-up) → normal. Muted when there's no date.
 */
function expiryColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days <= 14) return 'text-red-600 dark:text-red-400';
  if (days <= 30) return 'text-orange-600 dark:text-orange-400';
  if (days <= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-foreground';
}

const PAGE_SIZES = [25, 50, 100, 250];
const ALL = '__all__';

/** Expiration-window filter options. Value is the day count; ALL disables it. */
const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: 'All Expirations' },
  { value: '30', label: 'Next 30 days' },
  { value: '60', label: 'Next 60 days' },
  { value: '90', label: 'Next 90 days' },
];

// ── Page ────────────────────────────────────────────────────────────────────

export default function Domains() {
  const {
    portfolio,
    portfolioErrors,
    portfolioRegistrars,
    portfolioRegistrarLabels,
    portfolioLoading,
    portfolioError,
    portfolioLoadedAt,
    refreshTick,
    loadPortfolio,
    enriched,
    enriching,
    enrichVisible,
    aftermarket,
    marketLoading,
    loadAftermarketVisible,
  } = useAppStore();

  const openExternal = (url: string) => void window.api.openExternal(url);

  // Overlay lazily-fetched per-domain detail (nameservers/privacy/lock) onto the
  // fast summary. Filtering, sorting, and rendering all use this merged view.
  const merged = useMemo(
    () => portfolio.map((d) => enriched[`${d.registrar}:${d.domainName}`] ?? d),
    [portfolio, enriched],
  );

  const [search, setSearch] = useState('');
  const [tld, setTld] = useState<string>(ALL);
  const [registrar, setRegistrar] = useState<string>(ALL);
  const [expiry, setExpiry] = useState<string>(ALL);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortKey, setSortKey] = useState('domainName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  // CSV export: an in-flight flag (dialog open + write) and a transient result
  // note ("Exported N rows to …" / an error) that clears itself after a moment.
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const exportNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (exportNoteTimer.current) clearTimeout(exportNoteTimer.current);
    },
    [],
  );

  const hasLoaded = portfolioLoadedAt !== null;
  // Data past the staleness threshold — highlight the timestamp to nudge a
  // manual refresh (we never auto-refresh).
  const stale = portfolioLoadedAt !== null && isStale(portfolioLoadedAt);

  // Distinct filter options, derived from the loaded portfolio.
  const tlds = useMemo(
    () =>
      Array.from(new Set(portfolio.map((d) => tldOf(d.domainName))))
        .filter(Boolean)
        .sort(),
    [portfolio],
  );
  const registrars = useMemo(
    () =>
      Array.from(new Set(portfolio.map((d) => d.registrar))).sort((a, b) =>
        registrarLabel(a, portfolioRegistrarLabels).localeCompare(
          registrarLabel(b, portfolioRegistrarLabels),
        ),
      ),
    [portfolio, portfolioRegistrarLabels],
  );

  // Validate the price inputs, then derive the bounds actually applied. A field
  // error (or min > max) leaves the range unapplied until it's corrected.
  const minParsed = parsePriceInput(minPrice);
  const maxParsed = parsePriceInput(maxPrice);
  const rangeError =
    minParsed.value !== null &&
    maxParsed.value !== null &&
    minParsed.value > maxParsed.value
      ? 'Min must be ≤ max'
      : null;
  const priceError = minParsed.error ?? maxParsed.error ?? rangeError;
  const minValue = priceError ? null : minParsed.value;
  const maxValue = priceError ? null : maxParsed.value;
  const priceFilterActive = minValue !== null || maxValue !== null;
  // While a price filter is active, Afternic data may still be streaming in for
  // off-screen rows — surface that so a shrinking result set reads as "loading".
  const pricesLoading =
    priceFilterActive &&
    merged.some((d) => aftermarket[d.domainName] === undefined);

  const expiryDays = expiry === ALL ? null : Number(expiry);

  // Filter → sort. Pagination is applied after, on the sorted result.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = merged.filter((d) => {
      if (q && !d.domainName.toLowerCase().includes(q)) return false;
      if (tld !== ALL && tldOf(d.domainName) !== tld) return false;
      if (registrar !== ALL && d.registrar !== registrar) return false;
      // Expiration window: keep domains due within N days (includes overdue).
      if (expiryDays !== null) {
        const days = daysUntil(d.expirationDate);
        if (days === null || days > expiryDays) return false;
      }
      // Afternic price range. With any bound set, unlisted/offer-only domains
      // (no numeric price) are excluded.
      if (priceFilterActive) {
        const price = afternicPriceOf(aftermarket[d.domainName]);
        if (price === null) return false;
        if (minValue !== null && price < minValue) return false;
        if (maxValue !== null && price > maxValue) return false;
      }
      return true;
    });

    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    // Afternic isn't a Domain field — sort by its price from the aftermarket map.
    const valueOf = (d: Domain): SortValue | null =>
      sortKey === AFTERNIC
        ? (afternicListing(aftermarket[d.domainName])?.price ?? null)
        : col.sortValue(d, portfolioRegistrarLabels);
    return rows.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      // Nulls/blanks always sort last, independent of direction.
      const aEmpty = av === null || av === '';
      const bEmpty = bv === null || bv === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [
    merged,
    portfolioRegistrarLabels,
    search,
    tld,
    registrar,
    expiryDays,
    priceFilterActive,
    minValue,
    maxValue,
    sortKey,
    sortDir,
    aftermarket,
  ]);

  // Derive the effective page: if filters shrink the result below the current
  // page, `safePage` clamps it without needing to write back to state (every
  // read and the pager buttons use `safePage`, so it stays self-correcting).
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);

  const start = safePage * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  // Lazily fetch full detail for the rows actually on screen. Keyed on the
  // visible domains' identities so it re-runs on page/sort/filter changes;
  // enrichVisible dedupes against already-fetched and in-flight domains.
  const visibleKey = visible
    .map((d) => `${d.registrar}:${d.domainName}`)
    .join('|');

  // After a live refresh (refreshTick bumps), force one re-fetch of the visible
  // rows' detail/market — bypassing the caches — then fall back to cache-first
  // for later paging. Refs remember which tick each concern already forced.
  const forcedDetailTick = useRef(0);
  const forcedMarketTick = useRef(0);

  useEffect(() => {
    const force = refreshTick !== forcedDetailTick.current;
    forcedDetailTick.current = refreshTick;
    void enrichVisible(visible, force);
    // visibleKey encodes the identity of the current page's rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, refreshTick, enrichVisible]);

  // Aftermarket pricing for the visible rows (rate-limited server-side).
  useEffect(() => {
    const force = refreshTick !== forcedMarketTick.current;
    forcedMarketTick.current = refreshTick;
    void loadAftermarketVisible(visible, force);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, refreshTick, loadAftermarketVisible]);

  // The price filter compares against Afternic data, which otherwise loads only
  // for on-screen rows. When a bound is set, pull it for the whole portfolio so
  // the filter is accurate across every page; the loader dedupes and is cached,
  // and results refine as each (rate-limited) fetch lands.
  useEffect(() => {
    if (priceFilterActive) void loadAftermarketVisible(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceFilterActive, merged, loadAftermarketVisible]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function resetFilters() {
    setSearch('');
    setTld(ALL);
    setRegistrar(ALL);
    setExpiry(ALL);
    setMinPrice('');
    setMaxPrice('');
    setPage(0);
  }

  const filtersActive =
    search !== '' ||
    tld !== ALL ||
    registrar !== ALL ||
    expiry !== ALL ||
    minPrice !== '' ||
    maxPrice !== '';

  function flashExportNote(text: string, error: boolean) {
    setExportNote({ text, error });
    if (exportNoteTimer.current) clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => setExportNote(null), 6000);
  }

  // Export the full filtered + sorted result set (every column we have, not just
  // the current page) via the native save dialog in main.
  async function exportCsv() {
    setExporting(true);
    try {
      const csv = domainsToCsv(filtered, portfolioRegistrarLabels, aftermarket);
      const result = await window.api.saveCsv(csv, csvFilename());
      if (!result.saved) return; // user cancelled the dialog
      const name = result.path?.split(/[/\\]/).pop() ?? 'file';
      const n = filtered.length;
      flashExportNote(
        `Exported ${n} row${n === 1 ? '' : 's'} to ${name}`,
        false,
      );
    } catch (err) {
      flashExportNote(
        err instanceof Error ? err.message : 'Export failed',
        true,
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Domains</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasLoaded
              ? `${portfolio.length} domain${portfolio.length === 1 ? '' : 's'} across ${portfolioRegistrars.length} registrar${
                  portfolioRegistrars.length === 1 ? '' : 's'
                }`
              : 'Load your portfolio across every configured registrar.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {exportNote && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm',
                exportNote.error
                  ? 'text-destructive'
                  : 'text-emerald-600 dark:text-emerald-400',
              )}
              role="status"
            >
              {!exportNote.error && <CircleCheck className="size-4" />}
              {exportNote.text}
            </span>
          )}
          {portfolioLoadedAt !== null ? (
            // The freshness label doubles as the refresh control: "Refreshed N
            // days ago" you can click to re-fetch. Goes amber (fill + dot + spin
            // icon) once the data crosses the staleness threshold.
            <Button
              variant="outline"
              onClick={() => void loadPortfolio()}
              disabled={portfolioLoading}
              title={`Refreshed ${new Date(portfolioLoadedAt).toLocaleString()}${
                stale
                  ? ' — data may be stale, click to refresh'
                  : ' — click to refresh'
              }`}
              className={cn(
                stale &&
                  'border-amber-500/50 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60 dark:hover:text-amber-300',
              )}
            >
              {stale && !portfolioLoading && (
                <span
                  className="size-2 rounded-full bg-amber-500 dark:bg-amber-400"
                  aria-hidden
                />
              )}
              <RefreshCw className={cn(portfolioLoading && 'animate-spin')} />
              {portfolioLoading
                ? 'Refreshing…'
                : `Refreshed ${timeAgo(portfolioLoadedAt)}`}
            </Button>
          ) : (
            <Button
              onClick={() => void loadPortfolio()}
              disabled={portfolioLoading}
            >
              {portfolioLoading ? 'Loading…' : 'Load domains'}
            </Button>
          )}
          {hasLoaded && (
            <Button
              variant="outline"
              onClick={() => void exportCsv()}
              disabled={exporting || filtered.length === 0}
              title="Export the filtered domains as a CSV file"
            >
              <Download />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          )}
        </div>
      </div>

      {portfolioError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn’t load your portfolio</AlertTitle>
          <AlertDescription>{portfolioError}</AlertDescription>
        </Alert>
      )}

      {portfolioErrors.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            {portfolioErrors.length} registrar
            {portfolioErrors.length === 1 ? '' : 's'} failed to load
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-0.5">
              {portfolioErrors.map((e) => (
                <li key={e.registrar}>
                  <span className="font-medium text-foreground">
                    {registrarLabel(e.registrar, portfolioRegistrarLabels)}
                  </span>
                  : {e.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {hasLoaded && (
        <>
          {/* Toolbar: search + filters */}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search domains…"
                  className="pl-8"
                />
              </div>

              <FilterSelect
                label="TLD"
                value={tld}
                onChange={(v) => {
                  setTld(v);
                  setPage(0);
                }}
                options={tlds}
                format={(t) => `.${t}`}
              />
              <FilterSelect
                label="Registrar"
                value={registrar}
                onChange={(v) => {
                  setRegistrar(v);
                  setPage(0);
                }}
                options={registrars}
                format={(id) => registrarLabel(id, portfolioRegistrarLabels)}
              />

              <Select
                value={expiry}
                onValueChange={(v) => {
                  setExpiry(v);
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-[170px]" aria-label="Expiration">
                  <SelectValue placeholder="Expiration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              {/* Afternic price range */}
              <div className="flex items-center gap-1.5">
                <PriceInput
                  value={minPrice}
                  onChange={(v) => {
                    setMinPrice(v);
                    setPage(0);
                  }}
                  placeholder="Min"
                  ariaLabel="Minimum Afternic price"
                  invalid={Boolean(minParsed.error) || Boolean(rangeError)}
                />
                <span className="text-muted-foreground">–</span>
                <PriceInput
                  value={maxPrice}
                  onChange={(v) => {
                    setMaxPrice(v);
                    setPage(0);
                  }}
                  placeholder="Max"
                  ariaLabel="Maximum Afternic price"
                  invalid={Boolean(maxParsed.error) || Boolean(rangeError)}
                />
              </div>

              {filtersActive && (
                <Button variant="outline" onClick={resetFilters}>
                  Clear
                </Button>
              )}
            </div>

            {(priceError || pricesLoading) && (
              <p
                className={cn(
                  'text-xs',
                  priceError ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {priceError ?? 'Loading Afternic prices…'}
              </p>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((col, i) => {
                    const active = col.key === sortKey;
                    const Icon = !active
                      ? ChevronsUpDown
                      : sortDir === 'asc'
                        ? ArrowUp
                        : ArrowDown;
                    return (
                      <Fragment key={col.key}>
                        <TableHead
                          className={cn(
                            col.align === 'right' && 'text-right',
                            col.compact && 'px-1',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              'inline-flex items-center gap-1 select-none hover:text-foreground',
                              col.align === 'right' && 'flex-row-reverse',
                              active && 'text-foreground',
                            )}
                          >
                            {col.label}
                            <Icon className="size-3.5 opacity-70" />
                          </button>
                        </TableHead>
                        {/* Afternic sits right after the domain name. */}
                        {i === 0 && (
                          <TableHead className="text-right">
                            <button
                              type="button"
                              onClick={() => toggleSort(AFTERNIC)}
                              className={cn(
                                'inline-flex select-none flex-row-reverse items-center gap-1 hover:text-foreground',
                                sortKey === AFTERNIC && 'text-foreground',
                              )}
                            >
                              Afternic
                              {(() => {
                                const AfIcon =
                                  sortKey !== AFTERNIC
                                    ? ChevronsUpDown
                                    : sortDir === 'asc'
                                      ? ArrowUp
                                      : ArrowDown;
                                return (
                                  <AfIcon className="size-3.5 opacity-70" />
                                );
                              })()}
                            </button>
                          </TableHead>
                        )}
                      </Fragment>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((d) => {
                  const loadingDetail =
                    enriching[`${d.registrar}:${d.domainName}`] === true;
                  return (
                    <TableRow key={`${d.registrar}:${d.domainName}`}>
                      {COLUMNS.map((col, i) => (
                        <Fragment key={col.key}>
                          <TableCell
                            className={cn(
                              col.align === 'right' && 'text-right',
                              col.compact && 'px-1',
                            )}
                          >
                            {col.detail && loadingDetail ? (
                              <CellSkeleton align={col.align} />
                            ) : (
                              col.render(d, portfolioRegistrarLabels)
                            )}
                          </TableCell>
                          {i === 0 && (
                            <TableCell className="text-right">
                              <AfternicCell
                                info={aftermarket[d.domainName]}
                                loading={marketLoading[d.domainName] === true}
                                onOpen={openExternal}
                              />
                            </TableCell>
                          )}
                        </Fragment>
                      ))}
                    </TableRow>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={COLUMNS.length + 1}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {portfolio.length === 0
                        ? 'No domains found in any configured registrar.'
                        : 'No domains match the current filters.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(0);
                }}
              >
                <SelectTrigger size="sm" className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <span>
                {filtered.length === 0
                  ? '0 of 0'
                  : `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={safePage === 0}
                  onClick={() => setPage(0)}
                  aria-label="First page"
                >
                  <ChevronsLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <span className="px-2 text-foreground">
                  {safePage + 1} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(pageCount - 1)}
                  aria-label="Last page"
                >
                  <ChevronsRight />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {!hasLoaded && !portfolioLoading && !portfolioError && (
        <Empty className="rounded-lg border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No domains loaded</EmptyTitle>
            <EmptyDescription>
              Click “Load domains” to fetch every configured registrar into one
              table.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

/** Numeric price field with a "$" prefix and no spinner buttons (type=text). */
function PriceInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  invalid: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={cn(
          'w-[104px] pl-6 tabular-nums',
          invalid && 'border-destructive focus-visible:ring-destructive/30',
        )}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  format,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  format?: (value: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {format ? format(o) : o}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
