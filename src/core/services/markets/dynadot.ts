import {
  DynadotClient,
  DynadotError,
  type DynadotClientOptions,
  type DynadotExternalDomain,
  type DynadotListing,
} from '../../markets/dynadot';
import type {
  MarketAdapter,
  MarketCapabilities,
  MarketConfigField,
  MarketListing,
  MarketListingChange,
  MarketTestResult,
  MarketWriteResult,
} from '../../markets/types';

// Dynadot's marketplace in the shared market model (docs/markets.md,
// docs/dynadot-marketplace-api.md). One account sells two kinds of name:
// those the Dynadot account holds (`held: 'dynadot'`), read one at a time
// with `get_listing_item`, and those held at other registrars and listed
// through Dynadot's open marketplace (`held: 'elsewhere'`), read from the
// other-registrar list.
//
// Reads are checked live (2026-11-04). Listing from DomBot isn't built yet:
// writes answer that they aren't, name by name.

export const DYNADOT_CAPABILITIES: MarketCapabilities = {
  // Reads are asked for in USD, the currency DomBot compares prices in
  // until a Listing Currency setting comes with writes.
  currencies: ['USD'],
  minOffer: false,
  floor: false,
  discount: false,
  leaseToOwn: false,
  tiers: null,
  sales: false,
  saleAuthCode: false,
  saleMessages: false,
  accountStats: false,
  domainStats: null,
  leads: false,
  parkingEarnings: false,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  verifyDns: false,
  asyncInsert: false,
  writeBatch: 1,
  jobs: false,
  spends: false,
  // The account's limit by price level: 60 a minute on Regular, 600 on
  // Bulk, 6,000 on Super Bulk; the client paces under the lowest.
  rateLimit: 60,
};

/** None of its own: the account uses a Dynadot registrar account's key. */
export const DYNADOT_CONFIG_FIELDS: MarketConfigField[] = [];

/** The currency DomBot reads prices in (see the capabilities). */
const CURRENCY = 'USD';

const NOT_BUILT =
  'Listing on Dynadot from DomBot isn’t built yet. Change it on dynadot.com for now.';

// Reading

export function listingFromDynadot(
  l: DynadotListing,
  accountId: string,
): MarketListing {
  return {
    market: 'dynadot',
    accountId,
    name: l.name,
    displayName: null,
    status: l.pendingSale ? 'on_hold' : 'active',
    statusRaw: l.pendingSale ? `${l.typeRaw} · pending sale` : l.typeRaw,
    forSale: true,
    price: l.price,
    buyNow: l.type === 'bin' || l.type === 'bin_make_offer',
    // Sent with a listing, never read back.
    minOffer: null,
    floor: null,
    discount: null,
    currency: CURRENCY,
    leaseToOwn: null,
    tier: null,
    listedAt: null,
    updatedAt: null,
    extra: {
      market: 'dynadot',
      held: 'dynadot',
      listingId: l.listingId,
      offers: l.type === 'make_offer' || l.type === 'bin_make_offer',
      pendingSale: l.pendingSale,
      verified: null,
      registrar: null,
      transferStatus: null,
    },
  };
}

/**
 * A name held elsewhere, as a listing; null when it's on the list but not
 * for sale ("Not Set"). Until Dynadot has verified it, it's pending; once a
 * transfer is under way (a buyer has paid), on hold. UNVERIFIED: which
 * transfer statuses Dynadot uses, and the price's currency (read as USD).
 */
export function listingFromExternal(
  d: DynadotExternalDomain,
  accountId: string,
): MarketListing | null {
  if (!d.listingType) return null;
  const status = !d.verified
    ? 'pending'
    : d.transferStatus
      ? 'on_hold'
      : 'active';
  return {
    market: 'dynadot',
    accountId,
    name: d.name,
    displayName: null,
    status,
    statusRaw: [d.listingTypeRaw, d.verifyStatusRaw, d.transferStatus]
      .filter(Boolean)
      .join(' · '),
    forSale: d.verified,
    price: d.price,
    buyNow: d.listingType === 'bin' || d.listingType === 'bin_make_offer',
    minOffer: null,
    floor: null,
    discount: null,
    currency: CURRENCY,
    leaseToOwn: null,
    tier: null,
    listedAt: null,
    updatedAt: d.updatedAt,
    extra: {
      market: 'dynadot',
      held: 'elsewhere',
      listingId: null,
      offers:
        d.listingType === 'make_offer' || d.listingType === 'bin_make_offer',
      pendingSale: Boolean(d.transferStatus),
      verified: d.verified,
      registrar: d.registrar,
      transferStatus: d.transferStatus,
    },
  };
}

