import { accountNumber, accountTitle } from '../../shared/account-label';
import { syncProblems } from '../lib/activity';
import { multiAccountRegistrars } from '../lib/registrar-accounts';
import { parseDomainsLink } from '../lib/domains-link';
import {
  importedRegistrarName,
  registrarFilterOptions,
  registrarFilterValue,
} from '../lib/registrar-filter';
import { domainKey } from '../../shared/account-key';
import { toAscii } from '../../shared/domain-name';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Archive,
  Building2,
  Calendar1,
  CalendarCheck,
  CalendarClock,
  CalendarPlus2,
  CircleCheck,
  CircleHelp,
  Globe,
  RotateCw,
  Server,
  ShieldBan,
  ShieldCheck,
} from 'lucide-react';
import type {
  Domain,
  DomainOp,
  Folder,
  RegistrarName,
  RegistrationLookup,
  RenewalPricing,
} from '../../shared/ipc';
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/20/solid';
import { toast } from 'sonner';
import { DomainEventType } from '../../shared/domain-events';
import {
  ARCHIVE_LABELS,
  archiveRows,
  ownershipByDomain,
  standingOf,
  type ArchiveLabel,
  type Standing,
} from '../../shared/ownership';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { ARCHIVE_LABEL, accountName } from '../lib/domain-history';
import {
  ImportedRegistrarIcon,
  RegistrarLogo,
} from '../components/RegistrarLogo';
import { DomainLink } from '../components/domains/DomainLink';
import { NotesButton } from '../components/domains/NotesButton';
import { BulkNotesDialog } from '../components/domains/BulkNotesDialog';
import {
  DeleteDomainsDialog,
  MarkSoldDialog,
} from '../components/actions/OwnershipDialogs';
import { useAppStore } from '../store/app';
import { domainsCsvFilename, domainsToCsv } from '../../shared/domain-csv';
import { importedRows } from '../../shared/imported-domains';
import { priceMoney } from '../lib/renewals';
import { SALE_STEP_LABEL, saleSourceLabel } from '../lib/sales';
import { nameserverGroup } from '../lib/nameservers';
import {
  countFolders,
  folderBucket,
  folderColorStyle,
  NO_FOLDER,
} from '../lib/folders';
import {
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../lib/domain-ops';
import { FolderIcon } from '../components/icons/FolderIcon';
import { FolderOffIcon } from '../components/icons/FolderOffIcon';
import { autoRenewChoice, type AutoRenewChoice } from '../lib/auto-renew';
import { FolderMenuItems } from '../components/domains/FolderMenuItems';
import { OwnershipSwitch } from '../components/domains/OwnershipSwitch';
import {
  DomainsCards,
  type DomainsView,
} from '../components/domains/DomainsCards';
import { SyncSplitButton } from '../components/domains/SyncSplitButton';
import {
  EventTypeBadge,
  EventTypeDot,
} from '../components/activity/EventTypeBadge';
import { FlagToggle } from '../components/domains/FlagToggle';
import { RowActionsMenu } from '../components/domains/RowActionsMenu';
import { purchaseColumns } from '../components/domains/purchase-columns';
import {
  MarketActionDialog,
  type MarketAction,
} from '../components/domains/MarketActionDialog';
import {
  isMarketColumnKey,
  listingColumnKey,
  marketColumns,
} from '../components/domains/market-columns';
import {
  NO_MARKETS_FILTER,
  marketsField,
  toMarketFilter,
  type MarketsFilterValue,
} from '../components/domains/MarketsFilter';
import {
  isMarketFilterSet,
  marketState,
  matchesMarketFilter,
} from '../../shared/market-filter';
import { ImportDomainsDialog } from '../components/domains/ImportDomainsDialog';
import { PurchaseDialog } from '../components/domains/PurchaseDialog';
import { ListPriceDialog } from '../components/domains/ListPriceDialog';
import { MarketListingDialog } from '../components/domains/MarketListingDialog';
import { ImportedDomainDialog } from '../components/domains/ImportedDomainDialog';
import { SaleDialog } from '../components/domains/SaleDialog';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatMoney,
} from '../../shared/money';
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
import {
  EXPIRATION_PRESETS,
  isDateRangeSet,
  presetRange,
  matchesDateRange,
  NO_DATE_RANGE,
  PAST_DATE_PRESETS,
  utcDay,
  type DatePresetId,
  type DateRange,
} from '../lib/date-range';
import { usePreferences } from '../lib/preferences';
import { useColumnLayout } from '../components/data-table/ColumnPicker';
import {
  applyColumnLayout,
  type ColumnLayout,
  type LayoutColumn,
} from '../components/data-table/column-layout';
import { DataTable, type DataColumn } from '../components/data-table/DataTable';
import { EmptyState } from '../components/EmptyState';
import { paginate, sortRows } from '../components/data-table/table-state';
import { dateRangeField } from '../components/data-table/DateRangeFilter';
import { type FilterField } from '../components/data-table/FilterBar';
import {
  NO_PRICING_FILTER,
  isPricingFilterSet,
  pricingField,
  toAskingFilter,
  type PricingFilterValue,
} from '../components/domains/PricingFilter';
import { matchesAsking } from '../../shared/list-prices';
import {
  FilterToolbar,
  listField,
} from '../components/data-table/FilterToolbar';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  /** A hover note on the header, marked with a small help icon. */
  tooltip?: string;
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
/** Distinct names among rows (a name two accounts hold is one row in a CSV). */
function nameCount(rows: Domain[]): number {
  return new Set(rows.map((d) => toAscii(d.domainName))).size;
}

function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

/** A registrar's display name, falling back to its raw id. */
function registrarLabel(id: string, labels: RegistrarLabels): string {
  return labels[id] ?? id;
}

