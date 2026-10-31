import { assertDomainName } from '../../../shared/domain-name';
import { wholeAmount } from '../../../shared/list-prices';
import {
  AfternicClient,
  BATCH_SIZE,
  type AccountSettingsInput,
  type AfternicAccountSettings,
  type AfternicClientOptions,
  type AfternicListing,
  type AfternicSale,
  type DailyStats,
  type ListingInput,
  type ListStatus,
  type RelistMode,
  type SaleStatus,
} from '../../markets/afternic';
import { SEARCH_DATA_FLAG } from '../../../shared/markets';
import {
  MarketUnsupportedError,
  type AfternicActions,
  type Amount,
  type ListingStatus,
  type MarketAdapter,
  type MarketCapabilities,
  type MarketConfigField,
  type MarketListing,
  type MarketListingChange,
  type MarketSale,
  type MarketStatsDay,
  type MarketTestResult,
  type MarketWriteResult,
} from '../../markets/types';

// Afternic in the shared market model (docs/markets.md): maps the Afternic
// client's types (whole USD, Afternic's enums) to and from the shared ones.
// No storage here; the market services call this.

export const AFTERNIC_CAPABILITIES: MarketCapabilities = {
  currencies: ['USD'],
  minOffer: true,
  floor: true,
  discount: false,
  leaseToOwn: true,
  tiers: null,
  sales: true,
  saleAuthCode: true,
  saleMessages: true,
  accountStats: true,
  domainStats: 'daily',
  leads: true,
  parkingEarnings: false,
  searchCounts: true,
  accountSettings: true,
  relist: true,
  verifyDns: false,
  asyncInsert: false,
  writeBatch: BATCH_SIZE,
  jobs: true,
  spends: false,
  rateLimit: 150,
};

export const AFTERNIC_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiKey', label: 'API key', type: 'password', required: true },
  { name: 'apiSecret', label: 'API secret', type: 'password', required: true },
];

// Reading

const LISTING_STATUS: Record<ListStatus, ListingStatus> = {
  ACTIVE: 'active',
  // Listed and live, just not shown: `forSale` carries that.
  HIDDEN: 'active',
  PENDING: 'pending',
  INACTIVE: 'inactive',
  FAILED_COMPLIANCE: 'rejected',
  ON_HOLD: 'on_hold',
  SOLD: 'sold',
};

const dollars = (n: number | null): Amount | null =>
  n == null ? null : String(n);

export function listingFromAfternic(
  l: AfternicListing,
  accountId: string,
): MarketListing {
  return {
    market: 'afternic',
    accountId,
    name: l.name,
    displayName:
      l.displayName && l.displayName !== l.name ? l.displayName : null,
    status: LISTING_STATUS[l.listStatus] ?? 'unknown',
    statusRaw: l.listStatus,
    forSale: !l.hidden && l.listStatus !== 'HIDDEN',
    price: dollars(l.buyNow),
    // A Buy Now price can always be paid outright: GoDaddy and partner
    // registrars sell at it whatever the lander shows. The lander only
    // changes what the name's own page displays.
    buyNow: l.buyNow != null,
    minOffer: dollars(l.minOffer),
    floor: dollars(l.floor),
    discount: null,
    currency: 'USD',
    leaseToOwn: {
      enabled: l.leasingEnabled,
      maxPayments: l.maxLeasePeriod,
    },
    tier: null,
    listedAt: l.createdAt || null,
    updatedAt: l.updatedAt || null,
    extra: {
      market: 'afternic',
      landingPage: l.landingPage,
      intakeStyle: l.intakeStyle,
      showLanderBuynowOption: l.showLanderBuynowOption,
      showLanderMakeOfferOption: l.showLanderMakeOfferOption,
      showLanderLeaseToOwnOption: l.showLanderLeaseToOwnOption,
      featured: l.featured,
      fastTransferStatus: l.fastTransferStatus,
      registrar: l.registrar,
      registrarRaw: l.registrarRaw,
      searches: l.searches,
    },
  };
}

