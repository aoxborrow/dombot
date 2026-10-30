import { useRef } from 'react';
import { domainKey } from '../../../shared/account-key';
import {
  Calculator,
  CalendarPlus,
  Ellipsis,
  KeyRound,
  Link2,
  Mail,
  Receipt,
  PencilLine,
  RefreshCw,
  Trash2,
  CircleX,
} from 'lucide-react';
import type { Domain, Folder } from '../../../shared/ipc';
import type { ArchiveLabel } from '../../../shared/ownership';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../RegistrarLogo';
import { useOpUnsupportedReason } from '../../lib/domain-ops';
import { FolderIcon } from '../icons/FolderIcon';
import { FolderMenuItems } from './FolderMenuItems';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StickyNoteIcon } from '../icons/StickyNoteIcon';
import { CashIcon } from '../icons/CashIcon';
import type { MarketAction } from './MarketActionDialog';

/**
 * The trailing "⋯" menu on each row (pinned to the right of the Domain cell):
 * for a name you own, a refresh, a Folder submenu, and the actions that
 * aren't a column (forwarding, renew, auth code); then, for every name,
 * Notes, Purchase details, and Mark as Sold (Edit sale once one is recorded;
 * undoing it is in that dialog). Remove from DomBot ends the menu only for a
 * name no connected account holds (imported and Archive names): a name you
 * hold goes away by turning its auto-renew off (docs/owned-and-archive.md).
 * A name in Archive gets no registrar actions. Registrar-backed items the
 * registrar can't do are disabled with the reason as their tooltip. Disabled
 * outright while a write for this row is in flight.
 */
