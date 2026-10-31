import { useEffect, useState } from 'react';
import { Feature } from '@aoxborrow/registrar-client';
import { domainKey } from '../../../shared/account-key';
import { localDay } from '../../../shared/domain-events';
import type { Domain, DomainOp } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { reportOpResult, targetOf } from '../../lib/domain-ops';
import { Button } from '@/components/ui/button';

const APPROVE: DomainOp = { kind: 'approveTransfer' };

/**
 * Approve transfer, for a sale whose buyer's registrar has asked for the
 * name: the registrar holding it waits for you to answer (Dynadot five days)
 * before letting it go on its own, and approving releases it now. Shown only
 * while that registrar reports the request as waiting, so only where its API
 * can report one. One click, like Unlock: the sale is the reason. It reads
 * Approved once the registrar confirms.
 */
export function SaleApproveTransfer({ domain }: { domain: Domain }) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const loadTransferOut = useAppStore((s) => s.loadTransferOut);
  const key = domainKey(domain);
  const transfer = useAppStore((s) => s.transfersOut[key]);
  // Another write on the name (an Unlock) holds this one back.
  const busy = useAppStore((s) => s.mutating[key] ?? false);
  const meta = useAppStore((s) =>
    s.registrars?.find((r) => r.name === domain.registrar),
  );
  const reports = meta?.features.includes(Feature.GetTransferOut) ?? false;
  // Stays on screen once clicked, so the row shows it worked.
  const [state, setState] = useState<'idle' | 'approving' | 'approved'>('idle');

  // Read live each time the row appears.
  const { registrar, domainName, accountId } = targetOf(domain);
  useEffect(() => {
    if (reports) void loadTransferOut({ registrar, domainName, accountId });
  }, [reports, loadTransferOut, registrar, domainName, accountId]);

  if (!reports || (state === 'idle' && transfer?.status !== 'pending'))
    return null;

  const approve = () => {
    setState('approving');
    void applyDomainOp(targetOf(domain), APPROVE).then((result) => {
      setState(reportOpResult(APPROVE, result) ? 'approved' : 'idle');
    });
  };
  const by = transfer?.expiresAt
    ? `on ${localDay(Date.parse(transfer.expiresAt))}`
    : 'in a few days';
  return (
    <Button
      size="sm"
      variant="outline"
      // Short enough to sit in a table row without making it taller.
      className="-my-1 h-6 shrink-0 px-2 text-xs"
      disabled={busy || state !== 'idle'}
      onClick={approve}
      title={
        state === 'approved'
          ? 'Approved: the buyer’s registrar can take the name now'
          : `The buyer’s registrar has asked for the name. Approve to release it now; left alone, ${meta?.displayName ?? 'the registrar'} lets it go ${by}.`
      }
    >
      {state === 'approving'
        ? 'Approving…'
        : state === 'approved'
          ? 'Approved'
          : 'Approve transfer'}
    </Button>
  );
}
