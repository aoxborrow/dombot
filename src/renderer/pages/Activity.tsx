import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Calculator,
  CircleMinus,
  CirclePlus,
  CalendarClock,
  ChevronDown,
  CircleSlash,
  ClipboardPen,
  Ellipsis,
  Flag,
  Globe,
  History,
  Inbox,
  Receipt,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { toAscii, toUnicode } from '../../shared/domain-name';
import { importedRows } from '../../shared/imported-domains';
import { DomainEventType, type DomainEvent } from '../../shared/domain-events';
import { SETTING_LABEL, SETTING_ORDER } from '../../shared/domain-changes';
import type {
  DomainPurchase,
  RegistrarMeta,
  RegistrarName,
} from '../../shared/ipc';
import { DEFAULT_CURRENCY, DEFAULT_NUMBER_FORMAT } from '../../shared/money';
import {
  archiveRows,
  ownershipByDomain,
  standingOf,
  type Ownership,
} from '../../shared/ownership';
import { needsReviewIds, unrecordedIds } from '../../shared/review';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { RegistrarLogo } from '../components/RegistrarLogo';
import { StatCard, StatCardRow } from '../components/StatCard';
import { DomainLink } from '../components/domains/DomainLink';
import { NotesButton } from '../components/domains/NotesButton';
import { BulkNotesDialog } from '../components/domains/BulkNotesDialog';
import {
  EventTypeBadge,
  EventTypeDot,
} from '../components/activity/EventTypeBadge';
import {
  DeleteDomainsDialog,
  MarkSoldDialog,
} from '../components/actions/OwnershipDialogs';
import { DataTable, type DataColumn } from '../components/data-table/DataTable';
import { useColumnLayout } from '../components/data-table/ColumnPicker';
import { applyColumnLayout } from '../components/data-table/column-layout';
import { sortRows, type SortValue } from '../components/data-table/table-state';
import { type FilterField } from '../components/data-table/FilterBar';
import {
  FilterToolbar,
  ToolbarSwitch,
  listField,
} from '../components/data-table/FilterToolbar';
import {
  PurchaseDialog,
  type AcquisitionSide,
} from '../components/domains/PurchaseDialog';
import { SaleDialog } from '../components/domains/SaleDialog';
import { accountName } from '../lib/domain-history';
import {
  NEW_ROW_TINT,
  SOURCE_LABEL,
  VERB,
  alertDomain,
  eventAccounts,
  eventDay,
  eventConversion,
  eventDetails,
  resolutions,
  withinDays,
} from '../lib/activity';
import { usePreferences } from '../lib/preferences';
import {
  feeError,
  registrationDay,
  registrationFee,
} from '../lib/registration';
import { useAppStore } from '../store/app';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StickyNoteIcon } from '../components/icons/StickyNoteIcon';

const DATE_OPTIONS = [7, 14, 30, 90, 180].map((days) => ({
  value: String(days),
  label: `Last ${days} days`,
}));

// The Type filter's order: a name's life, which also keeps each color
// together (see EventTypeBadge): coming in (blue), renewed and moved
// (indigo), sold (green), then gone (removed, then the grays).
const TYPE_ORDER: DomainEvent['type'][] = [
  'added',
  'registered',
  'purchased',
  'renewed',
  'moved',
  'changed',
  'sold',
  'removed',
];

/**
 * One row: an event, and what the row shows for it. When you answer a sync
 * alert (a name that left or arrived), your answer takes the alert's row, so
 * "Removed" becomes "Sold" in place rather than adding a second row.
 */
interface ActivityRow {
  /** The event the row is for; its id is the row's key. */
  event: DomainEvent;
  /** Your answer to it, or the event itself: the row's type, source, date,
   *  and details. */
  shown: DomainEvent;
}

type DialogState =
  | {
      kind: 'sold' | 'delete' | 'notes';
      rows: ActivityRow[];
    }
  | {
      kind: 'purchase';
      row: ActivityRow;
      side: AcquisitionSide;
      /** Why the fee isn't filled in, from a one-click registration. */
      note?: string;
    };

/**
 * Every domain event, newest first: what you recorded (purchases, sales,
 * labels) and what sync saw (arrivals, departures, moves). An alert you've
 * answered shows your answer in its place. New alerts are highlighted like
 * unread mail, and Needs review lists every arrival or departure still
 * missing its money; every row has a menu to record a sale
 * or a purchase, or delete a name no account holds, and the same
 * actions work in bulk on a selection.
 */
