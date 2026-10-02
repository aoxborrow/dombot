import { useState } from 'react';
import { sameAskingPrice } from '../../../shared/asking-prices';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ActionHeader } from '../actions/ActionDialog';
import { CurrencyPicker } from './CurrencyPicker';

/**
 * Set the asking price, minimum offer, and floor for one name or a selection
 * (docs/domain-import-export.md, "Asking price"). Amounts are typed in the
 * number format from Settings; all three blank clears the price. A selection
 * opens with the price they share, or blank when they differ.
 */
export function AskingPriceDialog({
  domains,
  onClose,
}: {
  domains: Domain[];
  onClose: () => void;
}) {
  const askingPrices = useAppStore((s) => s.askingPrices);
  const settings = useAppStore((s) => s.settings);
  const saveAskingPrices = useAppStore((s) => s.saveAskingPrices);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const names = domains.map((d) => d.domainName);
  const records = domains.map((d) => askingPrices[toAscii(d.domainName)]);
  const shared = records.every((r) => sameAskingPrice(r, records[0]))
    ? records[0]
    : undefined;
  const anyPriced = records.some(Boolean);

  const [currency, setCurrency] = useState(shared?.currency ?? preferred);
  const shown = (value: string | null | undefined) =>
    value && shared ? formatAmountInput(value, shared.currency, formatId) : '';
  const [amount, setAmount] = useState(shown(shared?.amount));
  const [minOffer, setMinOffer] = useState(shown(shared?.minOffer));
  const [floor, setFloor] = useState(shown(shared?.floor));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(clear: boolean) {
    setError(null);
    let fields = { amount: null, minOffer: null, floor: null } as {
      amount: string | null;
      minOffer: string | null;
      floor: string | null;
    };
    if (!clear) {
      try {
        fields = {
          amount: parseLocalizedAmount(
            amount,
            currency,
            formatId,
            'Asking price',
          ),
          minOffer: parseLocalizedAmount(
            minOffer,
            currency,
            formatId,
            'Minimum offer',
          ),
          floor: parseLocalizedAmount(floor, currency, formatId, 'Floor price'),
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Check the amounts.');
        return;
      }
    }
    setSaving(true);
    try {
      await saveAskingPrices(
        names.map((domainName) => ({ domainName, ...fields, currency })),
      );
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not save.';
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, ''));
      setSaving(false);
    }
  }

  const placeholder = formatAmountInput('0', currency, formatId);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader title="Asking price" names={names} />
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {domains.length > 1 && !shared && anyPriced
              ? 'These names have different prices. Saving gives them all the price below.'
              : 'What you would sell for. It isn’t listed anywhere.'}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="asking-amount">Asking price</Label>
            <Input
              id="asking-amount"
              inputMode="decimal"
              value={amount}
              placeholder={placeholder}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="asking-min-offer">Minimum offer</Label>
              <Input
                id="asking-min-offer"
                inputMode="decimal"
                value={minOffer}
                placeholder="Optional"
                onChange={(e) => setMinOffer(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="asking-floor">Floor price</Label>
              <Input
                id="asking-floor"
                inputMode="decimal"
                value={floor}
                placeholder="Optional"
                onChange={(e) => setFloor(e.target.value)}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            The minimum offer is the lowest offer you’ll consider. The floor is
            the lowest price you’d accept, and is never shown to buyers.
          </p>
          <div className="flex flex-col gap-2">
            <Label>Currency</Label>
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {anyPriced && (
            <Button
              type="button"
              variant="outline"
              className="sm:mr-auto"
              disabled={saving}
              onClick={() => void save(true)}
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
            disabled={saving}
            onClick={() => void save(false)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
