import { useMemo } from 'react';
import { useAppStore } from '../store/app';
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

/**
 * The headline number each top-level tab shows in its pill: Domains → portfolio
 * size, Renewals → known annual renewal spend, Settings → accounts whose last sync failed (only shown when
 * there are any). `null` hides the pill.
 */
export function useTabMetrics(): {
  domains: TabMetric | null;
  renewals: TabMetric | null;
  markets: TabMetric | null;
  sales: TabMetric | null;
  settings: TabMetric | null;
} {
  const portfolio = useAppStore((s) => s.portfolio);
  const pricing = useAppStore((s) => s.pricing);
  const registrars = useAppStore((s) => s.registrars);

  return useMemo(() => {
    const n = portfolio.length.toLocaleString('en-US');
    const domains =
      portfolio.length > 0 ? { value: n, title: `${n} domains` } : null;

    const summary = summarize(portfolio, pricing);
    const renewals =
      summary.priced > 0
        ? {
            value: usdCompact(summary.yearly),
            title: `$${Math.round(summary.yearly).toLocaleString('en-US')} per year in renewals (${summary.priced} of ${summary.total} priced)`,
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

    // Placeholder figures for the stub pages until they have real data.
    const markets = { value: '89%', title: 'Placeholder' };
    const sales = { value: '$35.7k', title: 'Placeholder' };

    return {
      domains,
      renewals,
      markets,
      sales,
      settings,
    };
  }, [portfolio, pricing, registrars]);
}