export default function Activity() {
  const events = useAppStore((s) => s.domainEvents);
  const registrars = useAppStore((s) => s.registrars);
  const portfolio = useAppStore((s) => s.portfolio);
  const importedDomains = useAppStore((s) => s.importedDomains);
  // Every name a dialog can open on: synced, and the imported names no account
  // reports.
  const domains = useMemo(
    () => [...portfolio, ...importedRows(importedDomains, portfolio)],
    [portfolio, importedDomains],
  );
  const settings = useAppStore((s) => s.settings);
  const setAlertsDismissed = useAppStore((s) => s.setAlertsDismissed);
  const setDeparturesDropped = useAppStore((s) => s.setDeparturesDropped);
  const savePurchase = useAppStore((s) => s.savePurchase);
  const deleteUserEvent = useAppStore((s) => s.deleteUserEvent);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reviewOnly = params.get('review') === '1';
  // One import's rows (`?import=<id>`), from the import's result.
  const importId = params.get('import');
  const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  const fx = useAppStore((s) => s.exchangeRates);

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
  // Which settings changed (`changed` events only).
  const [changes, setChanges] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(
    () => usePreferences.getState().pageSize,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // The row (by event id) whose notes editor is open.
  const [notesFor, setNotesFor] = useState<string | null>(null);
  // Arrivals whose one-click registration is asking the registrar for its fee.
  const [registering, setRegistering] = useState<Set<string>>(new Set());
  const purchases = useAppStore((s) => s.purchases);
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
      setChanges([]);
      setDays([]);
      setPage(0);
      setSelected(new Set());
    }
  }

  const resolved = useMemo(() => resolvedIds(events), [events]);
  const closedBy = useMemo(() => resolutions(events), [events]);
  const ownership = useMemo(() => ownershipByDomain(events), [events]);
  // New: an alert nobody has answered or dismissed, highlighted like unread
  // mail. Unrecorded: an arrival or departure still missing its money, what
  // the answers are for. Needs review lists both (shared/review.ts).
  const isNew = (e: DomainEvent) => isOpenAlert(e, resolved);
  const unrecorded = useMemo(() => unrecordedIds(events), [events]);
  const reviewIds = useMemo(
    () => needsReviewIds(events, unrecorded),
    [events, unrecorded],
  );
  /** An arrival with nothing paid on file: recording what you paid answers
   *  it. (A new one with a purchase on file only needs dismissing.) */
  const arrivalToRecord = (e: DomainEvent) =>
    e.type === DomainEventType.Added && unrecorded.has(e.id);
  /** A departure with no sale on file: a sale or Mark dropped answers it. */
  const departureToRecord = (e: DomainEvent) =>
    e.type === DomainEventType.Removed && unrecorded.has(e.id);

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

  // Filter options, with counts over every event.
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { shown } of allRows)
      counts.set(shown.type, (counts.get(shown.type) ?? 0) + 1);
    // Every type, even with none yet, so the list doesn't shift as
    // activity comes in.
    return TYPE_ORDER.map((t) => ({
      value: t,
      label: VERB[t],
      count: counts.get(t) ?? 0,
      icon: <EventTypeDot type={t} />,
    }));
  }, [allRows]);
  const accountOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { event } of allRows)
      for (const id of new Set(eventAccounts(event)))
        counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts]
      .map(([value, count]) => {
        const meta = registrars?.find((r) => (r.accountId ?? r.name) === value);
        return {
          value,
          label: accountName(registrars, value) ?? value,
          count,
          icon: meta && (
            <RegistrarLogo
              name={meta.name as RegistrarName}
              label={meta.displayName}
              className="size-4"
            />
          ),
        };
      })
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
  // Only the settings that have changed, like Source.
  const changeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { shown } of allRows)
      if (shown.setting)
        counts.set(shown.setting, (counts.get(shown.setting) ?? 0) + 1);
    return SETTING_ORDER.filter((s) => counts.has(s)).map((s) => ({
      value: s,
      label: SETTING_LABEL[s],
      count: counts.get(s),
    }));
  }, [allRows]);

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

  const hasActiveFilters =
    search.trim() !== '' ||
    importId !== null ||
    [types, accounts, sources, changes, days].some((f) => f.length > 0);

  // When the import being shown was recorded.
  const importedAt = useMemo(() => {
    if (!importId) return null;
    const times = events
      .filter((e) => e.importId === importId)
      .map((e) => e.createdAt);
    return times.length ? Math.min(...times) : null;
  }, [events, importId]);

  function clearImport() {
    const next = new URLSearchParams(params);
    next.delete('import');
    setParams(next, { replace: true });
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
      if (importId && e.importId !== importId && shown.importId !== importId)
        return false;
      if (reviewOnly && !reviewIds.has(e.id)) return false;
      if (types.length > 0 && !types.includes(shown.type)) return false;
      if (sources.length > 0 && !sources.includes(shown.source)) return false;
      if (
        changes.length > 0 &&
        !(shown.setting && changes.includes(shown.setting))
      )
        return false;
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
        default:
          // The day it happened, then the order it was recorded.
          return `${eventDay(e)}|${e.id}`;
      }
    };
    return sortRows(filtered, valueOf, sortDir);
  }, [
    allRows,
    search,
    importId,
    reviewIds,
    reviewOnly,
    types,
    sources,
    changes,
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
  // The cards over the table: what the rows the filters leave hold.
  const counts = useMemo(() => {
    const n = { review: 0, fresh: 0, added: 0, removed: 0, sold: 0 };
    for (const { event: e, shown } of rows) {
      if (reviewIds.has(e.id)) n.review += 1;
      if (isOpenAlert(e, resolved)) n.fresh += 1;
      if (shown.type === 'added') n.added += 1;
      if (shown.type === 'removed') n.removed += 1;
      if (shown.type === 'sold') n.sold += 1;
    }
    return n;
  }, [rows, reviewIds, resolved]);
  // A card that counts a type sets the Type filter to it.
  const showType = (type: string) => {
    setTypes([type]);
    setPage(0);
  };

  const selectedRows = allRows.filter((r) => selected.has(r.event.id));
  const newSelected = selectedRows.map((r) => r.event).filter(isNew);
  const arrivalsSelected = selectedRows
    .map((r) => r.event)
    .filter(arrivalToRecord);
  const departuresSelected = selectedRows
    .map((r) => r.event)
    .filter(departureToRecord);
  const clearSelection = () => setSelected(new Set());

  const stateOf = (e: DomainEvent): Ownership | undefined =>
    ownership.get(e.domain);
  const heldNames = useMemo(
    () => new Set(portfolio.map((d) => toAscii(d.domainName))),
    [portfolio],
  );
  const held = (e: DomainEvent) => heldNames.has(e.domain);
  const lookups = useAppStore((s) => s.registrationLookups);
  /** Whether Domains shows the name in Archive (shared/ownership.ts). */
  const inArchive = (e: DomainEvent) => {
    const o = stateOf(e);
    const row =
      domains.find((d) => toAscii(d.domainName) === e.domain) ??
      (o ? archiveRows(new Map([[e.domain, o]]), domains, null)[0] : undefined);
    return !!row && standingOf(row, o, lookups[e.domain]?.registered).archived;
  };
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
  /** One item per name with no sale on record yet. */
  const unsoldOf = (list: ActivityRow[]) => {
    const seen = new Set<string>();
    return list.flatMap(({ event: e }) => {
      if (seen.has(e.domain)) return [];
      seen.add(e.domain);
      if (stateOf(e)?.sale) return [];
      return [{ domainName: toUnicode(e.domain), resolves: answers(e) }];
    });
  };
  const namesOf = (list: ActivityRow[]) => [
    ...new Map(list.map((r) => [r.event.domain, r.event])).values(),
  ];
  /** Delete applies only to names no connected account holds. */
  const removableOf = (list: ActivityRow[]) =>
    namesOf(list).filter((e) => !held(e));

  function dismiss(list: DomainEvent[]) {
    const ids = list.map((e) => e.id);
    const what =
      list.length === 1 ? toUnicode(list[0].domain) : `${list.length} alerts`;
    void setAlertsDismissed(ids, true).then(() => {
      deselect(ids);
      toast.success(`Dismissed ${what}`, {
        action: {
          label: 'Undo',
          onClick: () => void setAlertsDismissed(ids, false),
        },
      });
    });
  }

  const deselect = (ids: string[]) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });

  /**
   * Save the registration that answers an arrival: the name's created date
   * and its registrar's fee. Returns why it can't (no usable fee) instead.
   */
  async function saveRegistration(e: DomainEvent): Promise<string | null> {
    const domain = alertDomain(e, domains, registrars);
    const fee = await registrationFee(domain, registrars);
    if ('note' in fee) return fee.note;
    await savePurchase({
      domainName: domain.domainName,
      kind: 'registered',
      resolves: e.id,
      purchaseDate: registrationDay(domain.createdDate),
      amount: fee.amount,
      currency: fee.currency,
      // The note belongs to the name: keep it.
      notes: purchases[e.domain]?.notes ?? '',
    });
    return null;
  }

  /** Undo one-click registrations: delete the ones answering these arrivals. */
  async function undoRegistrations(ids: string[]) {
    const answering = new Set(ids);
    for (const e of useAppStore.getState().domainEvents)
      if (
        e.type === DomainEventType.Registered &&
        e.resolves &&
        answering.has(e.resolves)
      )
        await deleteUserEvent(e.id);
  }

  /**
   * Record registration, in one click: saved at the registrar's fee, with an
   * Undo. With no usable fee it opens the dialog instead, saying why.
   */
  async function recordRegistration(row: ActivityRow) {
    const e = row.event;
    setRegistering((current) => new Set(current).add(e.id));
    let note: string | null;
    try {
      note = await saveRegistration(e);
    } catch (err) {
      note = `DomBot couldn't get the fee (${feeError(err)}).`;
    } finally {
      setRegistering((current) => {
        const next = new Set(current);
        next.delete(e.id);
        return next;
      });
    }
    if (note) {
      setDialog({ kind: 'purchase', row, side: 'registration', note });
      return;
    }
    deselect([e.id]);
    toast.success(`Recorded the registration of ${toUnicode(e.domain)}`, {
      action: { label: 'Undo', onClick: () => void undoRegistrations([e.id]) },
    });
  }

  /**
   * Record registration for many arrivals, one registrar call each, in turn.
   * Names with no usable fee are skipped and stay in Needs review.
   */
  async function recordRegistrations(list: DomainEvent[]) {
    const n = list.length;
    const id = toast.loading(`Recording ${n} registrations…`);
    const saved: string[] = [];
    let skipped = 0;
    for (const e of list) {
      try {
        if (await saveRegistration(e)) skipped += 1;
        else saved.push(e.id);
      } catch {
        skipped += 1;
      }
      toast.loading(
        `Recording registrations… ${saved.length + skipped} of ${n}`,
        { id },
      );
    }
    deselect(saved);
    const done = `Recorded ${saved.length} registration${saved.length === 1 ? '' : 's'}`;
    const left = skipped
      ? `${skipped} had no fee to record and still need review.`
      : undefined;
    (saved.length ? toast.success : toast.error)(done, {
      id,
      description: left,
      ...(saved.length
        ? {
            action: {
              label: 'Undo',
              onClick: () => void undoRegistrations(saved),
            },
          }
        : {}),
    });
  }

  /** Mark departures dropped (no money came back), with an Undo. */
  function markDropped(list: DomainEvent[], dropped = true) {
    const ids = list.map((e) => e.id);
    const what =
      list.length === 1 ? toUnicode(list[0].domain) : `${list.length} names`;
    void setDeparturesDropped(ids, dropped).then(() => {
      deselect(ids);
      if (!dropped) return;
      toast.success(`Marked ${what} dropped`, {
        action: {
          label: 'Undo',
          onClick: () => void setDeparturesDropped(ids, false),
        },
      });
    });
  }

  function showInDomains(e: DomainEvent) {
    const next = new URLSearchParams({ q: toUnicode(e.domain) });
    if (inArchive(e)) next.set('view', 'archive');
    navigate(`/?${next}`);
  }

  // The name, when, what happened, where, and its details (or, for a row in
  // Needs review, its answers), in the order Sales reads. Every column but
  // Details is only as wide as its widest cell (w-0), so Details gets the
  // rest and its answers stay in view in a narrow window.
  const columns: DataColumn<ActivityRow>[] = [
    {
      key: 'domain',
      label: 'Domain',
      // First and always shown; the Columns picker moves and hides the rest.
      locked: true,
      headClassName: 'w-0',
      // The row's "⋯" menu, pinned to the cell's right edge like Domains',
      // with the name's sticky note (when it has one) just before it.
      cell: (row) => (
        <div className="flex items-center justify-between gap-2">
          <DomainLink name={toUnicode(row.event.domain)} />
          <div className="flex items-center">
            <NotesButton
              domainName={toUnicode(row.event.domain)}
              notes={purchases[toAscii(row.event.domain)]?.notes ?? ''}
              editing={notesFor === row.event.id}
              onEditingChange={(open) =>
                setNotesFor(open ? row.event.id : null)
              }
            />
            <RowMenu
              row={row}
              state={stateOf(row.event)}
              isNew={isNew(row.event)}
              toRecord={unrecorded.has(row.event.id)}
              paid={purchases[row.event.domain]}
              removable={!held(row.event)}
              onDialog={setDialog}
              onDropped={(dropped) => markDropped([row.event], dropped)}
              onNotes={() => setNotesFor(row.event.id)}
              onDismiss={() => dismiss([row.event])}
              onShow={() => showInDomains(row.event)}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'date',
      label: 'Date',
      headClassName: 'w-0',
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
      key: 'type',
      label: 'Activity',
      headClassName: 'w-0',
      // No vertical padding, centered, so the badge (taller than a line of
      // text) doesn't make the row taller than Domains'.
      cellClassName: 'py-0!',
      cell: ({ shown }) => <EventTypeBadge type={shown.type} />,
    },
    {
      key: 'account',
      label: 'Registrar',
      headClassName: 'w-0',
      cell: ({ event: e }) =>
        // A move from no account is sync taking over an imported name.
        e.type === DomainEventType.Moved && !e.fromAccountId ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-muted-foreground">Now synced from</span>
            <AccountLabel registrars={registrars} id={e.toAccountId} />
          </span>
        ) : e.type === DomainEventType.Moved ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <AccountLabel registrars={registrars} id={e.fromAccountId} />
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            <AccountLabel registrars={registrars} id={e.toAccountId} />
          </span>
        ) : e.accountId ? (
          <AccountLabel registrars={registrars} id={e.accountId} />
        ) : e.type === DomainEventType.Added ||
          e.type === DomainEventType.Changed ? (
          // An imported name, from a file or the Add domains form alike.
          <span className="whitespace-nowrap text-muted-foreground">
            Imported
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      key: 'details',
      label: 'Details',
      sortable: false,
      hideOnMobile: true,
      // A little more room on the left than the other columns, so text here
      // doesn't hug the rule; the answers' borders sit in it (ReviewActions).
      headClassName: 'pl-3',
      cellClassName: 'pl-3',
      // A row in Needs review has its answers here, where an arrival or a
      // departure has no details of its own.
      cell: (row) => {
        const { event: e, shown } = row;
        const details = eventDetails(shown, numberFormat, preferred);
        const actions = reviewIds.has(e.id) && (
          <ReviewActions
            event={e}
            isNew={isNew(e)}
            toRecord={unrecorded.has(e.id)}
            registering={registering.has(e.id)}
            onRegistration={() => void recordRegistration(row)}
            onPurchase={() =>
              setDialog({ kind: 'purchase', row, side: 'purchase' })
            }
            onSale={() => setDialog({ kind: 'sold', rows: [row] })}
            onDropped={() => markDropped([e])}
            onDismiss={() => dismiss([e])}
          />
        );
        // A change can name several nameservers or rules: cut it short, with
        // the whole of it on hover. An amount in another currency than yours
        // shows what it was worth in yours.
        return (
          <span className="flex items-center gap-3">
            {details ? (
              <span
                className="block max-w-64 truncate"
                title={
                  eventConversion(shown, numberFormat, preferred, fx) ?? details
                }
              >
                {details}
              </span>
            ) : (
              !actions && <span className="text-muted-foreground/50">—</span>
            )}
            {actions}
          </span>
        );
      },
    },
    {
      key: 'source',
      label: 'Source',
      hideOnMobile: true,
      headClassName: 'w-0',
      cell: ({ shown }) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {SOURCE_LABEL[shown.source]}
        </span>
      ),
    },
  ];

  // The columns shown and their order, remembered on this device; the
  // Columns button in the table's footer changes them.
  const { layout: columnLayout, setLayout: setColumnLayout } = useColumnLayout(
    'activity',
    columns,
  );
  const shownColumnKeys = applyColumnLayout(columns, columnLayout)
    .map((c) => c.key)
    .join(' ');
  // A sort whose column is hidden goes back to the default, or Domain when
  // that's hidden too, so a header always shows the sort.
  useEffect(() => {
    const shown = new Set(shownColumnKeys.split(' '));
    if (shown.has(sortKey)) return;
    const useDefault = shown.has('date');
    setSortKey(useDefault ? 'date' : 'domain');
    setSortDir(useDefault ? 'desc' : 'asc');
  }, [shownColumnKeys, sortKey]);

  // The filter bar's fields, in the Filters menu's order (the order the
  // old filter dropdowns had).
  const listFilter = (
    field: Parameters<typeof listField>[0],
    set: (next: string[]) => void,
  ) =>
    listField(field, (next) => {
      set(next);
      setPage(0);
    });
  const filterFields: FilterField[] = [
    listFilter(
      {
        key: 'account',
        label: 'Registrar',
        icon: Building2,
        options: accountOptions,
        selected: accounts,
        plural: 'registrars',
      },
      setAccounts,
    ),
    listFilter(
      {
        key: 'type',
        label: 'Type',
        icon: History,
        options: typeOptions,
        selected: types,
        plural: 'types',
      },
      setTypes,
    ),
    listFilter(
      {
        key: 'change',
        label: 'Change',
        icon: SlidersHorizontal,
        options: changeOptions,
        selected: changes,
        plural: 'changes',
      },
      setChanges,
    ),
    listFilter(
      {
        key: 'source',
        label: 'Source',
        icon: Inbox,
        options: sourceOptions,
        selected: sources,
        plural: 'sources',
      },
      setSources,
    ),
    listFilter(
      {
        key: 'date',
        label: 'Date',
        icon: CalendarClock,
        options: dateOptions,
        selected: days,
        plural: 'ranges',
      },
      setDays,
    ),
    // One import's rows, from the import's result: a chip while it's set,
    // whose × shows everything again.
    ...(importId
      ? [
          {
            kind: 'custom' as const,
            key: 'import',
            label: 'Import',
            icon: Upload,
            summary: importedAt
              ? new Date(importedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : 'One import',
            onClear: clearImport,
            content: (
              <p className="max-w-56 px-2 py-1.5 text-sm text-muted-foreground">
                What one import recorded. Remove this filter to see everything.
              </p>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* -m-1 p-1 leaves room for focus rings, which the scroll box would clip. */}
      <div className="-m-1 flex min-h-0 flex-col gap-[13px] overflow-y-auto p-1">
        {/* As tall as Domains' title row (its Sync button), so the toolbar
            lands in the same place on both pages. */}
        <div className="mb-1 min-h-9">
          <h1 className="mt-1.5 flex min-w-0 items-baseline gap-2.5 text-2xl font-bold leading-none sm:mt-0.5 sm:text-[32px]">
            Activity
            {/* The view, as on Domains. */}
            <span className="text-sm font-semibold uppercase tracking-wider text-brand sm:text-base">
              {reviewOnly ? 'Needs review' : 'All'}
            </span>
          </h1>
        </div>

        <StatCardRow>
          <StatCard
            size="sm"
            icon={Flag}
            accentClass="text-yellow-600 dark:text-yellow-400"
            label="Needs review"
            value={[
              {
                value: counts.review.toLocaleString(),
                unit: counts.fresh ? `${counts.fresh} new` : undefined,
              },
            ]}
            onClick={() => setView(true)}
          />
          <StatCard
            size="sm"
            icon={CirclePlus}
            accentClass="text-brand-400"
            label="Added"
            value={counts.added.toLocaleString()}
            onClick={() => showType('added')}
          />
          <StatCard
            size="sm"
            icon={CircleMinus}
            accentClass="text-rose-400"
            label="Removed"
            value={counts.removed.toLocaleString()}
            onClick={() => showType('removed')}
          />
          <StatCard
            size="sm"
            icon={Receipt}
            accentClass="text-violet-400"
            label="Sold"
            value={counts.sold.toLocaleString()}
            onClick={() => showType('sold')}
          />
        </StatCardRow>

        <FilterToolbar
          id="activity"
          // The default view first.
          switch={
            <ToolbarSwitch
              fillOnPhone
              label="Which activity to show"
              options={[
                {
                  id: 'all',
                  label: 'All',
                  icon: History,
                  count: allRows.length,
                  active: !reviewOnly,
                  onClick: () => setView(false),
                },
                {
                  id: 'review',
                  label: 'Needs review',
                  icon: Flag,
                  count: reviewIds.size,
                  active: reviewOnly,
                  onClick: () => setView(true),
                },
              ]}
            />
          }
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(0);
          }}
          fields={filterFields}
          presets={['account', 'type']}
        />

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/70 bg-brand/10 py-1.5 pl-2.5 pr-[7px]">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-brand">
                <span className="pl-1 pr-px text-[16px] font-bold">
                  {selected.size}
                </span>{' '}
                selected
                {newSelected.length > 0 && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {newSelected.length} new
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
                  icon={StickyNoteIcon}
                  label="Notes"
                  count={namesOf(selectedRows).length}
                  onSelect={() =>
                    setDialog({ kind: 'notes', rows: selectedRows })
                  }
                />
                <DropdownMenuSeparator />
                <BulkItem
                  icon={ClipboardPen}
                  label="Record registration"
                  count={arrivalsSelected.length}
                  immediate
                  onSelect={() => void recordRegistrations(arrivalsSelected)}
                />
                <BulkItem
                  icon={Receipt}
                  label="Record sale"
                  count={unsoldOf(selectedRows).length}
                  onSelect={() =>
                    setDialog({ kind: 'sold', rows: selectedRows })
                  }
                />
                <BulkItem
                  icon={CircleSlash}
                  label="Mark dropped"
                  count={departuresSelected.length}
                  immediate
                  onSelect={() => markDropped(departuresSelected)}
                />
                <DropdownMenuSeparator />
                <BulkItem
                  icon={X}
                  label="Dismiss"
                  count={newSelected.length}
                  immediate
                  onSelect={() => dismiss(newSelected)}
                />
                <DropdownMenuSeparator />
                <BulkItem
                  icon={Trash2}
                  label="Delete"
                  count={removableOf(selectedRows).length}
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
        layout={columnLayout}
        onLayoutChange={setColumnLayout}
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
        // A new row is highlighted like unread mail; a selected one shows the
        // selection instead.
        rowClassName={(r, selected) =>
          !selected && isNew(r.event) ? NEW_ROW_TINT : undefined
        }
        empty={
          reviewOnly && !hasActiveFilters
            ? 'Every name that came or went is on the books.'
            : events.length === 0
              ? 'No activity yet. Arrivals, departures, and moves appear after an account’s second sync; purchases, sales, and settings changes as you make them.'
              : 'No activity matches the current filters.'
        }
      />

      {dialog?.kind === 'sold' &&
        (dialog.rows.length === 1 ? (
          <SaleDialog
            domain={alertDomain(dialog.rows[0].event, domains, registrars)}
            // Already Sold: edit that sale. Otherwise mark it.
            mode={stateOf(dialog.rows[0].event)?.sale ? 'edit' : 'mark'}
            resolves={
              stateOf(dialog.rows[0].event)?.sale
                ? undefined
                : answers(dialog.rows[0].event)
            }
            onSaved={clearSelection}
            onClose={() => setDialog(null)}
          />
        ) : (
          <MarkSoldDialog
            items={unsoldOf(dialog.rows)}
            onDone={clearSelection}
            onClose={() => setDialog(null)}
          />
        ))}
      {dialog?.kind === 'purchase' && (
        <PurchaseDialog
          domain={alertDomain(dialog.row.event, domains, registrars)}
          // An arrival you haven't answered: record it as a new purchase.
          side={dialog.side}
          note={dialog.note}
          // An arrival in Needs review: record it as a new holding.
          resolves={
            arrivalToRecord(dialog.row.event) ? dialog.row.event.id : undefined
          }
          arrivedOn={
            arrivalToRecord(dialog.row.event)
              ? (dialog.row.event.date ?? undefined)
              : undefined
          }
          onSaved={clearSelection}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'notes' && (
        <BulkNotesDialog
          domainNames={namesOf(dialog.rows).map((e) => e.domain)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDomainsDialog
          domains={removableOf(dialog.rows).map((e) => ({
            domainName: toUnicode(e.domain),
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
 * A row's "⋯" menu, with every option, in the words the inline answers use:
 * notes, record what you paid (edit it once there is one), record a sale
 * (edit it once there is one), mark a departure dropped (or undo it), dismiss
 * a new row, open it in Domains, or remove a name no connected account holds
 * from DomBot.
 */
function RowMenu({
  row,
  state,
  isNew,
  toRecord,
  paid,
  removable,
  onDialog,
  onDropped,
  onNotes,
  onDismiss,
  onShow,
}: {
  row: ActivityRow;
  state: Ownership | undefined;
  isNew: boolean;
  /** In Needs review: the answers here record a new holding's money. */
  toRecord: boolean;
  /** What's saved for the name: a purchase or registration to edit. */
  paid: DomainPurchase | undefined;
  removable: boolean;
  onDialog: (dialog: DialogState) => void;
  onDropped: (dropped: boolean) => void;
  onNotes: () => void;
  onDismiss: () => void;
  onShow: () => void;
}) {
  const e = row.event;
  const name = toUnicode(e.domain);
  const set = (kind: 'sold' | 'delete') => onDialog({ kind, rows: [row] });
  const acquire = (side: AcquisitionSide) =>
    onDialog({ kind: 'purchase', row, side });
  const arrival = e.type === DomainEventType.Added;
  const departure = e.type === DomainEventType.Removed;
  // An arrival in Needs review asks for a new record; otherwise the one on
  // file is edited, when there is one.
  const editing =
    !(arrival && toRecord) && !!(paid?.purchaseDate || paid?.amount);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${name}`}
          // Covers the Domain cell: the cell lights, not the button (index.css).
          data-cell-action
          className="-my-2 w-7 text-muted-foreground hover:bg-transparent hover:text-foreground compact:h-7 compact:w-6 dark:hover:bg-transparent"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onNotes}>
          <StickyNoteIcon className="text-muted-foreground" />
          Notes…
        </DropdownMenuItem>
        {editing ? (
          <DropdownMenuItem
            onSelect={() =>
              acquire(
                paid?.purchaseType === 'registered'
                  ? 'registration'
                  : 'purchase',
              )
            }
          >
            <Calculator className="text-muted-foreground" />
            {paid?.purchaseType === 'registered'
              ? 'Edit registration…'
              : 'Edit purchase…'}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => acquire('registration')}>
              <ClipboardPen className="text-muted-foreground" />
              Record registration…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => acquire('purchase')}>
              <Calculator className="text-muted-foreground" />
              Record purchase…
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {/* A sold name's Record sale edits its sale. */}
        <DropdownMenuItem onSelect={() => set('sold')}>
          <Receipt className="text-muted-foreground" />
          {state?.sale ? 'Edit sale…' : 'Record sale…'}
        </DropdownMenuItem>
        {departure && (e.dropped || toRecord) && (
          <DropdownMenuItem onSelect={() => onDropped(!e.dropped)}>
            <CircleSlash className="text-muted-foreground" />
            {e.dropped ? 'Undo dropped' : 'Mark dropped'}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isNew && (
          <DropdownMenuItem onSelect={onDismiss}>
            <X className="text-muted-foreground" />
            Dismiss
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onShow}>
          <Globe className="text-muted-foreground" />
          Show in Domains
        </DropdownMenuItem>
        {removable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => set('delete')}
            >
              <Trash2 />
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The suggested answers for a row in Needs review, in its Details, the
 * one-click answer first: Record registration (saved at the registrar's fee)
 * or Record purchase… for an arrival, Mark dropped or Record sale… for a
 * departure, and Dismiss last while it's new. A new row whose money is
 * already on file only gets Dismiss. The "⋯" menu has every option, and is
 * the only place for them on phones, where these don't fit.
 */
function ReviewActions({
  event,
  isNew,
  toRecord,
  registering,
  onRegistration,
  onPurchase,
  onSale,
  onDropped,
  onDismiss,
}: {
  event: DomainEvent;
  isNew: boolean;
  /** Still missing its money: the answers apply. */
  toRecord: boolean;
  /** Record registration is asking the registrar for the fee. */
  registering: boolean;
  onRegistration: () => void;
  onPurchase: () => void;
  onSale: () => void;
  onDropped: () => void;
  onDismiss: () => void;
}) {
  const arrival = event.type === DomainEventType.Added;
  return (
    // Pulled left a little when they lead the cell, so the buttons' text,
    // not their borders, lines up with the details on other rows.
    <span className="hidden shrink-0 items-center gap-1.5 first:-ml-1 md:flex">
      {!toRecord ? null : arrival ? (
        <>
          <ReviewButton disabled={registering} onClick={onRegistration}>
            {registering ? 'Recording…' : 'Record registration'}
          </ReviewButton>
          <ReviewButton onClick={onPurchase}>Record purchase…</ReviewButton>
        </>
      ) : (
        <>
          <ReviewButton onClick={onDropped}>Mark dropped</ReviewButton>
          <ReviewButton onClick={onSale}>Record sale…</ReviewButton>
        </>
      )}
      {isNew && (
        <ReviewButton quiet onClick={onDismiss}>
          <X className="size-3" />
          Dismiss
        </ReviewButton>
      )}
    </span>
  );
}

function ReviewButton({
  quiet = false,
  disabled,
  onClick,
  children,
}: {
  /** Dismiss: an outline with no fill, so the answers stand out. */
  quiet?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  // The size of Sales' step buttons.
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      className={cn(
        '-my-1 h-6 shrink-0 px-2 text-xs',
        quiet &&
          'gap-1 bg-transparent text-muted-foreground shadow-none hover:text-foreground has-[>svg]:pr-2 has-[>svg]:pl-1.5 dark:bg-transparent',
      )}
      onClick={onClick}
    >
      {children}
    </Button>
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
