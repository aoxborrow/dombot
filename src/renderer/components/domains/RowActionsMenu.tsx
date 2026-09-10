import { domainKey } from '../../../shared/account-key';
import {
  CalendarPlus,
  Check,
  Ellipsis,
  EyeOff,
  KeyRound,
  Link2,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { HIDDEN_FOLDER_ID } from '../../../shared/ipc';
import type { Domain, Folder } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { useOpUnsupportedReason } from '../../lib/domain-ops';
import { folderColorStyle } from '../../lib/folders';
import { FolderIcon } from '../icons/FolderIcon';
import { cn } from '@/lib/utils';
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
 * renew), and a Folder submenu for assigning the domain to a folder, Hidden, or
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
          className="text-muted-foreground/60 hover:text-foreground"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={onRefresh}>
          <RefreshCw className="text-muted-foreground" />
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderIcon className="text-muted-foreground" />
            Folder
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[320px] w-52 overflow-y-auto">
            {folders.map((f) => (
              <DropdownMenuItem
                key={f.id}
                className="gap-2.5"
                onSelect={() => onAssignFolder(f.id)}
              >
                <FolderIcon
                  className={cn(
                    'size-4 shrink-0',
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
            <DropdownMenuItem
              className="gap-2.5"
              onSelect={() => onAssignFolder(HIDDEN_FOLDER_ID)}
            >
              <EyeOff className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">Hidden</span>
              {folderId === HIDDEN_FOLDER_ID && (
                <Check className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5"
              onSelect={() => onAssignFolder(null)}
            >
              <span className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">None</span>
              {folderId === undefined && (
                <Check className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
