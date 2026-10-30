import { useMemo } from 'react';
import { toAscii } from '../../shared/domain-name';
import { localDay } from '../../shared/domain-events';
import type { MarketInfo } from '../../shared/markets';
import {
  buildSaleRecords,
  type SaleRecord,
  type SaleSource,
} from '../../shared/sales';
import { useAppStore } from '../store/app';

/**
 * Every sale record (src/shared/sales.ts) from what the store holds: the
 * event log, market sales, the names the registrar accounts hold now, and
 * the exchange rates (a cost paid in another currency than the sale's).
 */
export function useSaleRecords(): SaleRecord[] {
  const events = useAppStore((s) => s.domainEvents);
  const marketSales = useAppStore((s) => s.marketSales);
  const portfolio = useAppStore((s) => s.portfolio);
  const fx = useAppStore((s) => s.exchangeRates);
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
        holders: new Map(
          portfolio
            .filter((d) => d.source !== 'imported' && d.accountId)
            .map((d) => [toAscii(d.domainName), d.accountId!]),
        ),
        today: localDay(),
        fx,
      }),
    [events, marketSales, portfolio, fx],
  );
}

const SOURCE_LABEL: Record<'market' | 'private' | 'imported', string> = {
  market: 'Market',
  private: 'Private',
  imported: 'Imported',
};

/** "Afternic", or Private / Imported for sales you recorded. */
export function saleSourceLabel(
  source: SaleSource,
  catalog: readonly MarketInfo[],
): string {
  if (source in SOURCE_LABEL)
    return SOURCE_LABEL[source as keyof typeof SOURCE_LABEL];
  return catalog.find((m) => m.id === source)?.name ?? source;
}

/** What a market sale waits on, in a few words. */
export const SALE_STEP_LABEL: Record<
  NonNullable<SaleRecord['step']>,
  string
> = {
  auth_code: 'Needs the auth code',
  transfer: 'Waiting on the transfer',
  payee_details: 'Needs payee details',
};

/** A record's status in a word or two. */
export function saleStatusLabel(r: SaleRecord): string {
  if (r.status === 'completed')
    return r.awaitingTransfer ? 'Awaiting transfer' : 'Completed';
  if (r.status === 'cancelled') return 'Cancelled';
  if (r.step) return SALE_STEP_LABEL[r.step];
  return 'In progress';
}

/** Still under way at the market. */
export const isUnderWay = (r: SaleRecord) =>
  r.status === 'in_progress' || r.status === 'unknown';

/**
 * Not finished: under way at the market, or sold and the buyer hasn't taken
 * the name yet. The Sales tab's Pending view and pill; pinned to the top.
 */
export const isPending = (r: SaleRecord) => isUnderWay(r) || r.awaitingTransfer;
