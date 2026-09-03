import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { Domain, RenewalPricing } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { reportOpResult, targetOf } from '../../lib/domain-ops';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MAX_YEARS = 10;
/** What the user types to confirm — renewals charge the registrar account. */
const CONFIRM_WORD = 'RENEW';

/** Registrars whose API ignores the term and renews for the registry minimum. */
const FIXED_TERM: Record<string, string> = {
  porkbun:
    'Porkbun always renews for the registry-minimum term (usually 1 year) regardless of the years chosen.',
};

/** Whole/decimal USD, e.g. "$12" or "$12.99". */
function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function isoDate(date: Date | null): string {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

/** `date` plus `years` calendar years (same month/day), or null. */
function plusYears(date: Date | null, years: number): Date | null {
  if (!date) return null;
  const d = new Date(date instanceof Date ? date : new Date(date));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * Renew one domain. Costs money, so it shows the term, DomBot's estimated
 * price (clearly an estimate — the registrar charges its own price), the new
 * expiry, and requires typing RENEW. The op runs with retries off in main; on
 * success the row's expiry updates from the registrar's fresh detail.
 */
export function RenewDialog({
  domain,
  pricing,
  onClose,
}: {
  domain: Domain;
  pricing: RenewalPricing | undefined;
  onClose: () => void;
}) {
  const applyDomainOp = useAppStore((s) => s.applyDomainOp);
  const [years, setYears] = useState(1);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const fixedTerm = FIXED_TERM[domain.registrar];
  const perYear = pricing?.renewal ?? null;
  const estimate = perYear === null ? null : perYear * years;
  const newExpiry = plusYears(domain.expirationDate, years);
  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const submit = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    const op = { kind: 'renew' as const, years };
    try {
      const result = await applyDomainOp(targetOf(domain), op);
      if (reportOpResult(op, result)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renew domain</DialogTitle>
          <DialogDescription>
            Renew{' '}
            <span className="font-mono text-foreground">
              {domain.domainName}
            </span>{' '}
            at its registrar. This charges your registrar account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="renew-years">Term</FieldLabel>
            <Select
              value={String(years)}
              onValueChange={(v) => setYears(Number(v))}
              disabled={busy || Boolean(fixedTerm)}
            >
              <SelectTrigger id="renew-years" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_YEARS }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} year{n === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fixedTerm && (
              <p className="text-xs text-muted-foreground">{fixedTerm}</p>
            )}
          </Field>

          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
            <dt className="text-muted-foreground">Current expiry</dt>
            <dd className="font-mono tabular-nums">
              {isoDate(domain.expirationDate)}
            </dd>
            <dt className="text-muted-foreground">New expiry</dt>
            <dd className="font-mono tabular-nums">{isoDate(newExpiry)}</dd>
            <dt className="text-muted-foreground">Estimated cost</dt>
            <dd className="tabular-nums">
              {estimate === null ? (
                <span className="text-muted-foreground">unknown</span>
              ) : (
                <>
                  {usd(estimate)}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {usd(perYear!)}/yr · {pricing?.source}
                  </span>
                </>
              )}
            </dd>
          </dl>
          <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The cost is DomBot’s estimate. Your registrar charges its own price,
            which can differ for premium names.
          </p>

          <Field>
            <FieldLabel htmlFor="renew-confirm">
              Type <span className="font-mono">{CONFIRM_WORD}</span> to confirm
            </FieldLabel>
            <Input
              id="renew-confirm"
              value={typed}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              className="w-40 font-mono uppercase"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!confirmed || busy}>
            {busy
              ? 'Renewing…'
              : `Renew for ${years} year${years === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
