import { useState } from 'react';
import { domainKey } from '../../../shared/account-key';
import type { Domain, DomainOp } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import {
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../../lib/domain-ops';
import { Button } from '@/components/ui/button';

const UNLOCK: DomainOp = { kind: 'lock', locked: false };

/**
 * Unlock, for a pending sale whose name is still in a registrar account of
 * yours: the buyer's registrar can't take it while it's locked. One click,
 * without the Locked column's confirm: the sale is the reason. Once the name
 * is unlocked it stays as a disabled Unlocked, a step done, until the sale
 * stops pending. Where the registrar's API can't unlock, it's disabled with
 * the reason, to do at the registrar.
 */
export function SaleUnlock({ domain }: { domain: Domain }) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  // Another write on the name (an Approve transfer) holds this one back.
  const busy = useAppStore((s) => s.mutating[domainKey(domain)] ?? false);
  const reason = useOpUnsupportedReason(domain.registrar, UNLOCK);
  // Only this button's own write reads as Unlocking.
  const [unlocking, setUnlocking] = useState(false);

  const unlock = () => {
    setUnlocking(true);
    void applyDomainOp(targetOf(domain), UNLOCK, { locked: false }).then(
      (result) => {
        setUnlocking(false);
        reportOpResult(UNLOCK, result);
      },
    );
  };
  return (
    <Button
      size="sm"
      variant="outline"
      // Short enough to sit in a table row without making it taller.
      className="-my-1 h-6 shrink-0 px-2 text-xs"
      disabled={busy || unlocking || !domain.locked || reason !== null}
      onClick={unlock}
      title={
        !domain.locked
          ? 'The transfer lock is off: the buyer can take the name'
          : (reason ??
            'Turn off the transfer lock at the registrar, so the buyer can take the name')
      }
    >
      {unlocking ? 'Unlocking…' : domain.locked ? 'Unlock' : 'Unlocked'}
    </Button>
  );
}
