import { useState } from 'react';
import { toast } from 'sonner';
import type { OwnershipItem } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { ActionDialog, DateField, todayInput } from './ActionDialog';

// The ownership actions, for one name or many. Each is one write however
// many names it covers. Pass each name's open alert as `resolves` so the
// action closes it.

const count = (n: number) => `${n} domain${n === 1 ? '' : 's'}`;
const who = (items: { domainName: string }[]) =>
  items.length === 1 ? items[0].domainName : count(items.length);

/**
 * Mark as Sold with no price, for several names at once. (One name gets the
 * sale dialog, which takes the price.)
 */
export function MarkSoldDialog({
  items,
  onDone,
  onClose,
}: {
  items: OwnershipItem[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const markSold = useAppStore((s) => s.markSold);
  const [date, setDate] = useState(todayInput);
  return (
    <ActionDialog
      title="Mark as Sold"
      names={items.map((i) => i.domainName)}
      description="Records each sale, dated as below. A name still in one of your accounts stays in Owned as Sold until the buyer takes it. Add each price later from its row. Nothing changes at the registrar."
      actionLabel="Mark as Sold"
      onConfirm={async () => {
        await markSold(items, date);
        toast.success(`Marked ${who(items)} as Sold`);
        onDone?.();
      }}
      onClose={onClose}
    >
      <DateField
        id="mark-sold-date"
        label="Sale date"
        value={date}
        onChange={setDate}
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
