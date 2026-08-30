import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ExternalLink,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { Aftermarket, Domain, MarketListing } from '../../shared/ipc';
import { useAppStore } from '../store/app';
import { cn } from '@/lib/utils';
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

/** Listings other than Afternic (already sorted lowest-price-first). */
function otherListings(info: Aftermarket | null | undefined): MarketListing[] {
  return (
    info?.listings.filter((l) => l.platform.toLowerCase() !== AFTERNIC) ?? []
  );
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
  if (!listing || !info) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(info.detailUrl)}
      title={`Afternic: ${fmtPrice(listing)}`}
      className="group inline-flex items-baseline gap-1 font-medium tabular-nums hover:underline"
    >
      {fmtPrice(listing)}
      <ExternalLink className="size-3 self-center text-muted-foreground/60 opacity-0 group-hover:opacity-100" />
    </button>
  );
}

/** Other marketplaces: lowest listing + "+N more", linking to DomDB. */
function MarketsCell({
  info,
  loading,
  onOpen,
}: {
  info: Aftermarket | null | undefined;
  loading: boolean;
  onOpen: (url: string) => void;
}) {
  if (loading && info === undefined) return <CellSkeleton align="left" />;
  const others = otherListings(info);
  if (!info || others.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const lowest = others[0];
  const more = others.length - 1;
  const tooltip = others.map((l) => `${l.platform}: ${fmtPrice(l)}`).join('\n');
  return (
    <button
      type="button"
      onClick={() => onOpen(info.detailUrl)}
      title={tooltip}
      className="group inline-flex items-baseline gap-1.5 hover:underline"
    >
      <span className="font-medium tabular-nums">{fmtPrice(lowest)}</span>
      <span className="text-xs text-muted-foreground">{lowest.platform}</span>
      {more > 0 && (
        <span className="text-xs text-muted-foreground">+{more} more</span>
      )}
      <ExternalLink className="size-3 self-center text-muted-foreground/60 opacity-0 group-hover:opacity-100" />
    </button>
  );
}

/** A yes/no flag: a green check for yes, a rose ✕ for no. */
function Flag({ value }: { value: boolean }) {
  return value ? (
    <Check className="mx-auto size-4 text-emerald-500" aria-label="yes" />
  ) : (
    <X className="mx-auto size-4 text-rose-400" aria-label="no" />
  );
}

const COLUMNS: Column[] = [
  {
    key: 'domainName',
    label: 'Domain',
    render: (d) => <span className="font-mono">{d.domainName}</span>,
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
    render: (d) => <Flag value={d.autoRenew} />,
    sortValue: (d) => (d.autoRenew ? 1 : 0),
  },
  {
    key: 'locked',
    label: 'Locked',
    align: 'right',
    detail: true,
    compact: true,
    render: (d) => <Flag value={d.locked} />,
    sortValue: (d) => (d.locked ? 1 : 0),
  },
  {
    key: 'privacy',
    label: 'Privacy',
    align: 'right',
    detail: true,
    compact: true,
    render: (d) => <Flag value={d.privacy} />,
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

/** Urgency color: red past-due, amber within 30 days, muted otherwise. */
function expiryColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days < 0) return 'text-destructive';
  if (days <= 30) return 'text-amber-600 dark:text-amber-400';
  return 'text-foreground';
}

const PAGE_SIZES = [25, 50, 100, 250];
const ALL = '__all__';

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
  const [sortKey, setSortKey] = useState('domainName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  const hasLoaded = portfolioLoadedAt !== null;

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

  // Filter → sort. Pagination is applied after, on the sorted result.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = merged.filter((d) => {
      if (q && !d.domainName.toLowerCase().includes(q)) return false;
      if (tld !== ALL && tldOf(d.domainName) !== tld) return false;
      if (registrar !== ALL && d.registrar !== registrar) return false;
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
  useEffect(() => {
    void enrichVisible(visible);
    // visibleKey encodes the identity of the current page's rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, enrichVisible]);

  // Aftermarket pricing for the visible rows (rate-limited server-side).
  useEffect(() => {
    void loadAftermarketVisible(visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, loadAftermarketVisible]);

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
    setPage(0);
  }

  const filtersActive = search !== '' || tld !== ALL || registrar !== ALL;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Domains</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasLoaded
              ? `${portfolio.length} domain${portfolio.length === 1 ? '' : 's'} across ${portfolioRegistrars.length} registrar${
                  portfolioRegistrars.length === 1 ? '' : 's'
                }${
                  portfolioLoadedAt
                    ? ` · updated ${new Date(portfolioLoadedAt).toLocaleTimeString()}`
                    : ''
                }`
              : 'Load your portfolio across every configured registrar.'}
          </p>
        </div>
        <Button
          onClick={() => void loadPortfolio()}
          disabled={portfolioLoading}
        >
          {portfolioLoading
            ? 'Loading…'
            : hasLoaded
              ? 'Refresh'
              : 'Load domains'}
        </Button>
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
            {filtersActive && (
              <Button variant="outline" onClick={resetFilters}>
                Clear
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((col) => {
                    const active = col.key === sortKey;
                    const Icon = !active
                      ? ChevronsUpDown
                      : sortDir === 'asc'
                        ? ArrowUp
                        : ArrowDown;
                    return (
                      <TableHead
                        key={col.key}
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
                    );
                  })}
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
                        const Icon =
                          sortKey !== AFTERNIC
                            ? ChevronsUpDown
                            : sortDir === 'asc'
                              ? ArrowUp
                              : ArrowDown;
                        return <Icon className="size-3.5 opacity-70" />;
                      })()}
                    </button>
                  </TableHead>
                  <TableHead>Markets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((d) => {
                  const loadingDetail =
                    enriching[`${d.registrar}:${d.domainName}`] === true;
                  return (
                    <TableRow key={`${d.registrar}:${d.domainName}`}>
                      {COLUMNS.map((col) => (
                        <TableCell
                          key={col.key}
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
                      ))}
                      <TableCell className="text-right">
                        <AfternicCell
                          info={aftermarket[d.domainName]}
                          loading={marketLoading[d.domainName] === true}
                          onOpen={openExternal}
                        />
                      </TableCell>
                      <TableCell>
                        <MarketsCell
                          info={aftermarket[d.domainName]}
                          loading={marketLoading[d.domainName] === true}
                          onOpen={openExternal}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={COLUMNS.length + 2}
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
