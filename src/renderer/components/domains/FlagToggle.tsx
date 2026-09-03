import type { LucideIcon } from 'lucide-react';
import type { Domain, DomainOp } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import {
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../../lib/domain-ops';
import { cn } from '@/lib/utils';
import { ConfirmPopover } from '../ConfirmPopover';

/**
 * A clickable on/off cell for the Privacy and Locked columns. Shows the `on`
 * icon (emphasized) when enabled, the muted `off` icon otherwise, and flips
 * the value at the registrar on click — optimistically, rolling back if the
 * registrar rejects. Disabled (with the reason as its tooltip) when the
 * registrar can't change the flag, and while a write is in flight.
 *
 * Privacy changes (either direction — turning it off exposes the WHOIS
 * contact, turning it on can be a purchase at some registrars) and unlocking
 * (enables a transfer-out) ask first in a small popover anchored to the cell.
 * Locking is the one transition that's plain one-click: it only ever makes
 * the domain safer.
 */
export function FlagToggle({
  domain,
  kind,
  on: On,
  off: Off,
  onLabel,
  offLabel,
}: {
  domain: Domain;
  kind: 'privacy' | 'lock';
  on: LucideIcon;
  off: LucideIcon;
  onLabel: string;
  offLabel: string;
}) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const key = `${domain.registrar}:${domain.domainName}`;
  const pending = useAppStore((s) => s.mutating[key] ?? false);

  const value = kind === 'privacy' ? domain.privacy : domain.locked;
  const next = !value;
  const op: DomainOp =
    kind === 'privacy'
      ? { kind: 'privacy', enabled: next }
      : { kind: 'lock', locked: next };
  const optimistic: Partial<Domain> =
    kind === 'privacy' ? { privacy: next } : { locked: next };
  const reason = useOpUnsupportedReason(domain.registrar, op);

  const apply = () => {
    void applyDomainOp(targetOf(domain), op, optimistic).then((result) =>
      reportOpResult(op, result),
    );
  };

  // Lock → one click. Everything else confirms in place.
  const needsConfirm = !(kind === 'lock' && !value);
  const confirm =
    kind === 'lock'
      ? {
          title: `Unlock ${domain.domainName}?`,
          body: 'An unlocked domain can be transferred to another registrar.',
          action: 'Unlock',
        }
      : next
        ? {
            title: `Enable privacy for ${domain.domainName}?`,
            body: 'Hides the registrant contact from public WHOIS. Some registrars charge for this.',
            action: 'Enable',
          }
        : {
            title: `Disable privacy for ${domain.domainName}?`,
            body: 'Exposes the registrant name, address, email, and phone in public WHOIS.',
            action: 'Disable',
          };

  const Icon = value ? On : Off;
  const label = value ? onLabel : offLabel;
  const title = reason
    ? reason
    : `${label[0].toUpperCase()}${label.slice(1)} — click to ${
        kind === 'privacy'
          ? next
            ? 'enable privacy'
            : 'disable privacy'
          : next
            ? 'lock'
            : 'unlock'
      }`;

  const button = (
    <button
      type="button"
      disabled={pending || reason !== null}
      title={title}
      aria-label={label}
      aria-pressed={value}
      onClick={needsConfirm ? undefined : apply}
      className={cn(
        'mx-auto flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent',
        pending && 'animate-pulse',
        reason !== null && 'opacity-40',
      )}
    >
      <Icon
        className={cn(
          'size-4',
          value ? 'text-[#7ac28d]/85' : 'text-muted-foreground/50',
        )}
      />
    </button>
  );

  if (!needsConfirm) return button;

  return (
    <ConfirmPopover
      title={confirm.title}
      body={confirm.body}
      actionLabel={confirm.action}
      destructive={kind === 'lock' || !next}
      disabled={pending || reason !== null}
      onConfirm={apply}
    >
      {button}
    </ConfirmPopover>
  );
}
