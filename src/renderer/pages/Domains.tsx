import {
  Fragment,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
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
  ExternalLink,
  FileSpreadsheet,
  Folder as FolderIcon,
  Globe,
  Lock,
  LockOpen,
  RefreshCw,
  RefreshCwOff,
  Search,
  Server,
  Tag,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  Aftermarket,
  Domain,
  Folder,
  MarketListing,
  RenewalPricing,
} from '../../shared/ipc';
import { HIDDEN_FOLDER_ID, STALE_AFTER_MS } from '../../shared/ipc';
import { useAppStore } from '../store/app';
import { csvFilename, domainsToCsv } from '../lib/csv';
import { nameserverGroup } from '../lib/nameservers';
import { folderColorStyle } from '../lib/folders';
import { timeAgo } from '../lib/time';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

/** Whether a fetch timestamp is at or past the staleness threshold. */
function isStale(fetchedAt: number): boolean {
  return Date.now() - fetchedAt >= STALE_AFTER_MS;
}

/** Freshly refreshed (within the last day) — the button dims itself so it
 * recedes when there's nothing to nudge. */
const RECENT_WITHIN_MS = 24 * 60 * 60 * 1000; // 1 day
function isRecent(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < RECENT_WITHIN_MS;
}

/** Minimum gap between manual refreshes — the button is disabled during it so a
 * fresh pull can't be hammered (every refresh re-queries every registrar). */
const REFRESH_COOLDOWN_MS = 60 * 1000; // 1 minute
function refreshOnCooldown(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < REFRESH_COOLDOWN_MS;
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

/** Sort sentinel for the injected Folder column (folders aren't a Domain field). */
const FOLDER = 'folder';
/** Filter value matching domains with no folder assigned. */
const UNASSIGNED = '__unassigned__';

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
      // Don't let the click bubble to the row trigger (which opens the row menu).
      onPointerDown={(e) => e.stopPropagation()}
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
function FolderCell({
  folders,
  folderId,
}: {
  folders: Folder[];
  folderId: string | undefined;
}) {
  if (folderId === HIDDEN_FOLDER_ID) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        title="Hidden"
      >
        <EyeOff className="size-3.5 shrink-0" />
        Hidden
      </span>
    );
  }
  const current = folderId ? folders.find((f) => f.id === folderId) : undefined;
  if (!current) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 text-sm"
      title={`Folder: ${current.name}`}
    >
      <FolderIcon
        className={cn(
          'size-3.5 shrink-0',
          folderColorStyle(current.color).text,
        )}
      />
      <span className="truncate">{current.name}</span>
    </span>
  );
}

/**
 * The menu shown when a domain row is clicked (the whole row is the trigger).
 * Visit the domain, or assign it to a folder (single-select submenu). The
 * submenu ends with "None" (clear) and the built-in "Hidden" folder, which drops
 * the domain from the table. Rendered inside a <DropdownMenu> whose trigger is
 * the row.
 */
