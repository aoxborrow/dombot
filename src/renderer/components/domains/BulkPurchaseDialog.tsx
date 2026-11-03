import { useState } from 'react';
import { toast } from 'sonner';
import { toAscii, toUnicode } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  parsePurchaseDate,
  type NumberFormatId,
} from '../../../shared/money';
import { registrationDay } from '../../lib/registration';
import { useAppStore } from '../../store/app';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ActionDialog, DateField, todayInput } from '../actions/ActionDialog';
import { MoneyInput } from './MoneyInput';
import type { AcquisitionSide } from './PurchaseDialog';

/** A name to record, and the arrival it answers, if any. */
export interface PurchaseTarget {
  domain: Domain;
  /** The arrival alert this answers: records a new holding and closes it. */
  resolves?: string;
  /** The day it arrived: the purchase side's date when all agree. */
  arrivedOn?: string;
}

/**
 * Record what you paid for several names at once, like the one-name dialog:
 * Registration (each dated the day it was created) or Purchase (one date),
 * at one amount for every name. Bulk is for names that cost the same (a
 * promo registration fee); a name priced differently is recorded from its
 * row. Pass only names with nothing paid on record, or arrivals
 * (`resolves`): it records new purchases, one by one. `onUndo` adds an Undo
 * to the toast for the arrivals answered.
 */
export function BulkPurchaseDialog({
  targets,
  side: openOn = 'purchase',
  onDone,
  onUndo,
  onClose,
}: {
  targets: PurchaseTarget[];
  side?: AcquisitionSide;
  /** After saving, with the arrivals answered. */
  onDone?: (answered: string[]) => void;
  onUndo?: (answered: string[]) => void;
  onClose: () => void;
}) {
  const savePurchase = useAppStore((s) => s.savePurchase);
  const purchases = useAppStore((s) => s.purchases);
  const settings = useAppStore((s) => s.settings);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const [side, setSide] = useState<AcquisitionSide>(openOn);
  // Arrivals that came in on one day start the purchase date there.
  const [date, setDate] = useState(() => {
    const days = new Set(targets.map((t) => t.arrivedOn));
    const [only] = days;
    return days.size === 1 && only ? only : todayInput();
  });
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(
    settings?.preferredCurrency ?? DEFAULT_CURRENCY,
  );
  const noun = side === 'registration' ? 'registration' : 'purchase';

  async function record() {
    // Check the date and amount before saving any.
    const purchaseDate =
      side === 'purchase'
        ? (parsePurchaseDate(date) ?? todayInput())
        : undefined;
    const paid = parseLocalizedAmount(
      amount,
      currency,
      formatId,
      side === 'registration' ? 'Registration fee' : 'Purchase price',
    );
    if (!paid) throw new Error('Type the amount you paid.');
    const answered: string[] = [];
    for (const { domain, resolves } of targets) {
      await savePurchase({
        domainName: domain.domainName,
        kind: side === 'registration' ? 'registered' : 'purchased',
        ...(resolves ? { resolves } : {}),
        purchaseDate: purchaseDate ?? registrationDay(domain.createdDate),
        amount: paid,
        currency,
        // The note belongs to the name: keep it.
        notes: purchases[toAscii(domain.domainName)]?.notes ?? '',
      });
      if (resolves) answered.push(resolves);
    }
    toast.success(
      targets.length === 1
        ? `Recorded the ${noun} of ${toUnicode(targets[0].domain.domainName)}`
        : `Recorded ${targets.length} ${noun}s`,
      onUndo && answered.length
        ? { action: { label: 'Undo', onClick: () => onUndo(answered) } }
        : undefined,
    );
    onDone?.(answered);
  }

  return (
    <ActionDialog
      title={`Record ${noun}`}
      names={targets.map((t) => toUnicode(t.domain.domainName))}
      actionLabel={`Record ${noun}`}
      disabled={!amount.trim()}
      // Start in the amount, not on the Registration | Purchase switch.
      focusId="bulk-purchase-amount"
      onConfirm={record}
      onClose={onClose}
    >
      <SegmentedControl
        aria-label="Registered or bought"
        className="w-full [&>button]:flex-1"
        value={side}
        onChange={setSide}
        options={[
          { value: 'registration', label: 'Registration' },
          { value: 'purchase', label: 'Purchase' },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        {side === 'registration'
          ? 'You registered them yourself: the fee you paid for each, dated the day it was created.'
          : 'You bought them from someone: what you paid for each, and when.'}
      </p>
      {side === 'purchase' && (
        <DateField
          id="bulk-purchase-date"
          label="Purchase Date"
          value={date}
          onChange={setDate}
        />
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="bulk-purchase-amount">
          {side === 'registration' ? 'Registration Fee' : 'Purchase Price'}
        </Label>
        <MoneyInput
          id="bulk-purchase-amount"
          currency={currency}
          onCurrencyChange={setCurrency}
          value={amount}
          placeholder={formatAmountInput('0', currency, formatId)}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
    </ActionDialog>
  );
}
