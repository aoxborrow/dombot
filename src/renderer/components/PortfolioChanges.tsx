import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Domain, PortfolioChange } from '../../shared/ipc';
import { useAppStore } from '../store/app';
import { PurchaseDialog } from './domains/PurchaseDialog';
import { SaleDialog } from './domains/SaleDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function accountText(label: string | null, registrar: string | null): string {
  if (label && label !== 'Default') return label;
  return registrar ?? label ?? 'an account';
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function summary(change: PortfolioChange): string {
  const name = change.domainName;
  if (change.kind === 'added') {
    return `${name} arrived at ${accountText(change.toLabel, change.toRegistrar)}`;
  }
  if (change.kind === 'moved') {
    return `${name} moved from ${accountText(change.fromLabel, change.fromRegistrar)} to ${accountText(change.toLabel, change.toRegistrar)}`;
  }
  return `${name} left ${accountText(change.fromLabel, change.fromRegistrar)}`;
}

function arrivalDomain(
  change: PortfolioChange,
  portfolio: Domain[],
): Domain {
  const live = portfolio.find(
    (domain) =>
      domain.domainName.toLowerCase() === change.domainName.toLowerCase() &&
      domain.accountId === change.toAccountId,
  );
  if (live) return live;
  return purchaseDomain(change);
}

function departedDomain(change: PortfolioChange): Domain {
  return {
    registrar: (change.fromRegistrar ?? 'dynadot') as Domain['registrar'],
    accountId: change.fromAccountId ?? undefined,
    accountLabel: change.fromLabel ?? undefined,
    domainName: change.domainName,
    status: '',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(change.at),
    deleted: false,
    departed: true,
  };
}

function purchaseDomain(change: PortfolioChange): Domain {
  return {
    registrar: (change.toRegistrar ?? 'dynadot') as Domain['registrar'],
    domainName: change.domainName,
    accountId: change.toAccountId ?? undefined,
    accountLabel: change.toLabel ?? undefined,
    status: 'active',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(change.at),
    deleted: false,
  };
}

/**
 * Red count of unresolved portfolio changes, immediately left of the
 * last-sync time. Opens one list for every name still waiting from that
 * sync, including a move between the user's accounts. When the count is
 * zero, that spot stays empty. History is the Owned / History switch.
 * Full history in the list opens the Domains History view (Sold, Dropped,
 * and Archive). It does not list moves. Those rows stay stored after
 * Dismiss and are not shown again.
 */
export function PortfolioChangesButton() {
  const changes = useAppStore((s) => s.portfolioChanges);
  const portfolio = useAppStore((s) => s.portfolio);
  const resolve = useAppStore((s) => s.resolvePortfolioChange);
  const unresolved = changes.filter((change) => !change.resolved);
  const [open, setOpen] = useState(false);
  const [purchase, setPurchase] = useState<{
    id: string;
    domain: Domain;
  } | null>(null);
  const [saleFor, setSaleFor] = useState<Domain | null>(null);

  // The last alert just closed. Don't leave the empty "Nothing waiting" list up.
  if (open && unresolved.length === 0) setOpen(false);

  if (unresolved.length === 0 && !open && !saleFor && !purchase) return null;

  return (
    <>
      {unresolved.length > 0 && (
        <button
          type="button"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-medium text-white tabular-nums"
          aria-label={`${unresolved.length} unresolved portfolio ${unresolved.length === 1 ? 'change' : 'changes'}`}
          onClick={() => setOpen(true)}
        >
          {unresolved.length}
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Portfolio changes</DialogTitle>
            <DialogDescription>
              Names that arrived, left, or moved the last time an account synced.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {unresolved.map((change) => (
              <div
                key={change.id}
                className="flex flex-col gap-2 border-b pb-3 last:border-b-0"
              >
                <div>
                  <p className="text-sm">
                    <span className="font-mono font-medium">
                      {change.domainName}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      {summary(change).slice(change.domainName.length + 1)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {when(change.at)}
                  </p>
                </div>
                {change.kind === 'removed' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSaleFor(departedDomain(change));
                        void resolve(change.id, 'sold');
                      }}
                    >
                      Sold
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(change.id, 'dropped')}
                    >
                      Dropped
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(change.id, 'dismissed')}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
                {change.kind === 'added' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPurchase({
                          id: change.id,
                          domain: arrivalDomain(change, portfolio),
                        })
                      }
                    >
                      Purchase date & amount
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(change.id, 'dismissed')}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
                {change.kind === 'moved' && (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(change.id, 'dismissed')}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="sm:justify-start">
            <Link
              to="/?view=history"
              className="text-sm underline underline-offset-4"
              onClick={() => setOpen(false)}
            >
              Full history
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {saleFor && (
        <SaleDialog domain={saleFor} onClose={() => setSaleFor(null)} />
      )}
      {purchase && (
        <PurchaseDialog
          domain={purchase.domain}
          justRegistered
          onSaved={() => {
            void resolve(purchase.id, 'dismissed');
          }}
          onClose={() => setPurchase(null)}
        />
      )}
    </>
  );
}
