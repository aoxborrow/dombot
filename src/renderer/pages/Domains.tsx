import { useMemo, useState } from 'react';
import type { Domain } from '../../shared/ipc';
import { useAppStore } from '../store/app';

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
  className?: string;
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

function Bool({ value }: { value: boolean }) {
  return (
    <span className={value ? 'text-emerald-400' : 'text-slate-600'}>
      {value ? 'yes' : 'no'}
    </span>
  );
}

const COLUMNS: Column[] = [
  {
    key: 'domainName',
    label: 'Domain',
    render: (d) => (
      <span className="font-mono text-slate-100">{d.domainName}</span>
    ),
    sortValue: (d) => d.domainName.toLowerCase(),
  },
  {
    key: 'registrar',
    label: 'Registrar',
    render: (d, labels) => (
      <span className="text-slate-300">
        {registrarLabel(d.registrar, labels)}
      </span>
    ),
    sortValue: (d, labels) => registrarLabel(d.registrar, labels).toLowerCase(),
  },
  {
    key: 'createdDate',
    label: 'Created',
    align: 'right',
    render: (d) => (
      <span className="font-mono text-slate-400">{fmtDate(d.createdDate)}</span>
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
          className={`inline-flex items-baseline gap-3 font-mono tabular-nums ${color}`}
          title={dueLabel(days)}
        >
          <span>{fmtDate(d.expirationDate)}</span>
          <span className="w-16 text-right text-xs">
            {days !== null ? relativeDays(days) : ''}
          </span>
        </span>
      );
    },
    sortValue: (d) => toTime(d.expirationDate),
  },
  {
    key: 'autoRenew',
    label: 'Auto-renew',
    align: 'right',
    render: (d) => <Bool value={d.autoRenew} />,
    sortValue: (d) => (d.autoRenew ? 1 : 0),
  },
  {
    key: 'locked',
    label: 'Locked',
    align: 'right',
    render: (d) => <Bool value={d.locked} />,
    sortValue: (d) => (d.locked ? 1 : 0),
  },
  {
    key: 'privacy',
    label: 'Privacy',
    align: 'right',
    render: (d) => <Bool value={d.privacy} />,
    sortValue: (d) => (d.privacy ? 1 : 0),
  },
  {
    key: 'nameservers',
    label: 'Nameservers',
    render: (d) =>
      d.nameservers.length === 0 ? (
        <span className="text-slate-600">—</span>
      ) : (
        <span
          className="font-mono text-xs text-slate-400"
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
  if (days === null) return 'text-slate-500';
  if (days < 0) return 'text-red-400';
  if (days <= 30) return 'text-amber-400';
  return 'text-slate-400';
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
  } = useAppStore();

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
    const rows = portfolio.filter((d) => {
      if (q && !d.domainName.toLowerCase().includes(q)) return false;
      if (tld !== ALL && tldOf(d.domainName) !== tld) return false;
      if (registrar !== ALL && d.registrar !== registrar) return false;
      return true;
    });

    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const av = col.sortValue(a, portfolioRegistrarLabels);
      const bv = col.sortValue(b, portfolioRegistrarLabels);
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
    portfolio,
    portfolioRegistrarLabels,
    search,
    tld,
    registrar,
    sortKey,
    sortDir,
  ]);

  // Derive the effective page: if filters shrink the result below the current
  // page, `safePage` clamps it without needing to write back to state (every
  // read and the pager buttons use `safePage`, so it stays self-correcting).
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);

  const start = safePage * pageSize;
  const visible = filtered.slice(start, start + pageSize);

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
          <p className="mt-1 text-sm text-slate-400">
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
        <button
          onClick={() => void loadPortfolio()}
          disabled={portfolioLoading}
          className="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {portfolioLoading
            ? 'Loading…'
            : hasLoaded
              ? 'Refresh'
              : 'Load domains'}
        </button>
      </div>

      {portfolioError && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {portfolioError}
        </p>
      )}

      {portfolioErrors.length > 0 && (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
          <p className="font-medium">
            {portfolioErrors.length} registrar
            {portfolioErrors.length === 1 ? '' : 's'} failed to load:
          </p>
          <ul className="mt-1 space-y-0.5">
            {portfolioErrors.map((e) => (
              <li key={e.registrar} className="text-amber-400/90">
                <span className="font-medium">
                  {registrarLabel(e.registrar, portfolioRegistrarLabels)}
                </span>
                : {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasLoaded && (
        <>
          {/* Toolbar: search + filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search domains…"
              className="min-w-[220px] flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
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
              <button
                onClick={resetFilters}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-800">
                  {COLUMNS.map((col) => {
                    const active = col.key === sortKey;
                    return (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 font-medium hover:text-slate-300 ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        } ${active ? 'text-indigo-400' : ''}`}
                      >
                        {col.label}
                        <span className="ml-1 inline-block w-2 text-slate-600">
                          {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {visible.map((d) => (
                  <tr
                    key={`${d.registrar}:${d.domainName}`}
                    className="hover:bg-slate-900/60"
                  >
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-3 py-2 ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {col.render(d, portfolioRegistrarLabels)}
                      </td>
                    ))}
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-3 py-10 text-center text-slate-500"
                    >
                      {portfolio.length === 0
                        ? 'No domains found in any configured registrar.'
                        : 'No domains match the current filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <span>
                {filtered.length === 0
                  ? '0 of 0'
                  : `${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`}
              </span>
              <div className="flex gap-1">
                <PageButton
                  disabled={safePage === 0}
                  onClick={() => setPage(0)}
                >
                  «
                </PageButton>
                <PageButton
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  ‹
                </PageButton>
                <span className="px-2 py-1 text-slate-300">
                  {safePage + 1} / {pageCount}
                </span>
                <PageButton
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  ›
                </PageButton>
                <PageButton
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(pageCount - 1)}
                >
                  »
                </PageButton>
              </div>
            </div>
          </div>
        </>
      )}

      {!hasLoaded && !portfolioLoading && !portfolioError && (
        <div className="rounded-lg border border-dashed border-slate-800 px-6 py-16 text-center text-slate-500">
          Click “Load domains” to fetch every configured registrar into one
          table.
        </div>
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
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
    >
      <option value={ALL}>All {label.toLowerCase()}s</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {format ? format(o) : o}
        </option>
      ))}
    </select>
  );
}

function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
