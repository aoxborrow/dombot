import { useState } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { Domain, RegistrarName } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  parsePurchaseDate,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ActionHeader, todayInput } from '../actions/ActionDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyPicker } from './CurrencyPicker';
import {
  NOTES_MAX,
  NotesLimit,
  notesNearLimit,
  notesTextareaClass,
} from './NotesLimit';

/**
 * Edit the purchase date, amount, and notes for one domain. The amount is
 * typed in the number format from Settings. An empty form deletes the record.
 */
function registrationDay(value: Domain['createdDate']): string {
  if (value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function PurchaseDialog({
  domain,
  onClose,
  onSaved,
  justRegistered = false,
  resolves,
}: {
  domain: Domain;
  onClose: () => void;
  /** Called after a successful Save, before the dialog closes. */
  onSaved?: () => void;
  /** An arrival: offer to fill the registration date and this registrar's fee. */
  justRegistered?: boolean;
  /** The arrival alert this answers: records a new purchase and closes it. */
  resolves?: string;
}) {
  const purchases = useAppStore((s) => s.purchases);
  const registrars = useAppStore((s) => s.registrars);
  const settings = useAppStore((s) => s.settings);
  const savePurchase = useAppStore((s) => s.savePurchase);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  const record = purchases[toAscii(domain.domainName)];
  // Answering an arrival records a new holding: start blank rather than from
  // the previous purchase. The note belongs to the name, so it still shows.
  const existing = resolves ? undefined : record;

  // A new purchase starts dated today; editing one keeps what's stored.
  const recorded = !!(existing?.purchaseDate || existing?.amount);
  const [date, setDate] = useState(
    recorded ? (existing?.purchaseDate ?? '') : todayInput,
  );
  const [amount, setAmount] = useState(
    existing?.amount
      ? formatAmountInput(
          existing.amount,
          existing.currency ?? preferred,
          formatId,
        )
      : '',
  );
  const [currency, setCurrency] = useState(existing?.currency ?? preferred);
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [feeNote, setFeeNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [filling, setFilling] = useState(false);
  // Filled from the registrar's registration date and fee: a registration,
  // not a purchase from someone.
  const [registered, setRegistered] = useState(false);

  async function fillJustRegistered() {
    setError(null);
    setFeeNote(null);
    setFilling(true);
    const day = registrationDay(domain.createdDate);
    try {
      const quote = await window.api.getRegistrationQuote(
        domain.registrar as RegistrarName,
        domain.domainName,
        domain.accountId,
      );
      setDate(day);
      setRegistered(true);
      if (!quote.amount) {
        const name =
          registrars?.find((r) => r.name === domain.registrar)?.displayName ??
          'This registrar';
        setFeeNote(
          `${name} doesn't report a registration fee. The date is filled in. Type the amount you paid.`,
        );
        return;
      }
      setCurrency(quote.currency);
      setAmount(formatAmountInput(quote.amount, quote.currency, formatId));
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : 'Could not look up the fee.';
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, ''));
    } finally {
      setFilling(false);
    }
  }

  async function save(clear: boolean) {
    setError(null);
    let purchaseDate: string | null = null;
    let canonical: string | null = null;
    if (!clear) {
      try {
        purchaseDate = parsePurchaseDate(date);
        canonical = parseLocalizedAmount(amount, currency, formatId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Check the amount.');
        return;
      }
    }
    setSaving(true);
    try {
      await savePurchase({
        domainName: domain.domainName,
        ...(registered && !clear ? { kind: 'registered' as const } : {}),
        ...(resolves ? { resolves } : {}),
        purchaseDate,
        amount: canonical,
        currency: canonical ? currency : null,
        // Clear removes the purchase only; the note belongs to the name.
        notes,
      });
      if (!clear) onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader
          title={recorded ? 'Edit purchase' : 'Record purchase'}
          names={[domain.domainName]}
        />
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            What you paid and when. Kept even if the name leaves the account.
          </p>
          <div
            className={
              justRegistered
                ? 'flex flex-col gap-3 rounded-md border bg-muted/40 p-3'
                : 'flex flex-col gap-4'
            }
          >
            {justRegistered && (
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={saving || filling}
                  onClick={() => void fillJustRegistered()}
                >
                  Just Registered
                </Button>
                <p className="text-xs text-muted-foreground">
                  Fills the purchase date, and the registration fee when this
                  registrar reports one. It does not save.
                </p>
                {feeNote && (
                  <p className="text-xs text-muted-foreground" role="status">
                    {feeNote}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="purchase-date">Purchase date</Label>
              <Input
                id="purchase-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="purchase-amount">Purchase amount</Label>
              <Input
                id="purchase-amount"
                inputMode="decimal"
                value={amount}
                placeholder={formatAmountInput('0', currency, formatId)}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Currency</Label>
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purchase-notes">Notes</Label>
            <Textarea
              id="purchase-notes"
              className={notesTextareaClass}
              value={notes}
              maxLength={NOTES_MAX}
              aria-describedby={
                notesNearLimit(notes.length)
                  ? 'purchase-notes-limit'
                  : undefined
              }
              onChange={(e) => setNotes(e.target.value)}
            />
            <NotesLimit notes={notes} id="purchase-notes-limit" />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        {confirmClear ? (
          <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm">
              Remove the purchase date and amount for{' '}
              <span className="font-mono font-medium">{domain.domainName}</span>
              ? The notes stay.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={saving}
                onClick={() => void save(true)}
              >
                Clear
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            {/* Clear only when there's a purchase to clear. Answering an
                arrival starts a new holding: Clear would delete the previous
                purchase instead. */}
            {recorded && !resolves && (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                disabled={saving || filling}
                onClick={() => setConfirmClear(true)}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={saving || filling}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || filling}
              onClick={() => void save(false)}
            >
              {recorded ? 'Save' : 'Record purchase'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
