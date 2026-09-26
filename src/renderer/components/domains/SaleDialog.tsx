import { useState } from 'react';
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
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
 * Sale date, sale amount, and the shared notes for one name.
 * `edit` updates a name that is already Sold. `mark` files it in Sold only
 * when the user saves. Closing without that button leaves the name where it was.
 */
export function SaleDialog({
  domain,
  mode = 'edit',
  step,
  onSaved,
  onClose,
}: {
  domain: Domain;
  mode?: 'edit' | 'mark';
  /** 1-based place in a bulk Mark as Sold run. */
  step?: { current: number; total: number };
  /** Runs after the sale is stored. The caller files the folder on `mark`. */
  onSaved?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const purchases = useAppStore((s) => s.purchases);
  const settings = useAppStore((s) => s.settings);
  const saveSale = useAppStore((s) => s.saveSale);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  const existing = purchases[toAscii(domain.domainName)];

  const [date, setDate] = useState(existing?.saleDate ?? '');
  const [amount, setAmount] = useState(
    existing?.saleAmount
      ? formatAmountInput(
          existing.saleAmount,
          existing.saleCurrency ?? preferred,
          formatId,
        )
      : '',
  );
  const [currency, setCurrency] = useState(
    existing?.saleCurrency ?? existing?.currency ?? preferred,
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    let saleDate: string | null = null;
    let canonical: string | null = null;
    try {
      saleDate = parsePurchaseDate(date, 'Sale date');
      canonical = parseLocalizedAmount(amount, currency, formatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the amount.');
      return;
    }
    setSaving(true);
    try {
      await saveSale({
        domainName: domain.domainName,
        saleDate,
        amount: canonical,
        currency: canonical ? currency : null,
        notes,
      });
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">{domain.domainName}</DialogTitle>
          <DialogDescription>
            {mode === 'mark'
              ? `Add the sale date, amount, and notes. Mark as Sold files this name in Sold, under History. The registrar account is not changed.${
                  step && step.total > 1
                    ? ` ${step.current} of ${step.total}.`
                    : ''
                }`
              : 'This name is marked Sold. Add what you sold it for, the date, and any notes. Notes are the same notes kept for this name.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sale-date">Sale date</Label>
              <Input
                id="sale-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sale-amount">Sale amount</Label>
              <Input
                id="sale-amount"
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
            <Label htmlFor="sale-notes">Notes</Label>
            <Textarea
              id="sale-notes"
              className={notesTextareaClass}
              value={notes}
              maxLength={NOTES_MAX}
              aria-describedby={
                notesNearLimit(notes.length) ? 'sale-notes-limit' : undefined
              }
              onChange={(e) => setNotes(e.target.value)}
            />
            <NotesLimit notes={notes} id="sale-notes-limit" />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {mode === 'mark' ? 'Mark as Sold' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
