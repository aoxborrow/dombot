import { useRef } from 'react';
import { domainKey } from '../../../shared/account-key';
import {
  Archive,
  Calculator,
  CalendarPlus,
  Ellipsis,
  ExternalLink,
  KeyRound,
  Link2,
  Mail,
  OctagonMinus,
  Receipt,
  Tag,
  PencilLine,
  RefreshCw,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Domain, Folder } from '../../../shared/ipc';
import { toAscii } from '../../../shared/domain-name';
import type { ArchiveLabel } from '../../../shared/ownership';
import { useAppStore } from '../../store/app';
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

/**
 * The trailing "⋯" menu on each row (pinned to the right of the Domain cell):
 * for a name you own, a refresh, a Folder submenu (a folder, Hidden, or None),
 * and the actions that aren't a column (forwarding, renew, auth code); then,
 * for every name, Notes, Purchase details, and the ownership states: Sold, Dropped, or Archived (the one it's in is disabled; a new one
 * replaces yours; Archive only for a name you own), "Move back
 * to Owned" for a labeled name an account still holds, and Delete. A name in
 * Archive gets no registrar actions: move it back to Owned first. Registrar-backed items the
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
  onEditAsking,
  onEditDetails,
  onAssignFolder,
  archive,
  onMarkSold,
  onMarkDropped,
  onMarkArchived,
  onRestoreOwned,
  onDelete,
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
  onEditAsking: () => void;
  /** A manual name: edit its registrar, dates, and auto-renew. */
  onEditDetails: () => void;
  onAssignFolder: (folderId: string | null) => void;
  /** Why the name is in Archive, or null while you own it. */
  archive: ArchiveLabel | null;
  onMarkSold: () => void;
  onMarkDropped: () => void;
  onMarkArchived: () => void;
  onRestoreOwned: () => void;
  onDelete: () => void;
}) {
  // A name you labeled that an account still holds can go back to Owned. One
  // gone from every account stays Sold, Dropped, or Archived.
  const labeled =
    archive === 'sold' || archive === 'dropped' || archive === 'archived';
  const key = domainKey(domain);
  // A manual name isn't at a connected account: registrar actions can't run.
  const manualReason = domain.manual
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
          title="Actions"
          className="-my-2 w-7 text-muted-foreground hover:text-foreground compact:h-7 compact:w-6"
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
            {domain.manual ? (
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
              disabled={manualReason !== null || urlReason !== null}
              title={manualReason ?? urlReason ?? undefined}
              onSelect={onUrlForwarding}
            >
              <Link2 className="text-muted-foreground" />
              URL forwarding<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={manualReason !== null || emailReason !== null}
              title={manualReason ?? emailReason ?? undefined}
              onSelect={onEmailForwarding}
            >
              <Mail className="text-muted-foreground" />
              Email forwarding<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={manualReason !== null || renewReason !== null}
              title={manualReason ?? renewReason ?? undefined}
              onSelect={onRenew}
            >
              <CalendarPlus className="text-muted-foreground" />
              Renew<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={manualReason !== null || authReason !== null}
              title={manualReason ?? authReason ?? undefined}
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
        {archive === null && (
          <DropdownMenuItem onSelect={onEditAsking}>
            <Tag className="text-muted-foreground" />
            Pricing<span className="-ml-[6px] opacity-50">…</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={archive === 'sold' ? onEditSale : onMarkSold}
        >
          <Receipt className="text-muted-foreground" />
          Mark as Sold<span className="-ml-[6px] opacity-50">…</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={archive === 'dropped'}
          onSelect={onMarkDropped}
        >
          <OctagonMinus className="text-muted-foreground" />
          Mark as Dropped<span className="-ml-[6px] opacity-50">…</span>
        </DropdownMenuItem>
        {/* Puts a name you own away without a reason. In Archive, Removed
            already means "gone, no reason given". */}
        {archive === null && (
          <DropdownMenuItem onSelect={onMarkArchived}>
            <Archive className="text-muted-foreground" />
            Archive<span className="-ml-[6px] opacity-50">…</span>
          </DropdownMenuItem>
        )}
        {!domain.departed && labeled && (
          <DropdownMenuItem onSelect={onRestoreOwned}>
            <Undo2 className="text-muted-foreground" />
            Move back to Owned
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void window.api.openExternal(
              `https://${toAscii(domain.domainName)}`,
            )
          }
        >
          <ExternalLink className="text-muted-foreground" />
          Open in browser
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete<span className="-ml-[6px] opacity-50">…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
