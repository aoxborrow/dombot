import { useMemo, useState, type ComponentType } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleOff,
  Flag,
  ReceiptText,
  SlidersHorizontal,
  Tag,
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
import { resolvedIds } from '../../shared/sync-diff';
import { RegistrarLogo } from '../components/RegistrarLogo';
import {
  EventTypeBadge,
  EventTypeDot,
} from '../components/activity/EventTypeBadge';
import {
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
  alertStatus,
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

type DialogState =
  | { kind: 'sold' | 'dropped' | 'archived'; events: DomainEvent[] }
  | { kind: 'purchase'; event: DomainEvent };

/**
 * Every domain event, newest first: what you recorded (purchases, sales,
 * labels) and what sync saw (arrivals, departures, moves). Open alerts are
 * tinted by priority and carry their actions; answered or dismissed ones keep
 * their outcome and can be undone, so nothing disappears. Select alerts to
 * act on many at once.
 */
export default function Activity() {
  const events = useAppStore((s) => s.domainEvents);
  const registrars = useAppStore((s) => s.registrars);
  const portfolio = useAppStore((s) => s.portfolio);
  const settings = useAppStore((s) => s.settings);
  const setAlertsDismissed = useAppStore((s) => s.setAlertsDismissed);
  const deleteUserEvent = useAppStore((s) => s.deleteUserEvent);
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
  const priorityOf = (e: DomainEvent) => reviewPriority(e, resolved);
  const reviewCount = useMemo(() => notifications(events, []).length, [events]);
  const since = trackingSince(registrars);

  // Filter options, with counts over every event.
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return TYPE_ORDER.filter((t) => counts.has(t)).map((t) => ({
      value: t,
      label: VERB[t],
      count: counts.get(t),
      icon: <EventTypeDot type={t} />,
    }));
  }, [events]);
  const accountOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events)
      for (const id of new Set(eventAccounts(e)))
        counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts]
      .map(([value, count]) => ({
        value,
        label: accountName(registrars, value) ?? value,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [events, registrars]);
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events)
      counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    return (Object.keys(SOURCE_LABEL) as DomainEvent['source'][])
      .filter((s) => counts.has(s))
      .map((s) => ({ value: s, label: SOURCE_LABEL[s], count: counts.get(s) }));
  }, [events]);
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
        count: events.filter((e) => withinDays(e, Number(o.value), openedAt))
          .length,
      })),
    [events, openedAt],
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
    const filtered = events.filter((e) => {
      if (q && !toUnicode(e.domain).includes(q) && !e.domain.includes(q))
        return false;
      const priority = reviewPriority(e, resolved);
      if (reviewOnly && !priority) return false;
      if (
        priorities.length > 0 &&
        (!priority || !priorities.includes(priority))
      )
        return false;
      if (types.length > 0 && !types.includes(e.type)) return false;
      if (sources.length > 0 && !sources.includes(e.source)) return false;
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
    const valueOf = (e: DomainEvent): SortValue | null => {
      switch (sortKey) {
        case 'domain':
          return toUnicode(e.domain);
        case 'type':
          return VERB[e.type];
        case 'account':
          return accountName(registrars, e.accountId ?? e.toAccountId) ?? '';
        case 'source':
          return SOURCE_LABEL[e.source];
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
    events,
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

  // Selection: only open alerts can be acted on in bulk.
  const selectedEvents = events.filter((e) => selected.has(e.id));
  const openSelected = selectedEvents.filter((e) => priorityOf(e));
  const departures = openSelected.filter(
    (e) => e.type === DomainEventType.Removed,
  );
  const clearSelection = () => setSelected(new Set());

  const itemsOf = (list: DomainEvent[]) =>
    list.map((e) => ({ domainName: toUnicode(e.domain), resolves: e.id }));

  function dismiss(list: DomainEvent[]) {
    const ids = list.map((e) => e.id);
    const what =
      list.length === 1 ? toUnicode(list[0].domain) : `${list.length} alerts`;
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

  const columns: DataColumn<DomainEvent>[] = [
    {
      key: 'date',
      label: 'Date',
      cell: (e) => (
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
      cell: (e) => (
        <span className="font-mono compact:text-[13px]">
          {toUnicode(e.domain)}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      cell: (e) => <EventTypeBadge type={e.type} />,
    },
    {
      key: 'account',
      label: 'Registrar',
      cell: (e) =>
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
      cell: (e) =>
        eventDetails(e, numberFormat, preferred) ?? (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      key: 'source',
      label: 'Source',
      hideOnMobile: true,
      cell: (e) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {SOURCE_LABEL[e.source]}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      cell: (e) => {
        const priority = priorityOf(e);
        if (priority) {
          return (
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium"
              title={`${PRIORITY_LABEL[priority]} priority`}
            >
              <span
                className={cn('size-2 rounded-full', SEVERITY_DOT[priority])}
                aria-hidden
              />
              Needs review
            </span>
          );
        }
        const closer = closedBy.get(e.id);
        const status = alertStatus(e, closer);
        if (!status) return null;
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
            {status.text}
            {status.undo && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="-my-1"
                onClick={() =>
                  void (
                    status.undo === 'dismissal'
                      ? setAlertsDismissed([e.id], false)
                      : deleteUserEvent(closer!.id)
                  ).then(() =>
                    toast.success(`${toUnicode(e.domain)} needs review again`),
                  )
                }
              >
                Undo
              </Button>
            )}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      cellClassName: 'py-0! align-middle',
      cell: (e) => {
        if (!priorityOf(e)) return null;
        const left = e.type === DomainEventType.Removed;
        return (
          <span className="flex items-center gap-0.5">
            <RowAction
              icon={BadgeDollarSign}
              label="Mark as Sold"
              disabled={!left}
              onClick={() => setDialog({ kind: 'sold', events: [e] })}
            />
            <RowAction
              icon={CircleOff}
              label="Mark as Dropped"
              disabled={!left}
              onClick={() => setDialog({ kind: 'dropped', events: [e] })}
            />
            <RowAction
              icon={Archive}
              label="Archive"
              disabled={!left}
              onClick={() => setDialog({ kind: 'archived', events: [e] })}
            />
            <RowAction
              icon={ReceiptText}
              label="Record purchase"
              disabled={left}
              onClick={() => setDialog({ kind: 'purchase', event: e })}
            />
            <RowAction icon={X} label="Dismiss" onClick={() => dismiss([e])} />
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
                count: events.length,
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
                  count={departures.length}
                  onSelect={() =>
                    setDialog({ kind: 'sold', events: departures })
                  }
                />
                <BulkItem
                  icon={CircleOff}
                  label="Mark as Dropped"
                  count={departures.length}
                  onSelect={() =>
                    setDialog({ kind: 'dropped', events: departures })
                  }
                />
                <BulkItem
                  icon={Archive}
                  label="Archive"
                  count={departures.length}
                  onSelect={() =>
                    setDialog({ kind: 'archived', events: departures })
                  }
                />
                <DropdownMenuSeparator />
                <BulkItem
                  icon={X}
                  label="Dismiss"
                  count={openSelected.length}
                  immediate
                  onSelect={() => dismiss(openSelected)}
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
        rowKey={(e) => e.id}
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
          rowLabel: (e) => `Select ${toUnicode(e.domain)} ${VERB[e.type]}`,
        }}
        rowClassName={(e, selected) => {
          // A selected row shows the selection, not its priority tint.
          const p = !selected && priorityOf(e);
          return p ? REVIEW_ROW_TINT : undefined;
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
        (dialog.events.length === 1 ? (
          <SaleDialog
            domain={alertDomain(dialog.events[0], portfolio, registrars)}
            mode="mark"
            resolves={dialog.events[0].id}
            onSaved={clearSelection}
            onClose={() => setDialog(null)}
          />
        ) : (
          <MarkSoldDialog
            items={itemsOf(dialog.events)}
            onDone={clearSelection}
            onClose={() => setDialog(null)}
          />
        ))}
      {(dialog?.kind === 'dropped' || dialog?.kind === 'archived') && (
        <DispositionDialog
          type={dialog.kind}
          items={itemsOf(dialog.events)}
          onDone={clearSelection}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'purchase' && (
        <PurchaseDialog
          domain={alertDomain(dialog.event, portfolio, registrars)}
          justRegistered
          resolves={dialog.event.id}
          onSaved={clearSelection}
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

/** An icon action on an alert row; greyed out when it doesn't apply. */
function RowAction({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-7 text-muted-foreground hover:text-foreground"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/** A bulk action with how many of the selection it applies to. */
function BulkItem({
  icon: Icon,
  label,
  count,
  immediate = false,
  onSelect,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  count: number;
  /** Runs at once instead of opening a dialog (no "…"). */
  immediate?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem disabled={count === 0} onSelect={onSelect}>
      <Icon className="text-muted-foreground" />
      {label}
      {!immediate && <span className="-ml-[6px] opacity-50">…</span>}
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </DropdownMenuItem>
  );
}
