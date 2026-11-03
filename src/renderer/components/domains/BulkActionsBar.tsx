import type { ReactNode } from 'react';
import {
  Building2,
  Calculator,
  CalendarPlus,
  ChevronDown,
  CircleX,
  EyeOff,
  FileSpreadsheet,
  IterationCw,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Mail,
  Receipt,
  Redo,
  RefreshCw,
  Server,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Domain, DomainOpKind, Folder } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../RegistrarLogo';
import {
  bulkKindReason,
  bulkOpTitle,
  type BulkRegistrarKind,
} from '../../lib/bulk';
import { FolderIcon } from '../icons/FolderIcon';
import { ListEditIcon } from '../icons/ListEditIcon';
import { StickyNoteIcon } from '../icons/StickyNoteIcon';
import { CertificateIcon } from '../icons/CertificateIcon';
import { CashIcon } from '../icons/CashIcon';
import { FolderMenuItems } from './FolderMenuItems';
import { MenuSub } from './MenuSub';
import type { MarketAction } from './MarketActionDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** Ownership actions on the selection, each opening its dialog. */
export type OwnershipAction = 'sold' | 'delete';

// White on the brand green, icons a pale green, and the selection's darker
// green on hover and while a menu is open.
const ON_GREEN =
  'h-8 gap-1.5 rounded-sm px-2.5 has-[>svg]:px-2.5 text-[13px] font-medium text-primary-foreground hover:bg-black/15 hover:text-primary-foreground dark:hover:bg-black/25 data-[state=open]:bg-black/15 dark:data-[state=open]:bg-black/25 [&_svg]:size-4 [&_svg]:text-brand-100/85';

// The bar's menus open upward, so their shadow is cast up too: the usual one
// falls down, onto the bar.
const UP_SHADOW =
  'shadow-[0_-18px_50px_6px_rgb(0_0_0/0.12),0_-4px_16px_rgb(0_0_0/0.08)] dark:shadow-[0_-18px_50px_6px_rgb(0_0_0/0.75),0_-4px_16px_rgb(0_0_0/0.6)]';

const dots = <span className="-ml-[6px] opacity-50">…</span>;
const icon = 'text-muted-foreground';

/**
 * The bulk actions, in a green bar floating over the bottom of the table once
 * rows are selected (the table places it; see DataTable's `floatingBar`).
 * Left, on a darker green: the count, "of N selected", and Clear. Right:
 * Actions, which holds everything in the row menu's order and submenus, then
 * Folder and Export CSV as shortcuts, which drop out when the table is narrow
 * (they're in Actions too). Archive's menu is short and flat, like its row
 * menu. Registrar items grey out while a job runs, or when no selected name's
 * registrar can make the change; the dialog an item opens is where the value
 * is picked. While a job runs, a progress pill with View floats above the bar,
 * or on its own with nothing selected.
 */
