import { useCallback, useEffect, useState } from 'react';
import type { McpPendingApproval } from '../../shared/ipc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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

  return (
    <Dialog open={Boolean(req)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {req && (
          <>
            <DialogHeader>
              <DialogTitle>Approve MCP connection</DialogTitle>
              <DialogDescription>
                A client wants to connect to your DomBot portfolio. Approve only
                if you started this connection.
              </DialogDescription>
            </DialogHeader>

            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between border-b pb-2">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-medium">{req.clientName}</dd>
              </div>
              <div className="flex justify-between border-b pb-2">
                <dt className="text-muted-foreground">Confirm code</dt>
                <dd className="font-mono tracking-widest text-primary">
                  {req.code}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              The same code is shown in the client&apos;s browser window — make
              sure they match.
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void decide(req.id, false)}
                disabled={busy === req.id}
              >
                Deny
              </Button>
              <Button
                className="flex-1"
                onClick={() => void decide(req.id, true)}
                disabled={busy === req.id}
              >
                Approve
              </Button>
            </DialogFooter>

            {pending.length > 1 && (
              <p className="text-center text-xs text-muted-foreground">
                {pending.length - 1} more request
                {pending.length - 1 === 1 ? '' : 's'} waiting
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
