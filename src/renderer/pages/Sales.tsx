import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  Coins,
  Download,
  Ellipsis,
  Globe,
  History,
  Hourglass,
  Pencil,
  Store,
} from 'lucide-react';
import { toUnicode } from '../../shared/domain-name';
import { localDay } from '../../shared/domain-events';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatMoney,
} from '../../shared/money';
import {
  filterSaleRecords,
  saleRecordsCsv,
  saleTld,
  type SaleRecord,
  type SaleSource,
} from '../../shared/sales';
import { useAppStore } from '../store/app';
import { accountName } from '../lib/domain-history';
import {
  PAST_DATE_PRESETS,
  NO_DATE_RANGE,
  matchesDateRange,
  resolveDateRange,
  type DateRange,
} from '../lib/date-range';
import {
  isPending,
  isUnderWay,
  saleSourceLabel,
  saleStatusLabel,
  useSaleRecords,
} from '../lib/sales';
import { MarketLogo } from '../components/RegistrarLogo';
import { DataTable, type DataColumn } from '../components/data-table/DataTable';
import {
  FilterToolbar,
  listField,
  ToolbarSwitch,
} from '../components/data-table/FilterToolbar';
import type { FilterField } from '../components/data-table/FilterBar';
import { dateRangeField } from '../components/data-table/DateRangeFilter';
import { SaleDialog } from '../components/domains/SaleDialog';
import { SaleAuthCode } from '../components/sales/SaleAuthCode';
import { SalesCards, heldFor } from '../components/sales/SalesCards';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty as EmptyState,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

// The Sales tab (docs/sales-tab.md): every sale, from every source, one row
// each; sales under way pin to the top with their next step. The cards above
// add up what the filters leave, so a market, TLD, registrar or date filter
// shows that slice's totals, one currency at a time: amounts are never
// converted or combined.

type SortKey =
  | 'name'
  | 'soldOn'
  | 'source'
  | 'price'
  | 'fees'
  | 'net'
  | 'status'
  | 'paidOutOn'
  | 'held'
  | 'profit';

