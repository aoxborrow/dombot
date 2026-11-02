import { useState } from 'react';
import { domainKey } from '../../../shared/account-key';
import type { Domain, DomainOp, RegistrarMeta } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import {
  opUnsupportedReason,
  reportOpResult,
  targetOf,
  useOpUnsupportedReason,
} from '../../lib/domain-ops';
import { SaleStepButton } from './SaleStepButton';

const UNLOCK: DomainOp = { kind: 'lock', locked: false };

/**
 * Whether the sale's next steps wait for Unlock: the name is locked and
 * DomBot can unlock it. Where the registrar's API can't, they don't wait, so
 * you can unlock at the registrar and carry on.
 */
export function waitsForUnlock(
  domain: Domain | undefined,
  registrars: RegistrarMeta[] | null,
): boolean {
  return (
    !!domain?.locked &&
    opUnsupportedReason(registrars, domain.registrar, UNLOCK) === null
  );
}

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
    <SaleStepButton
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
    </SaleStepButton>
  );
}
