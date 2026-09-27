import { useMemo, useState, type ComponentType } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleOff,
  Ellipsis,
  Flag,
  ReceiptText,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { toUnicode } from '../../shared/domain-name';
import { DomainEventType, type DomainEvent } from '../../shared/domain-events';
import type { RegistrarMeta, RegistrarName } from '../../shared/ipc';
import { DEFAULT_CURRENCY, DEFAULT_NUMBER_FORMAT } from '../../shared/money';
import {
  notifications,
  reviewPriority,
  type ReviewPriority,
} from '../../shared/notifications';
import { ownershipByDomain, type Ownership } from '../../shared/ownership';
import { resolvedIds } from '../../shared/sync-diff';
import { RegistrarLogo } from '../components/RegistrarLogo';
import {
  EventTypeBadge,
  EventTypeDot,
} from '../components/activity/EventTypeBadge';
import {
  DeleteDomainsDialog,
  DispositionDialog,
  MarkSoldDialog,
} from '../components/actions/OwnershipDialogs';
import { DataTable, type DataColumn } from '../components/data-table/DataTable';
import { sortRows, type SortValue } from '../components/data-table/table-state';
import {
  MultiSelectFilter,
  ResetButton,
  SearchField,
  ViewSwitch,
} from '../components/data-table/Toolbar';
import { PurchaseDialog } from '../components/domains/PurchaseDialog';
import { SaleDialog } from '../components/domains/SaleDialog';
import { accountName } from '../lib/domain-history';
import { REVIEW_ROW_TINT, SEVERITY_DOT } from '../lib/severity';
import {
  SOURCE_LABEL,
  VERB,
  alertDomain,
  eventAccounts,
  eventDay,
  eventDetails,
  resolutions,
  trackingSince,
  withinDays,
} from '../lib/activity';
import { usePreferences } from '../lib/preferences';
import { useAppStore } from '../store/app';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PRIORITY_LABEL: Record<ReviewPriority, string> = {
  high: 'High',
  low: 'Low',
};

const DATE_OPTIONS = [7, 14, 30, 90, 180].map((days) => ({
  value: String(days),
  label: `Last ${days} days`,
}));

const TYPE_ORDER: DomainEvent['type'][] = [
  'added',
  'removed',
  'moved',
  'registered',
  'purchased',
  'sold',
  'dropped',
  'archived',
  'renewed',
];

/**
 * One row: an event, and what the row shows for it. When you answer a sync
 * alert (a name that left or arrived), your answer takes the alert's row, so
 * "Removed" becomes "Dropped" in place rather than adding a second row.
 */
interface ActivityRow {
  /** The event the row is for; its id is the row's key. */
  event: DomainEvent;
  /** Your answer to it, or the event itself: the row's type, source, date,
   *  and details. */
  shown: DomainEvent;
}

type DialogState =
  | { kind: 'sold' | 'dropped' | 'archived' | 'delete'; rows: ActivityRow[] }
  | { kind: 'purchase'; row: ActivityRow };

/**
 * Every domain event, newest first: what you recorded (purchases, sales,
 * labels) and what sync saw (arrivals, departures, moves). An alert you've
 * answered shows your answer in its place. Open alerts are tinted by priority
 * with a Dismiss beside "Needs review"; every row has a menu to set the name's
 * state (Sold, Dropped, Archived), record a purchase, or delete it, and the
 * same actions work in bulk on a selection.
 */