export function RowActionsMenu({
  domain,
  folders,
  folderId,
  onRefresh,
  onUrlForwarding,
  onEmailForwarding,
  onAuthCode,
  onRenew,
  onNotes,
  onEditPurchase,
  onEditSale,
  onEditListPrice,
  onEditDetails,
  onAssignFolder,
  archive,
  sold,
  removable,
  onMarkSold,
  onDelete,
  onMarket,
  marketLabel = 'markets',
  marketId = null,
  marketReasons,
}: {
  domain: Domain;
  folders: Folder[];
  folderId: string | undefined;
  onRefresh: () => void;
  onUrlForwarding: () => void;
  onEmailForwarding: () => void;
  onAuthCode: () => void;
  onRenew: () => void;
  onNotes: () => void;
  onEditPurchase: () => void;
  onEditSale: () => void;
  onEditListPrice: () => void;
  /** An imported name: edit its registrar, dates, and auto-renew. */
  onEditDetails: () => void;
  onAssignFolder: (folderId: string | null) => void;
  /** Why the name is in Archive, or null while you own it. */
  archive: ArchiveLabel | null;
  /** A sale is on record: Mark as Sold edits it. */
  sold: boolean;
  /** No connected account holds it: Remove from DomBot applies. */
  removable: boolean;
  onMarkSold: () => void;
  onDelete: () => void;
  /** List or delist on a market; absent with no market account. */
  onMarket?: (action: MarketAction) => void;
  marketLabel?: string;
  /** The one market behind the menu, for its logo; null for several. */
  marketId?: string | null;
  /** Why each market action can't apply here; null when it can. */
  marketReasons?: Record<MarketAction, string | null>;
}) {
  const key = domainKey(domain);
  // An imported name isn't at a connected account: registrar actions can't run.
  const importedReason =
    domain.source === 'imported'
      ? 'Added by you. No connected account holds this name.'
      : null;
  const pending = useAppStore((s) => s.mutating[key] ?? false);
  const urlReason = useOpUnsupportedReason(domain.registrar, {
    kind: 'urlForwarding',
    forwards: [],
  });
  const emailReason = useOpUnsupportedReason(domain.registrar, {
    kind: 'emailForwarding',
    forwards: [],
  });
  const authReason = useOpUnsupportedReason(domain.registrar, {
    kind: 'authCode',
  });
  const renewReason = useOpUnsupportedReason(domain.registrar, {
    kind: 'renew',
    years: 1,
  });

  // Notes opens an editor beside the row: the menu mustn't hand focus back
  // to its trigger as it closes, or the editor's textarea loses the caret.
  const keepFocus = useRef(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Actions for ${domain.domainName}`}
          // Covers the Domain cell outside the name: the cell lights, not
          // the button (index.css).
          data-cell-action
          className="-my-2 w-7 text-muted-foreground hover:bg-transparent hover:text-foreground compact:h-7 compact:w-6 dark:hover:bg-transparent"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onCloseAutoFocus={(e) => {
          if (!keepFocus.current) return;
          keepFocus.current = false;
          e.preventDefault();
        }}
      >
        {/* Registrar and organizing actions: only for a name you own. */}
        {archive === null && (
          <>
            {domain.source === 'imported' ? (
              <DropdownMenuItem onSelect={onEditDetails}>
                <PencilLine className="text-muted-foreground" />
                Edit details<span className="-ml-[6px] opacity-50">…</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onRefresh}>
                <RefreshCw className="text-muted-foreground" />
                Refresh
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderIcon className="text-muted-foreground" />
                Folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[320px] w-52 overflow-y-auto">
                <FolderMenuItems
                  folders={folders}
                  selected={folderId ?? null}
                  onAssign={onAssignFolder}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={importedReason !== null || urlReason !== null}
              title={importedReason ?? urlReason ?? undefined}
              onSelect={onUrlForwarding}
            >
              <Link2 className="text-muted-foreground" />
              URL forwarding<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importedReason !== null || emailReason !== null}
              title={importedReason ?? emailReason ?? undefined}
              onSelect={onEmailForwarding}
            >
              <Mail className="text-muted-foreground" />
              Email forwarding<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={importedReason !== null || renewReason !== null}
              title={importedReason ?? renewReason ?? undefined}
              onSelect={onRenew}
            >
              <CalendarPlus className="text-muted-foreground" />
              Renew<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={importedReason !== null || authReason !== null}
              title={importedReason ?? authReason ?? undefined}
              onSelect={onAuthCode}
            >
              <KeyRound className="text-muted-foreground" />
              Get auth code<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {/* Ownership, in the same order as on Activity. Purchase details and
            Mark as Sold open with what's saved (and the name's notes), so
            a sold name's Mark as Sold edits its sale. */}
        <DropdownMenuItem
          onSelect={() => {
            keepFocus.current = true;
            onNotes();
          }}
        >
          <StickyNoteIcon className="text-muted-foreground" />
          Notes<span className="-ml-[6px] opacity-50">…</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEditPurchase}>
          <Calculator className="text-muted-foreground" />
          Purchase details<span className="-ml-[6px] opacity-50">…</span>
        </DropdownMenuItem>
        {/* Pricing and the markets, in a section of their own. */}
        {archive === null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onEditListPrice}>
              <CashIcon className="text-muted-foreground" />
              Pricing<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            {onMarket && (
              <>
                <DropdownMenuItem
                  disabled={Boolean(marketReasons?.list)}
                  title={marketReasons?.list ?? undefined}
                  onSelect={() => onMarket('list')}
                >
                  <MarketLogo
                    market={marketId}
                    label={marketLabel}
                    className="size-4 p-[1.5px] text-muted-foreground"
                  />
                  List at your price
                  <span className="-ml-[6px] opacity-50">…</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={Boolean(marketReasons?.delist)}
                  title={marketReasons?.delist ?? undefined}
                  onSelect={() => onMarket('delist')}
                >
                  <CircleX className="text-muted-foreground" />
                  Delist<span className="-ml-[6px] opacity-50">…</span>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={sold ? onEditSale : onMarkSold}>
          <Receipt className="text-muted-foreground" />
          {sold ? 'Edit sale' : 'Mark as Sold'}
          <span className="-ml-[6px] opacity-50">…</span>
        </DropdownMenuItem>
        {removable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              Remove from DomBot<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
