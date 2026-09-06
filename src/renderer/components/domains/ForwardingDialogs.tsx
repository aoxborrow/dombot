import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  Domain,
  DomainForward,
  DomainOp,
  EmailForward,
  UrlForwardInput,
} from '../../../shared/ipc';
import { friendlyError } from '../../../shared/domain-ops';
import { useAppStore } from '../../store/app';
import { reportOpResult, targetOf } from '../../lib/domain-ops';
import {
  normalizeEmailForward,
  normalizeUrlForward,
  sameEmailForwards,
  sameUrlForwards,
  validateEmailForwards,
  validateUrlForwards,
} from '../../lib/forwarding-input';
import { ConfirmDialog } from '../ConfirmDialog';
import { UrlForwardingEditor } from './UrlForwardingEditor';
import { EmailForwardingEditor } from './EmailForwardingEditor';

// The two per-row forwarding dialogs. Each loads the domain's current rules
// live when opened (forwarding isn't cached), hands them to its editor, and
// saves the full set through applyDomainOp — a full replace, so the dialog
// says so and the validators warn when the set is emptied.

/** Loading / loaded / failed for the initial live read. */
type Load<T> =
  | { state: 'loading' }
  | { state: 'ready'; rules: T[] }
  | { state: 'error'; message: string };

function LoadingLine() {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Reading current rules from the registrar…
    </p>
  );
}

/** Registrar caveats shown under the editor. */
const URL_NOTE: Record<string, string> = {
  gandi: 'Gandi forwards subdomains only — the apex (“@”) can’t be forwarded.',
  namesilo:
    'NameSilo supports one apex (“@”) forward; saving no rules restores its default nameservers.',
  namecheap:
    'Namecheap stores forwards as URL host records; the domain must use Namecheap DNS.',
};
const EMAIL_NOTE: Record<string, string> = {
  namesilo: 'NameSilo fans one alias out to up to five destinations.',
  namecheap: 'Requires the domain to use Namecheap DNS.',
};

export function UrlForwardingDialog({
  domain,
  onClose,
}: {
  domain: Domain;
  onClose: () => void;
}) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const [load, setLoad] = useState<Load<DomainForward>>({ state: 'loading' });
  const [rows, setRows] = useState<UrlForwardInput[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.getUrlForwarding(targetOf(domain)).then(
      (rules) => {
        if (cancelled) return;
        setLoad({ state: 'ready', rules });
        setRows(
          rules
            .filter((r) => r.type !== 'masked')
            .map((r) => ({
              host: r.host,
              url: r.url,
              type: r.type as UrlForwardInput['type'],
            })),
        );
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoad({
          state: 'error',
          message: friendlyError(
            err instanceof Error ? err.message : String(err),
          ),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const initial = useMemo(
    () =>
      load.state === 'ready'
        ? load.rules
            .filter((r) => r.type !== 'masked')
            .map((r) => ({
              host: r.host,
              url: r.url,
              type: r.type as UrlForwardInput['type'],
            }))
        : [],
    [load],
  );
  const masked =
    load.state === 'ready' ? load.rules.filter((r) => r.type === 'masked') : [];
  const validation = useMemo(
    () => validateUrlForwards(rows, domain.registrar),
    [rows, domain.registrar],
  );
  const unchanged =
    load.state === 'ready' &&
    masked.length === 0 &&
    sameUrlForwards(rows, initial);
  const canSave =
    load.state === 'ready' && validation.errors.length === 0 && !unchanged;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    const op: DomainOp = {
      kind: 'urlForwarding',
      forwards: rows.map(normalizeUrlForward),
    };
    try {
      const result = await applyDomainOp(targetOf(domain), op);
      if (reportOpResult(op, result)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title="URL forwarding"
      description={
        <>
          HTTP redirects from{' '}
          <span className="font-mono text-foreground">{domain.domainName}</span>
          . Saving replaces the full rule set at the registrar.
        </>
      }
      actionLabel={rows.length === 0 ? 'Remove all forwarding' : 'Save'}
      busyLabel="Saving…"
      busy={busy}
      wide
      disabled={!canSave}
      destructive={rows.length === 0 && initial.length > 0}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      {load.state === 'loading' && <LoadingLine />}
      {load.state === 'error' && (
        <p className="text-sm text-destructive">{load.message}</p>
      )}
      {load.state === 'ready' && (
        <>
          <UrlForwardingEditor
            rows={rows}
            onChange={setRows}
            validation={validation}
            masked={masked}
            disabled={busy}
          />
          {URL_NOTE[domain.registrar] && (
            <p className="text-xs text-muted-foreground">
              {URL_NOTE[domain.registrar]}
            </p>
          )}
        </>
      )}
    </ConfirmDialog>
  );
}

export function EmailForwardingDialog({
  domain,
  onClose,
}: {
  domain: Domain;
  onClose: () => void;
}) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const [load, setLoad] = useState<Load<EmailForward>>({ state: 'loading' });
  const [rows, setRows] = useState<EmailForward[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.getEmailForwarding(targetOf(domain)).then(
      (rules) => {
        if (cancelled) return;
        setLoad({ state: 'ready', rules });
        setRows(rules.map((r) => ({ ...r })));
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoad({
          state: 'error',
          message: friendlyError(
            err instanceof Error ? err.message : String(err),
          ),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [domain]);

  const initial = load.state === 'ready' ? load.rules : [];
  const validation = useMemo(
    () => validateEmailForwards(rows, domain.registrar),
    [rows, domain.registrar],
  );
  const unchanged = load.state === 'ready' && sameEmailForwards(rows, initial);
  const canSave =
    load.state === 'ready' && validation.errors.length === 0 && !unchanged;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    const op: DomainOp = {
      kind: 'emailForwarding',
      forwards: rows.map(normalizeEmailForward),
    };
    try {
      const result = await applyDomainOp(targetOf(domain), op);
      if (reportOpResult(op, result)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title="Email forwarding"
      description={
        <>
          Alias redirects at{' '}
          <span className="font-mono text-foreground">{domain.domainName}</span>{' '}
          (no mailboxes are created). Saving replaces the full rule set at the
          registrar.
        </>
      }
      actionLabel={rows.length === 0 ? 'Remove all forwarding' : 'Save'}
      busyLabel="Saving…"
      busy={busy}
      wide
      disabled={!canSave}
      destructive={rows.length === 0 && initial.length > 0}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      {load.state === 'loading' && <LoadingLine />}
      {load.state === 'error' && (
        <p className="text-sm text-destructive">{load.message}</p>
      )}
      {load.state === 'ready' && (
        <>
          <EmailForwardingEditor
            rows={rows}
            onChange={setRows}
            validation={validation}
            domainName={domain.domainName}
            disabled={busy}
          />
          {EMAIL_NOTE[domain.registrar] && (
            <p className="text-xs text-muted-foreground">
              {EMAIL_NOTE[domain.registrar]}
            </p>
          )}
        </>
      )}
    </ConfirmDialog>
  );
}
