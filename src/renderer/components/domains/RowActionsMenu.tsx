import { domainKey } from '../../../shared/account-key';
import {
  CalendarPlus,
  Ellipsis,
  KeyRound,
  Link2,
  Mail,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { SOLD_FOLDER_ID, type Domain, type Folder } from '../../../shared/ipc';
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

/**
 * The trailing "⋯" menu on each row (pinned to the right of the Domain cell): a
 * per-domain refresh, the actions that aren't a column (forwarding, auth code,
 * renew), and a Folder submenu for assigning the domain to a folder, Archive, or
 * None. Registrar-backed items the registrar can't do are disabled with the
 * reason as their tooltip. Disabled outright while a write for this row is in
 * flight.
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
  onEditPurchase,
  onEditSale,
  onAssignFolder,
}: {
  domain: Domain;
  folders: Folder[];
  folderId: string | undefined;
  onRefresh: () => void;
  onUrlForwarding: () => void;
  onEmailForwarding: () => void;
  onAuthCode: () => void;
  onRenew: () => void;
  onEditPurchase: () => void;
  onEditSale: () => void;
  onAssignFolder: (folderId: string | null) => void;
}) {
  const key = domainKey(domain);
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`Actions for ${domain.domainName}`}
          title="Actions"
          className="-my-2 text-muted-foreground hover:text-foreground compact:size-7"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {!domain.departed && (
          <>
            <DropdownMenuItem onSelect={onRefresh}>
              <RefreshCw className="text-muted-foreground" />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
        <DropdownMenuItem onSelect={onEditPurchase}>
          <Receipt className="text-muted-foreground" />
          Purchase & notes
        </DropdownMenuItem>
        {folderId === SOLD_FOLDER_ID && (
          <DropdownMenuItem onSelect={onEditSale}>
            <Receipt className="text-muted-foreground" />
            Sale & notes
          </DropdownMenuItem>
        )}
        {!domain.departed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={urlReason !== null}
              title={urlReason ?? undefined}
              onSelect={onUrlForwarding}
            >
              <Link2 className="text-muted-foreground" />
              URL forwarding<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={emailReason !== null}
              title={emailReason ?? undefined}
              onSelect={onEmailForwarding}
            >
              <Mail className="text-muted-foreground" />
              Email forwarding<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={renewReason !== null}
              title={renewReason ?? undefined}
              onSelect={onRenew}
            >
              <CalendarPlus className="text-muted-foreground" />
              Renew<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={authReason !== null}
              title={authReason ?? undefined}
              onSelect={onAuthCode}
            >
              <KeyRound className="text-muted-foreground" />
              Get auth code<span className="-ml-[6px] opacity-50">…</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
