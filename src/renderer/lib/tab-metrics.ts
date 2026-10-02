import { useMemo } from 'react';
import { useAppStore } from '../store/app';
import { notifications } from '../../shared/notifications';
import { summarize, wholeMoney } from './renewals';
import { manualRows } from '../../shared/manual-domains';

export interface TabMetric {
  /** Short display value for the tab's pill, e.g. "1,050" or "$4.2k". */
  value: string;
  /** Longer form for the tooltip. */
  title: string;
  /** Tinted red when the number is a problem count. */
  alert?: boolean;
}

/** Compact whole amount: "$820", "$4.2k", "€12k". */
function compactMoney(n: number, currency: string): string {
  if (n < 1000) return wholeMoney(n, currency);
  const k = n / 1000;
  const symbol = wholeMoney(0, currency).replace(/[\d\s.,]/g, '');
  return `${symbol}${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

export interface TabMetrics {
  domains: TabMetric | null;
  renewals: TabMetric | null;
  activity: TabMetric | null;
}

/**
 * The headline number each top-level tab shows in its pill: Domains → portfolio
 * size, Renewals → known annual renewal spend, Activity → alerts that need
 * review (only when there are any). Settings has none: sync failures show in
 * the bell and the status bar. `null` hides the pill.
 */
export function useTabMetrics(): TabMetrics {
  const synced = useAppStore((s) => s.portfolio);
  const manualDomains = useAppStore((s) => s.manualDomains);
  const pricing = useAppStore((s) => s.pricing);
  const events = useAppStore((s) => s.domainEvents);

  return useMemo(() => {
    const portfolio = [...synced, ...manualRows(manualDomains, synced)];
    const n = portfolio.length.toLocaleString('en-US');
    const domains =
      portfolio.length > 0
        ? {
            value: n,
            title: `${n} domain${portfolio.length === 1 ? '' : 's'}`,
          }
        : null;

    const summary = summarize(portfolio, pricing);
    const renewals =
      summary.priced > 0
        ? {
            value: compactMoney(summary.yearly, summary.currency),
            title: `${wholeMoney(summary.yearly, summary.currency)} per year in renewals (${summary.priced} of ${summary.total} priced)${summary.others.map((o) => `, plus ${wholeMoney(o.yearly, o.currency)}`).join('')}`,
          }
        : null;

    // The same alerts as the header bell, without its sync errors.
    const open = notifications(events, []).length;
    const activity =
      open > 0
        ? {
            value: open.toLocaleString('en-US'),
            title: `${open.toLocaleString('en-US')} need${open === 1 ? 's' : ''} review`,
          }
        : null;

    return { domains, renewals, activity };
  }, [synced, manualDomains, pricing, events]);
}
