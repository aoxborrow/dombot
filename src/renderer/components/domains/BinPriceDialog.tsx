import { useState, type ReactNode } from 'react';
import { sameBinPrice } from '../../../shared/bin-prices';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  parseLocalizedAmount,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ActionHeader } from '../actions/ActionDialog';
import { CurrencyPicker } from './CurrencyPicker';
import { MoneyInput } from './MoneyInput';

/**
 * Set the asking price, minimum offer, and floor for one name or a selection
 * (docs/domain-import-export.md, "Asking price"). Amounts are typed in the
 * number format from Settings; all three blank clears the price. A selection
 * opens with the price they share, or blank when they differ.
 */
export function BinPriceDialog({
  domains,
  onClose,
}: {
  domains: Domain[];
  onClose: () => void;
}) {
  const binPrices = useAppStore((s) => s.binPrices);
  const settings = useAppStore((s) => s.settings);
  const saveBinPrices = useAppStore((s) => s.saveBinPrices);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const names = domains.map((d) => d.domainName);
  const records = domains.map((d) => binPrices[toAscii(d.domainName)]);
  const shared = records.every((r) => sameBinPrice(r, records[0]))
    ? records[0]
    : undefined;
  const anyPriced = records.some(Boolean);
  const mixed = domains.length > 1 && !shared && anyPriced;

  const [currency, setCurrency] = useState(shared?.currency ?? preferred);
  // Prices are whole amounts, typed as plain digits.
  const shown = (value: string | null | undefined) =>
    value && shared ? String(Math.round(Number(value))) : '';
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
    // A mixed selection opens blank, so a blank Save there would clear prices
    // the names already have. Clearing them takes the Clear button.
    if (
      !clear &&
      mixed &&
      !amount.trim() &&
      !minOffer.trim() &&
      !floor.trim()
    ) {
      setError('Type a BIN price, or use Clear to remove them all.');
      return;
    }
    if (!clear) {
      try {
        fields = {
          amount: parseLocalizedAmount(amount, currency, formatId, 'BIN price'),
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
      await saveBinPrices(
        names.map((domainName) => ({ domainName, ...fields, currency })),
      );
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not save.';
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, ''));
      setSaving(false);
    }
  }

  const placeholder = '0';

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader title="Pricing" names={names} />
        <div className="flex flex-col gap-4">
          {mixed && (
            <p className="text-sm text-muted-foreground">
              These names have different prices. Saving gives them all the price
              below.
            </p>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <PriceField id="bin-price" label="BIN price" help={BIN_HELP.amount}>
              <MoneyInput
                whole
                id="bin-price"
                currency={currency}
                value={amount}
                placeholder={placeholder}
                onChange={(e) => setAmount(e.target.value)}
              />
            </PriceField>
            <PriceField label="Currency" help="For all three prices.">
              <CurrencyPicker compact value={currency} onChange={setCurrency} />
            </PriceField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PriceField
              id="bin-min-offer"
              label="Minimum offer"
              help={BIN_HELP.minOffer}
            >
              <MoneyInput
                whole
                id="bin-min-offer"
                currency={currency}
                value={minOffer}
                placeholder="Optional"
                onChange={(e) => setMinOffer(e.target.value)}
              />
            </PriceField>
            <PriceField
              id="bin-floor"
              label="Floor price"
              help={BIN_HELP.floor}
            >
              <MoneyInput
                whole
                id="bin-floor"
                currency={currency}
                value={floor}
                placeholder="Optional"
                onChange={(e) => setFloor(e.target.value)}
              />
            </PriceField>
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

/** The help line under each price's label, here and in Import. */
export const BIN_HELP = {
  amount: 'The "Buy it now" price.',
  minOffer: 'The lowest offer you’ll consider.',
  floor: 'The lowest price you’d accept.',
} as const;

/** A label, its one line of help, then the input. */
function PriceField({
  id,
  label,
  help,
  children,
}: {
  id?: string;
  label: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <p className="-mt-0.5 text-xs text-muted-foreground">{help}</p>
      {children}
    </div>
  );
}
