import { expect, it } from 'vitest';
import type { DomainEvent } from '../../shared/domain-events';
import type { SalesDetails } from '../../shared/sales-details';
import {
  filterSales,
  groupedSales,
  openingCohort,
  saleRows,
  salesSummary,
} from './sales-analytics';

function event(
  id: string,
  type: DomainEvent['type'],
  date: string | null,
  amount: string | null = null,
  currency: DomainEvent['currency'] = 'USD',
  domain = 'example.com',
): DomainEvent {
  return {
    id,
    type,
    date,
    amount,
    currency,
    domain,
    source: 'user',
    createdAt: Date.parse(date ?? '2026-02-01'),
    updatedAt: null,
  };
}
const paid: SalesDetails = {
  currency: 'USD',
  marketplace: 'Atom',
  payment: 'paid',
  received: '1000',
  fees: '100',
  renewalCost: '20',
};
const purchase = event('01', 'purchased', '2025-01-01', '100');
const sale = event('02', 'sold', '2026-01-01', '1000');

it('calculates confirmed proceeds, profit, ROI and holding days from complete facts', () => {
  const rows = saleRows([sale, purchase], { details: { '02': paid } });
  expect(rows[0]).toMatchObject({
    gross: 1000,
    received: 1000,
    net: 900,
    profit: 780,
    investment: 120,
    holdingDays: 365,
  });
  expect(salesSummary(rows)).toMatchObject({
    count: 1,
    gross: 1000,
    average: 1000,
    profit: 780,
    roi: 650,
    profitCount: 1,
    holdingDays: 365,
  });
});
it('keeps unreviewed imports and missing costs unknown, and zero costs explicit', () => {
  expect(saleRows([purchase, sale], { details: {} })[0]).toMatchObject({
    received: null,
    net: null,
    profit: null,
  });
  expect(
    saleRows([purchase, sale], {
      details: { '02': { ...paid, renewalCost: null } },
    })[0].profit,
  ).toBeNull();
  expect(
    saleRows([purchase, sale], {
      details: { '02': { ...paid, fees: '0', renewalCost: '0' } },
    })[0].profit,
  ).toBe(900);
  expect(salesSummary(saleRows([sale], { details: {} })).roi).toBeNull();
});
it('counts partial installment receipts without booking realized profit', () => {
  const row = saleRows([purchase, sale], {
    details: {
      '02': { ...paid, payment: 'installments', received: '200', fees: '20' },
    },
  })[0];
  expect(row).toMatchObject({
    gross: 1000,
    received: 200,
    net: 180,
    profit: null,
  });
  expect(
    saleRows([purchase, sale], {
      details: { '02': { ...paid, received: '200' } },
    })[0].profit,
  ).toBeNull();
});
it('does not reuse purchase or renewal costs after a sale, and pairs buybacks correctly', () => {
  const events = [
    purchase,
    event('011', 'renewed', '2025-06-01', '20'),
    sale,
    event('03', 'purchased', '2026-02-01', '300'),
    event('04', 'sold', '2026-03-01', '1000'),
    event('05', 'sold', '2026-04-01', '1000'),
  ];
  const rows = saleRows(events, {
    details: { '02': paid, '04': paid, '05': paid },
  });
  expect(rows.map((r) => r.profit)).toEqual([780, 580, null]);
  expect(rows.map((r) => r.recordedRenewals)).toEqual([20, 0, 0]);
  expect(rows[1].holdingDays).toBe(28);
});
it('keeps currencies separate and ignores stale financials after a currency change', () => {
  const euro = event('03', 'sold', '2026-01-02', '200', 'EUR', 'euro.com');
  const rows = saleRows([purchase, sale, euro], {
    details: { '02': paid, '03': paid },
  });
  expect(rows[1].received).toBeNull();
  expect(groupedSales(rows, 'month').map((r) => [r.currency, r.gross])).toEqual(
    [
      ['USD', 1000],
      ['EUR', 200],
    ],
  );
  const foreignPurchase = { ...purchase, currency: 'EUR' as const };
  expect(
    saleRows([foreignPurchase, sale], { details: { '02': paid } })[0].profit,
  ).toBeNull();
});
it('filters date bounds inclusively and excludes undated sales only with date bounds', () => {
  const rows = saleRows([sale, event('03', 'sold', null, '200')], {
    details: {},
  });
  expect(filterSales(rows, { from: '', to: '', currency: 'all' })).toHaveLength(
    2,
  );
  expect(
    filterSales(rows, {
      from: '2026-01-01',
      to: '2026-01-01',
      currency: 'USD',
    }),
  ).toHaveLength(1);
  expect(
    filterSales(rows, { from: '2026-01-02', to: '', currency: 'all' }),
  ).toHaveLength(0);
});
it('uses the registrar at sale and current folder without later account moves changing history', () => {
  const rows = saleRows(
    [
      { ...purchase, accountId: 'first' },
      sale,
      { ...event('03', 'moved', '2026-02-01'), toAccountId: 'second' },
    ],
    {
      details: { '02': paid },
      registrars: { first: 'GoDaddy', second: 'Dynadot' },
      folders: { 'example.com': 'Atom Premium' },
    },
  );
  expect(rows[0]).toMatchObject({
    registrar: 'GoDaddy',
    folder: 'Atom Premium',
    marketplace: 'Atom',
    tld: 'com',
  });
});
it('calculates opening cohort sell-through, excluding new purchases and deduplicating resales', () => {
  const events = [
    purchase,
    event('a', 'purchased', '2025-01-01', '10', 'USD', 'keep.com'),
    sale,
    event('03', 'purchased', '2026-02-01', '10', 'USD', 'new.com'),
    event('04', 'sold', '2026-03-01', '100', 'USD', 'new.com'),
    event('05', 'purchased', '2026-03-02', '10'),
    event('06', 'sold', '2026-03-03', '100'),
  ];
  expect(openingCohort(events, '2026-01-01', '2026-12-31')).toEqual({
    opening: 2,
    sold: 1,
    rate: 50,
  });
  expect(openingCohort(events, '', '')).toBeNull();
  expect(openingCohort(events, '2024-01-01', '2024-12-31')).toEqual({
    opening: 0,
    sold: 0,
    rate: null,
  });
});
it('does not use annual renewal estimates or undated purchases to invent holding duration', () => {
  const rows = saleRows(
    [
      event('01', 'purchased', null, '100'),
      event('02', 'sold', '2026-03-01', '1000'),
    ],
    { details: { '02': { ...paid, renewalCost: null } } },
  );
  expect(rows[0]).toMatchObject({
    holdingDays: null,
    profit: null,
    recordedRenewals: 0,
  });
});
it('supports losses and avoids dividing by zero for free acquisitions', () => {
  expect(
    saleRows([event('01', 'purchased', '2025-01-01', '2000'), sale], {
      details: { '02': paid },
    })[0].profit,
  ).toBe(-1120);
  const rows = saleRows([event('01', 'purchased', '2025-01-01', '0'), sale], {
    details: { '02': { ...paid, renewalCost: '0' } },
  });
  expect(salesSummary(rows).roi).toBeNull();
});