export default function Activity() {
  const events = useAppStore((s) => s.domainEvents);
  const registrars = useAppStore((s) => s.registrars);
  const portfolio = useAppStore((s) => s.portfolio);
  const settings = useAppStore((s) => s.settings);
  const setAlertsDismissed = useAppStore((s) => s.setAlertsDismissed);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reviewOnly = params.get('review') === '1';
  const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  // The search lives in the URL, so the bell can open Activity on one name.
  const search = useMemo(() => params.get('q') ?? '', [params]);
  const setSearch = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const [types, setTypes] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(
    () => usePreferences.getState().pageSize,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // "Last N days" is measured from when the page opened.
  const [openedAt] = useState(() => Date.now());

  // The bell opens Needs review (or one name in it) with `fresh` state: clear
  // the other filters, page and selection, which live here rather than in the
  // URL, so leftovers can't hide what the bell pointed at when the page is
  // already open.
  const location = useLocation();
  const [seenKey, setSeenKey] = useState(location.key);
  if (location.key !== seenKey) {
    setSeenKey(location.key);
    if ((location.state as { fresh?: boolean } | null)?.fresh) {
      setTypes([]);
      setAccounts([]);
      setSources([]);
      setPriorities([]);
      setDays([]);
      setPage(0);
      setSelected(new Set());
    }
  }

  const resolved = useMemo(() => resolvedIds(events), [events]);
  const closedBy = useMemo(() => resolutions(events), [events]);
  const ownership = useMemo(() => ownershipByDomain(events), [events]);
  const priorityOf = (e: DomainEvent) => reviewPriority(e, resolved);

  // Your answer to an alert shows on the alert's row, not its own. (Sync's own
  // closures, a name coming back or a move, stay rows of their own.)
  const allRows = useMemo(() => {
    const ids = new Set(events.map((e) => e.id));
    const answerOf = (e: DomainEvent) => {
      const answer = closedBy.get(e.id);
      return answer && answer.source !== 'sync' ? answer : undefined;
    };
    return events
      .filter(
        (e) => !(e.resolves && e.source !== 'sync' && ids.has(e.resolves)),
      )
      .map((e): ActivityRow => ({ event: e, shown: answerOf(e) ?? e }));
  }, [events, closedBy]);
  const reviewCount = useMemo(() => notifications(events, []).length, [events]);
  const since = trackingSince(registrars);

  // Filter options, with counts over every event.
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { shown } of allRows)
      counts.set(shown.type, (counts.get(shown.type) ?? 0) + 1);
    return TYPE_ORDER.filter((t) => counts.has(t)).map((t) => ({
      value: t,
      label: VERB[t],
      count: counts.get(t),
      icon: <EventTypeDot type={t} />,
    }));
  }, [allRows]);
  const accountOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { event } of allRows)
      for (const id of new Set(eventAccounts(event)))
        counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts]
      .map(([value, count]) => ({
        value,
        label: accountName(registrars, value) ?? value,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allRows, registrars]);
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { shown } of allRows)
      counts.set(shown.source, (counts.get(shown.source) ?? 0) + 1);
    return (Object.keys(SOURCE_LABEL) as DomainEvent['source'][])
      .filter((s) => counts.has(s))
      .map((s) => ({ value: s, label: SOURCE_LABEL[s], count: counts.get(s) }));
  }, [allRows]);
  const priorityOptions = useMemo(() => {
    const counts = { high: 0, low: 0 };
    for (const e of events) {
      const p = reviewPriority(e, resolved);
      if (p) counts[p] += 1;
    }
    return (['high', 'low'] as const).map((p) => ({
      value: p,
      label: PRIORITY_LABEL[p],
      count: counts[p],
      icon: (
        <span
          className={cn('m-1 size-2 rounded-full', SEVERITY_DOT[p])}
          aria-hidden
        />
      ),
    }));
  }, [events, resolved]);

  // Date windows are cumulative, so their counts overlap (a change from 3
  // days ago counts in every window).
  const dateOptions = useMemo(
    () =>
      DATE_OPTIONS.map((o) => ({
        ...o,
        count: allRows.filter((r) =>
          withinDays(r.event, Number(o.value), openedAt),
        ).length,
      })),
    [allRows, openedAt],
  );

  const activeGroups =
    (types.length > 0 ? 1 : 0) +
    (accounts.length > 0 ? 1 : 0) +
    (sources.length > 0 ? 1 : 0) +
    (priorities.length > 0 ? 1 : 0) +
    (days.length > 0 ? 1 : 0);
  const hasActiveFilters = search.trim() !== '' || activeGroups > 0;

  function resetFilters() {
    setSearch('');
    setTypes([]);
    setAccounts([]);
    setSources([]);
    setPriorities([]);
    setDays([]);
    setPage(0);
  }

  const setView = (review: boolean) => {
    const next = new URLSearchParams(params);
    if (review) next.set('review', '1');
    else next.delete('review');
    setParams(next, { replace: true });
    setPage(0);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allRows.filter(({ event: e, shown }) => {
      if (q && !toUnicode(e.domain).includes(q) && !e.domain.includes(q))
        return false;
      const priority = reviewPriority(e, resolved);
      if (reviewOnly && !priority) return false;
      if (
        priorities.length > 0 &&
        (!priority || !priorities.includes(priority))
      )
        return false;
      if (types.length > 0 && !types.includes(shown.type)) return false;
      if (sources.length > 0 && !sources.includes(shown.source)) return false;
      if (
        accounts.length > 0 &&
        !eventAccounts(e).some((id) => accounts.includes(id))
      )
        return false;
      // Windows overlap, so any picked window means the widest one.
      if (
        days.length > 0 &&
        !withinDays(e, Math.max(...days.map(Number)), openedAt)
      )
        return false;
      return true;
    });
    const rank = { high: 0, low: 1 };
    const valueOf = ({ event: e, shown }: ActivityRow): SortValue | null => {
      switch (sortKey) {
        case 'domain':
          return toUnicode(e.domain);
        case 'type':
          return VERB[shown.type];
        case 'account':
          return accountName(registrars, e.accountId ?? e.toAccountId) ?? '';
        case 'source':
          return SOURCE_LABEL[shown.source];
        case 'status': {
          const p = reviewPriority(e, resolved);
          return p ? rank[p] : 2;
        }
        default:
          // The day it happened, then the order it was recorded.
          return `${eventDay(e)}|${e.id}`;
      }
    };
    return sortRows(filtered, valueOf, sortDir);
  }, [
    allRows,
    search,
    resolved,
    reviewOnly,
    priorities,
    types,
    sources,
    accounts,
    days,
    openedAt,
    sortKey,
    sortDir,
    registrars,
  ]);

  function toggleSort(key: string) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      // Dates read newest first; everything else A to Z.
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  }

  // Selection: any rows. State actions apply to each selected name once.
  const selectedRows = allRows.filter((r) => selected.has(r.event.id));
  const openSelected = selectedRows
    .map((r) => r.event)
    .filter((e) => priorityOf(e));
  const clearSelection = () => setSelected(new Set());

  const stateOf = (e: DomainEvent): Ownership | undefined =>
    ownership.get(e.domain);
  const held = (e: DomainEvent) =>
    portfolio.some((d) => d.domainName.toLowerCase() === toUnicode(e.domain));
  /** The alert a new state answers: the row's own, unless sync closed it. */
  const answers = (e: DomainEvent) => {
    if (
      e.source !== 'sync' ||
      (e.type !== DomainEventType.Removed && e.type !== DomainEventType.Added)
    )
      return undefined;
    const closer = closedBy.get(e.id);
    return closer && closer.source === 'sync' ? undefined : e.id;
  };
  /** One item per name, skipping names already in `label` (for Archived,
   *  any name already in Archive). */
  const itemsOf = (list: ActivityRow[], label?: string) => {
    const seen = new Set<string>();
    return list.flatMap(({ event: e }) => {
      if (seen.has(e.domain)) return [];
      seen.add(e.domain);
      const state = stateOf(e);
      if (label && state?.label === label) return [];
      if (label === 'archived' && state?.archived) return [];
      return [{ domainName: toUnicode(e.domain), resolves: answers(e) }];
    });
  };
  const namesOf = (list: ActivityRow[]) => [
    ...new Map(list.map((r) => [r.event.domain, r.event])).values(),
  ];

  function dismiss(list: DomainEvent[]) {
    const ids = list.map((e) => e.id);
    const what =
      list.length === 1 ? toUnicode(list[0].domain) : `${list.length} reviews`;
    void setAlertsDismissed(ids, true).then(() => {
      setSelected((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      toast.success(`Dismissed ${what}`, {
        action: {
          label: 'Undo',
          onClick: () => void setAlertsDismissed(ids, false),
        },
      });
    });
  }

  function showInDomains(e: DomainEvent) {
    const next = new URLSearchParams({ q: toUnicode(e.domain) });
    if (stateOf(e)?.archived) next.set('view', 'archive');
    navigate(`/?${next}`);
  }

  const columns: DataColumn<ActivityRow>[] = [
    {
      key: 'date',
      label: 'Date',
      cell: ({ event: e }) => (
        <span
          className="font-mono text-muted-foreground tabular-nums"
          title={new Date(e.createdAt).toLocaleString()}
        >
          {e.date ?? '—'}
        </span>
      ),
    },
    {
      key: 'domain',
      label: 'Domain',
      // The row's "⋯" menu, pinned to the cell's right edge like Domains'.
      cell: (row) => (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono compact:text-[13px]">
            {toUnicode(row.event.domain)}
          </span>
          <RowMenu
            row={row}
            state={stateOf(row.event)}
            needsReview={!!priorityOf(row.event)}
            onDialog={setDialog}
            onDismiss={() => dismiss([row.event])}
            onShow={() => showInDomains(row.event)}
          />
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      cell: ({ shown }) => <EventTypeBadge type={shown.type} />,
    },
    {
      key: 'account',
      label: 'Registrar',
      cell: ({ event: e }) =>
        e.type === DomainEventType.Moved ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <AccountLabel registrars={registrars} id={e.fromAccountId} />
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            <AccountLabel registrars={registrars} id={e.toAccountId} />
          </span>
        ) : e.accountId ? (
          <AccountLabel registrars={registrars} id={e.accountId} />
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      key: 'details',
      label: 'Details',
      sortable: false,
      hideOnMobile: true,
      cell: ({ shown }) =>
        eventDetails(shown, numberFormat, preferred) ?? (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      key: 'source',
      label: 'Source',
      hideOnMobile: true,
      cell: ({ shown }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {SOURCE_LABEL[shown.source]}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      cellClassName: 'py-0! align-middle',
      cell: ({ event: e }) => {
        const priority = priorityOf(e);
        if (!priority) return null;
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span
              className="inline-flex items-center gap-1.5 font-medium"
              title={`${PRIORITY_LABEL[priority]} priority`}
            >
              <span
                className={cn('size-2 rounded-full', SEVERITY_DOT[priority])}
                aria-hidden
              />
              Needs review
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-label={`Dismiss review of ${toUnicode(e.domain)}`}
              title="Dismiss review"
              onClick={() => dismiss([e])}
            >
              <X className="size-3.5" />
            </Button>
          </span>
        );
      },
    },
  ];

  const filterChips = (
    <>
      <MultiSelectFilter
        label="Registrar"
        icon={Building2}
        options={accountOptions}
        selected={accounts}
        onChange={(next) => {
          setAccounts(next);
          setPage(0);
        }}
      />
      <MultiSelectFilter
        label="Priority"
        icon={Flag}
        options={priorityOptions}
        selected={priorities}
        onChange={(next) => {
          setPriorities(next);
          setPage(0);
        }}
      />
      <MultiSelectFilter
        label="Type"
        icon={Tag}
        options={typeOptions}
        selected={types}
        onChange={(next) => {
          setTypes(next);
          setPage(0);
        }}
      />
      <MultiSelectFilter
        label="Source"
        icon={User}
        options={sourceOptions}
        selected={sources}
        onChange={(next) => {
          setSources(next);
          setPage(0);
        }}
      />
      <MultiSelectFilter
        label="Date"
        icon={CalendarClock}
        options={dateOptions}
        selected={days}
        onChange={(next) => {
          setDays(next);
          setPage(0);
        }}
      />
    </>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* -m-1 p-1 leaves room for focus rings, which the scroll box would clip. */}
      <div className="-m-1 flex min-h-0 flex-col gap-[13px] overflow-y-auto p-1">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-2xl font-bold leading-none sm:text-[32px]">
              Activity
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {since
                ? `Tracking changes since ${new Date(since).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
                : 'Changes are tracked from each account’s first sync'}
            </p>
          </div>
          <ViewSwitch
            label="Which activity to show"
            options={[
              {
                id: 'review',
                label: 'Needs review',
                count: reviewCount,
                active: reviewOnly,
                onClick: () => setView(true),
              },
              {
                id: 'all',
                label: 'All',
                count: allRows.length,
                active: !reviewOnly,
                onClick: () => setView(false),
              },
            ]}
          />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-3 sm:mt-3">
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            placeholder="Search domains…"
          />
          {/* Phones: the filters collapse behind a toggle. */}
          <Button
            variant="outline"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="gap-2 sm:hidden"
          >
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            Filters
            {activeGroups > 0 && (
              <Badge className="bg-primary px-1.5 py-0 text-xs tabular-nums text-primary-foreground">
                {activeGroups}
              </Badge>
            )}
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                filtersOpen && 'rotate-180',
              )}
            />
          </Button>
          <div
            className={cn(
              'flex-wrap items-center gap-3 max-sm:basis-full sm:contents',
              filtersOpen ? 'flex' : 'hidden',
            )}
          >
            {filterChips}
          </div>
          <ResetButton active={hasActiveFilters} onReset={resetFilters} />
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/70 bg-brand/10 py-1.5 pl-2.5 pr-[7px]">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-brand">
                <span className="pl-1 pr-px text-[16px] font-bold">
                  {selected.size}
                </span>{' '}
                selected
                {openSelected.length < selected.size && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {openSelected.length} need review
                  </span>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 border-brand/40 pl-1! pr-2.5 text-muted-foreground hover:bg-brand/10 hover:text-brand dark:border-brand/40 dark:hover:bg-brand/15 dark:hover:text-brand"
                onClick={clearSelection}
              >
                <X />
                Clear
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  Bulk actions
                  <ChevronDown className="text-primary-foreground/70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <BulkItem
                  icon={BadgeDollarSign}
                  label="Mark as Sold"
                  count={itemsOf(selectedRows, 'sold').length}
                  onSelect={() =>
                    setDialog({ kind: 'sold', rows: selectedRows })
                  }
                />
                <BulkItem
                  icon={CircleOff}
                  label="Mark as Dropped"
                  count={itemsOf(selectedRows, 'dropped').length}
                  onSelect={() =>
                    setDialog({ kind: 'dropped', rows: selectedRows })
                  }
                />
                <BulkItem
                  icon={Archive}
                  label="Archive"
                  count={itemsOf(selectedRows, 'archived').length}
                  onSelect={() =>
                    setDialog({ kind: 'archived', rows: selectedRows })
                  }
                />
                <DropdownMenuSeparator />
                <BulkItem
                  icon={X}
                  label="Dismiss review"
                  count={openSelected.length}
                  immediate
                  onSelect={() => dismiss(openSelected)}
                />
                <DropdownMenuSeparator />
                <BulkItem
                  icon={Trash2}
                  label="Delete"
                  count={namesOf(selectedRows).length}
                  destructive
                  onSelect={() =>
                    setDialog({ kind: 'delete', rows: selectedRows })
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <DataTable
        className="mt-[13px]"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.event.id}
        sort={{ key: sortKey, dir: sortDir }}
        onSort={toggleSort}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        selection={{
          selected,
          toggle: (id) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            }),
          setMany: (ids, on) =>
            setSelected((current) => {
              const next = new Set(current);
              for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
              }
              return next;
            }),
          allLabel: 'Select all activity',
          rowLabel: (r) =>
            `Select ${toUnicode(r.event.domain)} ${VERB[r.shown.type]}`,
        }}
        rowClassName={(r, selected) => {
          // A selected row shows the selection, not its priority tint.
          const p = !selected && priorityOf(r.event);
          return p ? REVIEW_ROW_TINT[p] : undefined;
        }}
        empty={
          reviewOnly && !hasActiveFilters
            ? 'Nothing needs review.'
            : events.length === 0
              ? 'No activity yet. Arrivals, departures, and moves appear after an account’s second sync; purchases and sales as you record them.'
              : 'No activity matches the current filters.'
        }
      />

      {dialog?.kind === 'sold' &&
        (dialog.rows.length === 1 ? (
          <SaleDialog
            domain={alertDomain(dialog.rows[0].event, portfolio, registrars)}
            mode="mark"
            resolves={answers(dialog.rows[0].event)}
            onSaved={clearSelection}
            onClose={() => setDialog(null)}
          />
        ) : (
          <MarkSoldDialog
            items={itemsOf(dialog.rows, 'sold')}
            onDone={clearSelection}
            onClose={() => setDialog(null)}
          />
        ))}
      {(dialog?.kind === 'dropped' || dialog?.kind === 'archived') && (
        <DispositionDialog
          type={dialog.kind}
          items={itemsOf(dialog.rows, dialog.kind)}
          onDone={clearSelection}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'purchase' && (
        <PurchaseDialog
          domain={alertDomain(dialog.row.event, portfolio, registrars)}
          // An arrival you haven't answered: record it as a new purchase.
          justRegistered={priorityOf(dialog.row.event) === 'low' || undefined}
          resolves={
            priorityOf(dialog.row.event) === 'low'
              ? dialog.row.event.id
              : undefined
          }
          onSaved={clearSelection}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDomainsDialog
          domains={namesOf(dialog.rows).map((e) => ({
            domainName: toUnicode(e.domain),
            departed: !held(e),
          }))}
          onDone={clearSelection}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** Registrar logo and account name (numbered or nicknamed when a registrar has several); "a removed account" when it's gone. */
function AccountLabel({
  registrars,
  id,
}: {
  registrars: RegistrarMeta[] | null;
  id: string | null | undefined;
}) {
  const meta = registrars?.find((r) => (r.accountId ?? r.name) === id);
  const name = accountName(registrars, id);
  if (!meta || !name)
    return <span className="text-muted-foreground">a removed account</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <RegistrarLogo
        name={meta.name as RegistrarName}
        label={meta.displayName}
        className="size-4"
      />
      {name}
    </span>
  );
}

/**
 * A row's "⋯" menu: set the name's state, record a purchase, dismiss its
 * review, open it in Domains, or delete it. The state it's already in,
 * Archive for a name already in Archive, and Dismiss on a row that doesn't
 * need review are disabled.
 */
function RowMenu({
  row,
  state,
  needsReview,
  onDialog,
  onDismiss,
  onShow,
}: {
  row: ActivityRow;
  state: Ownership | undefined;
  needsReview: boolean;
  onDialog: (dialog: DialogState) => void;
  onDismiss: () => void;
  onShow: () => void;
}) {
  const name = toUnicode(row.event.domain);
  const is = (label: string) => state?.label === label;
  const set = (kind: 'sold' | 'dropped' | 'archived' | 'delete') =>
    onDialog({ kind, rows: [row] });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${name}`}
          title="Actions"
          className="-my-2 text-muted-foreground hover:text-foreground compact:size-7"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={is('sold')} onSelect={() => set('sold')}>
          <BadgeDollarSign className="text-muted-foreground" />
          Mark as Sold…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={is('dropped')}
          onSelect={() => set('dropped')}
        >
          <CircleOff className="text-muted-foreground" />
          Mark as Dropped…
        </DropdownMenuItem>
        {/* Archive puts a name you own away without a reason. One already
            in Archive (Removed means "gone, no reason given") can't use it. */}
        <DropdownMenuItem
          disabled={!!state?.archived}
          onSelect={() => set('archived')}
        >
          <Archive className="text-muted-foreground" />
          Archive…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDialog({ kind: 'purchase', row })}>
          <ReceiptText className="text-muted-foreground" />
          Record purchase…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!needsReview} onSelect={onDismiss}>
          <X className="text-muted-foreground" />
          Dismiss review
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onShow}>
          <SquareArrowOutUpRight className="text-muted-foreground" />
          Show in Domains
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => set('delete')}>
          <Trash2 />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A bulk action with how many of the selection it applies to. */
function BulkItem({
  icon: Icon,
  label,
  count,
  immediate = false,
  destructive = false,
  onSelect,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  count: number;
  /** Runs at once instead of opening a dialog (no "…"). */
  immediate?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={count === 0}
      variant={destructive ? 'destructive' : 'default'}
      onSelect={onSelect}
    >
      <Icon className={destructive ? undefined : 'text-muted-foreground'} />
      {label}
      {!immediate && <span className="-ml-[6px] opacity-50">…</span>}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </DropdownMenuItem>
  );
}