function RowMenuContent({
  folders,
  folderId,
  onAssign,
  onVisit,
}: {
  folders: Folder[];
  folderId: string | undefined;
  onAssign: (folderId: string | null) => void;
  onVisit: () => void;
}) {
  return (
    <DropdownMenuContent align="start" className="w-44">
      <DropdownMenuItem onSelect={onVisit}>
        <ExternalLink />
        Visit domain
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderIcon />
          Folder
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-[320px] max-w-[240px] overflow-y-auto">
          {folders.map((f) => (
            <DropdownMenuItem
              key={f.id}
              className="gap-1.5"
              onSelect={() => onAssign(f.id)}
            >
              <FolderIcon
                className={cn(
                  'size-3.5 shrink-0',
                  folderColorStyle(f.color).text,
                )}
                aria-hidden
              />
              <span className="flex-1 truncate">{f.name}</span>
              {f.id === folderId && (
                <Check className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
          {folders.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem className="gap-1.5" onSelect={() => onAssign(null)}>
            {/* Spacer keeps "None" aligned with the icon'd rows. */}
            <span className="size-3.5 shrink-0" aria-hidden />
            <span className="flex-1">None</span>
            {folderId === undefined && (
              <Check className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
          {/* Hidden is a built-in folder: assigning to it drops the domain from
              the table until "Hidden" is picked in the Folder filter. */}
          <DropdownMenuItem
            className="gap-1.5"
            onSelect={() => onAssign(HIDDEN_FOLDER_ID)}
          >
            <EyeOff className="size-3.5 shrink-0" aria-hidden />
            <span className="flex-1">Hidden</span>
            {folderId === HIDDEN_FOLDER_ID && (
              <Check className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
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
  align = 'center',
}: {
  value: boolean;
  on: LucideIcon;
  off: LucideIcon;
  onLabel: string;
  offLabel: string;
  /** Horizontal placement within the cell. Default centers; 'left' hugs the
   * left edge (used by Auto-Renew so it snugs up to the renewal price). */
  align?: 'center' | 'left';
}) {
  const place = align === 'left' ? 'mr-auto' : 'mx-auto';
  const Icon = value ? On : Off;
  return (
    <Icon
      className={cn(
        'size-4',
        place,
        value ? 'text-emerald-500' : 'text-muted-foreground/50',
      )}
      aria-label={value ? onLabel : offLabel}
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
    // Sits right after the injected Renewal column, hugging the price on its
    // left (compact + left-aligned so the icon snugs up to the figure).
    key: 'autoRenew',
    label: 'Auto-Renew',
    align: 'left',
    compact: true,
    render: (d) => (
      <StateIcon
        value={d.autoRenew}
        on={RefreshCw}
        off={RefreshCwOff}
        onLabel="auto-renew on"
        offLabel="auto-renew off"
        align="left"
      />
    ),
    sortValue: (d) => (d.autoRenew ? 1 : 0),
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
    loadAllDetail,
    aftermarket,
    marketLoading,
    loadAftermarketVisible,
    loadAllMarket,
    pricing,
    pricingLoading,
    loadPricingAll,
    folders,
    folderAssignments,
    assignFolder,
  } = useAppStore();

  const openExternal = (url: string) => void window.api.openExternal(url);

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
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
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
  // Refreshed within the last day: dim the control so it recedes when the data
  // is plainly fresh and there's nothing to act on.
  const recent = portfolioLoadedAt !== null && isRecent(portfolioLoadedAt);
  // Rate limit: block a re-refresh for a minute after the last one.
  const tooSoon =
    portfolioLoadedAt !== null && refreshOnCooldown(portfolioLoadedAt);

  // Nothing else re-renders when the cooldown simply elapses, so schedule one
  // render at the moment it lifts to re-enable the button on its own.
  const [, tickCooldown] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (portfolioLoadedAt === null) return;
    const remaining = REFRESH_COOLDOWN_MS - (Date.now() - portfolioLoadedAt);
    if (remaining <= 0) return;
    const t = setTimeout(tickCooldown, remaining + 50);
    return () => clearTimeout(t);
  }, [portfolioLoadedAt]);

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
    // Afternic and Renewal aren't Domain fields — sort them from their maps.
    const valueOf = (d: Domain): SortValue | null => {
      if (sortKey === AFTERNIC) {
        return afternicListing(aftermarket[d.domainName])?.price ?? null;
      }
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
    priceFilterActive,
    minValue,
    maxValue,
    sortKey,
    sortDir,
    aftermarket,
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

  // Eagerly load detail (nameservers) and Afternic pricing for the WHOLE
  // portfolio once it's loaded, so the Nameservers and Price filters see every
  // domain — not just on-screen rows. Both loaders dedupe against the visible
  // fetches and are cached on disk; the loading flags drive the filter spinners.
  // Keyed on the portfolio identity + refreshTick so it runs once per load.
  useEffect(() => {
    if (portfolio.length === 0) return;
    void loadAllDetail(portfolio);
    void loadAllMarket(portfolio);
    void loadPricingAll(portfolio);
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
        aftermarket,
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
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-3">
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
              // The refresh control carries its own freshness: a "Refresh" label
              // with the last-refreshed time in smaller muted text. Dimmed when
              // fresh (<1 day), amber (fill + dot) once past the stale threshold.
              <Button
                variant="outline"
                onClick={() => void loadPortfolio()}
                disabled={portfolioLoading || tooSoon}
                title={`Refreshed ${new Date(portfolioLoadedAt).toLocaleString()}${
                  tooSoon
                    ? ' — just refreshed, try again in a minute'
                    : stale
                      ? ' — data may be stale, click to refresh'
                      : ' — click to refresh'
                }`}
                className={cn(
                  recent &&
                    !stale &&
                    'border-border/40 text-muted-foreground hover:text-foreground',
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
                {portfolioLoading ? (
                  'Refreshing…'
                ) : (
                  <span className="inline-flex items-baseline gap-1.5">
                    Refresh
                    <span className="text-xs font-normal opacity-70">
                      {timeAgo(portfolioLoadedAt)}
                    </span>
                  </span>
                )}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={exporting || filtered.length === 0}
                    title="Export the filtered domains"
                  >
                    <Download />
                    {exporting ? 'Exporting…' : 'Export'}
                    <ChevronDown className="text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onSelect={() => void exportCsv()}>
                    <FileSpreadsheet />
                    Export CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
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

              {/* Afternic price range — a dropdown holding the min/max inputs */}
              <PriceRangeFilter
                min={minPrice}
                max={maxPrice}
                onMinChange={(v) => {
                  setMinPrice(v);
                  setPage(0);
                }}
                onMaxChange={(v) => {
                  setMaxPrice(v);
                  setPage(0);
                }}
                minInvalid={Boolean(minParsed.error) || Boolean(rangeError)}
                maxInvalid={Boolean(maxParsed.error) || Boolean(rangeError)}
                minValue={minValue}
                maxValue={maxValue}
                error={priceError}
              />
            </div>
          </div>

          {/* Bulk action bar — contextual, appears once any row is selected.
              Actions are UI-only stubs for now. */}
          {selectedCount > 0 && (
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
                    Hide
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
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
                            col.key === 'domainName' && 'pl-3',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              'inline-flex items-center gap-1 select-none hover:text-foreground',
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
                                'inline-flex select-none items-center gap-1 hover:text-foreground',
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
                        {/* Folder sits right after Afternic, before Registrar. */}
                        {i === 0 && (
                          <TableHead>
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
                                return (
                                  <FdIcon className="size-3.5 opacity-70" />
                                );
                              })()}
                            </button>
                          </TableHead>
                        )}
                        {/* Renewal price sits right before the Auto-Renew flag. */}
                        {col.key === 'expirationDate' && (
                          <TableHead className="text-right">
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
                                return (
                                  <RnIcon className="size-3.5 opacity-70" />
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
                  const key = `${d.registrar}:${d.domainName}`;
                  const loadingDetail = enriching[key] === true;
                  return (
                    // The whole row is the trigger: clicking it opens the row
                    // menu (visit / assign folder / hide). It highlights on
                    // hover and stays highlighted while its menu is open.
                    <DropdownMenu key={key}>
                      <DropdownMenuTrigger asChild>
                        <TableRow
                          className={cn(
                            'cursor-pointer data-[state=open]:bg-muted/50',
                            selected.has(key) && 'bg-muted/50',
                          )}
                        >
                          {/* Selection checkbox. Stop pointer/click here so
                              ticking a row doesn't also open the row menu. */}
                          <TableCell
                            className="w-9 pl-3"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={selected.has(key)}
                              onCheckedChange={() => toggleSelected(key)}
                              aria-label={`Select ${d.domainName}`}
                            />
                          </TableCell>
                          {COLUMNS.map((col, i) => (
                            <Fragment key={col.key}>
                              <TableCell
                                className={cn(
                                  col.align === 'right' && 'text-right',
                                  col.compact && 'px-1',
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
                                <TableCell className="text-right">
                                  <AfternicCell
                                    info={aftermarket[d.domainName]}
                                    loading={
                                      marketLoading[d.domainName] === true
                                    }
                                    onOpen={openExternal}
                                  />
                                </TableCell>
                              )}
                              {i === 0 && (
                                <TableCell>
                                  <FolderCell
                                    folders={folders}
                                    folderId={folderAssignments[key]}
                                  />
                                </TableCell>
                              )}
                              {col.key === 'expirationDate' && (
                                <TableCell className="text-right">
                                  <RenewalCell
                                    info={pricing[key]}
                                    loading={pricingLoading}
                                  />
                                </TableCell>
                              )}
                            </Fragment>
                          ))}
                        </TableRow>
                      </DropdownMenuTrigger>
                      <RowMenuContent
                        folders={folders}
                        folderId={folderAssignments[key]}
                        onAssign={(folderId) =>
                          void assignFolder(key, folderId)
                        }
                        onVisit={() => openExternal(`https://${d.domainName}`)}
                      />
                    </DropdownMenu>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={COLUMNS.length + 4}
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
/** One "$"-prefixed price field with a tiny, right-aligned unit label inside. */
function PriceField({
  value,
  onChange,
  label,
  ariaLabel,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  ariaLabel: string;
  invalid: boolean;
}) {
  return (
    <InputGroup className="w-[105px]">
      <InputGroupAddon className="pl-1.5">$</InputGroupAddon>
      <InputGroupInput
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className="flex-1 pl-1 tabular-nums"
      />
      <InputGroupAddon className="pr-2 text-xs">{label}</InputGroupAddon>
    </InputGroup>
  );
}

/** Compact whole-dollar label for the trigger badge, e.g. "$1,200". */
function fmtBound(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** A short label for the active Afternic price range, or null when none is set. */
function priceSummary(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${fmtBound(min)}–${fmtBound(max)}`;
  if (min !== null) return `≥ ${fmtBound(min)}`;
  if (max !== null) return `≤ ${fmtBound(max)}`;
  return null;
}

/**
 * Afternic price filter: a filter button (matching the multi-selects) that opens
 * a popover holding the min/max inputs. The button reflects the active range as
 * a badge.
 */
function PriceRangeFilter({
  min,
  max,
  onMinChange,
  onMaxChange,
  minInvalid,
  maxInvalid,
  minValue,
  maxValue,
  error,
}: {
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  minInvalid: boolean;
  maxInvalid: boolean;
  /** Applied numeric bounds (null when unset/invalid) — drives the badge. */
  minValue: number | null;
  maxValue: number | null;
  /** Validation message shown inside the popover, or null. */
  error: string | null;
}) {
  const summary = priceSummary(minValue, maxValue);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Price" className="gap-1.5">
          <Tag className="size-4 text-muted-foreground" />
          Price
          {summary && (
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-xs tabular-nums"
            >
              {summary}
            </Badge>
          )}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <PriceField
              value={min}
              onChange={onMinChange}
              label="min"
              ariaLabel="Minimum Afternic price"
              invalid={minInvalid}
            />
            <span className="text-muted-foreground">–</span>
            <PriceField
              value={max}
              onChange={onMaxChange}
              label="max"
              ariaLabel="Maximum Afternic price"
              invalid={maxInvalid}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
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
  icon?: LucideIcon;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={label} className="gap-1.5">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {label}
          {selected.length > 0 && (
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-xs tabular-nums"
            >
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