export default function Sales() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // All, or only the sales that haven't finished (like Activity's Needs
  // review): under way at a market, or waiting on the buyer to take the name.
  const pendingOnly = params.get('pending') === '1';
  const setView = (pending: boolean) => {
    const next = new URLSearchParams(params);
    if (pending) next.set('pending', '1');
    else next.delete('pending');
    setParams(next, { replace: true });
    setPage(0);
  };
  const records = useSaleRecords();
  const catalog = useAppStore((s) => s.marketCatalog);
  const registrars = useAppStore((s) => s.registrars);
  const marketAccounts = useAppStore((s) => s.marketAccounts);
  const settings = useAppStore((s) => s.settings);
  const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  // formatMoney takes no sign, so a loss is formatted unsigned and given a
  // minus sign here.
  const money = (amount: string | null, currency: string | null) =>
    amount && currency
      ? `${amount.startsWith('-') ? '−' : ''}${formatMoney(
          amount.replace(/^-/, ''),
          currency,
          preferred,
          numberFormat,
          true,
        )}`
      : null;

  const [search, setSearch] = useState('');
  const [sold, setSold] = useState<DateRange>(NO_DATE_RANGE);
  const [sources, setSources] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [tlds, setTlds] = useState<string[]>([]);
  const [registrarIds, setRegistrarIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('soldOn');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<SaleRecord | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const sourceName = (source: SaleSource) => saleSourceLabel(source, catalog);
  const registrarName = (r: SaleRecord) =>
    accountName(registrars, r.registrarAccountId) ?? '';
  // Sales waiting on you can only be acted on through an account that's
  // still connected, turned on and set up.
  const liveMarketAccounts = useMemo(
    () =>
      new Set(
        (marketAccounts ?? [])
          .filter((a) => a.enabled && a.configured)
          .map((a) => a.id),
      ),
    [marketAccounts],
  );

  // Filter: search and chips. The date bounds go through filterSaleRecords
  // so an undated sale is left out of a bounded range and counted.
  const { rows, undated } = useMemo(() => {
    const range = resolveDateRange(sold);
    const byDate = filterSaleRecords(records, {
      from: range.from,
      to: range.to,
      sources: sources as SaleSource[],
      currency: '',
    });
    const q = search.trim().toLowerCase();
    return {
      rows: byDate.records.filter(
        (r) =>
          (!currencies.length || currencies.includes(r.currency ?? '')) &&
          (!tlds.length || tlds.includes(saleTld(r))) &&
          (!registrarIds.length ||
            registrarIds.includes(r.registrarAccountId ?? '')) &&
          (!q ||
            r.name.includes(q) ||
            toUnicode(r.name).toLowerCase().includes(q)),
      ),
      undated: byDate.undated,
    };
  }, [records, sold, sources, currencies, tlds, registrarIds, search]);

  const pendingCount = useMemo(() => rows.filter(isPending).length, [rows]);
  const viewRows = useMemo(
    () => (pendingOnly ? rows.filter(isPending) : rows),
    [rows, pendingOnly],
  );

  // Pending first, then the chosen sort; blanks last either way.
  const sorted = useMemo(() => {
    const value = (r: SaleRecord): string | number | null => {
      switch (sortKey) {
        case 'name':
          return r.name;
        case 'soldOn':
          return r.soldOn;
        case 'source':
          return sourceName(r.source).toLowerCase();
        case 'price':
          return r.price === null ? null : Number(r.price);
        case 'fees':
          return r.fees === null ? null : Number(r.fees);
        case 'net':
          return r.net === null ? null : Number(r.net);
        case 'status':
          return saleStatusLabel(r);
        case 'paidOutOn':
          return r.paidOutOn;
        case 'held':
          return r.holdingDays;
        case 'profit':
          return r.profit === null ? null : Number(r.profit);
      }
    };
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...viewRows].sort((a, b) => {
      const pin = Number(isPending(b)) - Number(isPending(a));
      if (pin) return pin;
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null)
        return va === vb ? 0 : va === null ? 1 : -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
    // sourceName reads the catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRows, sortKey, sortDir, catalog]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key as SortKey);
      setSortDir(key === 'name' || key === 'source' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  // Filter options, counted over every record.
  const sourceOptions = useMemo(() => {
    const counts = new Map<SaleSource, number>();
    for (const r of records)
      counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
    return [...counts]
      .map(([value, count]) => ({ value, label: sourceName(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, catalog]);
  const tldOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const tld = saleTld(r);
      counts.set(tld, (counts.get(tld) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, count]) => ({ value, label: `.${value}`, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [records]);
  // By the account that held the name; '' is a sale with none on record.
  const registrarOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const id = r.registrarAccountId ?? '';
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, count]) => ({
        value,
        label: (value && accountName(registrars, value)) || 'Unknown',
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [records, registrars]);
  const currencyOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records)
      if (r.currency) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
    return [...counts]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  const filterFields: FilterField[] = [
    dateRangeField({
      key: 'soldOn',
      label: 'Sold',
      icon: CalendarClock,
      range: sold,
      presets: PAST_DATE_PRESETS,
      count: (range) =>
        records.filter((r) => matchesDateRange(r.soldOn, range)).length,
      onChange: (next) => {
        setSold(next);
        setPage(0);
      },
    }),
    listField(
      {
        key: 'source',
        label: 'Where',
        icon: Store,
        options: sourceOptions,
        selected: sources,
        plural: 'sources',
      },
      (next) => {
        setSources(next);
        setPage(0);
      },
    ),
    listField(
      {
        key: 'tld',
        label: 'TLD',
        icon: Globe,
        options: tldOptions,
        selected: tlds,
        plural: 'TLDs',
      },
      (next) => {
        setTlds(next);
        setPage(0);
      },
    ),
    listField(
      {
        key: 'registrar',
        label: 'Registrar',
        icon: Building2,
        options: registrarOptions,
        selected: registrarIds,
        plural: 'registrars',
      },
      (next) => {
        setRegistrarIds(next);
        setPage(0);
      },
    ),
    listField(
      {
        key: 'currency',
        label: 'Currency',
        icon: Coins,
        options: currencyOptions,
        selected: currencies,
        plural: 'currencies',
      },
      (next) => {
        setCurrencies(next);
        setPage(0);
      },
    ),
  ];

  async function exportCsv() {
    const csv = saleRecordsCsv(sorted, {
      source: (r) => sourceName(r.source),
      registrar: registrarName,
    });
    try {
      const result = await window.api.saveTextFile(
        csv,
        `dombot-sales-${localDay()}.csv`,
      );
      if (!result.saved) return;
      setExportNote(
        `Exported ${sorted.length} sale${sorted.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : 'Export failed');
    }
    setTimeout(() => setExportNote(null), 4000);
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const amountCell = (
    amount: string | null,
    currency: string | null,
    className?: string,
  ) => {
    const text = money(amount, currency);
    return text ? <span className={className}>{text}</span> : dash;
  };

  const columns: DataColumn<SaleRecord>[] = [
    {
      key: 'name',
      label: 'Domain',
      cell: (r) => (
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono">{toUnicode(r.name)}</span>
          <RowMenu
            record={r}
            marketName={sourceName(r.source)}
            website={catalog.find((m) => m.id === r.source)?.website}
            onHistory={() =>
              navigate(`/activity?q=${encodeURIComponent(toUnicode(r.name))}`)
            }
            onEdit={() => setEditing(r)}
          />
        </span>
      ),
    },
    {
      key: 'soldOn',
      label: 'Sold',
      cell: (r) =>
        r.soldOn ? (
          <span className="whitespace-nowrap tabular-nums">{r.soldOn}</span>
        ) : (
          <span className="text-muted-foreground">Undated</span>
        ),
    },
    {
      key: 'source',
      label: 'Where',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {r.source !== 'private' && r.source !== 'imported' && (
            <MarketLogo
              market={r.source === 'market' ? null : r.source}
              label={sourceName(r.source)}
              className="size-4 p-[1.5px] text-muted-foreground"
            />
          )}
          <span
            className={cn(
              (r.source === 'private' || r.source === 'imported') &&
                'text-muted-foreground',
            )}
          >
            {sourceName(r.source)}
          </span>
        </span>
      ),
    },
    {
      key: 'price',
      label: 'Price',
      align: 'right',
      cell: (r) =>
        amountCell(
          r.price,
          r.currency,
          cn(
            'tabular-nums',
            r.status === 'cancelled' && 'text-muted-foreground line-through',
          ),
        ),
    },
    {
      key: 'fees',
      label: 'Fees',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => (
        <span
          className="text-muted-foreground tabular-nums"
          title={
            r.feesEstimated
              ? 'Estimated from the market’s published commission rates'
              : undefined
          }
        >
          {r.status === 'cancelled' ? '—' : (money(r.fees, r.currency) ?? '—')}
          {r.feesEstimated && r.status !== 'cancelled' && '*'}
        </span>
      ),
    },
    {
      key: 'net',
      label: 'Net',
      align: 'right',
      cell: (r) =>
        r.status === 'cancelled'
          ? dash
          : amountCell(r.net, r.currency, 'tabular-nums font-medium'),
    },
    {
      key: 'status',
      label: 'Status',
      cellClassName: 'py-1',
      cell: (r) => (
        <span className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap',
              r.status !== 'completed' && 'text-muted-foreground',
              isUnderWay(r) && r.step && 'font-medium text-foreground',
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full',
                isUnderWay(r)
                  ? r.step
                    ? 'bg-amber-500'
                    : 'bg-sky-500'
                  : r.status === 'cancelled'
                    ? 'bg-muted-foreground/40'
                    : r.awaitingTransfer
                      ? 'bg-sky-500'
                      : 'bg-brand',
              )}
              aria-hidden
            />
            {saleStatusLabel(r)}
          </span>
          {r.step === 'auth_code' &&
            r.marketAccountId &&
            r.marketSaleId &&
            liveMarketAccounts.has(r.marketAccountId) && (
              <SaleAuthCode
                accountId={r.marketAccountId}
                saleId={r.marketSaleId}
                name={r.name}
              />
            )}
        </span>
      ),
    },
    {
      key: 'paidOutOn',
      label: 'Paid out',
      hideOnMobile: true,
      cell: (r) =>
        r.paidOutOn ? (
          <span className="whitespace-nowrap text-muted-foreground tabular-nums">
            {r.paidOutOn}
          </span>
        ) : (
          dash
        ),
    },
    {
      key: 'held',
      label: 'Held',
      align: 'right',
      hideOnMobile: true,
      cell: (r) =>
        r.holdingDays === null ? (
          dash
        ) : (
          <span
            className="whitespace-nowrap text-muted-foreground tabular-nums"
            title={r.acquiredOn ? `Since ${r.acquiredOn}` : undefined}
          >
            {heldFor(r.holdingDays)}
          </span>
        ),
    },
    {
      key: 'profit',
      label: 'Profit',
      align: 'right',
      hideOnMobile: true,
      cell: (r) =>
        r.profit === null ? (
          dash
        ) : (
          <span
            className={cn(
              'tabular-nums',
              Number(r.profit) < 0 && 'text-destructive',
            )}
            title={
              r.cost
                ? `Cost ${money(r.cost, r.currency)}${r.acquiredOn ? `, ${r.acquiredOn}` : ''}`
                : undefined
            }
          >
            {money(r.profit, r.currency)}
          </span>
        ),
    },
  ];

  if (records.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
        <h1 className="text-2xl font-bold sm:text-[32px]">Sales</h1>
        <EmptyState className="rounded-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BadgeDollarSign />
            </EmptyMedia>
            <EmptyTitle>No sales yet</EmptyTitle>
            <EmptyDescription>
              Every sale shows here: the ones a market reports, and the private
              ones you record with Mark as Sold on a name in Domains.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button asChild variant="outline">
              <Link to="/">Go to Domains</Link>
            </Button>
            {marketAccounts?.length === 0 && (
              <Button asChild>
                <Link to="/settings?tab=markets">Add a market account</Link>
              </Button>
            )}
          </EmptyContent>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="-m-1 flex min-h-0 flex-col gap-[13px] overflow-y-auto p-1">
        <div className="flex min-h-9 items-start justify-between gap-4">
          <h1 className="mt-1.5 text-2xl font-bold leading-none sm:mt-0.5 sm:text-[32px]">
            Sales
          </h1>
          <div className="flex items-center gap-3">
            {exportNote && (
              <span className="text-sm text-brand" role="status">
                {exportNote}
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => void exportCsv()}
              disabled={sorted.length === 0}
            >
              <Download />
              Export CSV
            </Button>
          </div>
        </div>

        {/* The view first, as on Renewals. */}
        <div className="flex">
          <ToolbarSwitch
            label="Which sales to show"
            options={[
              {
                id: 'all',
                label: 'All',
                icon: BadgeDollarSign,
                count: rows.length,
                active: !pendingOnly,
                onClick: () => setView(false),
              },
              {
                id: 'pending',
                label: 'Pending',
                icon: Hourglass,
                count: pendingCount,
                active: pendingOnly,
                onClick: () => setView(true),
              },
            ]}
          />
        </div>

        <SalesCards rows={viewRows} money={money} />

        <FilterToolbar
          id="sales"
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(0);
          }}
          searchPlaceholder="Search domains…"
          fields={filterFields}
          presets={['soldOn', 'source', 'tld', 'registrar']}
          presetsIfRoom={['tld', 'registrar']}
        >
          {undated > 0 && (
            <span className="text-xs text-muted-foreground">
              {undated} undated sale{undated === 1 ? '' : 's'} left out
            </span>
          )}
        </FilterToolbar>
      </div>

      <DataTable
        className="mt-[13px]"
        rows={sorted}
        columns={columns}
        rowKey={(r) => r.id}
        sort={{ key: sortKey, dir: sortDir }}
        onSort={toggleSort}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowClassName={(r) =>
          isUnderWay(r) && r.step ? 'bg-amber-500/[0.06]' : undefined
        }
        empty={
          pendingOnly && !pendingCount
            ? 'No sales pending: every sale has finished.'
            : 'No sales match the current filters.'
        }
      />

      {editing && (
        <SaleDialog
          domain={{ domainName: toUnicode(editing.name) }}
          eventId={editing.eventId ?? undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowMenu({
  record: r,
  marketName,
  website,
  onHistory,
  onEdit,
}: {
  record: SaleRecord;
  marketName: string;
  website: string | undefined;
  onHistory: () => void;
  onEdit: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for the sale of ${toUnicode(r.name)}`}
          className="-my-2 w-7 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={onHistory}>
          <History />
          History
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onEdit}
          // A market sale with no event yet has nothing of yours to edit.
          disabled={!r.eventId}
        >
          <Pencil />
          Edit sale…
        </DropdownMenuItem>
        {website && (
          <DropdownMenuItem
            onSelect={() => void window.api.openExternal(website)}
          >
            <ArrowUpRight />
            Open {marketName}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
