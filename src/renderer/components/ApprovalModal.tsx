import { useCallback, useEffect, useState } from 'react';
import type { McpPendingApproval } from '../../shared/ipc';

/**
 * App-wide modal that surfaces MCP connection requests. The main process brings
 * the window forward and emits an event; we (re)load the pending list and let
 * the user approve or deny each one.
 */
export default function ApprovalModal() {
  const [pending, setPending] = useState<McpPendingApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPending(await window.api.listPendingApprovals());
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.api.onApprovalsChanged(() => void refresh());
    return off;
  }, [refresh]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await window.api.resolveApproval(id, approve);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const req = pending[0];
  if (!req) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Approve MCP connection</h2>
        <p className="mt-1 text-sm text-slate-400">
          A client wants to connect to your dombot portfolio. Approve only if
          you started this connection.
        </p>

        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <dt className="text-slate-500">Client</dt>
            <dd className="font-medium">{req.clientName}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <dt className="text-slate-500">Confirm code</dt>
            <dd className="font-mono tracking-widest text-indigo-300">
              {req.code}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          The same code is shown in the client&apos;s browser window — make sure
          they match.
        </p>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => void decide(req.id, false)}
            disabled={busy === req.id}
            className="flex-1 rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            Deny
          </button>
          <button
            onClick={() => void decide(req.id, true)}
            disabled={busy === req.id}
            className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Approve
          </button>
        </div>

        {pending.length > 1 && (
          <p className="mt-3 text-center text-xs text-slate-500">
            {pending.length - 1} more request
            {pending.length - 1 === 1 ? '' : 's'} waiting
          </p>
        )}
      </div>
    </div>
  );
}
