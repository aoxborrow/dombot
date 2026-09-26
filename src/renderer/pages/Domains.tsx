import { accountNumber, accountTitle } from '../../shared/account-label';
import { multiAccountRegistrars } from '../lib/registrar-accounts';
import { domainKey } from '../../shared/account-key';
import { toAscii } from '../../shared/domain-name';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SyncErrorsAlert } from '../components/SyncErrorsAlert';
import {
  Archive,
  BadgeDollarSign,
  CircleOff,
  DoorOpen,
  EyeOff,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CircleX,
  ExternalLink,
  Globe,
  Plug,
  Search,
  Server,
  ShieldBan,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  Domain,
  DomainOp,
  Folder,
  RenewalPricing,
} from '../../shared/ipc';
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/20/solid';
import { toast } from 'sonner';
import {
  HIDDEN_FOLDER_ID,
  builtInFolderName,
  isHiddenFolder,
} from '../../shared/ipc';
import { DomainEventType } from '../../shared/domain-events';
import { ownershipByDomain, type ArchiveLabel } from '../../shared/ownership';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { ARCHIVE_LABEL, archiveRows } from '../lib/domain-history';
import {
  DeleteDomainsDialog,
  DispositionDialog,
  MarkSoldDialog,
  RestoreOwnedDialog,
} from '../components/actions/OwnershipDialogs';
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
import { FolderOffIcon } from '../components/icons/FolderOffIcon';
import { FolderMenuItems } from '../components/domains/FolderMenuItems';
import { OwnershipSwitch } from '../components/domains/OwnershipSwitch';
import { FlagToggle } from '../components/domains/FlagToggle';
import { RowActionsMenu } from '../components/domains/RowActionsMenu';
import { purchaseColumns } from '../components/domains/purchase-columns';
import { PurchaseDialog } from '../components/domains/PurchaseDialog';
import { SaleDialog } from '../components/domains/SaleDialog';
import { DEFAULT_CURRENCY, DEFAULT_NUMBER_FORMAT } from '../../shared/money';
import { NameserversCell } from '../components/domains/NameserversCell';
import { AuthCodeDialog } from '../components/domains/AuthCodeDialog';
import { RenewDialog } from '../components/domains/RenewDialog';
import {
  EmailForwardingDialog,
  UrlForwardingDialog,
} from '../components/domains/ForwardingDialogs';
import { BulkBar, type OwnershipAction } from '../components/domains/BulkBar';
import { BulkActionDialog } from '../components/domains/BulkActionDialog';
import { defaultBulkOp } from '../lib/bulk';
import { usePreferences } from '../lib/preferences';
import { DataTable, type DataColumn } from '../components/data-table/DataTable';
import { paginate, sortRows } from '../components/data-table/table-state';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {} from '@/components/ui/table';

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
  /** Dropped below sm to trim the table on phones (still there when scrolled on
   * desktop). Applied to both the header and the body cell. */
  hideOnMobile?: boolean;
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
/** Filter value matching domains with no folder assigned (the "None" bucket). */
const NONE = '__none__';

const RENEWAL = 'renewal';

/** Whole/decimal USD, e.g. "$12" or "$12.99". */
function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

const SOURCE_LABEL: Record<RenewalPricing['source'], string> = {
  api: 'registrar quote',
  tld: 'account rate',
  base: 'built-in list price',
  manual: 'manual',
  unavailable: 'unknown',
};

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
      title={`Renewal source: ${SOURCE_LABEL[info.source]}`}
    >
      {fmtUsd(info.renewal)}
    </span>
  );
}

/**
 * The Folder cell: a small colored folder icon plus the folder name when the
 * domain is in a folder, a muted "Hidden" for the built-in Hidden folder, or a
 * muted dash when unassigned. Display only — assigning is done from
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
  const builtIn = builtInFolderName(folderId);
  const BuiltInIcon = EyeOff;
  const current =
    folderId && !builtIn ? folders.find((f) => f.id === folderId) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Assign folder"
          // Vertical padding matches the table cells' so this full-cell button
          // never sets the row height.
          className="group flex w-full cursor-pointer items-center gap-1.5 px-3 py-3 text-left text-sm text-muted-foreground/40 transition-colors hover:text-foreground compact:px-2 compact:py-[9px] compact:text-xs"
        >
          {builtIn ? (
            <span className="inline-flex h-4 items-center gap-2 leading-none text-muted-foreground">
              <BuiltInIcon className="size-4 shrink-0" />
              {builtIn}
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

const ARCHIVE_ICON: Record<ArchiveLabel, typeof Archive> = {
  sold: BadgeDollarSign,
  dropped: CircleOff,
  archived: Archive,
  left: DoorOpen,
};

/**
 * In Archive the Folder column shows why the name is there instead: Sold,
 * Dropped, Archived, or Left your accounts (sync saw it go; label it from the
 * row menu). Display only.
 */
