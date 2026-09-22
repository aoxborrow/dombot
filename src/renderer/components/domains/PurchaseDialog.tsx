import { useState } from 'react';
import type { Domain } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  parsePurchaseDate,
  purchaseKey,
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

/**
 * Edit the purchase date, amount, and notes for one domain. The amount is
 * typed in the number format from Settings. An empty form deletes the record.
 */
export function PurchaseDialog({
  domain,
  onClose,
}: {
  domain: Domain;
  onClose: () => void;
}) {
  const purchases = useAppStore((s) => s.purchases);
  const settings = useAppStore((s) => s.settings);
  const savePurchase = useAppStore((s) => s.savePurchase);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  const existing = purchases[purchaseKey(domain.domainName)];

  const [date, setDate] = useState(existing?.purchaseDate ?? '');
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
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

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
        purchaseDate,
        amount: canonical,
        currency: canonical ? currency : null,
        notes: clear ? '' : notes,
      });
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
            Purchase date, amount, and notes for this name. Kept even if it
            leaves the account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-2">
            <Label>Currency</Label>
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purchase-notes">Notes</Label>
            <Textarea
              id="purchase-notes"
              value={notes}
              maxLength={4000}
              onChange={(e) => setNotes(e.target.value)}
            />
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
              Remove the purchase date, amount, and notes for{' '}
              <span className="font-mono font-medium">{domain.domainName}</span>
              ?
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
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void save(false)}
            >
              Save
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
