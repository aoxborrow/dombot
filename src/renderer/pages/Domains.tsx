import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Globe,
  Lock,
  LockOpen,
  Plug,
  RefreshCw,
  Search,
  Server,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { Domain, Folder, RenewalPricing } from '../../shared/ipc';
import { toast } from 'sonner';
import { HIDDEN_FOLDER_ID } from '../../shared/ipc';
import { useAppStore } from '../store/app';
import { csvFilename, domainsToCsv } from '../lib/csv';
import { nameserverGroup } from '../lib/nameservers';
import { folderColorStyle } from '../lib/folders';
import {
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../lib/domain-ops';
import { FolderIcon } from '../components/icons/FolderIcon';
import { FlagToggle } from '../components/domains/FlagToggle';
import { RowActionsMenu } from '../components/domains/RowActionsMenu';
import { AuthCodeDialog } from '../components/domains/AuthCodeDialog';
import { RenewDialog } from '../components/domains/RenewDialog';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

// Which `refreshTick` the detail fetch has already force-refreshed. Module-level
// so it PERSISTS across Domains remounts (switching to another tab and back): a
// per-component ref would reset to 0 on every remount, making `force` true again
// whenever refreshTick is non-zero (i.e. after any live sync) and needlessly
// re-fetching every visible row's detail — which blanks the nameserver cells and
// reloads them on each tab revisit. A live refresh still forces once, because it
// bumps refreshTick past this.
let forcedDetailTick = 0;

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
  /** Right-align numeric-ish columns, or center the state/flag columns. */
  align?: 'left' | 'right' | 'center';
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
function CellSkeleton({ align }: { align?: 'left' | 'right' | 'center' }) {
  // Narrow bar for the small icon/flag columns (right- or center-aligned).
  const narrow = align === 'right' || align === 'center';
  return (
    <span
      className={cn(
        'inline-block h-3 animate-pulse rounded bg-muted',
        narrow ? 'w-4' : 'w-24',
      )}
      aria-label="Loading…"
    />
  );
}

/** Sort sentinel for the injected Folder column (folders aren't a Domain field). */
const FOLDER = 'folder';
/** Filter value matching domains with no folder assigned. */
const UNASSIGNED = '__unassigned__';

const RENEWAL = 'renewal';

/** Whole/decimal USD, e.g. "$12" or "$12.99". */
function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Annual renewal-price cell. Shows the figure with a source tooltip, a skeleton
 *  while pricing is still loading, or "—" when unavailable. */
function RenewalCell({
  info,
  loading,
}: {
  info: RenewalPricing | undefined;
  loading: boolean;
}) {
  if (info === undefined && loading) return <CellSkeleton align="right" />;
  if (!info || info.renewal == null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return (
    <span
      className="font-medium tabular-nums"
      title={`Renewal source: ${info.source}`}
    >
      {fmtUsd(info.renewal)}
    </span>
  );
}

/**
 * The Folder cell: a small colored folder icon plus the folder name when the
 * domain is in a folder, a muted "Hidden" (eye-off) for the built-in hidden
 * folder, or a muted dash when unassigned. Display only — assigning is done from
 * the row menu.
 */
/**
 * The Folder column cell — the row's only click target. A full-height, padded
 * button (faded folder icon when unassigned, the colored folder chip otherwise)
 * that opens the folder-assignment menu directly. Rendered in a `p-0` cell so
 * the button fills the whole cell.
 */
function FolderCell({
  folders,
  folderId,
  onAssign,
}: {
  folders: Folder[];
  folderId: string | undefined;
  onAssign: (folderId: string | null) => void;
}) {
  const hidden = folderId === HIDDEN_FOLDER_ID;
  const current =
    folderId && !hidden ? folders.find((f) => f.id === folderId) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Assign folder"
          className="group flex w-full cursor-pointer items-center gap-1.5 px-3 py-3 text-left text-sm text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          {hidden ? (
            <span className="inline-flex h-4 items-center gap-2 leading-none text-muted-foreground">
              <EyeOff className="size-4 shrink-0" />
              Hidden
              <ChevronDown
                className="ml-auto size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </span>
          ) : current ? (
            <span className="inline-flex h-4 max-w-full items-center gap-2 leading-none text-foreground">
              <FolderIcon
                className={cn(
                  'size-4 shrink-0',
                  folderColorStyle(current.color).text,
                )}
              />
              <span className="truncate">{current.name}</span>
              <ChevronDown
                className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </span>
          ) : (
            // Fixed h-4 wrapper (the icon's own height) so every state is the
            // same height — assigning a folder must not grow the row.
            <span className="flex h-4 items-center">
              <FolderIcon className="size-4 shrink-0" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <FolderMenuContent
        folders={folders}
        folderId={folderId}
        onAssign={onAssign}
      />
    </DropdownMenu>
  );
}

/**
 * The folder-assignment menu, opened directly from the Folder cell. A flat list
 * of the user's folders followed by "Hidden" (the built-in folder that drops
 * the domain from the table) and "None" (clear).
 */
function FolderMenuContent({
  folders,
  folderId,
  onAssign,
}: {
  folders: Folder[];
  folderId: string | undefined;
  onAssign: (folderId: string | null) => void;
}) {
  return (
    <DropdownMenuContent
      align="start"
      className="max-h-[320px] w-52 overflow-y-auto"
    >
      {folders.map((f) => (
        <DropdownMenuItem
          key={f.id}
          className="gap-2.5"
          onSelect={() => onAssign(f.id)}
        >
          <FolderIcon
            className={cn('size-4 shrink-0', folderColorStyle(f.color).text)}
            aria-hidden
          />
          <span className="flex-1 truncate">{f.name}</span>
          {f.id === folderId && (
            <Check className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </DropdownMenuItem>
      ))}
      {folders.length > 0 && <DropdownMenuSeparator />}
      {/* Hidden is a built-in folder: assigning to it drops the domain from the
          table until "Hidden" is picked in the Folder filter. */}
      <DropdownMenuItem
        className="gap-2.5"
        onSelect={() => onAssign(HIDDEN_FOLDER_ID)}
      >
        <EyeOff className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">Hidden</span>
        {folderId === HIDDEN_FOLDER_ID && (
          <Check className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2.5" onSelect={() => onAssign(null)}>
        {/* Spacer keeps "None" aligned with the icon'd rows. */}
        <span className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">None</span>
        {folderId === undefined && (
          <Check className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuItem>
    </DropdownMenuContent>
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

/**
 * Auto-renew toggle: writes through to the registrar via the shared domain-op
 * path. The store applies the new value optimistically (so the switch flips
 * immediately) and rolls back if the registrar rejects. Disabled, with the
 * reason as its tooltip, where the registrar can't toggle it post-registration
 * (Cloudflare), and while the write is in flight. Outcome is a toast. Brand
 * green when on, a muted red when off.
 */
function AutoRenewSwitch({ domain }: { domain: Domain }) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const key = `${domain.registrar}:${domain.domainName}`;
  const pending = useAppStore((s) => s.mutating[key] ?? false);
  const reason = useOpUnsupportedReason(domain.registrar, {
    kind: 'autoRenew',
    enabled: !domain.autoRenew,
  });

  const onToggle = (next: boolean) => {
    const op = { kind: 'autoRenew' as const, enabled: next };
    void applyDomainOp(targetOf(domain), op, { autoRenew: next }).then(
      (result) => reportOpResult(op, result),
    );
  };

  return (
    <Switch
      checked={domain.autoRenew}
      onCheckedChange={onToggle}
      disabled={pending || reason !== null}
      aria-label="auto-renew"
      title={
        reason ??
        `Auto-renew ${domain.autoRenew ? 'on' : 'off'} — click to toggle`
      }
      className="data-[state=unchecked]:bg-red-800/80 dark:data-[state=unchecked]:bg-red-800/80"
    />
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
    label: 'Auto',
    align: 'center',
    compact: true,
    render: (d) => <AutoRenewSwitch domain={d} />,
    sortValue: (d) => (d.autoRenew ? 1 : 0),
  },
  {
    key: 'privacy',
    label: 'Privacy',
    align: 'center',
    compact: true,
    detail: true,
    render: (d) => (
      <FlagToggle
        domain={d}
        kind="privacy"
        on={EyeOff}
        off={Eye}
        onLabel="privacy on"
        offLabel="privacy off"
      />
    ),
    sortValue: (d) => (d.privacy ? 1 : 0),
  },
  {
    key: 'locked',
    label: 'Locked',
    align: 'center',
    compact: true,
    detail: true,
    render: (d) => (
      <FlagToggle
        domain={d}
        kind="lock"
        on={Lock}
        off={LockOpen}
        onLabel="locked"
        offLabel="unlocked"
      />
    ),
    sortValue: (d) => (d.locked ? 1 : 0),
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
          className="inline-flex max-w-[260px] items-baseline gap-1.5 font-mono text-[13px] text-foreground/70"
          title={d.nameservers.join('\n')}
        >
          <span className="truncate">{d.nameservers[0]}</span>
          {d.nameservers.length > 1 && (
            <span className="opacity-60">+{d.nameservers.length - 1}</span>
          )}
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

/** Sentinel expiration value that keeps only already-expired domains. */
const EXPIRED = 'expired';

/**
 * Expiration-filter options for the multi-select. No "all" entry — an empty
 * selection means no expiration filter. EXPIRED keeps past-due domains; a
 * numeric value keeps domains expiring within that many upcoming days.
 */
const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: EXPIRED, label: 'Expired' },
  { value: '30', label: 'Next 30 days' },
  { value: '60', label: 'Next 60 days' },
  { value: '90', label: 'Next 90 days' },
];

/** Whether a domain (with `days` until expiry) matches one expiration option. */
function matchesExpiryOption(option: string, days: number | null): boolean {
  if (days === null) return false;
  if (option === EXPIRED) return days < 0;
  return days >= 0 && days <= Number(option);
}

/** Adds or removes `value` from a multi-select selection array. */
function toggleValue(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}

// Bulk row-selection (checkboxes + bulk action bar) is hidden for now; the
// underlying state and handlers are kept so it can be switched back on later.
const BULK_SELECT_ENABLED = false;

// ── Page ────────────────────────────────────────────────────────────────────

export default function Domains() {
  const {
    portfolio,
    portfolioErrors,
    portfolioRegistrars,
    portfolioRegistrarLabels,
    portfolioError,
    portfolioLoadedAt,
    refreshTick,
    registrars,
    loadRegistrars,
    enriched,
    enriching,
    enrichVisible,
    loadAllDetail,
    pricing,
    folders,
    folderAssignments,
    assignFolder,
  } = useAppStore();

  const navigate = useNavigate();
  // Pricing is computed locally in main and arrives with the portfolio; the only
  // gap is the brief moment after a live Sync resets it before it's re-read.
  const pricingLoading =
    portfolio.length > 0 && Object.keys(pricing).length === 0;

  // Whether any registrar has credentials configured (shared store state, so the
  // header/status bar/empty state agree). Drives the in-table empty prompt: with
  // none configured we point the user at Settings. Re-checked after a refresh in
  // case credentials changed. `null` (pre-load) is treated as "not yet known".
  useEffect(() => {
    void loadRegistrars();
  }, [portfolioLoadedAt, loadRegistrars]);
  const noneConfigured =
    registrars !== null && registrars.every((r) => !r.configured);

  // Overlay lazily-fetched per-domain detail (nameservers/privacy/lock) onto the
  // fast summary. Filtering, sorting, and rendering all use this merged view.
  const merged = useMemo(
    () => portfolio.map((d) => enriched[`${d.registrar}:${d.domainName}`] ?? d),
    [portfolio, enriched],
  );

  const [search, setSearch] = useState('');
  // Multi-select filters; an empty array means "no filter" (show all).
  const [tld, setTld] = useState<string[]>([]);
  const [registrar, setRegistrar] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string[]>([]);
  const [ns, setNs] = useState<string[]>([]);
  const [folder, setFolder] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState('domainName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  // Row selection for bulk actions, keyed by `${registrar}:${domainName}`.
  // UI only for now — the actions themselves aren't wired up yet.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // Per-row action dialogs (opened from the row's "⋯" menu).
  const [authCodeFor, setAuthCodeFor] = useState<Domain | null>(null);
  const [renewFor, setRenewFor] = useState<Domain | null>(null);
  const hideDomain = (d: Domain) => {
    void assignFolder(`${d.registrar}:${d.domainName}`, HIDDEN_FOLDER_ID).then(
      () =>
        toast.success(`Hid ${d.domainName}`, {
          description: 'Pick “Hidden” in the Folder filter to see it again.',
        }),
    );
  };

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

  // Distinct filter options with per-option domain counts, derived from the
  // loaded portfolio. Counts are over the whole portfolio (independent of the
  // other active filters), matching the Nameservers and Folder filters.
  const tldOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of portfolio) {
      const t = tldOf(d.domainName);
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({
      value,
      label: `.${value}`,
      count,
    })).sort((a, b) => a.value.localeCompare(b.value));
  }, [portfolio]);
  const registrarOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of portfolio)
      counts.set(d.registrar, (counts.get(d.registrar) ?? 0) + 1);
    return Array.from(counts, ([value, count]) => ({
      value,
      label: registrarLabel(value, portfolioRegistrarLabels),
      count,
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [portfolio, portfolioRegistrarLabels]);
  // Expiration windows are cumulative, so their counts intentionally overlap
  // (a domain due in 20 days matches the 30-, 60-, and 90-day options).
  const expiryOptions = useMemo(
    () =>
      EXPIRY_OPTIONS.map((o) => ({
        ...o,
        count: portfolio.reduce(
          (n, d) =>
            n +
            (matchesExpiryOption(o.value, daysUntil(d.expirationDate)) ? 1 : 0),
          0,
        ),
      })),
    [portfolio],
  );

  // Nameserver groups (by base domain, with per-provider splits) plus the set of
  // groups each domain belongs to. Derived from `merged`, so it fills in as
  // lazily-loaded nameservers arrive; the count is domains-per-group. Options
  // are sorted by count desc, then label.
  const { nsGroups, nsKeysByDomain } = useMemo(() => {
    const keysByDomain = new Map<string, Set<string>>();
    const counts = new Map<string, { label: string; count: number }>();
    for (const d of merged) {
      const keys = new Set<string>();
      for (const host of d.nameservers) {
        const group = nameserverGroup(host);
        if (!group) continue;
        // Count each domain once per group even with multiple hosts in it.
        if (!keys.has(group.key)) {
          const existing = counts.get(group.key);
          if (existing) existing.count += 1;
          else counts.set(group.key, { label: group.label, count: 1 });
        }
        keys.add(group.key);
      }
      keysByDomain.set(`${d.registrar}:${d.domainName}`, keys);
    }
    const groups = Array.from(counts, ([value, v]) => ({
      value,
      label: v.label,
      count: v.count,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return { nsGroups: groups, nsKeysByDomain: keysByDomain };
  }, [merged]);

  // Folder filter options: one per folder (with its assigned-domain count over
  // the whole portfolio), an "Unassigned" bucket, and an always-present "Hidden"
  // bucket for the built-in hidden folder. A dangling assignment (its folder was
  // deleted) counts as unassigned. `hiddenCount` also lets the Folder filter show
  // when the user has hidden domains but no folders of their own.
  const { folderOptions, hiddenCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    let unassigned = 0;
    let hidden = 0;
    for (const d of portfolio) {
      const id = folderAssignments[`${d.registrar}:${d.domainName}`];
      if (id === HIDDEN_FOLDER_ID) {
        hidden += 1;
      } else if (id && folders.some((f) => f.id === id)) {
        counts[id] = (counts[id] ?? 0) + 1;
      } else {
        unassigned += 1;
      }
    }
    const opts = folders.map((f) => ({
      value: f.id,
      label: f.name,
      count: counts[f.id] ?? 0,
    }));
    opts.push({ value: UNASSIGNED, label: 'Unassigned', count: unassigned });
    // Always offer Hidden so it's a discoverable way to reveal hidden domains.
    opts.push({ value: HIDDEN_FOLDER_ID, label: 'Hidden', count: hidden });
    return { folderOptions: opts, hiddenCount: hidden };
  }, [portfolio, folders, folderAssignments]);

  // Validate the price inputs, then derive the bounds actually applied. A field
  // error (or min > max) leaves the range unapplied until it's corrected.
  // Whether any search/filter is narrowing the list — drives the "Reset filters"
  // affordance and clearing them all at once.
  const hasActiveFilters =
    search.trim() !== '' ||
    tld.length > 0 ||
    registrar.length > 0 ||
    expiry.length > 0 ||
    ns.length > 0 ||
    folder.length > 0;

  function resetFilters() {
    setSearch('');
    setTld([]);
    setRegistrar([]);
    setExpiry([]);
    setNs([]);
    setFolder([]);
    setPage(0);
  }

  // Filter → sort. Pagination is applied after, on the sorted result.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = merged.filter((d) => {
      if (q && !d.domainName.toLowerCase().includes(q)) return false;
      if (tld.length > 0 && !tld.includes(tldOf(d.domainName))) return false;
      if (registrar.length > 0 && !registrar.includes(d.registrar))
        return false;
      // Expiration: keep a domain matching ANY selected window ("Expired" =
      // past-due; a numeric window = within that many upcoming days).
      if (expiry.length > 0) {
        const days = daysUntil(d.expirationDate);
        if (!expiry.some((o) => matchesExpiryOption(o, days))) return false;
      }
      // Nameservers: keep a domain in ANY selected nameserver group.
      if (ns.length > 0) {
        const keys = nsKeysByDomain.get(`${d.registrar}:${d.domainName}`);
        if (!keys || !ns.some((k) => keys.has(k))) return false;
      }
      // Folder: resolve each domain to a bucket — a real folder id, the built-in
      // Hidden id, or "Unassigned" (no folder, or a dangling assignment). With a
      // folder filter active, keep only domains whose bucket is selected. With no
      // folder filter, hide the Hidden bucket (that's the whole point of hiding).
      {
        const id = folderAssignments[`${d.registrar}:${d.domainName}`];
        const bucket =
          id === HIDDEN_FOLDER_ID
            ? HIDDEN_FOLDER_ID
            : id && folders.some((f) => f.id === id)
              ? id
              : UNASSIGNED;
        if (folder.length > 0) {
          if (!folder.includes(bucket)) return false;
        } else if (bucket === HIDDEN_FOLDER_ID) {
          return false;
        }
      }
      return true;
    });

    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    // Renewal isn't a Domain field — sort it from the pricing map.
    const valueOf = (d: Domain): SortValue | null => {
      if (sortKey === RENEWAL) {
        return pricing[`${d.registrar}:${d.domainName}`]?.renewal ?? null;
      }
      if (sortKey === FOLDER) {
        const id = folderAssignments[`${d.registrar}:${d.domainName}`];
        return folders.find((f) => f.id === id)?.name.toLowerCase() ?? null;
      }
      return col.sortValue(d, portfolioRegistrarLabels);
    };
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
    expiry,
    ns,
    nsKeysByDomain,
    folder,
    folders,
    folderAssignments,
    sortKey,
    sortDir,
    pricing,
  ]);

  // Derive the effective page: if filters shrink the result below the current
  // page, `safePage` clamps it without needing to write back to state (every
  // read and the pager buttons use `safePage`, so it stays self-correcting).
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);

  const start = safePage * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  // Header checkbox reflects the whole filtered set (across pages): fully checked
  // when every filtered row is selected, indeterminate when only some are.
  const selectedCount = selected.size;
  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((d) => selected.has(`${d.registrar}:${d.domainName}`));
  const someFilteredSelected =
    !allFilteredSelected &&
    filtered.some((d) => selected.has(`${d.registrar}:${d.domainName}`));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      const keys = filtered.map((d) => `${d.registrar}:${d.domainName}`);
      if (allFilteredSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });

  // Lazily fetch full detail for the rows actually on screen. Keyed on the
  // visible domains' identities so it re-runs on page/sort/filter changes;
  // enrichVisible dedupes against already-fetched and in-flight domains.
  const visibleKey = visible
    .map((d) => `${d.registrar}:${d.domainName}`)
    .join('|');

  // After a live refresh (refreshTick bumps), force one re-fetch of the visible
  // rows' detail — bypassing the caches — then fall back to cache-first for later
  // paging. The already-forced tick lives at module scope (see above) so a tab
  // switch back here doesn't re-force a fetch that blanks the cells.
  useEffect(() => {
    const force = refreshTick !== forcedDetailTick;
    forcedDetailTick = refreshTick;
    void enrichVisible(visible, force);
    // visibleKey encodes the identity of the current page's rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, refreshTick, enrichVisible]);

  // Eagerly load detail (nameservers) for the WHOLE portfolio once it's loaded,
  // so the Nameservers filter sees every domain — not just on-screen rows. Dedupes
  // against the visible fetches and is cached on disk. Renewal pricing isn't
  // fetched here: it's computed in main and loaded with the portfolio / after Sync.
  useEffect(() => {
    if (portfolio.length === 0) return;
    void loadAllDetail(portfolio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, refreshTick]);

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

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
      const csv = domainsToCsv(
        filtered,
        portfolioRegistrarLabels,
        folders,
        folderAssignments,
      );
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
    <div className="mx-auto flex max-w-[1400px] flex-col gap-[13px]">
      <div>
        <h1 className="text-[32px] font-bold">Domains</h1>
        <p className="-mt-0.5 text-sm text-muted-foreground">
          {/* Always a count — "0 domains across 0 registrars" before a load or
              when nothing is configured, never a call-to-action sentence. */}
          {`${portfolio.length} domain${portfolio.length === 1 ? '' : 's'} across ${portfolioRegistrars.length} registrar${
            portfolioRegistrars.length === 1 ? '' : 's'
          }`}
        </p>
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

      {/* The table always renders — even before a load or with no registrars
          configured — so its toolbar and structure stay put; the empty body row
          carries the contextual prompt (configure a registrar / refresh / no
          matches). */}
      <>
        {/* Toolbar: search, filters, and export all flow inline and wrap
              together as equal items. Extra top margin separates it from the
              title/refresh row above. */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
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

          <MultiSelectFilter
            label="Registrar"
            icon={Building2}
            options={registrarOptions}
            selected={registrar}
            onChange={(next) => {
              setRegistrar(next);
              setPage(0);
            }}
          />
          <MultiSelectFilter
            label="TLD"
            icon={Globe}
            options={tldOptions}
            selected={tld}
            onChange={(next) => {
              setTld(next);
              setPage(0);
            }}
          />
          <MultiSelectFilter
            label="Nameservers"
            icon={Server}
            options={nsGroups}
            selected={ns}
            onChange={(next) => {
              setNs(next);
              setPage(0);
            }}
          />
          <MultiSelectFilter
            label="Expiration"
            icon={CalendarClock}
            options={expiryOptions}
            selected={expiry}
            onChange={(next) => {
              setExpiry(next);
              setPage(0);
            }}
          />
          {/* Offer the Folder filter once there's anything to filter by —
                  a folder of the user's own, or hidden domains to reveal. */}
          {(folders.length > 0 || hiddenCount > 0) && (
            <MultiSelectFilter
              label="Folder"
              icon={FolderIcon}
              options={folderOptions}
              selected={folder}
              onChange={(next) => {
                setFolder(next);
                setPage(0);
              }}
            />
          )}

          {/* Reset button styled like the filters (no chevron); faded/
                  disabled when nothing is active. Trialling this alongside the
                  green header link. */}
          <Button
            variant="outline"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className={cn(
              'gap-2 pr-[14px]! pl-[8px]!',
              hasActiveFilters && 'border-[#4f9d6b] dark:border-[#4f9d6b]',
            )}
          >
            <X
              className={cn(
                'size-[18px]',
                hasActiveFilters ? 'text-[#4f9d6b]' : 'text-muted-foreground',
              )}
            />
            Reset
          </Button>

          <div className="flex items-center gap-3">
            {exportNote && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-sm',
                  exportNote.error
                    ? 'text-destructive'
                    : 'text-[#31613b] dark:text-[#7ac28d]',
                )}
                role="status"
              >
                {!exportNote.error && <CircleCheck className="size-4" />}
                {exportNote.text}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={exporting || filtered.length === 0}
                  title="Export the filtered domains"
                  className="pr-[7px]!"
                >
                  <Download className="text-muted-foreground" />
                  {exporting ? 'Exporting…' : 'Export'}
                  <ChevronDown className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportCsv()}>
                  <FileSpreadsheet className="text-muted-foreground" />
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Bulk action bar — contextual, appears once any row is selected.
              Actions are UI-only stubs for now. */}
        {BULK_SELECT_ENABLED && selectedCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{selectedCount} selected</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-muted-foreground"
                onClick={clearSelection}
              >
                <X />
                Clear
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Bulk actions
                  <ChevronDown className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled>
                  <FolderIcon />
                  Assign to folder…
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <RefreshCw />
                  Set auto-renew…
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Lock />
                  Set lock…
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <FileSpreadsheet />
                  Export selected
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <EyeOff />
                  Hidden
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border [&_td]:border-x [&_td]:border-x-border/50 [&_th]:border-x [&_th]:border-x-border/50">
          <Table>
            <TableHeader>
              <TableRow className="[&_th]:h-8 [&_th]:font-medium [&_th]:tracking-wider [&_th]:text-muted-foreground [&_button]:text-[10px] [&_button]:uppercase">
                {BULK_SELECT_ENABLED && (
                  <TableHead className="w-9 pl-3">
                    <Checkbox
                      checked={
                        allFilteredSelected
                          ? true
                          : someFilteredSelected
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all domains"
                    />
                  </TableHead>
                )}
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
                          col.align === 'center' && 'text-center',
                          col.compact && 'w-0 px-1.5',
                          col.key === 'autoRenew' && 'pl-[8px]',
                          col.key === 'domainName' && 'pl-3',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            'inline-flex items-center gap-1 select-none hover:text-foreground',
                            col.compact && 'gap-0.5',
                            active && 'text-foreground',
                          )}
                        >
                          {col.label}
                          <Icon className="size-3.5 opacity-70" />
                        </button>
                      </TableHead>
                      {/* Folder sits right after the domain name, before Registrar. */}
                      {i === 0 && (
                        <TableHead className="pl-3">
                          <button
                            type="button"
                            onClick={() => toggleSort(FOLDER)}
                            className={cn(
                              'inline-flex select-none items-center gap-1 hover:text-foreground',
                              sortKey === FOLDER && 'text-foreground',
                            )}
                          >
                            Folder
                            {(() => {
                              const FdIcon =
                                sortKey !== FOLDER
                                  ? ChevronsUpDown
                                  : sortDir === 'asc'
                                    ? ArrowUp
                                    : ArrowDown;
                              return <FdIcon className="size-3.5 opacity-70" />;
                            })()}
                          </button>
                        </TableHead>
                      )}
                      {/* Renewal price sits right before the Auto-Renew flag. */}
                      {col.key === 'expirationDate' && (
                        <TableHead className="w-0 text-right">
                          <button
                            type="button"
                            onClick={() => toggleSort(RENEWAL)}
                            className={cn(
                              'inline-flex select-none items-center gap-1 hover:text-foreground',
                              sortKey === RENEWAL && 'text-foreground',
                            )}
                          >
                            Renewal
                            {(() => {
                              const RnIcon =
                                sortKey !== RENEWAL
                                  ? ChevronsUpDown
                                  : sortDir === 'asc'
                                    ? ArrowUp
                                    : ArrowDown;
                              return <RnIcon className="size-3.5 opacity-70" />;
                            })()}
                          </button>
                        </TableHead>
                      )}
                    </Fragment>
                  );
                })}
                {/* Row actions ("⋯") — no header label. */}
                <TableHead className="w-0 px-1.5" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((d) => {
                const key = `${d.registrar}:${d.domainName}`;
                const loadingDetail = enriching[key] === true;
                return (
                  // Rows highlight on hover but aren't themselves clickable —
                  // the only click target is the Folder cell, which opens the
                  // folder-assignment menu.
                  <TableRow
                    key={key}
                    className={cn(selected.has(key) && 'bg-muted/50')}
                  >
                    {/* Selection checkbox. */}
                    {BULK_SELECT_ENABLED && (
                      <TableCell className="w-9 pl-3">
                        <Checkbox
                          checked={selected.has(key)}
                          onCheckedChange={() => toggleSelected(key)}
                          aria-label={`Select ${d.domainName}`}
                        />
                      </TableCell>
                    )}
                    {COLUMNS.map((col, i) => (
                      <Fragment key={col.key}>
                        <TableCell
                          className={cn(
                            col.align === 'right' && 'text-right',
                            col.align === 'center' && 'text-center',
                            col.compact && 'w-0 px-1.5',
                            col.key === 'autoRenew' && 'pl-[6px]',
                            col.key === 'domainName' && 'pl-3',
                          )}
                        >
                          {col.detail && loadingDetail ? (
                            <CellSkeleton align={col.align} />
                          ) : (
                            col.render(d, portfolioRegistrarLabels)
                          )}
                        </TableCell>
                        {i === 0 && (
                          <TableCell className="p-0">
                            <FolderCell
                              folders={folders}
                              folderId={folderAssignments[key]}
                              onAssign={(folderId) =>
                                void assignFolder(key, folderId)
                              }
                            />
                          </TableCell>
                        )}
                        {col.key === 'expirationDate' && (
                          <TableCell className="w-0 text-right pr-3">
                            <RenewalCell
                              info={pricing[key]}
                              loading={pricingLoading}
                            />
                          </TableCell>
                        )}
                      </Fragment>
                    ))}
                    <TableCell className="w-0 px-1.5">
                      <RowActionsMenu
                        domain={d}
                        onAuthCode={() => setAuthCodeFor(d)}
                        onRenew={() => setRenewFor(d)}
                        onHide={() => hideDomain(d)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={COLUMNS.length + 5}
                    className="h-40 text-center text-muted-foreground"
                  >
                    {noneConfigured ? (
                      <div className="flex flex-col items-center gap-3 py-4">
                        <div>
                          <p className="font-medium text-foreground">
                            No registrars configured
                          </p>
                          <p className="mt-0.5">
                            Add API credentials for a registrar to load your
                            domains into this table.
                          </p>
                        </div>
                        <Button
                          onClick={() => navigate('/settings?tab=registrars')}
                        >
                          <Plug />
                          Configure registrars
                        </Button>
                      </div>
                    ) : portfolio.length === 0 ? (
                      hasLoaded ? (
                        'No domains found in any configured registrar.'
                      ) : (
                        'Click “Sync domains” to load your portfolio.'
                      )
                    ) : (
                      'No domains match the current filters.'
                    )}
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
            <div className="flex items-center gap-1">
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
              <span className="px-2">
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

      {authCodeFor && (
        <AuthCodeDialog
          domain={authCodeFor}
          onClose={() => setAuthCodeFor(null)}
        />
      )}
      {renewFor && (
        <RenewDialog
          domain={renewFor}
          pricing={pricing[`${renewFor.registrar}:${renewFor.domainName}`]}
          onClose={() => setRenewFor(null)}
        />
      )}
    </div>
  );
}

/**
 * A checkbox dropdown filter. The trigger shows the plural `label` plus a count
 * badge once anything is selected; an empty selection means "no filter". The
 * menu stays open while toggling so several can be picked at once.
 */
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  icon: Icon,
}: {
  label: string;
  options: { value: string; label: string; count?: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional leading icon shown before the label in the trigger. */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          className="gap-2 pr-[7px]!"
        >
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {label}
          {selected.length > 0 && (
            <Badge className="bg-primary px-1.5 py-0 text-xs tabular-nums text-primary-foreground">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] overflow-y-auto"
      >
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            No options
          </div>
        )}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            // Keep the menu open so multiple options can be toggled in one go.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggleValue(selected, o.value))}
          >
            <span className="flex-1 truncate">{o.label}</span>
            {o.count != null && (
              <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                {o.count}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
