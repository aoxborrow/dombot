import { useMemo } from 'react';
import { useAppStore } from '../store/app';
import { reviewItems } from './activity';
import { summarize } from './renewals';

export interface TabMetric {
  /** Short display value for the tab's pill, e.g. "1,050" or "$4.2k". */
  value: string;
  /** Longer form for the tooltip. */
  title: string;
  /** Tinted red when the number is a problem count (Settings sync issues). */
  alert?: boolean;
}

/** Compact whole-dollar USD: "$820", "$4.2k", "$12k". */
function usdCompact(n: number): string {
  if (n < 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  const k = n / 1000;
  return `$${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

export interface TabMetrics {
  domains: TabMetric | null;
  renewals: TabMetric | null;
  activity: TabMetric | null;
  settings: TabMetric | null;
}

/**
 * The headline number each top-level tab shows in its pill: Domains → portfolio
 * size, Renewals → known annual renewal spend, Activity → alerts that need
 * review, Settings → accounts whose last sync failed (Activity and Settings
 * only when there are any). `null` hides the pill.
 */
export function useTabMetrics(): TabMetrics {
  const portfolio = useAppStore((s) => s.portfolio);
  const pricing = useAppStore((s) => s.pricing);
  const registrars = useAppStore((s) => s.registrars);
  const events = useAppStore((s) => s.domainEvents);

  return useMemo(() => {
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
            value: usdCompact(summary.yearly),
            title: `$${Math.round(summary.yearly).toLocaleString('en-US')} per year in renewals (${summary.priced} of ${summary.total} priced)`,
          }
        : null;

    // The same alerts as the header bell, without its sync errors (those
    // count on Settings).
    const open = reviewItems(events).length;
    const activity =
      open > 0
        ? {
            value: open.toLocaleString('en-US'),
            title: `${open.toLocaleString('en-US')} need${open === 1 ? 's' : ''} review`,
          }
        : null;

    // Enabled accounts, for the Settings sync-issue count.
    const configured = (registrars ?? []).filter(
      (r) => r.configured && r.enabled,
    );
    const issues = configured.filter((r) => r.sync.lastError != null).length;
    const settings =
      issues > 0
        ? {
            value: String(issues),
            title: `${issues} account${issues === 1 ? '' : 's'} failed to sync`,
            alert: true,
          }
        : null;

    return { domains, renewals, activity, settings };
  }, [portfolio, pricing, registrars, events]);
}