export function BulkActionsBar({
  domains,
  held,
  total,
  folders,
  onClear,
  onRefresh,
  onExport,
  onAssignFolder,
  onNotes,
  onKind,
  onViewJob,
  archiveView,
  onOwnership,
  onListPrice,
  onMarket,
  marketLabel = 'markets',
  marketId = null,
  marketReasons,
}: {
  /** The selected domains (merged rows). */
  domains: Domain[];
  /** The selected names at a connected account: what registrar items act on. */
  held: Domain[];
  /** Names in this view, for "3 of 251 selected". */
  total: number;
  folders: Folder[];
  onClear: () => void;
  /** Re-fetch the selected domains' detail from their registrars. */
  onRefresh: () => void;
  onExport: () => void;
  onAssignFolder: (folderId: string | null) => void;
  onNotes: () => void;
  /** Open the bulk dialog for an op kind (its value is chosen there). */
  onKind: (kind: DomainOpKind) => void;
  onViewJob: () => void;
  /** Archive offers only the actions that don't need an account. */
  archiveView: boolean;
  onOwnership: (action: OwnershipAction) => void;
  /** Set or clear the selection's asking price. */
  onListPrice: () => void;
  /** Market actions; absent with no market account. */
  onMarket?: (action: MarketAction) => void;
  /** The market's name for the menu, e.g. "Afternic" (or "markets"). */
  marketLabel?: string;
  /** The one market behind the menu, for its logo; null for several. */
  marketId?: string | null;
  /** Why each market action can't apply here; null when it can. */
  marketReasons?: Record<MarketAction, string | null>;
}) {
  const bulk = useAppStore((s) => s.bulk);
  const registrars = useAppStore((s) => s.registrars);
  const running = bulk?.status === 'running';
  // Delete applies only to names no connected account holds.
  const removable = domains.filter(
    (d) => d.departed || d.source === 'imported',
  ).length;
  const noneHeld = held.length === 0;

  const registrarItem = (
    kind: BulkRegistrarKind,
    Icon: typeof Lock,
    label: string,
  ) => {
    const reason = running
      ? 'Wait for the running bulk action to finish.'
      : bulkKindReason(held, kind, registrars);
    return (
      <DropdownMenuItem
        disabled={reason !== null}
        title={reason ?? undefined}
        onSelect={() => onKind(kind)}
      >
        <Icon className={icon} />
        {label}
        {dots}
      </DropdownMenuItem>
    );
  };

  const marketItem = (action: MarketAction, glyph: ReactNode, label: string) =>
    onMarket && (
      <DropdownMenuItem
        disabled={Boolean(marketReasons?.[action])}
        title={marketReasons?.[action] ?? undefined}
        onSelect={() => onMarket(action)}
      >
        {glyph}
        {label}
        {dots}
      </DropdownMenuItem>
    );

  const folderItems = (
    <FolderMenuItems folders={folders} emptyState onAssign={onAssignFolder} />
  );

  const exportItem = (
    <DropdownMenuItem onSelect={onExport}>
      <FileSpreadsheet className={icon} />
      Export CSV
    </DropdownMenuItem>
  );

  const recordSale = (
    <DropdownMenuItem onSelect={() => onOwnership('sold')}>
      <Receipt className={icon} />
      Record sale{dots}
    </DropdownMenuItem>
  );

  const deleteItem = (
    <DropdownMenuItem
      variant="destructive"
      disabled={removable === 0}
      title={
        removable === 0
          ? 'Only names no connected account holds can be deleted. A name you hold leaves when you turn its auto-renew off.'
          : undefined
      }
      onSelect={() => onOwnership('delete')}
    >
      <Trash2 />
      Delete{dots}
      {removable > 0 && removable < domains.length && (
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {removable} of {domains.length}
        </span>
      )}
    </DropdownMenuItem>
  );

  return (
    <>
      {bulk && running && (
        <button
          type="button"
          onClick={onViewJob}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-0.5 text-xs shadow-md hover:bg-accent"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {bulkOpTitle(bulk.op)} · {bulk.results.length}/{bulk.total}
          <span className="text-muted-foreground">View</span>
        </button>
      )}
      {domains.length > 0 && (
        <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-md bg-primary p-1 text-primary-foreground shadow-xl ring-1 shadow-black/30 ring-black/10 animate-in fade-in slide-in-from-bottom-2 @min-[480px]/float:max-w-[66%] dark:ring-white/15">
          {/* The selection, set apart from the actions on a darker green. */}
          <span className="mr-1 flex h-8 shrink-0 items-center gap-2 rounded-sm bg-black/15 pr-2.5 pl-2 text-[13px] whitespace-nowrap dark:bg-black/25">
            {/* The tabs' count pill, in the bar's green. */}
            <span className="inline-flex h-5 items-center rounded-full bg-primary px-2 text-xs font-medium text-white tabular-nums">
              {domains.length}
            </span>
            <span className="text-brand-100/75">
              of <span className="tabular-nums">{total}</span> selected
            </span>
            {/* The filter chips' remove button: a small X, a small hover
                square. */}
            <button
              type="button"
              title="Clear selection"
              aria-label="Clear selection"
              onClick={onClear}
              className="group/clear ml-0.5 flex text-brand-100/75 outline-none hover:text-white"
            >
              <span className="-m-[3px] flex rounded-[4px] p-[3px] transition-colors group-hover/clear:bg-white/20">
                <X className="size-3.5" />
              </span>
            </button>
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={ON_GREEN}>
                <ListEditIcon className="size-[18px]!" />
                Actions
                <ChevronDown className="size-3.5!" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              sideOffset={10}
              align="start"
              className={cn('w-56', UP_SHADOW)}
            >
              {archiveView ? (
                <>
                  <DropdownMenuItem onSelect={onNotes}>
                    <StickyNoteIcon className={icon} />
                    Notes{dots}
                  </DropdownMenuItem>
                  {recordSale}
                </>
              ) : (
                <>
                  <DropdownMenuItem onSelect={onRefresh}>
                    <RefreshCw className={icon} />
                    Refresh
                  </DropdownMenuItem>
                  <MenuSub
                    icon={<FolderIcon className={icon} />}
                    label="Folder"
                    contentClassName="max-h-[320px] w-52 overflow-y-auto"
                  >
                    {folderItems}
                  </MenuSub>
                  <DropdownMenuItem onSelect={onNotes}>
                    <StickyNoteIcon className={icon} />
                    Notes{dots}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <MenuSub
                    icon={<Building2 className={icon} />}
                    label="Registrar"
                    disabled={noneHeld}
                    title={
                      noneHeld
                        ? 'None of these are at a connected account.'
                        : undefined
                    }
                  >
                    {registrarItem('autoRenew', IterationCw, 'Auto-renew')}
                    {registrarItem('privacy', EyeOff, 'WHOIS privacy')}
                    {registrarItem('lock', Lock, 'Transfer lock')}
                    {registrarItem('nameservers', Server, 'Nameservers')}
                    <DropdownMenuSeparator />
                    {registrarItem('urlForwarding', Link2, 'URL forwarding')}
                    {registrarItem('emailForwarding', Mail, 'Email forwarding')}
                    <DropdownMenuSeparator />
                    {registrarItem('renew', CalendarPlus, 'Renew')}
                    {registrarItem('authCode', KeyRound, 'Get auth codes')}
                  </MenuSub>
                  <MenuSub
                    icon={<Tag className={icon} />}
                    label="Selling"
                    contentClassName="w-68"
                  >
                    <DropdownMenuItem onSelect={onListPrice}>
                      <CashIcon className={icon} />
                      Pricing{dots}
                    </DropdownMenuItem>
                    {onMarket && <DropdownMenuSeparator />}
                    {marketItem(
                      'list',
                      <MarketLogo
                        market={marketId}
                        label={marketLabel}
                        className="size-4 p-[1.5px] text-muted-foreground"
                      />,
                      'List at your prices',
                    )}
                    {marketItem(
                      'delist',
                      <CircleX className={icon} />,
                      'Delist',
                    )}
                    {marketItem(
                      'verificationTxt',
                      <CertificateIcon className={icon} />,
                      'Ownership verification TXT',
                    )}
                    {marketItem(
                      'recheckOwnership',
                      <Redo className={icon} />,
                      'Recheck ownership',
                    )}
                  </MenuSub>
                  <MenuSub
                    icon={<Calculator className={icon} />}
                    label="Bookkeeping"
                  >
                    <DropdownMenuItem
                      disabled
                      title="Purchases are recorded one name at a time from its row, or imported from a CSV."
                    >
                      <Calculator className={icon} />
                      Record purchase{dots}
                    </DropdownMenuItem>
                    {recordSale}
                  </MenuSub>
                </>
              )}
              <DropdownMenuSeparator />
              {exportItem}
              <DropdownMenuSeparator />
              {deleteItem}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Shortcuts, also in Actions, so they can drop out when narrow. */}
          {!archiveView && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(ON_GREEN, '@max-[760px]/float:hidden')}
                >
                  <FolderIcon />
                  Folder
                  <ChevronDown className="size-3.5!" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                sideOffset={10}
                align="start"
                className={cn('max-h-[320px] w-52 overflow-y-auto', UP_SHADOW)}
              >
                {folderItems}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            // A little more room on the right, where the others have a
            // chevron.
            className={cn(
              ON_GREEN,
              'pr-3.5 has-[>svg]:pr-3.5 @max-[760px]/float:hidden',
            )}
            onClick={onExport}
          >
            <FileSpreadsheet />
            Export CSV
          </Button>
        </div>
      )}
    </>
  );
}
