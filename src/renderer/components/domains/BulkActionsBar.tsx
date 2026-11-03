import { useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Building2,
  Calculator,
  CalendarPlus,
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
  RefreshCw,
  Server,
  Tag,
  Trash2,
} from 'lucide-react';
import type { Domain, DomainOpKind, Folder } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import {
  bulkKindReason,
  bulkOpTitle,
  type BulkRegistrarKind,
} from '../../lib/bulk';
import { FolderIcon } from '../icons/FolderIcon';
import { StickyNoteIcon } from '../icons/StickyNoteIcon';
import { CertificateIcon } from '../icons/CertificateIcon';
import { CashIcon } from '../icons/CashIcon';
import { NO_FOLDER } from '../../lib/folders';
import { FolderMenuItems } from './FolderMenuItems';
import { MenuSub } from './MenuSub';
import type { MarketAction } from './MarketActionDialog';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  SelectionBar,
  SelectionBarButton,
  SelectionBarMenu,
} from '../data-table/SelectionBar';

/** Ownership actions on the selection, each opening its dialog. */
export type OwnershipAction = 'purchase' | 'sold' | 'delete';

const dots = <span className="-ml-[6px] opacity-50">…</span>;
// After a T, whose stem leaves room under its bar where the dots sit, a
// little closer, as type kerns "T.".
const dotsAfterT = <span className="-ml-[7px] opacity-50">…</span>;
const icon = 'text-muted-foreground';

/**
 * The Domains bulk actions, in the SelectionBar floating over the table once
 * rows are selected (the table places it; see DataTable's `floatingBar`).
 * Actions holds everything in the row menu's order and submenus, Delete only
 * when some of the selection can be deleted; Folder and Export CSV follow as
 * shortcuts, which drop out when the table is narrow. Folder is in Actions
 * too; Export CSV joins it only once its button has gone. Archive's menu is
 * short and flat, like its row menu. Registrar items grey out while a job runs, or when no selected name's
 * registrar can make the change; the dialog an item opens is where the value
 * is picked. While a job runs, a progress pill with View floats above the bar,
 * or on its own with nothing selected.
 */
export function BulkActionsBar({
  domains,
  held,
  total,
  folders,
  folderCounts,
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
  marketReasons,
}: {
  /** The selected domains (merged rows). */
  domains: Domain[];
  /** The selected names at a connected account: what registrar items act on. */
  held: Domain[];
  /** Names in this view, for "3 of 251 selected". */
  total: number;
  folders: Folder[];
  /** Selected names per folder id (`NO_FOLDER` for None). */
  folderCounts: Readonly<Record<string, number>>;
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
        {label.endsWith('T') ? dotsAfterT : dots}
      </DropdownMenuItem>
    );

  // Checked when every selected name is in the same folder (or none).
  const filled = Object.keys(folderCounts).filter((k) => folderCounts[k] > 0);
  const sharedFolder =
    filled.length === 1
      ? filled[0] === NO_FOLDER
        ? null
        : filled[0]
      : undefined;
  const folderItems = (
    <FolderMenuItems
      folders={folders}
      selected={sharedFolder}
      counts={folderCounts}
      emptyState
      onAssign={onAssignFolder}
    />
  );

  const exportButton = useRef<HTMLButtonElement>(null);

  const recordPurchase = (
    <DropdownMenuItem onSelect={() => onOwnership('purchase')}>
      <Calculator className={icon} />
      Record purchase{dots}
    </DropdownMenuItem>
  );

  const recordSale = (
    <DropdownMenuItem onSelect={() => onOwnership('sold')}>
      <Receipt className={icon} />
      Record sale{dots}
    </DropdownMenuItem>
  );

  // Only when some of the selection can be deleted: a name you hold leaves
  // when you turn its auto-renew off.
  const deleteItem = removable > 0 && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => onOwnership('delete')}
      >
        <Trash2 />
        Delete{dots}
        {removable < domains.length && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {removable} of {domains.length}
          </span>
        )}
      </DropdownMenuItem>
    </>
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
        <SelectionBar
          count={domains.length}
          total={total}
          onClear={onClear}
          // Wide enough for "Verify ownership TXT" (about 202px) even with
          // a scrollbar showing (about 15px) when the menu is taller than
          // the window, and for the submenus a phone opens in place.
          actionsClassName="w-56"
          actions={
            <>
              {archiveView ? (
                <>
                  <DropdownMenuItem onSelect={onNotes}>
                    <StickyNoteIcon className={icon} />
                    Notes{dots}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {recordPurchase}
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
                  {recordPurchase}
                  {recordSale}
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
                    <DropdownMenuSeparator />
                    {registrarItem('nameservers', Server, 'Nameservers')}
                    {registrarItem('urlForwarding', Link2, 'URL forwarding')}
                    {registrarItem('emailForwarding', Mail, 'Email forwarding')}
                    <DropdownMenuSeparator />
                    {registrarItem('renew', CalendarPlus, 'Renew')}
                    {registrarItem('authCode', KeyRound, 'Get auth codes')}
                  </MenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onListPrice}>
                    <CashIcon className={icon} />
                    Pricing{dots}
                  </DropdownMenuItem>
                  {marketItem(
                    'list',
                    <Tag className={icon} />,
                    'List at your prices',
                  )}
                  {marketItem(
                    'verificationTxt',
                    <CertificateIcon className={icon} />,
                    'Verify ownership TXT',
                  )}
                  {/* Recheck ownership is hidden for now, as in the row
                      menu. */}
                  {marketItem('delist', <CircleX className={icon} />, 'Delist')}
                </>
              )}
              <ExportWhenHidden button={exportButton} onExport={onExport} />
              {deleteItem}
            </>
          }
        >
          {/* Shortcuts, which drop out when the bar won't fit in its share
              of the table (90% under 724px): Export CSV first, then Folder.
              Measured with "12,345 of 12,345 selected": 576px with both,
              456px without Export CSV. */}
          {!archiveView && (
            <SelectionBarMenu
              icon={<FolderIcon />}
              label="Folder"
              className="@max-[508px]/float:hidden"
              contentClassName="max-h-[320px] w-52 overflow-y-auto"
            >
              {folderItems}
            </SelectionBarMenu>
          )}
          <SelectionBarButton
            ref={exportButton}
            className="@max-[644px]/float:hidden"
            onClick={onExport}
          >
            <FileSpreadsheet />
            Export CSV
          </SelectionBarButton>
        </SelectionBar>
      )}
    </>
  );
}

/**
 * Export CSV in Actions, only while the bar's own Export CSV button is
 * hidden for room. A container query hides that button, and the menu, in a
 * portal outside the bar, can't see it: it looks once, as the menu opens
 * (its items mount then).
 */
function ExportWhenHidden({
  button,
  onExport,
}: {
  button: RefObject<HTMLButtonElement | null>;
  onExport: () => void;
}) {
  const [hidden] = useState(() => !button.current?.offsetWidth);
  if (!hidden) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onExport}>
        <FileSpreadsheet className={icon} />
        Export CSV
      </DropdownMenuItem>
    </>
  );
}
