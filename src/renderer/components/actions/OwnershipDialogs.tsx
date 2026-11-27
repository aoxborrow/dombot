import { useState } from 'react';
import { toast } from 'sonner';
import { toAscii } from '../../../shared/domain-name';
import type { OwnershipItem } from '../../../shared/ipc';
import type { ManualArchiveReason } from '../../../shared/ownership';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  parsePurchaseDate,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { MoneyInput } from '../domains/MoneyInput';
import { Label } from '@/components/ui/label';
import { ActionDialog, DateField, todayInput } from './ActionDialog';

// The ownership actions, for one name or many. Each is one write however
// many names it covers. Pass each name's open alert as `resolves` so the
// action closes it.

const count = (n: number) => `${n} domain${n === 1 ? '' : 's'}`;
const who = (items: { domainName: string }[]) =>
  items.length === 1 ? items[0].domainName : count(items.length);

/**
 * Record sales for several names at once, at one date and one price: bulk is
 * for names sold at the same price, and a name sold for a different one is
 * recorded from its row. A blank price records the sales in one write, to be
 * priced later from each row; a price records them one by one. Pass only
 * names with no sale on record: a priced one would replace it. (One name
 * gets the sale dialog, which also takes fees.)
 */
export function BulkSaleDialog({
  items,
  onDone,
  onClose,
}: {
  items: OwnershipItem[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const markSold = useAppStore((s) => s.markSold);
  const saveSale = useAppStore((s) => s.saveSale);
  const purchases = useAppStore((s) => s.purchases);
  const settings = useAppStore((s) => s.settings);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const [date, setDate] = useState(todayInput);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(
    settings?.preferredCurrency ?? DEFAULT_CURRENCY,
  );

  async function record() {
    // A cleared date is today, for the priced and unpriced alike.
    const saleDate = parsePurchaseDate(date, 'Sale date') ?? todayInput();
    const price = parseLocalizedAmount(
      amount,
      currency,
      formatId,
      'Sale price',
    );
    if (!price) await markSold(items, saleDate);
    else
      for (const item of items)
        await saveSale({
          mark: true,
          ...(item.resolves ? { resolves: item.resolves } : {}),
          domainName: item.domainName,
          saleDate,
          amount: price,
          currency,
          // The note belongs to the name: keep it.
          notes: purchases[toAscii(item.domainName)]?.notes ?? '',
        });
    toast.success(
      items.length === 1
        ? `Recorded the sale of ${items[0].domainName}`
        : `Recorded ${items.length} sales`,
    );
    onDone?.();
  }

  return (
    <ActionDialog
      title="Mark as Sold"
      names={items.map((i) => i.domainName)}
      description="Records a sale for each name at the date and price below, and moves them to Archive as Sold. Nothing changes at the registrar."
      actionLabel="Mark as Sold"
      focusId="bulk-sale-price"
      onConfirm={record}
      onClose={onClose}
    >
      <DateField
        id="bulk-sale-date"
        label="Sale Date"
        value={date}
        onChange={setDate}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="bulk-sale-price">Sale Price</Label>
        <MoneyInput
          id="bulk-sale-price"
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

/**
 * Delete everything DomBot holds about names no connected account holds
 * (imported and Archive names). Pass only those.
 */
export function DeleteDomainsDialog({
  domains,
  onDone,
  onClose,
}: {
  domains: { domainName: string }[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const deleteDomains = useAppStore((s) => s.deleteDomains);
  return (
    <ActionDialog
      title="Delete"
      names={domains.map((d) => d.domainName)}
      description={`This removes everything DomBot holds about ${
        domains.length === 1 ? 'the name' : 'these names'
      }: purchases and sales, notes, activity, folder, and price. Nothing changes at any registrar.`}
      actionLabel="Delete"
      destructive
      onConfirm={async () => {
        await deleteDomains(domains.map((d) => d.domainName));
        toast.success(`Deleted ${who(domains)}`);
        onDone?.();
      }}
      onClose={onClose}
    />
  );
}

/**
 * Mark names dropped or archived, or move them back to Owned. Nothing
 * changes at the registrar: a name an account still lists stays listed
 * there until you let it go.
 */
export function ManualArchiveDialog({
  domains,
  reason,
  onDone,
  onClose,
}: {
  domains: { domainName: string }[];
  /** Null moves them back to Owned. */
  reason: ManualArchiveReason | null;
  onDone?: () => void;
  onClose: () => void;
}) {
  const setManualArchive = useAppStore((s) => s.setManualArchive);
  const title =
    reason === 'dropped'
      ? 'Mark as Dropped'
      : reason === 'archived'
        ? 'Archive'
        : 'Move back to Owned';
  const description =
    reason === null
      ? `Moves ${who(domains)} back to Owned. Nothing changes at the registrar.`
      : `Moves ${who(domains)} to Archive${
          reason === 'dropped' ? ' as Dropped' : ''
        }. Nothing changes at the registrar. A name an account still lists stays listed there until you let it go.`;
  return (
    <ActionDialog
      title={title}
      names={domains.map((d) => d.domainName)}
      description={description}
      actionLabel={title}
      onConfirm={async () => {
        await setManualArchive(
          domains.map((d) => d.domainName),
          reason,
        );
        toast.success(
          reason === null
            ? `Moved ${who(domains)} back to Owned`
            : reason === 'dropped'
              ? `Marked ${who(domains)} as dropped`
              : `Archived ${who(domains)}`,
        );
        onDone?.();
      }}
      onClose={onClose}
    />
  );
}