/** RDAP's own registrar name, IANA ID and reseller, for the cell's tooltip. */
function registrarDetail(lookup: RegistrationLookup): string | undefined {
  const parts = [
    lookup.registrar,
    lookup.registrarIanaId != null ? `IANA ${lookup.registrarIanaId}` : null,
    lookup.reseller ? `reseller ${lookup.reseller}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function toTime(date: Date | null): number | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function fmtDate(date: Date | null): string {
  return utcDay(date) ?? '—';
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

const RENEWAL = 'renewal';

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
      {priceMoney(info.renewal, info.currency)}
    </span>
  );
}

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
  const current = folderId ? folders.find((f) => f.id === folderId) : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Assign folder"
          data-cell-action
          // Vertical padding matches the table cells' so this full-cell button
          // never sets the row height.
          className="group flex w-full cursor-pointer items-center gap-1.5 px-3 py-3 text-left text-sm text-muted-foreground/40 transition-colors hover:text-foreground compact:px-2 compact:py-[9px] compact:text-xs"
        >
          {current ? (
            <span className="inline-flex h-4 max-w-full items-center gap-2 leading-none text-foreground">
              <FolderIcon
                className={cn(
                  'size-4 shrink-0',
                  folderColorStyle(current.color).text,
                )}
              />
              <span className="truncate">{current.name}</span>
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
 * In Archive the Folder column shows why the name is there instead, as the
 * badges Activity shows (docs/owned-and-archive.md): Sold, Deleted (the
 * lookup says nobody holds it), Expired (it left after expiry), or Removed
 * (it left early with no sale recorded; review it on Activity).
 */
function ArchiveStatusCell({ label }: { label: ArchiveLabel | null }) {
  if (!label) return null;
  return (
    // No vertical padding (the cell has none either): the badge is taller
    // than a line of text, and centered it doesn't make the row taller.
    <span className="flex items-center px-3 compact:px-2">
      <EventTypeBadge type={label} title={ARCHIVE_TITLE[label]} />
    </span>
  );
}

const ARCHIVE_TITLE: Record<ArchiveLabel, string> = {
  sold: 'You recorded a sale',
  deleted: 'Not registered: the registration lookup found no holder',
  expired: 'Left your accounts after its expiry date',
  dropped: 'Left your accounts before expiry, and you marked it dropped',
  removed: 'Left your accounts before expiry, with no sale recorded',
};

/**
 * The folder-assignment menu, opened directly from the Folder cell. A flat list
 * of the user's folders followed by "None" (clear).
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

/** Expired by the date alone, when the registrar's status doesn't say. */
const EXPIRED = { label: 'Expired', tone: 'expired' as LifecycleTone };

/**
 * A solid pill per lifecycle state. Expired is red, the past-expiry date's
 * colour (see expiryColor), whether the registrar says so or only the date
 * has passed. Grace (still renewable at the normal price) is fuchsia and
 * redemption (renewable at a fee) purple, so the two read apart from it.
 * Hold (DNS switched off by a registrar/registry lock) is a different,
 * site-down problem and takes a deep red.
 */
const LIFECYCLE_TONE: Record<LifecycleTone, string> = {
  redemption: 'bg-purple-950 text-purple-100',
  expired: 'bg-red-600 text-white dark:bg-red-700',
  grace: 'bg-fuchsia-600 text-white dark:bg-fuchsia-500',
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

/** A distinctly-colored pill per lifecycle state; nothing when healthy. No
 *  tooltip: a click on it, like anywhere in the Domain cell, opens the row
 *  menu. `hold` picks the states it shows: Hold beside the name (DNS is off,
 *  not an expiry matter), or the expiry ones in the Expires column. */
function LifecycleBadge({
  status,
  hold,
  flag: given,
}: {
  status: string;
  hold: boolean;
  /** A state worked out elsewhere (Expired by the date), in place of the status's. */
  flag?: { label: string; tone: LifecycleTone };
}) {
  const flag = given ?? domainLifecycle(status);
  if (!flag || (flag.tone === 'hold') !== hold) return null;
  return (
    <Badge
      className={cn(
        // font-sans: the Expires cell around it is monospace.
        'border-transparent px-1.5 py-0 font-sans text-[11px] compact:px-1 compact:text-[10px]',
        LIFECYCLE_TONE[flag.tone],
      )}
    >
      {flag.label}
    </Badge>
  );
}

/**
 * Sold, beside the lifecycle pills: a sale is recorded, or under way at a
 * market, and the buyer hasn't taken the name yet, so it doubles as a
 * reminder to finish the transfer; a market's sale says where it's at on
 * hover. (Expiring is worked out too, docs/owned-and-archive.md, but isn't
 * shown on the row: the Expires column's colour and the Auto-renew filter
 * cover it.)
 */
function SoldBadge({
  standing,
  underWay,
}: {
  standing: Standing;
  /** "Afternic: Waiting on the transfer", for a sale under way. */
  underWay?: string;
}) {
  if (standing.archived) return null;
  const pill =
    'border-transparent px-1.5 py-0 text-[11px] compact:px-1 compact:text-[10px]';
  return (
    <>
      {standing.salePending && (
        <Badge
          className={cn(pill, 'bg-emerald-600 text-white dark:bg-emerald-700')}
          title={underWay}
        >
          Sold
        </Badge>
      )}
    </>
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
      data-cell-action
      title={
        reason ??
        `Auto-renew ${domain.autoRenew ? 'on' : 'off'} — click to toggle`
      }
      // Unsupported ones look the same as the rest (no fade) — the not-allowed
      // cursor and tooltip carry that. The top margin centers it in a normal
      // row (a transform would keep its click overlay to the switch).
      className="mt-0.5 data-[state=unchecked]:bg-flag-off disabled:opacity-100 compact:mt-0 dark:data-[state=unchecked]:bg-flag-off"
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

/**
 * Each view's columns in their default order, and which start off until the
 * Columns picker turns them on. Domain is locked first. Owned has one Listed
 * column for the markets; Listings has a column per market and the interest
 * counts, and leaves the registration settings out. Archive can show the
 * registration columns too: names still in an account stay editable, and
 * departed names show a dash.
 */
const VIEW_COLUMNS: Record<DomainsView, ColumnLayout> = {
  owned: {
    order: [
      'domainName',
      FOLDER,
      'binPrice',
      'minOffer',
      'listed',
      'registrar',
      'createdDate',
      'purchaseDate',
      'purchaseAmount',
      'expirationDate',
      RENEWAL,
      'autoRenew',
      'privacy',
      'locked',
      'nameservers',
    ],
    hidden: ['purchaseDate', 'purchaseAmount'],
  },
  listings: {
    order: [
      'domainName',
      FOLDER,
      'binPrice',
      'minOffer',
      'listing',
      'views',
      'leads',
      'searches',
      'fastTransfer',
      'registrar',
      'expirationDate',
      'purchaseDate',
      'purchaseAmount',
    ],
    hidden: [
      'fastTransfer',
      'registrar',
      'expirationDate',
      'purchaseDate',
      'purchaseAmount',
    ],
  },
  archive: {
    order: [
      'domainName',
      FOLDER,
      'registrar',
      'purchaseDate',
      'purchaseAmount',
      'saleDate',
      'saleAmount',
      'createdDate',
      'expirationDate',
      'binPrice',
      'minOffer',
      'listing',
      RENEWAL,
      'autoRenew',
      'privacy',
      'locked',
      'nameservers',
    ],
    hidden: [
      'createdDate',
      'binPrice',
      'minOffer',
      'listing',
      RENEWAL,
      'autoRenew',
      'privacy',
      'locked',
      'nameservers',
    ],
  },
};

/**
 * Each view's default filter chips, in order, and which of them show only
 * while there's room (toolbarLayout): those go, the last first, before the
 * view switch takes a line of its own. TLD is in the Filters menu only.
 */
const VIEW_FILTERS: Record<
  DomainsView,
  { presets: string[]; ifRoom: string[] }
> = {
  owned: {
    presets: ['registrar', 'folder', 'price', 'expirationDate'],
    ifRoom: ['price', 'expirationDate'],
  },
  listings: {
    presets: ['folder', 'price', 'markets'],
    ifRoom: ['folder'],
  },
  archive: {
    presets: ['registrar', 'status', 'expirationDate'],
    ifRoom: ['expirationDate'],
  },
};

const VIEW_TITLE: Record<DomainsView, string> = {
  owned: 'Owned',
  listings: 'Listings',
  archive: 'Archive',
};

const LAYOUT_COLUMNS: Record<DomainsView, LayoutColumn[]> = {
  owned: layoutColumns(VIEW_COLUMNS.owned),
  listings: layoutColumns(VIEW_COLUMNS.listings),
  archive: layoutColumns(VIEW_COLUMNS.archive),
};

function layoutColumns({ order, hidden }: ColumnLayout): LayoutColumn[] {
  return order.map((key) => ({
    key,
    locked: key === 'domainName',
    defaultHidden: hidden.includes(key),
  }));
}

const COLUMNS: Column[] = [
  {
    key: 'domainName',
    label: 'Domain',
    render: (d) => (
      <span className="inline-flex items-center gap-2">
        <DomainLink name={d.domainName} />
        <LifecycleBadge status={d.status} hold />
        {d.source === 'imported' && (
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
          >
            Imported
          </Badge>
        )}
      </span>
    ),
    sortValue: (d) => d.domainName.toLowerCase(),
  },
  {
    key: 'registrar',
    label: 'Registrar',
    render: (d, labels) => registrarLabel(d.registrar, labels),
    // An Archive name sorts by the registrar it shows now, not its old account.
    sortValue: (d, labels) =>
      (
        d.registrationRegistrar ?? registrarLabel(d.registrar, labels)
      ).toLowerCase(),
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
    label: 'Expiration',
    render: (d) => {
      const days = daysUntil(d.expirationDate);
      const color = expiryColor(days);
      // Past expiry, the registrar's Expired / Grace / Redemption takes the
      // countdown's place: the colour already says how long ago.
      // Past the date with no registrar state, it's Expired too.
      const lifecycle = domainLifecycle(d.status);
      const state =
        lifecycle && lifecycle.tone !== 'hold'
          ? lifecycle
          : days !== null && days < 0
            ? EXPIRED
            : null;
      return (
        <span
          className={cn(
            'inline-flex items-center gap-2.5 font-mono tabular-nums',
            color,
          )}
          title={
            state && state !== EXPIRED
              ? `${dueLabel(days)} · ${state.label}`
              : dueLabel(days)
          }
        >
          <span>{fmtDate(d.expirationDate)}</span>
          {state ? (
            <LifecycleBadge status={d.status} hold={false} flag={state} />
          ) : (
            // A countdown ahead of expiry; past it the colour says enough.
            days !== null &&
            days >= 0 && (
              <span className="text-xs opacity-60 compact:text-[11px]">
                {relativeDays(days)}
              </span>
            )
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

/** Compact countdown shown next to an upcoming date, e.g. "30d", "today". */
function relativeDays(days: number): string {
  return days === 0 ? 'today' : `${days}d`;
}

/**
 * Expiry text color: yellow (≤60 days, a heads-up), orange (0–30, today
 * included), then red once it's past; the Expired, Grace and Redemption
 * pills say what's left. Muted when there's no date.
 */
function expiryColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days < 0) return 'text-red-700 dark:text-red-500';
  if (days <= 30) return 'text-orange-500 dark:text-orange-375';
  if (days <= 60) return 'text-flag-off dark:text-yellow-400';
  return 'text-foreground';
}

/** A colour dot, the size of the Status filter's. */
function Dot({ className }: { className: string }) {
  return (
    <span
      className={cn('m-1 size-2 shrink-0 rounded-full', className)}
      aria-hidden
    />
  );
}

/**
 * The Expiration filter's shortcuts in the column's colours: the pills' for
 * Expired, Grace and Redemption, the dates' for the windows ahead (Next 60
 * reaches into yellow; Next 90 past it, so it has none).
 */
const EXPIRATION_DOTS: Partial<Record<DatePresetId, React.ReactNode>> = {
  expired: <Dot className="bg-red-600 dark:bg-red-700" />,
  grace: <Dot className="bg-fuchsia-600 dark:bg-fuchsia-500" />,
  redemption: <Dot className="bg-purple-800 dark:bg-purple-700" />,
  next30: <Dot className="bg-orange-500" />,
  next60: <Dot className="bg-yellow-500" />,
  next90: <Dot className="bg-muted-foreground/40" />,
};

/**
 * The Expiration filter: the date range, or for the Grace and Redemption
 * shortcuts the registrar's status (date-range.ts, EXPIRATION_PRESETS).
 */
function matchesExpiration(d: Domain, range: DateRange): boolean {
  if (range.preset === 'grace' || range.preset === 'redemption')
    return domainLifecycle(d.status)?.tone === range.preset;
  return matchesDateRange(utcDay(d.expirationDate), range);
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Domains() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Owned and Listings are what you hold, Listings with its market columns;
  // Archive is what you no longer have (Sold, Deleted, Expired, or Removed),
  // worked out in shared/ownership.ts.
  const archiveView = params.get('view') === 'archive';
  const {
    portfolio,
    portfolioErrors,
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
    exchangeRates,
    folders,
    folderAssignments,
    assignFolder,
    selected,
    toggleSelected,
    setSelectedMany,
    clearSelection,
    bulk,
    purchases,
    listPrices,
    marketAccounts,
    marketListings,
    marketCatalog,
    marketTraffic,
    marketSales,
    importedDomains,
    settings,
    domainEvents,
    registrationLookups,
    loadRegistrationLookups,
  } = useAppStore();

  // Market columns, the Listings view and the Markets filter only appear once
  // a market account is connected.
  const marketsOn = (marketAccounts?.length ?? 0) > 0;
  const listingsView = marketsOn && params.get('view') === 'listings';
  const view: DomainsView = archiveView
    ? 'archive'
    : listingsView
      ? 'listings'
      : 'owned';
  const ownedView = view === 'owned';
  // The row and bulk menus name the market when there's only one kind.
  const marketIds = [...new Set((marketAccounts ?? []).map((a) => a.market))];
  // A listing column per connected market, in the catalog's order.
  const listingMarkets = useMemo(() => {
    const connected = new Set((marketAccounts ?? []).map((a) => a.market));
    return marketCatalog.map((m) => m.id).filter((id) => connected.has(id));
  }, [marketCatalog, marketAccounts]);
  const marketId = marketIds.length === 1 ? marketIds[0] : null;
  // Market accounts whose last sync failed, for the line under Sync.
  const marketSyncProblems = useMemo(
    () => syncProblems(null, marketAccounts, marketCatalog),
    [marketAccounts, marketCatalog],
  );
  const marketLabel =
    (marketId && marketCatalog.find((m) => m.id === marketId)?.name) ||
    'Markets';
  // Why a market action can't apply to these names; null when it can (for
  // a selection: when it applies to at least one of them).
  const marketReasonsFor = (domains: Domain[]) => {
    const keys = domains.map((d) => toAscii(d.domainName));
    const priced = keys.some(
      (k) => listPrices[k]?.amount || listPrices[k]?.minOffer,
    );
    const listed = keys.some((k) => (marketListings[k]?.length ?? 0) > 0);
    const one = keys.length === 1;
    const where = marketId ? marketLabel : 'any market';
    const notListed = one
      ? `Not listed on ${where}`
      : `None of these are listed on ${where}`;
    return {
      list: priced
        ? null
        : one
          ? 'Set an asking price with Pricing first'
          : 'None of these have an asking price; set one with Pricing first',
      delist: listed ? null : notListed,
    };
  };
  const [marketAction, setMarketAction] = useState<{
    action: MarketAction;
    domains: Domain[];
  } | null>(null);

  // Ownership per name, and each name's open "removed from registrar" alert (a
  // label chosen from the row closes it).
  const ownership = useMemo(
    () => ownershipByDomain(domainEvents, marketSales),
    [domainEvents, marketSales],
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

  const multipleAccounts = useMemo(
    () => multiAccountRegistrars(registrars, portfolio),
    [registrars, portfolio],
  );
  const [purchaseFor, setPurchaseFor] = useState<Domain | null>(null);
  const [importing, setImporting] = useState(false);
  // Asking price for one name (its cell or row menu) or the selection.
  const [listPriceFor, setListPriceFor] = useState<Domain[] | null>(null);
  // One name's listing on one market (its cell in that market's column).
  const [listingFor, setListingFor] = useState<{
    domain: Domain;
    market: string;
  } | null>(null);
  // Edit details for an imported name.
  const [detailsFor, setDetailsFor] = useState<Domain | null>(null);
  const [saleFor, setSaleFor] = useState<Domain | null>(null);
  // Record sale for one name: the sale dialog, which takes the price.
  const [markSoldFor, setMarkSoldFor] = useState<Domain | null>(null);
  // The ownership dialogs, for one name (row menu) or the selection.
  const [ownershipDialog, setOwnershipDialog] = useState<{
    action: OwnershipAction;
    domains: Domain[];
  } | null>(null);
  // The Registrar column carries the account too: a nickname always shows in
  // parens; an unnamed account shows its number only when the registrar has
  // siblings to tell apart. `null` from accountNumber() means a real nickname.
  // Every column the picker can show is in this map. Order and visibility
  // come from the saved layout, not from where each column is built.
  const columnByKey = useMemo(() => {
    const paren = (label: string | undefined, registrar: string) => {
      const n = accountNumber(label);
      if (n === null) return label ?? '';
      return multipleAccounts.has(registrar) ? `#${n}` : '';
    };
    const byKey = new Map<string, Column>();
    for (const c of COLUMNS) {
      if (c.key !== 'registrar') {
        byKey.set(c.key, c);
        continue;
      }
      byKey.set(c.key, {
        ...c,
        render: (d: Domain, labels: RegistrarLabels) => {
          // Names you added: a faint building rather than the logo, so
          // they read apart from a connected account's names.
          if (d.source === 'imported') {
            const name = importedRegistrarName(d, labels);
            return (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <ImportedRegistrarIcon />
                {name || <span className="text-muted-foreground">Unknown</span>}
              </span>
            );
          }
          const suffix = paren(d.accountLabel, d.registrar);
          const label = registrarLabel(d.registrar, labels);
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <RegistrarLogo
                name={d.registrar as RegistrarName}
                label={label}
                className="size-4"
              />
              {label}
              {suffix && (
                <span className="ml-1 text-xs text-muted-foreground/70">
                  ({suffix})
                </span>
              )}
            </span>
          );
        },
        sortValue: (d: Domain, labels: RegistrarLabels) => {
          if (d.source === 'imported')
            return (
              d.importedRegistrarLabel ?? registrarLabel(d.registrar, labels)
            ).toLowerCase();
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
      });
    }
    for (const extra of purchaseColumns({
      purchases,
      preferredCurrency: settings?.preferredCurrency ?? DEFAULT_CURRENCY,
      numberFormat: settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
      onEditPurchase: setPurchaseFor,
      onEditSale: setSaleFor,
      isSold: (d) => !!ownership.get(toAscii(d.domainName))?.sale,
      listPrices,
      onEditListPrice: (d) => setListPriceFor([d]),
    })) {
      byKey.set(extra.key, extra);
    }
    for (const extra of marketColumns({
      listings: marketListings,
      markets: marketCatalog,
      listPrices,
      traffic: marketTraffic.domains,
      listingMarkets,
      onEditListing: (domain, market) => setListingFor({ domain, market }),
      preferredCurrency: settings?.preferredCurrency ?? DEFAULT_CURRENCY,
      numberFormat: settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
    })) {
      byKey.set(extra.key, extra);
    }
    return byKey;
  }, [
    multipleAccounts,
    purchases,
    listPrices,
    settings,
    ownership,
    marketListings,
    marketCatalog,
    marketTraffic,
    listingMarkets,
  ]);

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
  // Names you added that no account reports join the registrar rows.
  const importedList = useMemo(
    () => importedRows(importedDomains, portfolio),
    [importedDomains, portfolio],
  );
  const merged = useMemo(
    () => [
      ...portfolio.map((d) =>
        enriched[domainKey(d)]
          ? {
              ...enriched[domainKey(d)],
              accountId: d.accountId,
              accountLabel: d.accountLabel,
            }
          : d,
      ),
      ...importedList,
    ],
    [portfolio, enriched, importedList],
  );

  // Names in Archive that no registrar reports any more. They're not in
  // `merged`; the Archive view is what shows them.
  const listed = useMemo(
    () => [
      ...merged,
      ...archiveRows(ownership, [...portfolio, ...importedList], registrars),
    ],
    [merged, ownership, portfolio, importedList, registrars],
  );

  // Archive asks RDAP for names that have left, so created and expires stay
  // current and a free name can be shown as unregistered. Imported names past
  // expiry are asked about in either view: a definite "not registered" moves
  // one to Archive as Deleted before its 90 days are up.
  // "Now" for the derived states: when the page opened.
  const [now] = useState(() => Date.now());
  const departedKey = listed
    .filter((d) =>
      d.departed
        ? archiveView
        : d.source === 'imported' &&
          !!d.expirationDate &&
          d.expirationDate.getTime() < now,
    )
    .map((d) => d.domainName.toLowerCase())
    .sort()
    .join('\n');
  useEffect(() => {
    if (!departedKey) return;
    void loadRegistrationLookups(departedKey.split('\n'));
  }, [departedKey, loadRegistrationLookups]);

  const shown = useMemo(() => {
    if (!archiveView) return listed;
    return listed.map((d) => {
      if (!d.departed) return d;
      const lookup = registrationLookups[toAscii(d.domainName)];
      if (lookup === undefined) return { ...d, registrationPending: true };
      if (lookup === null) return { ...d, registrationPending: false };
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
        registrationRegistrar:
          lookup.registrarLabel ?? lookup.registrar ?? undefined,
        registrationRegistrarDetail: registrarDetail(lookup),
        registrationRegistrarId: lookup.mappedRegistrar ?? undefined,
        createdDate: lookup.created ? new Date(lookup.created) : null,
        expirationDate: lookup.expires ? new Date(lookup.expires) : null,
      };
    });
  }, [listed, archiveView, registrationLookups]);

  // Each shown row's standing (shared/ownership.ts): Owned with its derived
  // states, or Archive and why.
  const standings = useMemo(() => {
    const out = new Map<Domain, Standing>();
    for (const d of shown) {
      const key = toAscii(d.domainName);
      out.set(
        d,
        standingOf(
          d,
          ownership.get(key),
          registrationLookups[key]?.registered,
          now,
        ),
      );
    }
    return out;
  }, [shown, ownership, registrationLookups, now]);
  const standingOfRow = useCallback(
    (d: Domain): Standing => {
      const known = standings.get(d);
      if (known) return known;
      const key = toAscii(d.domainName);
      return standingOf(
        d,
        ownership.get(key),
        registrationLookups[key]?.registered,
        now,
      );
    },
    [standings, ownership, registrationLookups, now],
  );
  const archiveLabelOf = useCallback(
    (d: Domain): ArchiveLabel | null => standingOfRow(d).label,
    [standingOfRow],
  );
  // Where a sale under way at a market is at, for the Sold badge's hover.
  const saleUnderWay = (d: Domain): string | undefined => {
    const sale = ownership.get(toAscii(d.domainName))?.marketSale;
    if (!sale) return undefined;
    const market = saleSourceLabel(sale.market, marketCatalog);
    return `${market}: ${sale.action ? SALE_STEP_LABEL[sale.action] : 'in progress'}`;
  };

  // Starts from ?q= so another page (Activity's Show in Domains) can open it
  // on one name, and follows it when a link changes it here (the bell).
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const qParam = params.get('q');
  useEffect(() => {
    if (qParam !== null) setSearch(qParam);
  }, [qParam]);
  // Multi-select filters; an empty array means "no filter" (show all).
  const [tld, setTld] = useState<string[]>([]);
  // One "Registrar" filter, but its options are individual accounts (keyed by
  // account id), so a registrar's accounts can be picked apart or selected
  // together. Old saved values were registrar names; those simply match nothing
  // now, which reads as "no filter".
  // Starts from ?account= so a registrar card's domain count opens on it.
  const [registrar, setRegistrar] = useState<string[]>(() => {
    const account = params.get('account');
    return account ? [account] : [];
  });
  const [ns, setNs] = useState<string[]>([]);
  // The Markets and Pricing filters start from a domainsLink (the summary
  // cards, the Sales overview).
  const linked = useMemo(() => parseDomainsLink(params), [params]);
  const [marketsFilter, setMarketsFilter] = useState<MarketsFilterValue>(
    () => ({
      ...NO_MARKETS_FILTER,
      markets: linked.markets ?? [],
      states: linked.states ?? [],
      comparisons: linked.comparisons ?? [],
    }),
  );
  // Starts from ?folder= so a folder's count in Settings opens on it.
  const [folder, setFolder] = useState<string[]>(() => {
    const id = params.get('folder');
    return id ? [id] : [];
  });
  // Archive only: Sold, Deleted, Expired, Removed.
  const [status, setStatus] = useState<string[]>([]);
  // Owned only: auto-renew on or off (how you see what you're letting go).
  const [autoRenewFilter, setAutoRenewFilter] = useState<string[]>([]);
  // Owned only: what each name's asking price holds, and BIN price and
  // minimum offer ranges.
  const [pricingFilter, setPricingFilter] = useState<PricingFilterValue>(
    () => ({ ...NO_PRICING_FILTER, kinds: linked.asking ?? [] }),
  );
  // Date filters (see lib/date-range). Expiration and Purchased apply on
  // both tabs, Created on Owned only, Sold on Archive only.
  const [created, setCreated] = useState<DateRange>(NO_DATE_RANGE);
  const [expires, setExpires] = useState<DateRange>(NO_DATE_RANGE);
  const [purchased, setPurchased] = useState<DateRange>(NO_DATE_RANGE);
  const [sold, setSold] = useState<DateRange>(NO_DATE_RANGE);
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
  // The row (by domain key) whose notes editor is open, from its sticky note
  // or its menu's Notes…; and the selection's bulk Notes dialog.
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [bulkNotesFor, setBulkNotesFor] = useState<Domain[] | null>(null);
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
  // Imported names count alongside the registrar rows, less those already in
  // Archive (sold, deleted, or long expired).
  const ownedImported = useMemo(
    () => importedList.filter((d) => !archiveLabelOf(d)),
    [importedList, archiveLabelOf],
  );
  const ownedRows = useMemo(
    () => [...portfolio, ...ownedImported],
    [portfolio, ownedImported],
  );
  const tldOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of ownedRows) {
      const t = tldOf(d.domainName);
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({
      value,
      label: `.${value}`,
      count,
    })).sort((a, b) => a.value.localeCompare(b.value));
  }, [ownedRows]);
  // One option per account, then the registrars of the names you added
  // (lib/registrar-filter.tsx, shared with Renewals).
  const registrarOptions = useMemo(
    () =>
      registrarFilterOptions(
        [...portfolio, ...ownedImported],
        portfolioRegistrarLabels,
        multipleAccounts,
      ),
    [portfolio, ownedImported, portfolioRegistrarLabels, multipleAccounts],
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
        const group = nameserverGroup(host, marketCatalog);
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
  }, [merged, marketCatalog]);

  // The Folder filter offers the user's folders and None, counted over this
  // tab's names (a name in Archive keeps its folder). Archive also filters by
  // status (Sold, Deleted, Expired, Removed); Owned by auto-renew (On, Off).
  const {
    folderOptions,
    archiveStatusOptions,
    autoRenewOptions,
    ownedCount,
    archiveCount,
  } = useMemo(() => {
    const counts = countFolders(
      shown,
      (d) => !!archiveLabelOf(d),
      folderAssignments,
      folders,
    );
    const inView = archiveView ? counts.archive : counts.owned;
    const status: Record<ArchiveLabel, number> = {
      sold: 0,
      deleted: 0,
      expired: 0,
      dropped: 0,
      removed: 0,
    };
    const renew: Record<AutoRenewChoice, number> = {
      on: 0,
      off: 0,
      unknown: 0,
    };
    for (const d of shown) {
      const label = archiveLabelOf(d);
      if (label) status[label] += 1;
      else renew[autoRenewChoice(d)] += 1;
    }
    const opts = folders.map((f) => ({
      value: f.id,
      label: f.name,
      count: inView[f.id] ?? 0,
      icon: (
        <FolderIcon
          className={cn('size-4 shrink-0', folderColorStyle(f.color).text)}
          aria-hidden
        />
      ),
    }));
    opts.push({
      value: NO_FOLDER,
      label: 'None',
      count: inView[NO_FOLDER] ?? 0,
      icon: (
        <FolderOffIcon
          className="size-4 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
      ),
    });
    const statusOptions = ARCHIVE_LABELS.map((label) => ({
      value: label,
      label: ARCHIVE_LABEL[label],
      count: status[label],
      icon: <EventTypeDot type={label} />,
    }));
    const sum = (c: Record<string, number>) =>
      Object.values(c).reduce((n, x) => n + x, 0);
    return {
      folderOptions: opts,
      archiveStatusOptions: statusOptions,
      autoRenewOptions: [
        { value: 'on', label: 'On', count: renew.on },
        { value: 'off', label: 'Off', count: renew.off },
        // A name you added, whose registrar DomBot can't ask.
        ...(renew.unknown
          ? [{ value: 'unknown', label: 'Unknown', count: renew.unknown }]
          : []),
      ],
      ownedCount: sum(counts.owned),
      archiveCount: sum(counts.archive),
    };
  }, [shown, folders, folderAssignments, archiveLabelOf, archiveView]);

  // The filter bar's fields, in the Filters menu's order (the order the
  // old filter buttons had). Each set field shows as a chip; clearing is per
  // chip.
  const currency = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  const listFilter = (
    field: Parameters<typeof listField>[0],
    set: (next: string[]) => void,
  ) =>
    listField(field, (next) => {
      set(next);
      setPage(0);
    });
  // Each shortcut's count is over this tab's names, before other filters,
  // like the list filters' counts.
  const dateFilter = (
    key: string,
    label: string,
    range: DateRange,
    set: (next: DateRange) => void,
    presets: DatePresetId[],
    dayOf: (d: Domain) => string | null | undefined,
    icon?: typeof CalendarClock,
    matches: (d: Domain, r: DateRange) => boolean = (d, r) =>
      matchesDateRange(dayOf(d), r),
    presetIcons?: Partial<Record<DatePresetId, React.ReactNode>>,
  ) =>
    dateRangeField({
      key,
      label,
      icon,
      range,
      presets,
      presetIcons,
      // Over this tab's names only (Archive rows carry their last expiry).
      count: (r) =>
        shown.filter(
          (d) => !archiveLabelOf(d) === !archiveView && matches(d, r),
        ).length,
      onChange: (next) => {
        set(next);
        setPage(0);
      },
    });
  const purchaseOf = (d: Domain) => purchases[toAscii(d.domainName)];
  /** What's recorded as paid for a name, for its menu's wording. */
  const paidKind = (d: Domain) => {
    const p = purchaseOf(d);
    return p?.purchaseDate || p?.amount
      ? (p.purchaseType ?? 'purchased')
      : null;
  };
  // TLD first in the Filters menu, though never a default chip.
  const filterFields: FilterField[] = [
    listFilter(
      {
        key: 'tld',
        label: 'TLD',
        icon: Globe,
        options: tldOptions,
        selected: tld,
        plural: 'TLDs',
      },
      setTld,
    ),
    listFilter(
      {
        key: 'registrar',
        label: 'Registrar',
        icon: Building2,
        options: registrarOptions,
        selected: registrar,
        plural: 'registrars',
      },
      setRegistrar,
    ),
    // TLD, Registrar and Folder first, as on every table; then, on
    // Archive, the status.
    ...(!archiveView || archiveCount > 0
      ? [
          listFilter(
            {
              key: 'folder',
              label: 'Folder',
              icon: FolderIcon,
              options: folderOptions,
              selected: folder,
              plural: 'folders',
            },
            setFolder,
          ),
        ]
      : []),
    ...(archiveView && archiveCount > 0
      ? [
          listFilter(
            {
              key: 'status',
              label: 'Status',
              icon: Archive,
              options: archiveStatusOptions,
              selected: status,
              plural: 'statuses',
            },
            setStatus,
          ),
        ]
      : []),
    ...(archiveView
      ? []
      : [
          pricingField({
            value: pricingFilter,
            onChange: (next) => {
              setPricingFilter(next);
              setPage(0);
            },
            prices: shown
              .filter((d) => !archiveLabelOf(d))
              .map((d) => listPrices[toAscii(d.domainName)]),
            currency,
            format: (n) =>
              formatMoney(
                String(n),
                currency,
                currency,
                settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
                true,
              ),
          }),
        ]),
    // Markets: only once a market account is connected; after Pricing.
    ...(marketsOn
      ? [
          marketsField({
            value: marketsFilter,
            onChange: (next) => {
              setMarketsFilter(next);
              setPage(0);
            },
            markets: listingMarkets.map((id) => ({
              id,
              name: marketCatalog.find((m) => m.id === id)?.name ?? id,
            })),
            // The view's own names: Owned leaves Archive out, and back.
            rows: shown
              .filter((d) => !archiveLabelOf(d) === !archiveView)
              .map((d) => ({
                listings: marketListings[toAscii(d.domainName)],
                mine: listPrices[toAscii(d.domainName)],
              })),
            currency,
            format: (n) =>
              formatMoney(
                String(n),
                currency,
                currency,
                settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
                true,
              ),
          }),
        ]
      : []),
    dateFilter(
      'expirationDate',
      'Expiration',
      expires,
      setExpires,
      EXPIRATION_PRESETS,
      (d) => utcDay(d.expirationDate),
      CalendarClock,
      matchesExpiration,
      EXPIRATION_DOTS,
    ),
    // Owned only: what you're letting go (auto-renew off), after Expiration.
    ...(!ownedView
      ? []
      : [
          listFilter(
            {
              key: 'autoRenew',
              label: 'Auto-renew',
              icon: RotateCw,
              options: autoRenewOptions,
              selected: autoRenewFilter,
              plural: 'values',
            },
            setAutoRenewFilter,
          ),
        ]),
    // Created is an Owned column, so its filter is Owned only.
    ...(!ownedView
      ? []
      : [
          dateFilter(
            'createdDate',
            'Created',
            created,
            setCreated,
            PAST_DATE_PRESETS,
            (d) => utcDay(d.createdDate),
            Calendar1,
          ),
        ]),
    dateFilter(
      'purchaseDate',
      'Purchased',
      purchased,
      setPurchased,
      PAST_DATE_PRESETS,
      (d) => purchaseOf(d)?.purchaseDate,
      CalendarPlus2,
    ),
    ...(archiveView
      ? [
          dateFilter(
            'saleDate',
            'Sold',
            sold,
            setSold,
            PAST_DATE_PRESETS,
            (d) => purchaseOf(d)?.saleDate,
            CalendarCheck,
          ),
        ]
      : []),
    // Last in the Filters menu: the least used.
    listFilter(
      {
        key: 'dns',
        label: 'Nameservers',
        icon: Server,
        options: nsGroups,
        selected: ns,
        plural: 'providers',
      },
      setNs,
    ),
  ];

  // Each tab remembers its own columns on this device. A date filter keeps
  // its column on screen, where the layout puts it, while it narrows.
  const columnView = view;
  const layoutColumnsForView = useMemo(
    () =>
      LAYOUT_COLUMNS[columnView]
        // The `listing` slot becomes one column per connected market.
        .flatMap((c) =>
          c.key === 'listing'
            ? listingMarkets.map((m) => ({ ...c, key: listingColumnKey(m) }))
            : [c],
        )
        .filter((c) => marketsOn || !isMarketColumnKey(c.key)),
    [columnView, marketsOn, listingMarkets],
  );
  const { layout: columnLayout, setLayout: setColumnLayout } = useColumnLayout(
    `domains.${columnView}`,
    layoutColumnsForView,
  );
  const marketFilter = useMemo(() => {
    const f = toMarketFilter(marketsFilter, currency);
    return marketsOn && isMarketFilterSet(f) ? f : null;
  }, [marketsFilter, currency, marketsOn]);
  const filteredDateColumns = useMemo(
    () =>
      (
        [
          [created, 'createdDate'],
          [expires, 'expirationDate'],
          [purchased, 'purchaseDate'],
          [sold, 'saleDate'],
        ] as const
      )
        .filter(([range]) => isDateRangeSet(range))
        .map(([, key]): string => key)
        // A Markets filter keeps its markets' columns on screen too.
        .concat(
          marketFilter
            ? listingMarkets
                .filter(
                  (m) =>
                    !marketsFilter.markets.length ||
                    marketsFilter.markets.includes(m),
                )
                .map(listingColumnKey)
            : [],
        ),
    [
      created,
      expires,
      purchased,
      sold,
      marketFilter,
      marketsFilter.markets,
      listingMarkets,
    ],
  );
  const shownColumnKeys = applyColumnLayout(
    layoutColumnsForView,
    columnLayout,
    filteredDateColumns,
  )
    .map((c) => c.key)
    .join(' ');

  // A sort whose column has gone (hidden in the picker, a filter cleared, or
  // a tab switch) goes back to the Settings default, or Domain
  // when that column isn't shown either, so a header always shows the sort.
  useEffect(() => {
    const shownKeys = new Set(shownColumnKeys.split(' '));
    if (shownKeys.has(sortKey)) return;
    const fallback = usePreferences.getState();
    const useDefault = shownKeys.has(fallback.sortKey);
    setSortKey(useDefault ? fallback.sortKey : 'domainName');
    setSortDir(useDefault ? fallback.sortDir : 'asc');
  }, [shownColumnKeys, sortKey]);

  function setListView(next: DomainsView) {
    // The filters every view has stay: a folder's Owned names, then its
    // listings, then the ones you no longer hold. Those a view lacks go,
    // rather than wait hidden to come back.
    if (next !== 'archive') {
      setStatus([]);
      setSold(NO_DATE_RANGE);
    }
    if (next !== 'owned') {
      setAutoRenewFilter([]);
      setCreated(NO_DATE_RANGE);
    }
    if (next === 'archive') setPricingFilter(NO_PRICING_FILTER);
    setPage(0);
    const nextParams = new URLSearchParams(params);
    if (next === 'owned') nextParams.delete('view');
    else nextParams.set('view', next);
    setParams(nextParams, { replace: true });
  }

  // The cards count the markets the Markets filter picks, or all of them.
  const cardMarkets = marketsFilter.markets.length
    ? marketsFilter.markets
    : listingMarkets;
  // The same days the Expiration filter's shortcuts pick.
  const expiresWithin = useCallback(
    (d: Domain) => matchesExpiration(d, presetRange('next30')),
    [],
  );

  // The Listings switch's count: owned names live on a connected market,
  // over the whole portfolio like the other counts.
  const listedCount = useMemo(
    () =>
      shown.filter(
        (d) =>
          !archiveLabelOf(d) &&
          (marketListings[toAscii(d.domainName)] ?? []).some(
            (l) =>
              listingMarkets.includes(l.market) && marketState(l) === 'active',
          ),
      ).length,
    [shown, archiveLabelOf, marketListings, listingMarkets],
  );

  const askingFilter = useMemo(
    () =>
      isPricingFilterSet(pricingFilter)
        ? toAskingFilter(pricingFilter, currency)
        : null,
    [pricingFilter, currency],
  );

  // Filter → sort. Pagination is applied after, on the sorted result.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = shown.filter((d) => {
      if (q && !d.domainName.toLowerCase().includes(q)) return false;
      if (tld.length > 0 && !tld.includes(tldOf(d.domainName))) return false;
      // The "Registrar" filter picks individual accounts (by account id), or
      // the names you added by their registrar.
      if (
        registrar.length > 0 &&
        !registrar.includes(registrarFilterValue(d, portfolioRegistrarLabels))
      )
        return false;
      // Nameservers: keep a domain in ANY selected nameserver group.
      if (ns.length > 0) {
        const keys = nsKeysByDomain.get(domainKey(d));
        if (!keys || !ns.some((k) => keys.has(k))) return false;
      }
      if (
        marketFilter &&
        !matchesMarketFilter(
          marketListings[toAscii(d.domainName)],
          listPrices[toAscii(d.domainName)],
          marketFilter,
          listingMarkets,
        )
      )
        return false;
      if (
        askingFilter &&
        !archiveView &&
        !matchesAsking(listPrices[toAscii(d.domainName)], askingFilter)
      )
        return false;
      // Date bounds are inclusive calendar days. A blank date on the row
      // stays out. Sold is an Archive column, so that bound waits there.
      const record = purchases[toAscii(d.domainName)];
      if (ownedView && !matchesDateRange(utcDay(d.createdDate), created))
        return false;
      if (!matchesExpiration(d, expires)) return false;
      if (!matchesDateRange(record?.purchaseDate, purchased)) return false;
      if (archiveView && !matchesDateRange(record?.saleDate, sold))
        return false;
      // Owned vs Archive (shared/ownership.ts). Archive also filters by
      // status; Owned by auto-renew. The folder (a real folder or None)
      // filters both tabs.
      {
        const label = archiveLabelOf(d);
        if (!label === archiveView) return false;
        if (archiveView && status.length > 0 && !status.includes(label!))
          return false;
        const bucket = folderBucket(
          folderAssignments[toAscii(d.domainName)],
          folders,
        );
        if (folder.length > 0 && !folder.includes(bucket)) return false;
        if (
          ownedView &&
          autoRenewFilter.length > 0 &&
          !autoRenewFilter.includes(autoRenewChoice(d))
        )
          return false;
      }
      return true;
    });

    // A hidden column can still be the sort. Falling back to the first
    // visible column would change the order when the header disappears.
    const col = columnByKey.get(sortKey) ?? columnByKey.get('domainName');
    // Renewal isn't a Domain field — sort it from the pricing map.
    const valueOf = (d: Domain): SortValue | null => {
      if (sortKey === RENEWAL) {
        return pricing[domainKey(d)]?.renewal ?? null;
      }
      if (sortKey === FOLDER) {
        const label = archiveLabelOf(d);
        if (label) return ARCHIVE_LABEL[label].toLowerCase();
        const id = folderAssignments[toAscii(d.domainName)];
        return folders.find((f) => f.id === id)?.name.toLowerCase() ?? null;
      }
      return col?.sortValue(d, portfolioRegistrarLabels) ?? null;
    };
    return sortRows(rows, valueOf, sortDir);
  }, [
    shown,
    columnByKey,
    portfolioRegistrarLabels,
    search,
    tld,
    registrar,
    ns,
    nsKeysByDomain,
    marketFilter,
    listingMarkets,
    marketListings,
    folder,
    status,
    folders,
    folderAssignments,
    autoRenewFilter,
    askingFilter,
    listPrices,
    purchases,
    created,
    expires,
    purchased,
    sold,
    archiveView,
    ownedView,
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
  // Registrar actions act on the selected names an account still holds.
  // The selected names at a connected account: what registrar actions run on.
  const selectedHeld = selectedDomains.filter(
    (d) => !d.departed && d.source !== 'imported',
  );
  const bulkRefresh = () => {
    const n = selectedHeld.length;
    void enrichVisible(selectedHeld, true).then(() =>
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
              folders.find((folder) => folder.id === folderId)?.name ?? 'folder'
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
      const csv = domainsToCsv(rows, {
        registrarLabels: portfolioRegistrarLabels,
        folders,
        assignments: folderAssignments,
        purchases,
        listPrices,
        pricing,
        manualPrices: await window.api.getManualPrices(),
        statusOf: (d) => {
          const st = standingOfRow(d);
          return st.label ?? (st.salePending ? 'sold' : null);
        },
        accountName: (d) =>
          accountName(registrars, d.accountId ?? d.registrar) ??
          registrarLabel(d.registrar, portfolioRegistrarLabels),
      });
      const result = await window.api.saveTextFile(csv, domainsCsvFilename());
      if (!result.saved) return; // user cancelled the dialog
      const name = result.path?.split(/[/\\]/).pop() ?? 'file';
      const n = nameCount(rows);
      flashExportNote(
        `Exported ${n} name${n === 1 ? '' : 's'} to ${name}`,
        false,
      );
    } catch (err) {
      flashExportNote(
        err instanceof Error ? err.message : 'Export failed',
        true,
      );
    }
  }

  // Table columns follow the saved layout for this view. Cells show a
  // placeholder while their data loads, and a dash where a departed name
  // has none.
  const renderCell = (col: Column, d: Domain) => {
    const registration =
      col.key === 'registrar' ||
      col.key === 'createdDate' ||
      col.key === 'expirationDate';
    if (col.key === 'domainName') {
      // The row's "⋯" menu lives in the Domain cell, pinned to its right edge,
      // with the name's sticky note (when it has one) just before it.
      const key = domainKey(d);
      return (
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            {col.render(d, portfolioRegistrarLabels)}
            <SoldBadge standing={standingOfRow(d)} underWay={saleUnderWay(d)} />
          </span>
          <div className="flex items-center">
            <NotesButton
              domainName={d.domainName}
              notes={purchases[toAscii(d.domainName)]?.notes ?? ''}
              editing={notesFor === key}
              onEditingChange={(open) => setNotesFor(open ? key : null)}
            />
            <RowActionsMenu
              domain={d}
              folders={folders}
              folderId={folderAssignments[toAscii(d.domainName)]}
              onRefresh={() => refreshDomain(d)}
              onUrlForwarding={() => setUrlForwardingFor(d)}
              onEmailForwarding={() => setEmailForwardingFor(d)}
              onAuthCode={() => setAuthCodeFor(d)}
              onRenew={() => setRenewFor(d)}
              onNotes={() => setNotesFor(key)}
              onEditPurchase={() => setPurchaseFor(d)}
              onEditSale={() => setSaleFor(d)}
              onEditListPrice={() => setListPriceFor([d])}
              onEditDetails={() => setDetailsFor(d)}
              onAssignFolder={(folderId) => applyFolders([d], folderId)}
              archive={archiveLabelOf(d)}
              sold={!!ownership.get(toAscii(d.domainName))?.sale}
              paid={paidKind(d)}
              removable={d.departed === true || d.source === 'imported'}
              onMarkSold={() => openOwnership('sold', [d])}
              onDelete={() => openOwnership('delete', [d])}
              onMarket={
                marketsOn
                  ? (action) => setMarketAction({ action, domains: [d] })
                  : undefined
              }
              marketLabel={marketLabel}
              marketId={marketId}
              marketReasons={marketReasonsFor([d])}
            />
          </div>
        </div>
      );
    }
    if (d.registrationPending && registration)
      return <CellSkeleton align={col.align} />;
    if (d.unregistered && registration)
      return <span className="text-muted-foreground">—</span>;
    // Archive: the name isn't yours, so its expiry (often the new holder's,
    // from the lookup) is plain grey, with no countdown or pill.
    if (archiveView && col.key === 'expirationDate')
      return (
        <span className="font-mono text-muted-foreground tabular-nums">
          {d.expirationDate ? fmtDate(d.expirationDate) : '—'}
        </span>
      );
    if (col.key === 'registrar' && d.registrationRegistrar)
      return (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={d.registrationRegistrarDetail}
        >
          {d.registrationRegistrarId && (
            <RegistrarLogo
              name={d.registrationRegistrarId}
              label={d.registrationRegistrar}
              className="size-4"
            />
          )}
          {d.registrationRegistrar}
        </span>
      );
    if (d.source === 'imported' && col.key === 'autoRenew')
      return (
        <span className="text-muted-foreground">
          {d.autoRenewUnknown ? '—' : d.autoRenew ? 'On' : 'Off'}
        </span>
      );
    if (
      (d.departed || d.source === 'imported') &&
      (col.detail || col.key === 'autoRenew')
    )
      return <span className="text-muted-foreground/50">—</span>;
    if (col.detail && enriching[domainKey(d)] === true)
      return <CellSkeleton align={col.align} />;
    return col.render(d, portfolioRegistrarLabels);
  };
  // Every column this tab can show, in default order; the saved layout picks
  // and orders them.
  const dataColumn = (key: string): Omit<DataColumn<Domain>, 'key'> => {
    if (key === FOLDER)
      return {
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
      };
    if (key === RENEWAL)
      return {
        label: 'Renewal',
        align: 'right',
        headClassName: 'w-0',
        cellClassName: 'w-0 pr-3',
        cell: (d) => (
          <RenewalCell info={pricing[domainKey(d)]} loading={pricingLoading} />
        ),
      };
    const col = columnByKey.get(key)!;
    return {
      label: col.tooltip ? (
        <span
          className="inline-flex cursor-help items-center gap-1"
          title={col.tooltip}
        >
          {col.label}
          <CircleHelp className="size-3" aria-hidden />
        </span>
      ) : (
        col.label
      ),
      title: col.label,
      align: col.align,
      compact: col.compact,
      hideOnMobile: col.hideOnMobile,
      headClassName: key === 'autoRenew' ? 'pl-[8px]' : undefined,
      cellClassName: key === 'autoRenew' ? 'pl-[6px]' : undefined,
      cell: (d) => renderCell(col, d),
    };
  };
  const dataColumns: DataColumn<Domain>[] = layoutColumnsForView.map((c) => ({
    ...c,
    ...dataColumn(c.key),
  }));

  // Sync failures, in red under the Sync button: the whole sync, or which
  // accounts failed (their errors are on their cards in Settings → Registrars
  // or Markets).
  const syncErrors = (portfolioError ||
    portfolioErrors.length > 0 ||
    marketSyncProblems.length > 0) && (
    <div className="flex flex-col items-end gap-0.5 text-right text-xs text-destructive">
      {portfolioError && <p>Sync failed: {portfolioError}</p>}
      {portfolioErrors.length > 0 && (
        <p>
          {portfolioErrors
            .map((e) =>
              accountTitle(
                registrarLabel(e.registrar, portfolioRegistrarLabels),
                e.accountLabel,
                multipleAccounts.has(e.registrar),
              ),
            )
            .join(', ')}{' '}
          failed to sync ·{' '}
          <Link
            to="/settings?tab=registrars"
            className="whitespace-nowrap underline underline-offset-4"
          >
            Registrar settings
          </Link>
        </p>
      )}
      {marketSyncProblems.length > 0 && (
        <p>
          {marketSyncProblems.map((p) => p.account).join(', ')} failed to sync ·{' '}
          <Link
            to="/settings?tab=markets"
            className="whitespace-nowrap underline underline-offset-4"
          >
            Market settings
          </Link>
        </p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* Title and filters scroll away on a short screen so the column names
          and the row-count bar keep a slice of the page. The -m-1 p-1
          pair leaves room for focus rings, which the scroll box would clip. */}
      <div className="-m-1 flex min-h-0 flex-col gap-[13px] overflow-y-auto p-1 short:gap-[9px]">
        <div className="mb-1 flex items-start justify-between gap-x-6 short:mb-0">
          {/* Centred on the 36px Sync button beside it. */}
          <h1 className="mt-1.5 flex min-w-0 items-baseline gap-2.5 text-2xl font-bold leading-none sm:mt-0.5 sm:text-[32px]">
            Domains
            {/* The view, again: the switch is easy to miss below the cards. */}
            <span className="text-sm font-semibold uppercase tracking-wider text-brand sm:text-base">
              {VIEW_TITLE[view]}
            </span>
          </h1>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <SyncSplitButton
              viewCount={nameCount(filtered)}
              allCount={nameCount(shown)}
              onImport={() => setImporting(true)}
              onExportView={() => void exportCsv(filtered)}
              onExportAll={() =>
                void exportCsv(
                  [...shown].sort((a, b) =>
                    toAscii(a.domainName).localeCompare(toAscii(b.domainName)),
                  ),
                )
              }
            />
            {syncErrors && (
              <div className="hidden max-w-md sm:block">{syncErrors}</div>
            )}
          </div>
        </div>

        {/* On phones, where the header column is narrow, the sync errors
            get their own row. */}
        {syncErrors && <div className="-mt-1.5 sm:hidden">{syncErrors}</div>}

        {(archiveView ? archiveCount > 0 : ownedCount > 0) && (
          <DomainsCards
            view={view}
            rows={filtered}
            listings={marketListings}
            markets={marketsOn ? cardMarkets : []}
            listPrices={listPrices}
            traffic={marketTraffic.domains}
            expiresWithin={expiresWithin}
            archiveLabelOf={archiveLabelOf}
            pricing={pricing}
            currency={currency}
            fx={exchangeRates}
            actions={{
              // The names the card counts: expiring within 30 days, not
              // renewing on their own.
              onExpiring: () => {
                setExpires(presetRange('next30'));
                setAutoRenewFilter(['off', 'unknown']);
                setPage(0);
              },
              onAutoRenew: () => {
                setAutoRenewFilter(['on']);
                setPage(0);
              },
              onMarketStates: (states) => {
                setMarketsFilter({ ...marketsFilter, states });
                setPage(0);
              },
              onPriceComparisons: (comparisons) => {
                setMarketsFilter({ ...marketsFilter, comparisons });
                setPage(0);
              },
              onListings: () => setListView('listings'),
              onArchiveStatus: (labels) => {
                setStatus(labels);
                setPage(0);
              },
            }}
          />
        )}

        {/* The table always renders — even before a load or with no registrars
          configured — so its toolbar and structure stay put; the empty body row
          carries the contextual prompt (configure a registrar / refresh / no
          matches). Columns is in the table's footer, under the rows. */}
        {/* One bar per view: each has its own default chips, and its own
            memory of the ones you removed. */}
        <FilterToolbar
          key={view}
          id={`domains.${view}`}
          switch={
            <OwnershipSwitch
              view={view}
              ownedCount={ownedCount}
              listedCount={listedCount}
              archiveCount={archiveCount}
              listings={marketsOn}
              onView={setListView}
            />
          }
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(0);
          }}
          fields={filterFields}
          presets={VIEW_FILTERS[view].presets}
          presetsIfRoom={VIEW_FILTERS[view].ifRoom}
        >
          {exportNote && (
            <span
              className={cn(
                // Before Columns, which is last.
                'order-[9998] inline-flex items-center gap-1.5 text-sm',
                exportNote.error ? 'text-destructive' : 'text-brand',
              )}
              role="status"
            >
              {!exportNote.error && <CircleCheck className="size-4" />}
              {exportNote.text}
            </span>
          )}
        </FilterToolbar>

        {/* Bulk action bar — contextual: appears once any row is selected, or
            while a bulk job is running (as a progress pill). */}
        <BulkBar
          domains={selectedDomains}
          folders={folders}
          onClear={clearSelection}
          onRefresh={bulkRefresh}
          onExport={() => void exportCsv(selectedDomains)}
          onAssignFolder={(folderId) => applyFolders(selectedDomains, folderId)}
          onNotes={() => setBulkNotesFor(selectedDomains)}
          onKind={(kind) =>
            setBulkDialog({ op: defaultBulkOp(kind, selectedHeld) })
          }
          onViewJob={() => {
            if (bulk) setBulkDialog({ op: bulk.op, jobId: bulk.id });
          }}
          archiveView={archiveView}
          onOwnership={(action) => openOwnership(action, selectedDomains)}
          onListPrice={() => setListPriceFor(selectedDomains)}
          onMarket={
            marketsOn
              ? (action) =>
                  setMarketAction({ action, domains: selectedDomains })
              : undefined
          }
          marketLabel={marketLabel}
          marketId={marketId}
          marketReasons={marketReasonsFor(selectedDomains)}
        />
      </div>

      <DataTable
        className="mt-[13px]"
        rows={filtered}
        columns={dataColumns}
        layout={columnLayout}
        onLayoutChange={setColumnLayout}
        forceVisible={filteredDateColumns}
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
          noneConfigured && importedList.length === 0 ? (
            // The first screen of a fresh install: neither way in is on the
            // page otherwise (Import hides in the Sync menu), so these two
            // are the only empty state with buttons.
            <EmptyState
              title="No domains yet"
              description="Add a registrar account to load your domains, or import them from a spreadsheet."
            >
              <Button onClick={() => navigate('/settings?tab=registrars')}>
                Add registrar account
              </Button>
              <Button variant="outline" onClick={() => setImporting(true)}>
                Import domains
              </Button>
            </EmptyState>
          ) : archiveView && archiveCount === 0 ? (
            <EmptyState
              title="Archive is empty"
              description="Names you sold or let expire end up here, along with any that left your accounts."
            />
          ) : portfolio.length === 0 ? (
            <EmptyState
              title="No domains yet"
              description={
                hasLoaded
                  ? "Your registrar accounts don't have any domains."
                  : 'Your domains show up here after the first sync.'
              }
            />
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
          domains={selectedHeld}
          jobId={bulkDialog.jobId}
          onClose={() => setBulkDialog(null)}
        />
      )}
      {detailsFor && (
        <ImportedDomainDialog
          domain={detailsFor}
          onClose={() => setDetailsFor(null)}
        />
      )}
      {listPriceFor && (
        <ListPriceDialog
          domains={listPriceFor}
          onClose={() => setListPriceFor(null)}
        />
      )}
      {listingFor && (
        <MarketListingDialog
          domain={listingFor.domain}
          market={listingFor.market}
          onClose={() => setListingFor(null)}
        />
      )}
      {marketAction && (
        <MarketActionDialog
          action={marketAction.action}
          domains={marketAction.domains}
          onClose={() => setMarketAction(null)}
        />
      )}
      {bulkNotesFor && (
        <BulkNotesDialog
          domainNames={bulkNotesFor.map((d) => d.domainName)}
          onClose={() => setBulkNotesFor(null)}
        />
      )}
      {importing && <ImportDomainsDialog onClose={() => setImporting(false)} />}
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
          if (action === 'sold')
            return (
              <MarkSoldDialog
                items={ownershipItems(ds)}
                onDone={done}
                onClose={close}
              />
            );
          // Delete: only the names no connected account holds.
          return (
            <DeleteDomainsDialog
              domains={ds.filter((d) => d.departed || d.source === 'imported')}
              onDone={done}
              onClose={close}
            />
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
