import {
  CalendarPlus,
  Ellipsis,
  EyeOff,
  KeyRound,
  Link2,
  Mail,
  RefreshCw,
} from 'lucide-react';
import type { Domain } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { useOpUnsupportedReason } from '../../lib/domain-ops';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The trailing "⋯" menu on each row: a per-domain refresh, the actions that
 * aren't a column (forwarding, auth code, renew), and moving it to the Hidden
 * folder. Registrar-backed items the registrar
 * can't do are disabled with the reason as their tooltip. Disabled outright
 * while a write for this row is in flight.
 */
export function RowActionsMenu({
  domain,
  onRefresh,
  onUrlForwarding,
  onEmailForwarding,
  onAuthCode,
  onRenew,
  onHide,
}: {
  domain: Domain;
  onRefresh: () => void;
  onUrlForwarding: () => void;
  onEmailForwarding: () => void;
  onAuthCode: () => void;
  onRenew: () => void;
  onHide: () => void;
}) {
  const key = `${domain.registrar}:${domain.domainName}`;
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
        <DropdownMenuItem
          disabled={urlReason !== null}
          title={urlReason ?? undefined}
          onSelect={onUrlForwarding}
        >
          <Link2 className="text-muted-foreground" />
          URL forwarding…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={emailReason !== null}
          title={emailReason ?? undefined}
          onSelect={onEmailForwarding}
        >
          <Mail className="text-muted-foreground" />
          Email forwarding…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={authReason !== null}
          title={authReason ?? undefined}
          onSelect={onAuthCode}
        >
          <KeyRound className="text-muted-foreground" />
          Get auth code…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={renewReason !== null}
          title={renewReason ?? undefined}
          onSelect={onRenew}
        >
          <CalendarPlus className="text-muted-foreground" />
          Renew…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onHide}>
          <EyeOff className="text-muted-foreground" />
          Hidden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