function ArchiveStatusCell({ label }: { label: ArchiveLabel | null }) {
  if (!label) return null;
  const Icon = ARCHIVE_ICON[label];
  return (
    <span
      className={cn(
        'flex items-center gap-2 px-3 py-3 text-sm compact:px-2 compact:py-[9px] compact:text-xs',
        label === 'left'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-muted-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{ARCHIVE_LABEL[label]}</span>
    </span>
  );
}

/**
 * The folder-assignment menu, opened directly from the Folder cell. A flat list
 * of the user's folders followed by "None" (clear) and "Archive" (the built-in
 * folder that drops the domain from the table).
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
      <FolderMenuItems
        folders={folders}
        selected={folderId ?? null}
        onAssign={onAssign}
      />
    </DropdownMenuContent>
  );
}

type LifecycleTone = 'redemption' | 'expired' | 'grace' | 'hold';

/**
 * A solid pill per lifecycle state. The post-expiry states walk the cool side
 * of the wheel with severity — grace (still renewable at the normal price) is
 * pink, expired fuchsia, redemption (renewable at a fee) purple — matching the
 * expired-date text (see expiryColor) and staying clear of the countdown's warm
 * yellow → orange → red ramp. Hold (DNS switched off by a registrar/registry
 * lock) is a different, site-down problem and takes a deep red.
 */
const LIFECYCLE_TONE: Record<LifecycleTone, string> = {
  redemption: 'bg-purple-950 text-purple-100',
  expired: 'bg-fuchsia-700 text-white',
  grace: 'bg-pink-500 text-white',
  hold: 'bg-red-800 text-white',
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
        'border-transparent px-1.5 py-0 text-[11px] compact:px-1 compact:text-[10px]',
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
 * green when on, pale yellow (`flag-off`) when off (matching the exposed-state glyphs
 * in the Privacy and Locked columns).
 */
function AutoRenewSwitch({ domain }: { domain: Domain }) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const key = domainKey(domain);
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
      size="sm"
      checked={domain.autoRenew}
      onCheckedChange={onToggle}
      disabled={pending || reason !== null}
      aria-label="auto-renew"
      title={
        reason ??
        `Auto-renew ${domain.autoRenew ? 'on' : 'off'} — click to toggle`
      }
      // Unsupported ones look the same as the rest (no fade) — the not-allowed
      // cursor and tooltip carry that.
      className="data-[state=unchecked]:bg-flag-off disabled:opacity-100 dark:data-[state=unchecked]:bg-flag-off"
    />
  );
}

/** Lucide's shield-check as a solid glyph: the shield filled with the current
 * color and the check cut out in the page background, enlarged (Lucide ships
 * outlines only, so a plain fill would swallow the check). */
function ShieldCheckFilled(props: React.ComponentProps<typeof ShieldCheck>) {
  return (
    <ShieldCheck
      fill="currentColor"
      {...props}
      className={cn(
        // The check: knocked out in the page background, and scaled up a bit
        // with a heavier stroke so it reads at 18px.
        '[&>path:last-child]:origin-center [&>path:last-child]:scale-125 [&>path:last-child]:stroke-background [&>path:last-child]:stroke-[2.75] [&>path:last-child]:[transform-box:fill-box]',
        props.className,
      )}
    />
  );
}

/** Not useful once a name has left: there is nothing to renew or reconfigure. */
const ARCHIVE_HIDDEN_COLUMNS = new Set([
  'autoRenew',
  'privacy',
  'locked',
  'nameservers',
]);

const COLUMNS: Column[] = [
  {
    key: 'domainName',
    label: 'Domain',
    render: (d) => (
      <span className="inline-flex items-center gap-2">
        {/* Opens the site in a new tab/window (Electron hands target=_blank to
            the OS browser). noreferrer keeps the Referer header off the request.
            The external-link glyph only shows on hover but always takes its
            space, so nothing shifts when it appears. */}
        <a
          href={`https://${d.domainName}/`}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open https://${d.domainName} in a new window`}
          className="group/domain inline-flex items-center font-mono hover:text-brand-600 compact:text-[13px] dark:hover:text-brand"
        >
          {/* One step up from the reduced mobile body size — the domain is
              the row's primary field. Desktop inherits the table's text-sm. */}
          {d.domainName}
          <ExternalLink
            // Always green (not currentColor) so it never flashes grey mid-fade.
            className="ml-1.5 size-3 shrink-0 text-brand-600 opacity-0 transition-opacity group-hover/domain:opacity-100 dark:text-brand dark:group-hover/domain:opacity-50"
            aria-hidden
          />
        </a>
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
    hideOnMobile: true,
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
            <span className="text-xs opacity-60 compact:text-[11px]">
              {relativeDays(days)}
            </span>
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
    hideOnMobile: true,
    render: (d) => (
      <FlagToggle
        domain={d}
        kind="privacy"
        on={ShieldCheckFilled}
        off={ShieldBan}
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
        on={LockClosedIcon}
        off={LockOpenIcon}
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
    render: (d) => <NameserversCell domain={d} />,
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
 * Expiry text color. Upcoming expiries climb a warm ramp as they near — yellow
 * (≤60, a heads-up) → orange (≤30) → red (≤14). Past expiries switch to the
 * cool side so they can't be mistaken for a countdown: pink while the domain
 * is likely still recoverable (most registrars' grace + redemption windows
 * fall inside ~45 days), then a deep purple once it's probably gone. Muted
 * when there's no date.
 */
function expiryColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days < -RECOVERABLE_DAYS) return 'text-purple-900 dark:text-purple-500';
  if (days <= 0) return 'text-pink-600 dark:text-pink-400';
  if (days <= 14) return 'text-red-700 dark:text-red-500';
  if (days <= 30) return 'text-orange-500 dark:text-orange-375';
  if (days <= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-foreground';
}

/** Days past expiry within which a domain is usually still renewable. */
const RECOVERABLE_DAYS = 45;

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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Owned is what you hold; Archive is what you no longer own (Sold, Dropped,
  // Archived, or Left your accounts), read from the domain event log.
  const archiveView = params.get('view') === 'archive';
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
    selected,
    toggleSelected,
    setSelectedMany,
    clearSelection,
    bulk,
    purchases,
    settings,
    domainEvents,
    registrationLookups,
    loadRegistrationLookups,
    restoreOwned,
  } = useAppStore();

  // Ownership per name, and each name's open "left your accounts" alert (a
  // label chosen from the row closes it).
  const ownership = useMemo(
    () => ownershipByDomain(domainEvents),
    [domainEvents],
  );
  const openRemoval = useMemo(() => {
    const resolved = resolvedIds(domainEvents);
    const out = new Map<string, string>();
    for (const e of domainEvents) {
      if (e.type === DomainEventType.Removed && isOpenAlert(e, resolved))
        out.set(e.domain, e.id);
    }
    return out;
  }, [domainEvents]);
  const archiveLabelOf = useCallback(
    (d: Domain): ArchiveLabel | null =>
      ownership.get(toAscii(d.domainName))?.label ?? null,
    [ownership],
  );

  const multipleAccounts = useMemo(
    () => multiAccountRegistrars(registrars, portfolio),
    [registrars, portfolio],
  );
  const [purchaseFor, setPurchaseFor] = useState<Domain | null>(null);
  const [saleFor, setSaleFor] = useState<Domain | null>(null);
  // Mark as Sold for one name: the sale dialog, which takes the price.
  const [markSoldFor, setMarkSoldFor] = useState<Domain | null>(null);
  // The ownership dialogs, for one name (row menu) or the selection.
  const [ownershipDialog, setOwnershipDialog] = useState<{
    action: OwnershipAction;
    domains: Domain[];
  } | null>(null);
  // The Registrar column carries the account too: a nickname always shows in
  // parens; an unnamed account shows its number only when the registrar has
  // siblings to tell apart. `null` from accountNumber() means a real nickname.
  const columns = useMemo(() => {
    const paren = (label: string | undefined, registrar: string) => {
      const n = accountNumber(label);
      if (n === null) return label ?? '';
      return multipleAccounts.has(registrar) ? `#${n}` : '';
    };
    const base = COLUMNS.map((c) =>
      c.key === 'registrar'
        ? {
            ...c,
            render: (d: Domain, labels: RegistrarLabels) => {
              const suffix = paren(d.accountLabel, d.registrar);
              return (
                <span>
                  {registrarLabel(d.registrar, labels)}
                  {suffix && (
                    <span className="ml-1 text-xs text-muted-foreground/70">
                      ({suffix})
                    </span>
                  )}
                </span>
              );
            },
            sortValue: (d: Domain, labels: RegistrarLabels) => {
              const name = registrarLabel(d.registrar, labels).toLowerCase();
              const n = accountNumber(d.accountLabel);
              const suffix =
                n === null
                  ? (d.accountLabel ?? '').toLowerCase()
                  : multipleAccounts.has(d.registrar)
                    ? String(n).padStart(4, '0')
                    : '';
              return suffix ? `${name} ${suffix}` : name;
            },
          }
        : c,
    );
    const purchasedAt = base.findIndex((c) => c.key === 'createdDate');
    const extra = purchaseColumns({
      purchases,
      preferredCurrency: settings?.preferredCurrency ?? DEFAULT_CURRENCY,
      numberFormat: settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
      onEdit: setPurchaseFor,
      onEditSale: setSaleFor,
      showSale: archiveView,
      isSold: (d) => ownership.get(toAscii(d.domainName))?.label === 'sold',
    });
    base.splice(purchasedAt + 1, 0, ...extra);
    return base;
  }, [multipleAccounts, purchases, settings, archiveView, ownership]);

  const tableColumns = archiveView
    ? columns.filter((col) => !ARCHIVE_HIDDEN_COLUMNS.has(col.key))
    : columns;

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
    () =>
      portfolio.map((d) =>
        enriched[domainKey(d)]
          ? {
              ...enriched[domainKey(d)],
              accountId: d.accountId,
              accountLabel: d.accountLabel,
            }
          : d,
      ),
    [portfolio, enriched],
  );

  // Names in Archive that no registrar reports any more. They're not in
  // `merged`; the Archive view is what shows them.
  const listed = useMemo(
    () => [...merged, ...archiveRows(ownership, portfolio, registrars)],
    [merged, ownership, portfolio, registrars],
  );

  // Archive asks RDAP for names that have left, so created and expires stay
  // current and a free name can be shown as unregistered.
  const departedKey = archiveView
    ? listed
        .filter((d) => d.departed)
        .map((d) => d.domainName.toLowerCase())
        .sort()
        .join('\n')
    : '';
  useEffect(() => {
    if (!departedKey) return;
    void loadRegistrationLookups(departedKey.split('\n'));
  }, [departedKey, loadRegistrationLookups]);

  const shown = useMemo(() => {
    if (!archiveView) return listed;
    return listed.map((d) => {
      if (!d.departed) return d;
      const lookup = registrationLookups[toAscii(d.domainName)];
      if (!lookup) return { ...d, registrationPending: true };
      if (!lookup.registered) {
        return {
          ...d,
          registrationPending: false,
          unregistered: true,
          createdDate: null,
          expirationDate: null,
        };
      }
      return {
        ...d,
        registrationPending: false,
        unregistered: false,
        registrationRegistrar: lookup.registrar ?? undefined,
        createdDate: lookup.created ? new Date(lookup.created) : null,
        expirationDate: lookup.expires ? new Date(lookup.expires) : null,
      };
    });
  }, [listed, archiveView, registrationLookups]);

  const [search, setSearch] = useState('');
  // Multi-select filters; an empty array means "no filter" (show all).
  const [tld, setTld] = useState<string[]>([]);
  // One "Registrar" filter, but its options are individual accounts (keyed by
  // account id), so a registrar's accounts can be picked apart or selected
  // together. Old saved values were registrar names; those simply match nothing
  // now, which reads as "no filter".
  const [registrar, setRegistrar] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string[]>([]);
  const [ns, setNs] = useState<string[]>([]);
  const [folder, setFolder] = useState<string[]>([]);
  // Sort and page size open at the Settings → General defaults; changes made
  // here last for this visit only.
  const [sortKey, setSortKey] = useState(
    () => usePreferences.getState().sortKey,
  );
  const [sortDir, setSortDir] = useState(
    () => usePreferences.getState().sortDir,
  );
  const [pageSize, setPageSize] = useState(
    () => usePreferences.getState().pageSize,
  );
  const [page, setPage] = useState(0);
  // Phones only: the filter chips collapse behind a "Filters" toggle (they're
  // always shown at sm+). Search and Reset stay visible.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The bulk dialog: an op to configure for the current selection, or a
  // running/finished job to view (the bar's progress pill).
  const [bulkDialog, setBulkDialog] = useState<{
    op: DomainOp;
    jobId?: string;
  } | null>(null);

  // Per-row action dialogs (opened from the row's "⋯" menu).
  const [authCodeFor, setAuthCodeFor] = useState<Domain | null>(null);
  const [renewFor, setRenewFor] = useState<Domain | null>(null);
  const [urlForwardingFor, setUrlForwardingFor] = useState<Domain | null>(null);
  const [emailForwardingFor, setEmailForwardingFor] = useState<Domain | null>(
    null,
  );
  // Re-fetch one row's full record from its registrar (bypassing the detail
  // cache) — the row's detail cells show skeletons while it's in flight.
  const refreshDomain = (d: Domain) => {
    void enrichVisible([d], true).then(() =>
      toast.success(`Refreshed ${d.domainName}`),
    );
  };

  // CSV export: an in-flight flag (dialog open + write) and a transient result
  // note ("Exported N rows to …" / an error) that clears itself after a moment.
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
  // One option per account (keyed by account id), so accounts of the same
  // registrar can be filtered apart or, by multi-selecting, together. Labelled
  // "Registrar · nickname" / "Registrar #2" / "Registrar".
  const registrarOptions = useMemo(() => {
    const acc = new Map<string, { label: string; count: number }>();
    for (const d of portfolio) {
      const value = d.accountId ?? d.registrar;
      const existing = acc.get(value);
      if (existing) existing.count += 1;
      else
        acc.set(value, {
          label: accountTitle(
            registrarLabel(d.registrar, portfolioRegistrarLabels),
            d.accountLabel,
            multipleAccounts.has(d.registrar),
          ),
          count: 1,
        });
    }
    return Array.from(acc, ([value, v]) => ({
      value,
      label: v.label,
      count: v.count,
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [portfolio, portfolioRegistrarLabels, multipleAccounts]);
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
      keysByDomain.set(domainKey(d), keys);
    }
    const groups = Array.from(counts, ([value, v]) => ({
      value,
      label: v.label,
      count: v.count,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return { nsGroups: groups, nsKeysByDomain: keysByDomain };
  }, [merged]);

  // Owned: the Folder filter offers the user's folders, None, and Hidden.
  // Archive: the same control filters by status (Sold, Dropped, …).
  const { ownedFolderOptions, archiveStatusOptions, ownedCount, archiveCount } =
    useMemo(() => {
      const counts: Record<string, number> = {};
      const status: Record<ArchiveLabel, number> = {
        sold: 0,
        dropped: 0,
        archived: 0,
        left: 0,
      };
      let noFolder = 0;
      let hidden = 0;
      for (const d of listed) {
        const label = ownership.get(toAscii(d.domainName))?.label;
        if (label) {
          status[label] += 1;
          continue;
        }
        const id = folderAssignments[toAscii(d.domainName)];
        if (id === HIDDEN_FOLDER_ID) hidden += 1;
        else if (id && folders.some((f) => f.id === id)) {
          counts[id] = (counts[id] ?? 0) + 1;
        } else {
          noFolder += 1;
        }
      }
      const opts = folders.map((f) => ({
        value: f.id,
        label: f.name,
        count: counts[f.id] ?? 0,
        icon: (
          <FolderIcon
            className={cn('size-4 shrink-0', folderColorStyle(f.color).text)}
            aria-hidden
          />
        ),
      }));
      opts.push({
        value: NONE,
        label: 'None',
        count: noFolder,
        icon: (
          <FolderOffIcon
            className="size-4 shrink-0 text-muted-foreground/50"
            aria-hidden
          />
        ),
      });
      opts.push({
        value: HIDDEN_FOLDER_ID,
        label: 'Hidden',
        count: hidden,
        icon: <EyeOff className="size-4 shrink-0" aria-hidden />,
      });
      const statusOptions = (
        [
          ['sold', BadgeDollarSign],
          ['dropped', CircleOff],
          ['archived', Archive],
          ['left', DoorOpen],
        ] as const
      ).map(([label, Icon]) => ({
        value: label,
        label: ARCHIVE_LABEL[label],
        count: status[label],
        icon: <Icon className="size-4 shrink-0" aria-hidden />,
      }));
      const userFolderCount = Object.values(counts).reduce((n, c) => n + c, 0);
      return {
        ownedFolderOptions: opts,
        archiveStatusOptions: statusOptions,
        // Owned counts what shows by default: Hidden is left out.
        ownedCount: noFolder + userFolderCount,
        archiveCount: Object.values(status).reduce((n, c) => n + c, 0),
      };
    }, [listed, folders, folderAssignments, ownership]);

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

  // How many filter groups are narrowing the list (search excluded — it has its
  // own always-visible field). Drives the count badge on the mobile "Filters"
  // toggle.
  const activeFilterGroups =
    (registrar.length > 0 ? 1 : 0) +
    (tld.length > 0 ? 1 : 0) +
    (ns.length > 0 ? 1 : 0) +
    (expiry.length > 0 ? 1 : 0) +
    (folder.length > 0 ? 1 : 0);

  function resetFilters() {
    setSearch('');
    setTld([]);
    setRegistrar([]);
    setExpiry([]);
    setNs([]);
    setFolder([]);
    setPage(0);
  }

  function setListView(next: 'owned' | 'archive') {
    setFolder([]);
    setPage(0);
    const nextParams = new URLSearchParams(params);
    if (next === 'archive') nextParams.set('view', 'archive');
    else nextParams.delete('view');
    setParams(nextParams, { replace: true });
  }

  // Filter → sort. Pagination is applied after, on the sorted result.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = shown.filter((d) => {
      if (q && !d.domainName.toLowerCase().includes(q)) return false;
      if (tld.length > 0 && !tld.includes(tldOf(d.domainName))) return false;
      // The "Registrar" filter picks individual accounts (by account id).
      if (
        registrar.length > 0 &&
        !registrar.includes(d.accountId ?? d.registrar)
      )
        return false;
      // Expiration: keep a domain matching ANY selected window ("Expired" =
      // past-due; a numeric window = within that many upcoming days).
      if (expiry.length > 0) {
        const days = daysUntil(d.expirationDate);
        if (!expiry.some((o) => matchesExpiryOption(o, days))) return false;
      }
      // Nameservers: keep a domain in ANY selected nameserver group.
      if (ns.length > 0) {
        const keys = nsKeysByDomain.get(domainKey(d));
        if (!keys || !ns.some((k) => keys.has(k))) return false;
      }
      // Owned vs Archive comes from the event log. In Archive the filter is
      // the status; in Owned it's the folder (a real folder, Hidden, or None),
      // and Hidden stays out unless the filter picks it.
      {
        const label = archiveLabelOf(d);
        if (archiveView) {
          if (!label) return false;
          if (folder.length > 0 && !folder.includes(label)) return false;
        } else {
          if (label) return false;
          const id = folderAssignments[toAscii(d.domainName)];
          const bucket = isHiddenFolder(id)
            ? id!
            : id && folders.some((f) => f.id === id)
              ? id
              : NONE;
          if (folder.length > 0) {
            if (!folder.includes(bucket)) return false;
          } else if (isHiddenFolder(bucket)) {
            return false;
          }
        }
      }
      return true;
    });

    const col = columns.find((c) => c.key === sortKey) ?? columns[0];
    // Renewal isn't a Domain field — sort it from the pricing map.
    const valueOf = (d: Domain): SortValue | null => {
      if (sortKey === RENEWAL) {
        return pricing[domainKey(d)]?.renewal ?? null;
      }
      if (sortKey === FOLDER) {
        const label = archiveLabelOf(d);
        if (label) return ARCHIVE_LABEL[label].toLowerCase();
        const id = folderAssignments[toAscii(d.domainName)];
        return (
          builtInFolderName(id)?.toLowerCase() ??
          folders.find((f) => f.id === id)?.name.toLowerCase() ??
          null
        );
      }
      return col.sortValue(d, portfolioRegistrarLabels);
    };
    return sortRows(rows, valueOf, sortDir);
  }, [
    shown,
    columns,
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
    archiveView,
    archiveLabelOf,
    sortKey,
    sortDir,
    pricing,
  ]);

  // The rows on screen (the table pages the same way), for lazy detail loads.
  const { start, end } = paginate(filtered.length, page, pageSize);
  const visible = filtered.slice(start, end);

  // The selected domains as merged rows, for the bulk bar and dialog.
  const selectedDomains = useMemo(
    () => shown.filter((d) => selected.has(domainKey(d))),
    [shown, selected],
  );
  // Bulk: re-fetch every selected domain's detail from its registrar, bypassing
  // the detail cache (their cells show skeletons while in flight).
  const bulkRefresh = () => {
    const n = selectedDomains.length;
    void enrichVisible(selectedDomains, true).then(() =>
      toast.success(`Refreshed ${n} domain${n === 1 ? '' : 's'}`),
    );
  };
  function applyFolders(domainsToMove: Domain[], folderId: string | null) {
    const keys = domainsToMove.map((domain) => domainKey(domain));
    void Promise.all(
      domainsToMove.map((domain) => assignFolder(domain.domainName, folderId)),
    ).then(() => {
      setSelectedMany(keys, false);
      const noun = `${keys.length} domain${keys.length === 1 ? '' : 's'}`;
      toast.success(
        folderId === null
          ? `Removed ${noun} from their folders`
          : `Moved ${noun} to ${
              builtInFolderName(folderId) ??
              folders.find((folder) => folder.id === folderId)?.name ??
              'folder'
            }`,
      );
    });
  }

  // Ownership actions. A name sync saw leave has an open alert; the label
  // you pick closes it.
  const ownershipItems = (ds: Domain[]) =>
    ds.map((d) => ({
      domainName: d.domainName,
      resolves: openRemoval.get(toAscii(d.domainName)),
    }));

  function openOwnership(action: OwnershipAction, ds: Domain[]) {
    if (action === 'sold' && ds.length === 1) setMarkSoldFor(ds[0]);
    else setOwnershipDialog({ action, domains: ds });
  }

  // Undoing one name's label is one click (and reversible); many go through
  // the dialog.
  function moveBackToOwned(d: Domain) {
    const label = archiveLabelOf(d);
    void restoreOwned([d.domainName]).then(() =>
      toast.success(
        d.departed && label
          ? `Undid ${ARCHIVE_LABEL[label]} for ${d.domainName}`
          : `Moved ${d.domainName} back to Owned`,
      ),
    );
  }

  // After a bulk ownership action the names leave this view: clear them.
  const clearDone = (ds: Domain[]) =>
    setSelectedMany(
      ds.map((d) => domainKey(d)),
      false,
    );

  // Lazily fetch full detail for the rows actually on screen. Keyed on the
  // visible domains' identities so it re-runs on page/sort/filter changes;
  // enrichVisible dedupes against already-fetched and in-flight domains.
  const visibleKey = visible.map((d) => domainKey(d)).join('|');

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

  // Export a row set (the full filtered + sorted result by default — every
  // column we have, not just the current page; or the selection) via the
  // native save dialog in main.
  async function exportCsv(rows: Domain[] = filtered) {
    try {
      const csv = domainsToCsv(
        rows,
        portfolioRegistrarLabels,
        folders,
        folderAssignments,
        purchases,
      );
      const result = await window.api.saveTextFile(csv, csvFilename());
      if (!result.saved) return; // user cancelled the dialog
      const name = result.path?.split(/[/\\]/).pop() ?? 'file';
      const n = rows.length;
      flashExportNote(
        `Exported ${n} row${n === 1 ? '' : 's'} to ${name}`,
        false,
      );
    } catch (err) {
      flashExportNote(
        err instanceof Error ? err.message : 'Export failed',
        true,
      );
    }
  }

  // Table columns: the data columns, with Folder (Status in Archive) after
  // the domain and Renewal before Auto-renew. Cells show a placeholder while
  // their data loads, and a dash where a departed name has none.
  const renderCell = (col: Column, d: Domain) => {
    const registration =
      col.key === 'registrar' ||
      col.key === 'createdDate' ||
      col.key === 'expirationDate';
    if (col.key === 'domainName') {
      // The row's "⋯" menu lives in the Domain cell, pinned to its right edge.
      return (
        <div className="flex items-center justify-between gap-2">
          {col.render(d, portfolioRegistrarLabels)}
          <RowActionsMenu
            domain={d}
            folders={folders}
            folderId={folderAssignments[toAscii(d.domainName)]}
            onRefresh={() => refreshDomain(d)}
            onUrlForwarding={() => setUrlForwardingFor(d)}
            onEmailForwarding={() => setEmailForwardingFor(d)}
            onAuthCode={() => setAuthCodeFor(d)}
            onRenew={() => setRenewFor(d)}
            onEditPurchase={() => setPurchaseFor(d)}
            onEditSale={() => setSaleFor(d)}
            onAssignFolder={(folderId) => applyFolders([d], folderId)}
            archive={archiveLabelOf(d)}
            onMarkSold={() => openOwnership('sold', [d])}
            onMarkDropped={() => openOwnership('dropped', [d])}
            onMarkArchived={() => openOwnership('archived', [d])}
            onRestoreOwned={() => moveBackToOwned(d)}
            onDelete={() => openOwnership('delete', [d])}
          />
        </div>
      );
    }
    if (d.registrationPending && registration)
      return <CellSkeleton align={col.align} />;
    if (d.unregistered && registration)
      return <span className="text-muted-foreground">—</span>;
    if (col.key === 'registrar' && d.registrationRegistrar)
      return <span>{d.registrationRegistrar}</span>;
    if (d.departed && (col.detail || col.key === 'autoRenew'))
      return <span className="text-muted-foreground/50">—</span>;
    if (col.detail && enriching[domainKey(d)] === true)
      return <CellSkeleton align={col.align} />;
    return col.render(d, portfolioRegistrarLabels);
  };
  const dataColumns: DataColumn<Domain>[] = [];
  for (const col of tableColumns) {
    dataColumns.push({
      key: col.key,
      label: col.label,
      align: col.align,
      compact: col.compact,
      hideOnMobile: col.hideOnMobile,
      headClassName: col.key === 'autoRenew' ? 'pl-[8px]' : undefined,
      cellClassName: col.key === 'autoRenew' ? 'pl-[6px]' : undefined,
      cell: (d) => renderCell(col, d),
    });
    if (col.key === 'domainName') {
      dataColumns.push({
        key: FOLDER,
        label: archiveView ? 'Status' : 'Folder',
        headClassName: 'pl-3 compact:pl-2',
        cellClassName: 'p-0!',
        cell: (d) =>
          archiveView ? (
            <ArchiveStatusCell label={archiveLabelOf(d)} />
          ) : (
            <FolderCell
              folders={folders}
              folderId={folderAssignments[toAscii(d.domainName)]}
              onAssign={(folderId) => applyFolders([d], folderId)}
            />
          ),
      });
    }
    if (col.key === 'expirationDate' && !archiveView) {
      dataColumns.push({
        key: RENEWAL,
        label: 'Renewal',
        align: 'right',
        headClassName: 'w-0',
        cellClassName: 'w-0 pr-3',
        cell: (d) => (
          <RenewalCell info={pricing[domainKey(d)]} loading={pricingLoading} />
        ),
      });
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col">
      {/* Title and filters scroll away on a short screen so the column names
          and the row-count bar keep a slice of the page. */}
      <div className="flex min-h-0 flex-col gap-[13px] overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-2xl font-bold leading-none sm:text-[32px]">
              Domains
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {archiveView
                ? `${archiveCount} domain${archiveCount === 1 ? '' : 's'} you no longer own`
                : `${portfolio.length} domain${portfolio.length === 1 ? '' : 's'} across ${portfolioRegistrars.length} registrar${
                    portfolioRegistrars.length === 1 ? '' : 's'
                  }`}
            </p>
          </div>
          <OwnershipSwitch
            archive={archiveView}
            ownedCount={ownedCount}
            archiveCount={archiveCount}
            onOwned={() => setListView('owned')}
            onArchive={() => setListView('archive')}
          />
        </div>

        {portfolioError && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Couldn’t load your portfolio</AlertTitle>
            <AlertDescription>{portfolioError}</AlertDescription>
          </Alert>
        )}

        {/* Which accounts failed; the errors themselves are on their cards
            in Settings → Registrars. */}
        {portfolioErrors.length > 0 && (
          <SyncErrorsAlert
            label={`${multipleAccounts.size > 0 ? 'Account' : 'Registrar'}${portfolioErrors.length === 1 ? '' : 's'} failed to sync`}
            names={portfolioErrors.map((e) =>
              accountTitle(
                registrarLabel(e.registrar, portfolioRegistrarLabels),
                e.accountLabel,
                multipleAccounts.has(e.registrar),
              ),
            )}
            action={
              <Link
                to="/settings?tab=registrars"
                className="font-medium whitespace-nowrap underline underline-offset-4"
              >
                Open registrar settings
              </Link>
            }
          />
        )}

        {/* The table always renders — even before a load or with no registrars
          configured — so its toolbar and structure stay put; the empty body row
          carries the contextual prompt (configure a registrar / refresh / no
          matches). */}
        {/* Toolbar: search and filters flow inline and wrap together as equal
              items. Extra top margin separates it from the title/refresh row
              above. */}
        <div className="mt-1 flex flex-wrap items-center gap-3 sm:mt-3">
          <div className="relative min-w-[140px] flex-1 max-sm:basis-full">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search domains…"
              // Room on the right for the clear button below.
              className="pr-8 pl-8"
            />
            {/* Custom clear control in place of the native search-cancel
                button (a blue ⓧ on macOS): a muted solid disc with the ✕ cut
                out in the field's background, the same on every platform. */}
            {search !== '' && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setSearch('');
                  setPage(0);
                }}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full text-muted-foreground opacity-70 hover:opacity-100"
              >
                <CircleX
                  className="size-4 [&>path]:stroke-background"
                  fill="currentColor"
                  strokeWidth={2.5}
                />
              </button>
            )}
          </div>

          {/* Phones only: a toggle that collapses the filter chips (below) so the
              toolbar doesn't wrap onto several lines. At sm+ the chips are always
              shown and this is hidden. */}
          <Button
            variant="outline"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className="gap-2 sm:hidden"
          >
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            Filters
            {activeFilterGroups > 0 && (
              <Badge className="bg-primary px-1.5 py-0 text-xs tabular-nums text-primary-foreground">
                {activeFilterGroups}
              </Badge>
            )}
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                filtersOpen && 'rotate-180',
              )}
            />
          </Button>

          {/* The filter chips. On phones this is a collapsible full-width row
              (shown only when filtersOpen); at sm+ `sm:contents` dissolves the
              wrapper so the chips flow inline in the toolbar exactly as before. */}
          <div
            className={cn(
              'flex-wrap items-center gap-3 max-sm:basis-full sm:contents',
              filtersOpen ? 'flex' : 'hidden',
            )}
          >
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
              label="DNS"
              icon={Server}
              options={nsGroups}
              selected={ns}
              onChange={(next) => {
                setNs(next);
                setPage(0);
              }}
            />
            <MultiSelectFilter
              label="Expires"
              icon={CalendarClock}
              options={expiryOptions}
              selected={expiry}
              onChange={(next) => {
                setExpiry(next);
                setPage(0);
              }}
            />
            {/* Owned: folders and Hidden. Archive: status. */}
            {(!archiveView || archiveCount > 0) && (
              <MultiSelectFilter
                label={archiveView ? 'Status' : 'Folder'}
                icon={FolderIcon}
                options={
                  archiveView ? archiveStatusOptions : ownedFolderOptions
                }
                selected={folder}
                onChange={(next) => {
                  setFolder(next);
                  setPage(0);
                }}
              />
            )}
          </div>

          {/* Reset button styled like the filters (no chevron); faded/
                  disabled when nothing is active. On phones it stays beside the
                  Filters toggle (sm:order-last pins it after the chips on
                  desktop, its original spot). */}
          <Button
            variant="outline"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className={cn(
              'gap-2 pr-[14px]! pl-[8px]! sm:order-last',
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

          {exportNote && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm sm:order-last',
                exportNote.error ? 'text-destructive' : 'text-brand',
              )}
              role="status"
            >
              {!exportNote.error && <CircleCheck className="size-4" />}
              {exportNote.text}
            </span>
          )}
        </div>

        {/* Bulk action bar — contextual: appears once any row is selected, or
            while a bulk job is running (as a progress pill). */}
        <BulkBar
          domains={selectedDomains}
          folders={folders}
          onClear={clearSelection}
          onRefresh={bulkRefresh}
          onExport={() => void exportCsv(selectedDomains)}
          onAssignFolder={(folderId) => applyFolders(selectedDomains, folderId)}
          onKind={(kind) =>
            setBulkDialog({ op: defaultBulkOp(kind, selectedDomains) })
          }
          onViewJob={() => {
            if (bulk) setBulkDialog({ op: bulk.op, jobId: bulk.id });
          }}
          archiveView={archiveView}
          onOwnership={(action) => openOwnership(action, selectedDomains)}
        />
      </div>

      <DataTable
        className="mt-[13px]"
        rows={filtered}
        columns={dataColumns}
        rowKey={domainKey}
        sort={{ key: sortKey, dir: sortDir }}
        onSort={toggleSort}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        selection={{
          selected,
          toggle: toggleSelected,
          setMany: setSelectedMany,
          allLabel: 'Select all domains',
          rowLabel: (d) => `Select ${d.domainName}`,
        }}
        empty={
          noneConfigured ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div>
                <p className="font-medium text-foreground">
                  No registrars configured
                </p>
                <p className="mt-0.5">
                  Add API credentials for a registrar to load your domains into
                  this table.
                </p>
              </div>
              <Button onClick={() => navigate('/settings?tab=registrars')}>
                <Plug />
                Configure registrars
              </Button>
            </div>
          ) : archiveView && archiveCount === 0 ? (
            'Names you mark Sold, Dropped, or Archived, and names that leave your accounts, show up here.'
          ) : portfolio.length === 0 ? (
            hasLoaded ? (
              'No domains found in any configured registrar.'
            ) : (
              'Click “Sync domains” to load your portfolio.'
            )
          ) : (
            'No domains match the current filters.'
          )
        }
      />

      {authCodeFor && (
        <AuthCodeDialog
          domain={authCodeFor}
          onClose={() => setAuthCodeFor(null)}
        />
      )}
      {urlForwardingFor && (
        <UrlForwardingDialog
          domain={urlForwardingFor}
          onClose={() => setUrlForwardingFor(null)}
        />
      )}
      {emailForwardingFor && (
        <EmailForwardingDialog
          domain={emailForwardingFor}
          onClose={() => setEmailForwardingFor(null)}
        />
      )}
      {bulkDialog && (
        <BulkActionDialog
          initialOp={bulkDialog.op}
          domains={selectedDomains}
          jobId={bulkDialog.jobId}
          onClose={() => setBulkDialog(null)}
        />
      )}
      {purchaseFor && (
        <PurchaseDialog
          domain={purchaseFor}
          onClose={() => setPurchaseFor(null)}
        />
      )}
      {saleFor && (
        <SaleDialog domain={saleFor} onClose={() => setSaleFor(null)} />
      )}
      {markSoldFor && (
        <SaleDialog
          domain={markSoldFor}
          mode="mark"
          resolves={openRemoval.get(toAscii(markSoldFor.domainName))}
          onSaved={() => clearDone([markSoldFor])}
          onClose={() => setMarkSoldFor(null)}
        />
      )}
      {ownershipDialog &&
        (() => {
          const { action, domains: ds } = ownershipDialog;
          const close = () => setOwnershipDialog(null);
          const done = () => clearDone(ds);
          if (action === 'dropped' || action === 'archived')
            return (
              <DispositionDialog
                type={action}
                items={ownershipItems(ds)}
                onDone={done}
                onClose={close}
              />
            );
          if (action === 'sold')
            return (
              <MarkSoldDialog
                items={ownershipItems(ds)}
                onDone={done}
                onClose={close}
              />
            );
          if (action === 'restore')
            return (
              <RestoreOwnedDialog
                names={ds.map((d) => d.domainName)}
                restorable={
                  ds.filter((d) => {
                    const o = ownership.get(toAscii(d.domainName));
                    return o?.event && o.event.source !== 'sync';
                  }).length
                }
                onDone={done}
                onClose={close}
              />
            );
          return (
            <DeleteDomainsDialog domains={ds} onDone={done} onClose={close} />
          );
        })()}
      {renewFor && (
        <RenewDialog
          domain={renewFor}
          pricing={pricing[domainKey(renewFor)]}
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
  options: {
    value: string;
    label: string;
    count?: number;
    /** Optional leading icon shown before this option's label. */
    icon?: React.ReactNode;
  }[];
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
            {o.icon && (
              <span className="ml-0.5 mr-0.5 flex shrink-0">{o.icon}</span>
            )}
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
