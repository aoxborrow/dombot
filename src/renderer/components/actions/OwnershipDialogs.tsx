import { useState } from 'react';
import { toast } from 'sonner';
import type { OwnershipItem } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { ActionDialog, DateField, todayInput } from './ActionDialog';

// The ownership actions, for one name or many (docs/activity-redesign.md,
// "Action dialogs"). Each is one write however many names it covers. Pass
// each name's open alert as `resolves` so the action closes it.

const count = (n: number) => `${n} domain${n === 1 ? '' : 's'}`;
const who = (items: { domainName: string }[]) =>
  items.length === 1 ? items[0].domainName : count(items.length);

/** Mark as Dropped (on a date, today by default), or Archive (now, without
 *  saying why: just a confirmation). */
export function DispositionDialog({
  type,
  items,
  onDone,
  onClose,
}: {
  type: 'dropped' | 'archived';
  items: OwnershipItem[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const setDispositions = useAppStore((s) => s.setDispositions);
  const [date, setDate] = useState(todayInput);
  const dropped = type === 'dropped';
  return (
    <ActionDialog
      title={dropped ? 'Mark as Dropped' : 'Archive'}
      names={items.map((i) => i.domainName)}
      description={
        dropped
          ? 'Moves to Archive as Dropped: you let it go. Nothing changes at the registrar.'
          : 'Moves to Archive without saying why. Nothing changes at the registrar.'
      }
      actionLabel={dropped ? 'Mark as Dropped' : 'Archive'}
      onConfirm={async () => {
        await setDispositions(items, type, dropped ? date : null);
        toast.success(
          dropped
            ? `Marked ${who(items)} as Dropped`
            : `Archived ${who(items)}`,
        );
        onDone?.();
      }}
      onClose={onClose}
    >
      {dropped && (
        <DateField id="disposition-date" value={date} onChange={setDate} />
      )}
    </ActionDialog>
  );
}

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
      description="Moves to Archive as Sold. Add each sale's price later from its row. Nothing changes at the registrar."
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
 * Move back to Owned: undoes Sold, Dropped, or Archived for names an account
 * still holds. A name gone from every account keeps its state, so it's
 * skipped.
 */
export function RestoreOwnedDialog({
  names,
  restorable: restorableNames,
  onDone,
  onClose,
}: {
  names: string[];
  /** Those of `names` that can go back: labeled by you, still in an account. */
  restorable: string[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const restoreOwned = useAppStore((s) => s.restoreOwned);
  const restorable = restorableNames.length;
  const skipped = names.length - restorable;
  return (
    <ActionDialog
      title="Move back to Owned"
      names={names}
      description={
        restorable === 0
          ? 'None of these is still in one of your accounts with a label to undo. A name that left your accounts stays Sold, Dropped, or Archived.'
          : `Undoes Sold, Dropped, or Archived${
              skipped > 0
                ? `. ${count(skipped)} ${skipped === 1 ? 'isn’t' : 'aren’t'} in any of your accounts and will stay in Archive.`
                : '.'
            }`
      }
      actionLabel="Move back to Owned"
      disabled={restorable === 0}
      onConfirm={async () => {
        await restoreOwned(restorableNames);
        toast.success(`Moved ${count(restorable)} back to Owned`);
        onDone?.();
      }}
      onClose={onClose}
    />
  );
}

/** Delete everything DomBot holds about each name. */
export function DeleteDomainsDialog({
  domains,
  onDone,
  onClose,
}: {
  domains: { domainName: string; departed?: boolean }[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const deleteDomains = useAppStore((s) => s.deleteDomains);
  const held = domains.some((d) => !d.departed);
  return (
    <ActionDialog
      title="Delete"
      names={domains.map((d) => d.domainName)}
      description={`This removes everything DomBot holds about ${
        domains.length === 1 ? 'the name' : 'these names'
      }: purchases and sales, notes, activity, folder, and price.${
        held
          ? ' A name a connected registrar still has stays in your list, with no history.'
          : ''
      }`}
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
