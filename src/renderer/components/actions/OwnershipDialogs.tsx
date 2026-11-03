import { useState } from 'react';
import { toast } from 'sonner';
import { toAscii } from '../../../shared/domain-name';
import type { OwnershipItem } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  parseLocalizedAmount,
  parsePurchaseDate,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { CurrencyPicker } from '../domains/CurrencyPicker';
import { Label } from '@/components/ui/label';
import { ActionDialog, DateField, todayInput } from './ActionDialog';
import { NameAmounts } from './NameAmounts';

// The ownership actions, for one name or many. Each is one write however
// many names it covers. Pass each name's open alert as `resolves` so the
// action closes it.

const count = (n: number) => `${n} domain${n === 1 ? '' : 's'}`;
const who = (items: { domainName: string }[]) =>
  items.length === 1 ? items[0].domainName : count(items.length);

/**
 * Record sales for several names at once: one sale date and currency, and a
 * price for each name, like the one-name sale dialog's. A price can stay
 * blank and be added later from the name's row; those names are recorded in
 * one write, the priced ones one by one. (One name gets the sale dialog,
 * which also takes fees.)
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
  const [currency, setCurrency] = useState(
    settings?.preferredCurrency ?? DEFAULT_CURRENCY,
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  async function record() {
    const saleDate = parsePurchaseDate(date, 'Sale date');
    const priced: { item: OwnershipItem; amount: string }[] = [];
    const unpriced: OwnershipItem[] = [];
    for (const item of items) {
      let amount: string | null;
      try {
        amount = parseLocalizedAmount(
          amounts[item.domainName] ?? '',
          currency,
          formatId,
        );
      } catch (err) {
        throw new Error(
          `${item.domainName}: ${err instanceof Error ? err.message : 'check the amount.'}`,
        );
      }
      if (amount) priced.push({ item, amount });
      else unpriced.push(item);
    }
    if (unpriced.length > 0) await markSold(unpriced, saleDate);
    for (const { item, amount } of priced)
      await saveSale({
        mark: true,
        ...(item.resolves ? { resolves: item.resolves } : {}),
        domainName: item.domainName,
        saleDate,
        amount,
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
      title="Record sale"
      names={items.map((i) => i.domainName)}
      description="Records each sale, dated as below. A name still in one of your accounts stays in Owned as Sold until the buyer takes it. A price left blank can be added later from its row. Nothing changes at the registrar."
      actionLabel="Record sale"
      onConfirm={record}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <DateField
          id="bulk-sale-date"
          label="Sale Date"
          value={date}
          onChange={setDate}
        />
        <div className="flex flex-col gap-2">
          <Label>Currency</Label>
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </div>
      </div>
      <NameAmounts
        id="bulk-sale-amounts"
        label="Sale Amounts"
        placeholder="Later"
        rows={items.map((item) => ({
          key: item.domainName,
          name: item.domainName,
          amount: amounts[item.domainName] ?? '',
          currency,
        }))}
        onAmount={(key, amount) =>
          setAmounts((current) => ({ ...current, [key]: amount }))
        }
      />
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