function notBuilt(name: string): MarketWriteResult {
  return {
    name,
    ok: false,
    pending: false,
    saved: null,
    adjusted: [],
    error: { code: 'UNSUPPORTED', message: NOT_BUILT },
  };
}

// The adapter

export interface DynadotAccountCredentials {
  apiKey?: string;
  apiSecret?: string;
}

export class DynadotAdapter implements MarketAdapter {
  readonly market = 'dynadot' as const;
  readonly capabilities = DYNADOT_CAPABILITIES;
  /** The last other-registrar list read, for the verification key. */
  private external: DynadotExternalDomain[] | null = null;

  constructor(
    readonly accountId: string,
    private readonly client: DynadotClient,
  ) {}

  async test(): Promise<MarketTestResult> {
    const info = await this.client.accountInfo();
    return {
      listings: null,
      notes: info.priceLevel
        ? [`Dynadot API price level: ${info.priceLevel}.`]
        : [],
    };
  }

  /**
   * Names the account marks for sale, read one by one, then the names
   * listed from other registrars. A listing that fails to read for any
   * reason but the key leaves the snapshot incomplete rather than failing
   * the sync.
   */
  async allListings() {
    const held = await this.client.accountDomains();
    let complete = held.complete;
    const listings: MarketListing[] = [];
    for (const d of held.domains) {
      if (!d.forSale) continue;
      try {
        const l = await this.client.getListing(d.name, CURRENCY);
        if (l) listings.push(listingFromDynadot(l, this.accountId));
      } catch (error) {
        if (error instanceof DynadotError && error.code === 'AUTH') throw error;
        complete = false;
      }
    }
    const external = await this.client.externalDomains();
    this.external = external.domains;
    complete &&= external.complete;
    for (const d of external.domains) {
      const l = listingFromExternal(d, this.accountId);
      if (l) listings.push(l);
    }
    return { listings, complete };
  }

  /**
   * Just these names: the other-registrar list (one read) says which are
   * held elsewhere, and the rest are read as names in the account.
   */
  async getListings(names: readonly string[]): Promise<MarketListing[]> {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const external = (await this.client.externalDomains()).domains.filter((d) =>
      wanted.has(d.name),
    );
    const out: MarketListing[] = [];
    for (const d of external) {
      wanted.delete(d.name);
      const l = listingFromExternal(d, this.accountId);
      if (l) out.push(l);
    }
    for (const name of wanted) {
      const l = await this.client.getListing(name, CURRENCY);
      if (l) out.push(listingFromDynadot(l, this.accountId));
    }
    return out;
  }

  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    return changes.map((c) => notBuilt(c.name));
  }

  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    return names.map(notBuilt);
  }

  /**
   * The account's Open Marketplace Key: one per account, read through any
   * name on the other-registrar list; null while the list is empty.
   */
  async verificationId(): Promise<string | null> {
    const list = this.external ?? (await this.client.externalDomains()).domains;
    const first = list[0];
    if (!first) return null;
    return (await this.client.verification(first.name))?.key ?? null;
  }
}

/** An adapter for a Dynadot market account, on its registrar account's key. */
export function createDynadotAdapter(
  accountId: string,
  credentials: DynadotAccountCredentials,
  options: Omit<DynadotClientOptions, 'apiKey' | 'apiSecret'> = {},
): DynadotAdapter {
  const { apiKey, apiSecret } = credentials;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'This Dynadot account’s registrar account has no API key and secret. Check Settings → Registrars.',
    );
  }
  return new DynadotAdapter(
    accountId,
    new DynadotClient({ ...options, apiKey, apiSecret }),
  );
}
