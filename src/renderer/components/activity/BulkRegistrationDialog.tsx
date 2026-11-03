import { useEffect, useState } from 'react';
import { toUnicode } from '../../../shared/domain-name';
import type { Domain, DomainEvent } from '../../../shared/ipc';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  parseLocalizedAmount,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import {
  feeError,
  registrationDay,
  registrationFee,
  type RegistrationFee,
} from '../../lib/registration';
import { ActionDialog } from '../actions/ActionDialog';
import { NameAmounts } from '../actions/NameAmounts';

/** A fee being filled in: what's typed, in which currency, and why it's blank. */
interface FeeInput {
  amount: string;
  currency: string;
  note?: string;
}

/**
 * Record registration for several arrivals: each name's registrar fee, looked
 * up when the dialog opens (one quote call per name, in turn) and filled into
 * its own amount, which can be changed, like the one-name dialog's fee. A fee
 * left blank skips that name, which stays in Needs review. Each is saved on
 * the day the name was created; `onSaved` gets the arrivals answered.
 */
export function BulkRegistrationDialog({
  events,
  domainOf,
  onSaved,
  onClose,
}: {
  events: DomainEvent[];
  /** The name each arrival is about. */
  domainOf: (e: DomainEvent) => Domain;
  onSaved: (answered: string[], skipped: number) => void;
  onClose: () => void;
}) {
  const registrars = useAppStore((s) => s.registrars);
  const savePurchase = useAppStore((s) => s.savePurchase);
  const purchases = useAppStore((s) => s.purchases);
  const settings = useAppStore((s) => s.settings);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;
  // Each arrival with its name, fixed for the dialog's life.
  const [targets] = useState(() =>
    events.map((event) => ({ event, domain: domainOf(event) })),
  );
  const [fees, setFees] = useState<Record<string, FeeInput>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const { event, domain } of targets) {
        let fee: RegistrationFee;
        try {
          fee = await registrationFee(domain, registrars);
        } catch (err) {
          fee = { note: `DomBot couldn't get the fee (${feeError(err)}).` };
        }
        if (cancelled) return;
        const input: FeeInput =
          'note' in fee
            ? { amount: '', currency: preferred, note: fee.note }
            : {
                amount: formatAmountInput(fee.amount, fee.currency, formatId),
                currency: fee.currency,
              };
        setFees((current) => ({ ...current, [event.id]: input }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Look the fees up once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const looking = targets.filter((t) => !fees[t.event.id]).length;
  const edit = (key: string, change: Partial<FeeInput>) =>
    setFees((current) => ({
      ...current,
      [key]: { ...current[key], ...change },
    }));

  async function record() {
    // Check every amount before saving any.
    const priced: {
      event: DomainEvent;
      domain: Domain;
      amount: string;
      currency: string;
    }[] = [];
    for (const { event, domain } of targets) {
      const fee = fees[event.id];
      let amount: string | null;
      try {
        amount = parseLocalizedAmount(fee.amount, fee.currency, formatId);
      } catch (err) {
        throw new Error(
          `${toUnicode(event.domain)}: ${err instanceof Error ? err.message : 'check the fee.'}`,
        );
      }
      if (amount)
        priced.push({ event, domain, amount, currency: fee.currency });
    }
    const answered: string[] = [];
    for (const { event, domain, amount, currency } of priced) {
      await savePurchase({
        domainName: domain.domainName,
        kind: 'registered',
        resolves: event.id,
        purchaseDate: registrationDay(domain.createdDate),
        amount,
        currency,
        // The note belongs to the name: keep it.
        notes: purchases[event.domain]?.notes ?? '',
      });
      answered.push(event.id);
    }
    onSaved(answered, targets.length - answered.length);
  }

  return (
    <ActionDialog
      title="Record registration"
      names={targets.map((t) => toUnicode(t.event.domain))}
      description="Records each as a registration on the day it was created, at the fee below: its registrar’s, when DomBot could get one. A name left blank is skipped and stays in Needs review. Nothing changes at the registrar."
      actionLabel={
        looking > 0
          ? `Looking up fees… ${targets.length - looking} of ${targets.length}`
          : 'Record registration'
      }
      disabled={looking > 0}
      onConfirm={record}
      onClose={onClose}
    >
      <NameAmounts
        id="bulk-registration-fees"
        label="Registration Fees"
        placeholder="Skip"
        rows={targets.map(({ event, domain }) => {
          const fee = fees[event.id];
          return {
            key: event.id,
            name: toUnicode(event.domain),
            detail: `Created ${registrationDay(domain.createdDate)}`,
            amount: fee?.amount ?? '',
            currency: fee?.currency ?? preferred,
            loading: !fee,
            note: fee?.note,
          };
        })}
        onAmount={(key, amount) => edit(key, { amount })}
        onCurrency={(key, currency) => edit(key, { currency })}
      />
    </ActionDialog>
  );
}
