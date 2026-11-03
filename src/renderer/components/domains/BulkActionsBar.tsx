import type { ReactNode } from 'react';
import {
  Building2,
  Calculator,
  CalendarPlus,
  CircleX,
  EyeOff,
  FileSpreadsheet,
  HandCoins,
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
const icon = 'text-muted-foreground';

/**
 * The Domains bulk actions, in the SelectionBar floating over the table once
 * rows are selected (the table places it; see DataTable's `floatingBar`).
 * Actions holds everything in the row menu's order and submenus; Folder and
 * Export CSV follow as shortcuts, which drop out when the table is narrow
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
        {dots}
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

  const exportItem = (
    <DropdownMenuItem onSelect={onExport}>
      <FileSpreadsheet className={icon} />
      Export CSV
    </DropdownMenuItem>
  );

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
        <SelectionBar
          count={domains.length}
          total={total}
          onClear={onClear}
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
                  <MenuSub
                    icon={<HandCoins className={icon} />}
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
                      <Tag className={icon} />,
                      'List at your prices',
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
                    {marketItem(
                      'delist',
                      <CircleX className={icon} />,
                      'Delist',
                    )}
                  </MenuSub>
                  <MenuSub
                    icon={<Calculator className={icon} />}
                    label="Bookkeeping"
                  >
                    {recordPurchase}
                    {recordSale}
                  </MenuSub>
                </>
              )}
              <DropdownMenuSeparator />
              {exportItem}
              <DropdownMenuSeparator />
              {deleteItem}
            </>
          }
        >
          {/* Shortcuts, also in Actions, so they can drop out when narrow. */}
          {!archiveView && (
            <SelectionBarMenu
              icon={<FolderIcon />}
              label="Folder"
              className="@max-[760px]/float:hidden"
              contentClassName="max-h-[320px] w-52 overflow-y-auto"
            >
              {folderItems}
            </SelectionBarMenu>
          )}
          <SelectionBarButton
            className="@max-[760px]/float:hidden"
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
