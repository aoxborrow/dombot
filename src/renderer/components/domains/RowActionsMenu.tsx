import { CalendarPlus, Ellipsis, EyeOff, KeyRound } from 'lucide-react';
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
 * The trailing "⋯" menu on each row: the per-domain actions that aren't a
 * column (auth code, renew) plus Hide. Registrar-backed items the registrar
 * can't do are disabled with the reason as their tooltip. Disabled outright
 * while a write for this row is in flight.
 */
export function RowActionsMenu({
  domain,
  onAuthCode,
  onRenew,
  onHide,
}: {
  domain: Domain;
  onAuthCode: () => void;
  onRenew: () => void;
  onHide: () => void;
}) {
  const key = `${domain.registrar}:${domain.domainName}`;
  const pending = useAppStore((s) => s.mutating[key] ?? false);
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
          Hide
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
