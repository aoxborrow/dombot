import { useMemo } from 'react';
import { useAppStore } from '../store/app';
import { notifications } from '../../shared/notifications';
import { compactMoney, leavesOut, summarize, wholeMoney } from './renewals';
import { DEFAULT_CURRENCY } from '../../shared/money';
import { importedRows } from '../../shared/imported-domains';
import { ownedAndRenewing } from '../../shared/ownership';
import { isPending, useSaleRecords } from './sales';

export interface TabMetric {
  /** Short display value for the tab's pill, e.g. "1,050" or "$4.2k". */
  value: string;
  /** Longer form for the tooltip. */
  title: string;
  /** Tinted red when the number is a problem count. */
  alert?: boolean;
}

export interface TabMetrics {
  domains: TabMetric | null;
  renewals: TabMetric | null;
  sales: TabMetric | null;
  activity: TabMetric | null;
}

/**
 * The headline number each top-level tab shows in its pill: Domains → the
 * names in Owned, Renewals → known annual renewal spend, Sales → pending sales,
 * Activity → alerts that need review (those two only when there are any). Settings has none: sync failures show in
 * the bell and the status bar. `null` hides the pill.
 */
export function useTabMetrics(): TabMetrics {
  const synced = useAppStore((s) => s.portfolio);
  const importedDomains = useAppStore((s) => s.importedDomains);
  const pricing = useAppStore((s) => s.pricing);
  const events = useAppStore((s) => s.domainEvents);
  const registrationLookups = useAppStore((s) => s.registrationLookups);
  const currency = useAppStore(
    (s) => s.settings?.preferredCurrency ?? DEFAULT_CURRENCY,
  );
  const fx = useAppStore((s) => s.exchangeRates);
  const saleRecords = useSaleRecords();

  return useMemo(() => {
    // The pages' own counts (docs/owned-and-archive.md).
    const { owned: portfolio, renewing } = ownedAndRenewing(
      [...synced, ...importedRows(importedDomains, synced)],
      events,
      registrationLookups,
    );
    const n = portfolio.length.toLocaleString('en-US');
    const domains =
      portfolio.length > 0
        ? {
            value: n,
            title: `${n} domain${portfolio.length === 1 ? '' : 's'}`,
          }
        : null;

    const summary = summarize(renewing, pricing, currency, fx);
    const leftOut = leavesOut(summary.leftOut);
    const renewals =
      summary.priced > 0
        ? {
            value: compactMoney(summary.yearly, summary.currency),
            title: `${wholeMoney(summary.yearly, summary.currency)} per year in renewals (${summary.priced} of ${summary.total} priced)${leftOut ? `. ${leftOut}.` : ''}`,
          }
        : null;

    // The same alerts as the header bell, without its sync errors.
    const open = notifications(events, []).length;
    const activity =
      open > 0
        ? {
            value: open.toLocaleString('en-US'),
            title: `${open.toLocaleString('en-US')} new`,
          }
        : null;

    // Not the bell's sale alerts: every sale that hasn't finished, whether
    // it waits on you, the buyer or the market (the Sales Pending view).
    const pending = saleRecords.filter(isPending).length;
    const sales =
      pending > 0
        ? {
            value: pending.toLocaleString('en-US'),
            title: `${pending.toLocaleString('en-US')} sale${pending === 1 ? '' : 's'} pending`,
          }
        : null;

    return { domains, renewals, sales, activity };
  }, [
    synced,
    importedDomains,
    pricing,
    events,
    registrationLookups,
    currency,
    fx,
    saleRecords,
  ]);
}
