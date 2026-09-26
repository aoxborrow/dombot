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
 * Sale date, sale amount, and the shared notes for one name.
 * `edit` updates a name that is already Sold. `mark` files it in Sold only
 * when the user saves. Closing without that button leaves the name where it was.
 */
export function SaleDialog({
  domain,
  mode = 'edit',
  resolves,
  onSaved,
  onClose,
}: {
  domain: Domain;
  mode?: 'edit' | 'mark';
  /** The "left your accounts" alert this sale answers, if any. */
  resolves?: string;
  /** Runs after the sale is stored. */
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

  // A new sale starts dated today; editing one keeps what's stored.
  const [date, setDate] = useState(
    mode === 'mark' ? todayInput : (existing?.saleDate ?? ''),
  );
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
        ...(mode === 'mark' ? { mark: true } : {}),
        ...(resolves ? { resolves } : {}),
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
        <ActionHeader
          title={mode === 'mark' ? 'Mark as Sold' : 'Edit sale'}
          names={[domain.domainName]}
        />
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {mode === 'mark'
              ? 'Moves to Archive as Sold. Nothing changes at the registrar.'
              : 'What you sold it for and when.'}
          </p>
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
