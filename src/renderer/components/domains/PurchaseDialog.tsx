import { useEffect, useRef, useState } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  parsePurchaseDate,
  type NumberFormatId,
} from '../../../shared/money';
import {
  feeError,
  registrationDay,
  registrationFee,
} from '../../lib/registration';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ActionHeader, todayInput } from '../actions/ActionDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from './MoneyInput';
import {
  NOTES_MAX,
  NotesLimit,
  notesNearLimit,
  notesTextareaClass,
} from './NotesLimit';

/** Hand-registered (the registry fee) or bought from someone. */
export type AcquisitionSide = 'registration' | 'purchase';

const NOUN: Record<AcquisitionSide, string> = {
  registration: 'registration',
  purchase: 'purchase',
};

interface Form {
  date: string;
  amount: string;
  currency: string;
}

/**
 * Record what you paid for a name, and its notes: a registration (the day it
 * was created and the registrar's fee, filled in) or a purchase (the price
 * you paid someone). A Registration | Purchase switch picks which; each side
 * keeps its own fields. The amount is typed in the number format from
 * Settings. An empty form deletes the record.
 */
export function PurchaseDialog({
  domain,
  onClose,
  onSaved,
  side: openOn = 'purchase',
  note,
  resolves,
  arrivedOn,
}: {
  domain: Domain;
  onClose: () => void;
  /** Called after a successful Save, before the dialog closes. */
  onSaved?: () => void;
  /** The side it opens on; a record already saved opens on its own. */
  side?: AcquisitionSide;
  /** Why the fee isn't filled in (the one-click Record registration's). */
  note?: string;
  /** The arrival alert this answers: records a new purchase and closes it. */
  resolves?: string;
  /** The day the name arrived: the purchase side's date. */
  arrivedOn?: string;
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
  // the previous purchase, unless one was recorded since the name arrived (an
  // import): then it's that purchase, and saving edits it. The note belongs
  // to the name, so it still shows.
  const existing = resolves
    ? record?.acquisitionId && record.acquisitionId > resolves
      ? record
      : undefined
    : record;

  const recorded = !!(existing?.purchaseDate || existing?.amount);
  const savedSide: AcquisitionSide | null = recorded
    ? existing?.purchaseType === 'registered'
      ? 'registration'
      : 'purchase'
    : null;
  const [side, setSide] = useState<AcquisitionSide>(savedSide ?? openOn);
  const blank = (date: string): Form => ({
    date,
    amount: '',
    currency: preferred,
  });
  const [forms, setForms] = useState<Record<AcquisitionSide, Form>>(() => {
    const saved: Form | null =
      savedSide && existing
        ? {
            date: existing.purchaseDate || todayInput(),
            amount: existing.amount
              ? formatAmountInput(
                  existing.amount,
                  existing.currency ?? preferred,
                  formatId,
                )
              : '',
            currency: existing.currency ?? preferred,
          }
        : null;
    return {
      registration:
        savedSide === 'registration'
          ? saved!
          : blank(registrationDay(domain.createdDate)),
      purchase:
        savedSide === 'purchase' ? saved! : blank(arrivedOn ?? todayInput()),
    };
  });
  const form = forms[side];
  const setForm = (patch: Partial<Form>) =>
    setForms((all) => ({ ...all, [side]: { ...all[side], ...patch } }));
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [feeNote, setFeeNote] = useState<string | null>(note ?? null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // The registration side fills in the registrar's fee once, the first time
  // it shows with nothing saved there (and no note saying there's none).
  const [filling, setFilling] = useState(false);
  const askedFee = useRef(savedSide === 'registration' || !!note);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (side !== 'registration' || askedFee.current) return;
    askedFee.current = true;
    setFilling(true);
    registrationFee(domain, registrars)
      .then((fee) => {
        if (!mounted.current) return;
        if ('note' in fee) setFeeNote(fee.note);
        else
          setForms((all) =>
            // Not over anything typed while it looked.
            all.registration.amount
              ? all
              : {
                  ...all,
                  registration: {
                    ...all.registration,
                    amount: formatAmountInput(
                      fee.amount,
                      fee.currency,
                      formatId,
                    ),
                    currency: fee.currency,
                  },
                },
          );
      })
      .catch((err) => mounted.current && setError(feeError(err)))
      .finally(() => mounted.current && setFilling(false));
  }, [side, domain, registrars, formatId]);

  async function save(clear: boolean) {
    setError(null);
    let purchaseDate: string | null = null;
    let canonical: string | null = null;
    if (!clear) {
      try {
        purchaseDate = parsePurchaseDate(form.date);
        canonical = parseLocalizedAmount(form.amount, form.currency, formatId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Check the amount.');
        return;
      }
    }
    setSaving(true);
    try {
      await savePurchase({
        domainName: domain.domainName,
        ...(clear
          ? {}
          : {
              kind:
                side === 'registration'
                  ? ('registered' as const)
                  : ('purchased' as const),
            }),
        ...(resolves ? { resolves } : {}),
        purchaseDate,
        amount: canonical,
        currency: canonical ? form.currency : null,
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

  const noun = NOUN[side];
  const title = `${recorded ? 'Edit' : 'Record'} ${noun}`;
  const busy = saving || filling;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader
          title={title[0].toUpperCase() + title.slice(1)}
          names={[domain.domainName]}
        />
        <div className="flex flex-col gap-4">
          <SegmentedControl
            aria-label="Registered or bought"
            className="w-full [&>button]:flex-1"
            value={side}
            onChange={(next) => {
              setSide(next);
              setError(null);
            }}
            options={[
              { value: 'registration', label: 'Registration' },
              { value: 'purchase', label: 'Purchase' },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            {side === 'registration'
              ? 'You registered it yourself: the fee you paid and the day it was created.'
              : 'You bought it from someone: what you paid and when.'}{' '}
            Kept even if the name leaves the account.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purchase-date">
              {side === 'registration' ? 'Registration date' : 'Purchase date'}
            </Label>
            <Input
              id="purchase-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ date: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purchase-amount">
              {side === 'registration' ? 'Registration fee' : 'Purchase price'}
            </Label>
            <MoneyInput
              id="purchase-amount"
              currency={form.currency}
              onCurrencyChange={(currency) => setForm({ currency })}
              value={form.amount}
              placeholder={
                filling
                  ? 'Looking up the fee…'
                  : formatAmountInput('0', form.currency, formatId)
              }
              onChange={(e) => setForm({ amount: e.target.value })}
            />
            {side === 'registration' && feeNote && (
              <p className="text-xs text-muted-foreground" role="status">
                {feeNote} Type the amount you paid.
              </p>
            )}
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
              Remove the {NOUN[savedSide ?? side]} date and amount for{' '}
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
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void save(false)}
            >
              {recorded ? 'Save' : `Record ${noun}`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