const COMPLETED: ReadonlySet<SaleStatus> = new Set([
  'COMPLETED',
  'LEASE_FULLY_PAID',
]);

function saleAction(status: SaleStatus | null): MarketSale['action'] {
  switch (status) {
    case 'AWAITING_AUTH_CODE':
      return 'auth_code';
    case 'AWAITING_TRANSFER_OWNERSHIP':
    case 'PENDING_TRANSFER':
    case 'PENDING_TRANSFER_INSTRUCTIONS':
      return 'transfer';
    case 'AWAITING_PAYEE_INFO':
    case 'AWAITING_PAYEE_UPDATE':
      return 'payee_details';
    // The name has moved: only the money is left.
    case 'CONFIRMED_TRANSFER':
    case 'PENDING_PAYOUT':
    case 'SCHEDULED_PAYOUT':
      return 'payout';
    default:
      return null;
  }
}

function saleStatus(status: SaleStatus | null): MarketSale['status'] {
  if (!status || status === 'UNKNOWN') return 'unknown';
  if (COMPLETED.has(status)) return 'completed';
  if (status === 'CANCELLED') return 'cancelled';
  return 'in_progress';
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function saleFromAfternic(
  s: AfternicSale,
  accountId: string,
): MarketSale {
  return {
    market: 'afternic',
    accountId,
    id: s.transactionId,
    name: s.name,
    soldOn: day(s.soldAt),
    status: saleStatus(s.status),
    statusRaw: s.status ?? '',
    kind:
      s.saleType === 'LEASED'
        ? 'lease'
        : s.saleType === 'BUYNOW'
          ? 'buy_now'
          : 'unknown',
    price: s.salePrice,
    commission: s.commission,
    commissionEstimated: false,
    net: s.net,
    currency: 'USD',
    installments: s.lease
      ? {
          amount: s.lease.installmentAmount,
          paid: s.lease.totalInstallmentsPaid,
          total: s.lease.totalInstallments,
          next: s.lease.nextInstallmentDate,
        }
      : null,
    paidOutOn: day(s.disbursedAt),
    action: saleAction(s.status),
    // The auth code stays out: it's sensitive, and the registrar can always
    // give a fresh one. Only whether the market has one is kept; the sales
    // list leaves it out, so there a missing code says nothing.
    authCodeSent: s.authCode ? true : null,
  };
}

export function statsFromAfternic(
  days: DailyStats[],
  accountId: string,
  name: string | null,
): MarketStatsDay[] {
  return days.map((d) => ({
    market: 'afternic',
    accountId,
    name,
    date: d.date,
    views: d.views,
    leads: d.leads,
    clicks: null,
    earnings: null,
    currency: null,
    shortlists: null,
    trackers: null,
    source: 'market',
  }));
}

// Writing

function unsupported(field: string, message: string): never {
  throw new MarketUnsupportedError('afternic', field, message);
}

/** A shared amount as Afternic's whole dollars; null clears. */
function wholeDollars(value: Amount | null, label: string): number | null {
  if (value === null) return null;
  const whole = wholeAmount(value, label);
  if (whole === null) return null;
  return Number(whole);
}

/**
 * A shared change as an Afternic listing input. Rejects what Afternic can't
 * do rather than dropping it.
 */
export function changeToAfternic(change: MarketListingChange): ListingInput {
  if (change.currency && change.currency !== 'USD') {
    unsupported(
      'currency',
      `Afternic prices are in USD only, not ${change.currency}.`,
    );
  }
  if (change.extra && change.extra.market !== 'afternic') {
    unsupported(
      'extra',
      `Settings for ${change.extra.market} don't apply to Afternic.`,
    );
  }
  const input: ListingInput = { name: change.name };
  if (change.displayName !== undefined) input.displayName = change.displayName;
  if (change.price !== undefined) {
    input.buyNow = wholeDollars(change.price, 'BIN price');
  }
  if (change.minOffer !== undefined) {
    const minOffer = wholeDollars(change.minOffer, 'Minimum offer');
    if (minOffer === null) {
      unsupported(
        'minOffer',
        'Afternic always has a minimum offer ($20 or more).',
      );
    }
    input.minOffer = minOffer;
  }
  if (change.floor !== undefined) {
    input.floor = wholeDollars(change.floor, 'Floor price');
  }
  if (change.forSale !== undefined) input.hidden = !change.forSale;
  if (change.leaseToOwn) {
    input.leasingEnabled = change.leaseToOwn.enabled;
    if (change.leaseToOwn.maxPayments !== undefined) {
      input.maxLeasePeriod = change.leaseToOwn.maxPayments;
    }
  }
  const lander = change.extra;
  if (lander) {
    input.landingPage = lander.landingPage;
    input.intakeStyle = lander.intakeStyle;
    input.showLanderBuynowOption = lander.showLanderBuynowOption;
    input.showLanderMakeOfferOption = lander.showLanderMakeOfferOption;
    input.showLanderLeaseToOwnOption = lander.showLanderLeaseToOwnOption;
    input.featured = lander.featured;
  }
  return input;
}

/** Where Afternic saved something other than what was asked. */
export function adjustedFields(
  change: MarketListingChange,
  saved: MarketListing,
): MarketWriteResult['adjusted'] {
  const out: MarketWriteResult['adjusted'] = [];
  const check = (field: string, asked: unknown, got: unknown) => {
    if (asked !== undefined && asked !== got) {
      out.push({ field, asked, saved: got });
    }
  };
  // Compare amounts in Afternic's whole-dollar spelling ("2500.00" → "2500").
  const whole = (a: Amount | null | undefined, label: string) =>
    a == null ? a : wholeAmount(a, label);
  check('price', whole(change.price, 'BIN price'), saved.price);
  check('minOffer', whole(change.minOffer, 'Minimum offer'), saved.minOffer);
  check('floor', whole(change.floor, 'Floor price'), saved.floor);
  check('forSale', change.forSale, saved.forSale);
  check(
    'leaseToOwn.enabled',
    change.leaseToOwn?.enabled,
    saved.leaseToOwn?.enabled,
  );
  check(
    'leaseToOwn.maxPayments',
    change.leaseToOwn?.maxPayments,
    saved.leaseToOwn?.maxPayments,
  );
  return out;
}

function failed(name: string, error: unknown): MarketWriteResult {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof MarketUnsupportedError ? 'UNSUPPORTED' : 'INVALID';
  return {
    name,
    ok: false,
    pending: false,
    saved: null,
    adjusted: [],
    error: { code, message },
  };
}

// The adapter

export interface AfternicCredentials {
  apiKey?: string;
  apiSecret?: string;
}

export class AfternicAdapter implements MarketAdapter, AfternicActions {
  readonly market = 'afternic' as const;
  readonly capabilities = AFTERNIC_CAPABILITIES;

  constructor(
    readonly accountId: string,
    private readonly client: AfternicClient,
  ) {}

  async test(): Promise<MarketTestResult> {
    const page = await this.client.listListings({ limit: 1 });
    // Search counts come only to Discount Domain Club Domain Pro members, so
    // a listing with or without them says which the account is.
    return {
      listings: page.total,
      notes: [],
      status: page.listings.length
        ? [{ label: SEARCH_DATA_FLAG, on: page.listings[0].searches != null }]
        : [],
    };
  }

  async allListings() {
    const { listings, changedDuringRead } = await this.client.allListings();
    return {
      listings: listings.map((l) => listingFromAfternic(l, this.accountId)),
      complete: !changedDuringRead,
    };
  }

  async getListings(names: readonly string[]) {
    return (await this.client.getListings(names)).map((l) =>
      listingFromAfternic(l, this.accountId),
    );
  }

  /**
   * Create or update up to 500 listings in one call, then read back any the
   * answer didn't include, so each result says what was saved and what
   * Afternic changed (it silently caps lease-to-own payments by price).
   */
  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    if (changes.length > BATCH_SIZE) {
      throw new Error(`At most ${BATCH_SIZE} changes per call.`);
    }
    // Results by canonical name; a change that can't be made fails here,
    // before anything is sent, and the rest go on.
    const results = new Map<string, MarketWriteResult>();
    const keys: string[] = [];
    const inputs: ListingInput[] = [];
    const changeFor = new Map<string, MarketListingChange>();
    for (const change of changes) {
      let key = change.name;
      try {
        key = assertDomainName(change.name);
        const input = changeToAfternic({ ...change, name: key });
        inputs.push(input);
        changeFor.set(key, change);
      } catch (error) {
        results.set(key, failed(key, error));
      }
      keys.push(key);
    }

    const written = inputs.length
      ? await this.client.upsertListings(inputs)
      : [];
    const missing = written
      .filter((r) => r.ok && !r.listing)
      .map((r) => r.name);
    const readBack = new Map(
      missing.length
        ? (await this.client.getListings(missing)).map((l) => [l.name, l])
        : [],
    );
    for (const r of written) {
      const listing = r.listing ?? readBack.get(r.name) ?? null;
      const saved = listing
        ? listingFromAfternic(listing, this.accountId)
        : null;
      const change = changeFor.get(r.name);
      results.set(r.name, {
        name: r.name,
        ok: r.ok,
        pending: saved?.status === 'pending',
        saved,
        adjusted: saved && change ? adjustedFields(change, saved) : [],
        error: r.error,
      });
    }
    return keys.map(
      (key) => results.get(key) ?? failed(key, 'Afternic returned no result.'),
    );
  }

  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    const results = await this.client.deleteListings(names);
    return results.map((r) => ({
      name: r.name,
      // A name that wasn't listed is delisted already.
      ok: r.ok || r.status === 404,
      pending: false,
      saved: null,
      adjusted: [],
      error: r.ok || r.status === 404 ? null : r.error,
    }));
  }

  async allSales(since?: string): Promise<MarketSale[]> {
    const sales = await this.client.allSales(since ? { from: since } : {});
    return sales.map((s) => saleFromAfternic(s, this.accountId));
  }

  async getSale(saleId: string): Promise<MarketSale | null> {
    const sale = await this.client.getSale(saleId);
    // The single sale does carry the code, so here a missing one is a no.
    return sale
      ? {
          ...saleFromAfternic(sale, this.accountId),
          authCodeSent: !!sale.authCode,
        }
      : null;
  }

  async accountStats(days: number): Promise<MarketStatsDay[]> {
    return statsFromAfternic(
      await this.client.getAccountStats({ days }),
      this.accountId,
      null,
    );
  }

  async domainStats(name: string, days: number): Promise<MarketStatsDay[]> {
    return statsFromAfternic(
      await this.client.getDomainStats(name, { days }),
      this.accountId,
      name,
    );
  }

  // Afternic only

  async setSaleAuthCode(saleId: string, authCode: string): Promise<void> {
    await this.client.updateSale(saleId, { authCode });
  }

  async sendSaleMessage(saleId: string, message: string): Promise<void> {
    await this.client.sendSaleMessage(saleId, message);
  }

  async relist(
    names: readonly string[],
    mode?: RelistMode,
  ): Promise<MarketWriteResult[]> {
    const results = await this.client.relistListings(names, mode);
    return results.map((r) => ({
      name: r.name,
      ok: r.ok,
      pending: false,
      saved: null,
      adjusted: [],
      error: r.error,
    }));
  }

  getListingDefaults(): Promise<AfternicAccountSettings> {
    return this.client.getAccountSettings();
  }

  setListingDefaults(settings: AccountSettingsInput): Promise<void> {
    return this.client.updateAccountSettings(settings);
  }
}

/** An adapter for a stored Afternic account. */
export function createAfternicAdapter(
  accountId: string,
  credentials: AfternicCredentials,
  options: Omit<AfternicClientOptions, 'apiKey' | 'apiSecret'> = {},
): AfternicAdapter {
  if (!credentials.apiKey || !credentials.apiSecret) {
    throw new Error('This Afternic account has no API key and secret.');
  }
  return new AfternicAdapter(
    accountId,
    new AfternicClient({
      ...options,
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
    }),
  );
}
