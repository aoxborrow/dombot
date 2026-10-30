import { useMemo } from 'react';
import { toAscii } from '../../shared/domain-name';
import { localDay } from '../../shared/domain-events';
import { buildSaleRecords, type SaleRecord } from '../../shared/sales';
import { useAppStore } from '../store/app';

/**
 * Every sale record (src/shared/sales.ts) from what the store holds: the
 * event log, market sales, and the names the registrar accounts hold now.
 */
export function useSaleRecords(): SaleRecord[] {
  const events = useAppStore((s) => s.domainEvents);
  const marketSales = useAppStore((s) => s.marketSales);
  const portfolio = useAppStore((s) => s.portfolio);
  return useMemo(
    () =>
      buildSaleRecords({
        events,
        marketSales,
        held: new Set(
          portfolio
            .filter((d) => !d.departed && d.source !== 'imported')
            .map((d) => toAscii(d.domainName)),
        ),
        today: localDay(),
      }),
    [events, marketSales, portfolio],
  );
}
