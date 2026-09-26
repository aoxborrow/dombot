import { useState } from 'react';
import { toast } from 'sonner';
import { toUnicode } from '../../../shared/domain-name';
import {
  DomainEventType,
  type DomainEvent,
} from '../../../shared/domain-events';
import type { Domain, RegistrarMeta } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { PurchaseDialog } from '../domains/PurchaseDialog';
import { SaleDialog } from '../domains/SaleDialog';
import { Button } from '@/components/ui/button';

/** A Domain for the purchase and sale dialogs, from an alert. */
function alertDomain(
  e: DomainEvent,
  portfolio: Domain[],
  registrars: RegistrarMeta[] | null,
): Domain {
  const name = toUnicode(e.domain);
  const live = portfolio.find(
    (d) =>
      d.domainName.toLowerCase() === name &&
      (!e.accountId || d.accountId === e.accountId),
  );
  if (live) return live;
  const meta = registrars?.find((r) => (r.accountId ?? r.name) === e.accountId);
  return {
    registrar: (meta?.name ?? '') as Domain['registrar'],
    accountId: e.accountId ?? undefined,
    accountLabel: meta?.accountLabel,
    domainName: name,
    status: '',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(e.createdAt),
    deleted: false,
    departed: e.type === DomainEventType.Removed,
  };
}

/**
 * The answers to one open alert. A name that left: Sold (opens the sale
 * dialog), Dropped, Archive, or Dismiss. A name that arrived: Record purchase
 * (opens the purchase dialog, offering the registration fee) or Dismiss.
 * Whatever you pick is recorded against the alert, so it stays visible, and
 * undoable, on the Activity page.
 */
export function AlertActions({
  event,
  size = 'sm',
}: {
  event: DomainEvent;
  size?: 'sm' | 'xs';
}) {
  const portfolio = useAppStore((s) => s.portfolio);
  const registrars = useAppStore((s) => s.registrars);
  const setDisposition = useAppStore((s) => s.setDisposition);
  const setAlertDismissed = useAppStore((s) => s.setAlertDismissed);
  const [dialog, setDialog] = useState<'sale' | 'purchase' | null>(null);
  const name = toUnicode(event.domain);
  const button = (label: string, onClick: () => void) => (
    <Button type="button" size={size} variant="outline" onClick={onClick}>
      {label}
    </Button>
  );
  const dismiss = () =>
    void setAlertDismissed(event.id, true).then(() =>
      toast.success(`Dismissed ${name}`, {
        action: {
          label: 'Undo',
          onClick: () => void setAlertDismissed(event.id, false),
        },
      }),
    );
  const label = (type: 'dropped' | 'archived') =>
    void setDisposition(name, type, event.id).then(() =>
      toast.success(
        type === 'dropped' ? `Marked ${name} as Dropped` : `Archived ${name}`,
      ),
    );

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {event.type === DomainEventType.Removed ? (
          <>
            {button('Sold…', () => setDialog('sale'))}
            {button('Dropped', () => label('dropped'))}
            {button('Archive', () => label('archived'))}
          </>
        ) : (
          button('Record purchase…', () => setDialog('purchase'))
        )}
        {button('Dismiss', dismiss)}
      </div>
      {dialog === 'sale' && (
        <SaleDialog
          domain={alertDomain(event, portfolio, registrars)}
          mode="mark"
          resolves={event.id}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'purchase' && (
        <PurchaseDialog
          domain={alertDomain(event, portfolio, registrars)}
          justRegistered
          resolves={event.id}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
