import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { Domain } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { targetOf } from '../../lib/domain-ops';
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
 * Fetches and shows a domain's authorization (EPP / transfer) code. The code
 * is a secret: it's fetched live when the dialog opens, held only in this
 * component's state, shown masked until revealed, and never written anywhere
 * by the app. Copy puts it on the clipboard.
 */
export function AuthCodeDialog({
  domain,
  onClose,
}: {
  domain: Domain;
  onClose: () => void;
}) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void applyDomainOp(targetOf(domain), { kind: 'authCode' }).then((r) => {
      if (cancelled) return;
      if (r.status === 'ok' && r.data?.authCode) setCode(r.data.authCode);
      else setError(r.message || 'No auth code was returned.');
    });
    return () => {
      cancelled = true;
    };
    // Fetch once per domain the dialog is opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain.registrar, domain.domainName]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Auth code for ${domain.domainName} copied`);
    } catch {
      toast.error('Couldn’t copy to the clipboard');
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auth code</DialogTitle>
          <DialogDescription>
            The authorization (EPP) code for{' '}
            <span className="font-mono text-foreground">
              {domain.domainName}
            </span>
            . A gaining registrar needs it to transfer the domain away — treat
            it as a secret.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm select-all"
                aria-live="polite"
              >
                {code === null ? (
                  <span className="text-muted-foreground">Fetching…</span>
                ) : revealed ? (
                  <span className="truncate">{code}</span>
                ) : (
                  <span className="tracking-widest">
                    {'•'.repeat(Math.min(code.length, 24))}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                disabled={code === null}
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? 'Hide code' : 'Reveal code'}
                title={revealed ? 'Hide' : 'Reveal'}
              >
                {revealed ? <EyeOff /> : <Eye />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={code === null}
                onClick={() => void copy()}
                aria-label="Copy code"
                title="Copy"
              >
                <Copy />
              </Button>
            </div>
          )}
          {domain.locked && (
            <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              This domain is locked. A transfer won’t go through until it’s
              unlocked (the Locked column).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
