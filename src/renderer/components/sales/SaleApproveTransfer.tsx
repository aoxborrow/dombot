import { useEffect, useState } from 'react';
import { Feature } from '@aoxborrow/registrar-client';
import { domainKey } from '../../../shared/account-key';
import { localDay } from '../../../shared/domain-events';
import type { Domain, DomainOp } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { reportOpResult, targetOf } from '../../lib/domain-ops';
import { SaleStepButton } from './SaleStepButton';

const APPROVE: DomainOp = { kind: 'approveTransfer' };
// How long a registrar may hold an unanswered transfer before releasing it
// (ICANN's limit), for when it reports no date of its own (Dynadot doesn't).
const RELEASE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Approve transfer, the last of a pending sale's steps, shown from the start
 * wherever the registrar's API reports transfer requests (Dynadot today), so
 * the row lays out every step at once. It turns on when the buyer's registrar
 * asks for the name: the registrar holding it waits for you to answer
 * (Dynadot five days) before letting it go on its own, and approving releases
 * it now. One click, like Unlock: the sale is the reason. It reads Transfer
 * approved once the registrar confirms, or reports it approved.
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
  const reports =
    (meta?.features.includes(Feature.GetTransferOut) &&
      meta.features.includes(Feature.ApproveTransferOut)) ??
    false;
  // When the account last synced: a sync reads the request again, so a Sync
  // now shows one the buyer's registrar has made since.
  const syncedAt = useAppStore(
    (s) =>
      s.registrars?.find((r) => r.accountId === domain.accountId)?.sync
        .lastSyncedAt ?? null,
  );
  // Clicked: shows the click worked, before the registrar's next report.
  const [state, setState] = useState<'idle' | 'approving' | 'approved'>('idle');

  // Read live each time the row appears, and after each sync.
  const { registrar, domainName, accountId } = targetOf(domain);
  useEffect(() => {
    if (reports) void loadTransferOut({ registrar, domainName, accountId });
  }, [reports, loadTransferOut, registrar, domainName, accountId, syncedAt]);

  if (!reports) return null;
  const approved =
    state === 'approved' ||
    transfer?.status === 'approved' ||
    transfer?.status === 'completed';
  const waiting = !approved && transfer?.status !== 'pending';

  const approve = () => {
    setState('approving');
    void applyDomainOp(targetOf(domain), APPROVE).then((result) => {
      const ok = reportOpResult(APPROVE, result);
      setState(ok ? 'approved' : 'idle');
      // What the registrar says now, for when the row next appears.
      if (ok) void loadTransferOut({ registrar, domainName, accountId });
    });
  };
  const by = transfer?.expiresAt
    ? `on ${localDay(Date.parse(transfer.expiresAt))}`
    : transfer?.requestedAt
      ? `around ${localDay(Date.parse(transfer.requestedAt) + RELEASE_AFTER_MS)}`
      : 'in a few days';
  return (
    <SaleStepButton
      disabled={busy || waiting || approved || state !== 'idle'}
      onClick={approve}
      title={
        approved
          ? 'Transfer approved: the buyer’s registrar can take the name now'
          : waiting
            ? 'Turns on when the buyer’s registrar asks for the name, after it has the auth code'
            : `The buyer’s registrar has asked for the name. Approve to release it now; left alone, ${meta?.displayName ?? 'the registrar'} lets it go ${by}.`
      }
    >
      {state === 'approving'
        ? 'Approving…'
        : approved
          ? 'Transfer approved'
          : 'Approve transfer'}
    </SaleStepButton>
  );
}
