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
 * Unlock, for a sale whose name is still locked in a registrar account of
 * yours: the buyer's registrar can't take it until it's unlocked. One click,
 * without the Locked column's confirm: the sale is the reason. It reads
 * Unlocked once the registrar confirms, as Send auth code reads Sent. Where
 * the registrar's API can't unlock, it stays disabled with the reason, to do
 * at the registrar.
 */
export function SaleUnlock({ domain }: { domain: Domain }) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const pending = useAppStore((s) => s.mutating[domainKey(domain)] ?? false);
  const reason = useOpUnsupportedReason(domain.registrar, UNLOCK);
  // Stays on screen once clicked, so the row shows it worked.
  const [clicked, setClicked] = useState(false);
  if (!domain.locked && !clicked) return null;

  const unlock = () => {
    setClicked(true);
    void applyDomainOp(targetOf(domain), UNLOCK, { locked: false }).then(
      (result) => {
        if (!reportOpResult(UNLOCK, result)) setClicked(false);
      },
    );
  };
  return (
    <Button
      size="sm"
      variant="outline"
      // Short enough to sit in a table row without making it taller.
      className="-my-1 h-6 shrink-0 px-2 text-xs"
      disabled={pending || !domain.locked || reason !== null}
      onClick={unlock}
      title={
        reason ??
        (domain.locked
          ? 'Turn off the transfer lock at the registrar, so the buyer can take the name'
          : 'The transfer lock is off: the buyer can take the name')
      }
    >
      {pending ? 'Unlocking…' : domain.locked ? 'Unlock' : 'Unlocked'}
    </Button>
  );
}
