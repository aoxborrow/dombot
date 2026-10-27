import type {
  WireAccountSettings,
  WireDomain,
  WireSale,
  WireStats,
} from './wire';

// Responses in the exact shapes the live API returned on 2026-10-27, with
// made-up names and amounts (the real ones are a user's portfolio and sales).

/** A listing with every include the live API actually sent. */
export const domainFull: WireDomain = {
  buynowPrice: 2_499_000_000,
  floorPrice: 0,
  minbidPrice: 1_000_000_000,
  leasingEnabled: false,
  maxLeasePeriod: 12,
  displayName: 'Example.com',
  intakeStyle: 'PRICE_FORM',
  landingPage: 'SALES_TYPE',
  showLanderBuynowOption: true,
  showLanderLeaseToOwnOption: true,
  showLanderMakeOfferOption: false,
  featured: false,
  hidden: false,
  createdAt: '2023-04-12T06:53:36Z',
  updatedAt: '2026-04-10T00:30:29Z',
  listStatus: 'ACTIVE',
  registrar: 'GODADDY',
  fastTransferStatus: 'ACTIVE',
  name: 'example.com',
};

/** A fresh listing: no includes, no Buy Now price yet, still pending. */
export const domainBare: WireDomain = {
  buynowPrice: 0,
  floorPrice: 0,
  minbidPrice: 100_000_000,
  leasingEnabled: true,
  maxLeasePeriod: 30,
  displayName: 'example.net',
  intakeStyle: 'PRICE_FORM',
  landingPage: 'SALES_TYPE',
  showLanderBuynowOption: true,
  showLanderLeaseToOwnOption: true,
  showLanderMakeOfferOption: false,
  hidden: false,
  createdAt: '2026-10-27T23:03:59Z',
  updatedAt: '2026-10-27T23:03:59Z',
  listStatus: 'PENDING',
  name: 'example.net',
};

/** What a Domain Pro member gets, per the spec's example. */
export const domainWithSearches: WireDomain = {
  ...domainFull,
  name: 'example.org',
  displayName: 'example.org',
  registrar: 'Dynadot, LLC',
  offerCount: 3,
  searches: {
    total: { '30d': 120, '90d': 300, '365d': 1100 },
    unique: { '30d': 40, '90d': 95, '365d': 410 },
  },
};

export const saleBuyNow: WireSale = {
  commission: 149_700_000,
  name: 'example.com',
  salePrice: 499_000_000,
  saleTotal: 499_000_000,
  soldAt: '2026-10-08T03:36:24.000Z',
  disbursedAt: '2026-10-13T07:00:00.000Z',
  status: 'COMPLETED',
  transactionId: '728bded4-c2c9-11f1-9999-000000000001',
  authCode: 'not-a-real-code',
  saleType: 'BUYNOW',
};

export const saleLeased: WireSale = {
  commission: 369_770_000,
  name: 'example.io',
  salePrice: 1_479_090_000,
  soldAt: '2024-11-19T20:09:58.000Z',
  status: 'COMPLETED',
  transactionId: '416740e2-a6b2-11ef-9bc8-000000000002',
  saleType: 'LEASED',
  installmentAmount: 73_950_000,
  prevInstallmentDate: '2026-03-23',
  totalInstallments: 16,
  totalInstallmentsPaid: 16,
};

export const saleCancelled: WireSale = {
  commission: 212_500_000,
  name: 'example.dev',
  salePrice: 850_000_000,
  soldAt: '2024-04-19T10:00:00.000Z',
  status: 'CANCELLED',
  transactionId: '00000000-0000-0000-0000-000000000003',
  saleType: 'BUYNOW',
};

export const stats: WireStats = {
  stats: [
    { date: '2026-08-02T00:00:00Z', leads: 0, views: 3 },
    { date: '2026-08-03T00:00:00Z', leads: 1, views: 5 },
  ],
};

export const settings: WireAccountSettings = {
  intakeStyle: 'PRICE_FORM',
  landingPage: 'SALES_TYPE',
  leasingEnabled: true,
  maxLeasePeriod: 60,
  showLanderBuynowOption: true,
  showLanderLeaseToOwnOption: true,
  showLanderMakeOfferOption: false,
  selfBrokerEnabled: false,
};

export const salesLimitError = {
  code: 'BAD_REQUEST',
  message: 'Invalid Query Parameters',
  fields: [
    {
      path: 'limit',
      code: 'VALIDATION_ERROR',
      message: 'limit must be at most 100',
    },
  ],
};

/** `n` distinct listings, for paging tests. */
export function manyDomains(n: number, start = 0): WireDomain[] {
  return Array.from({ length: n }, (_, i) => ({
    ...domainBare,
    name: `name${String(start + i).padStart(6, '0')}.com`,
    displayName: '',
  }));
}
