import { assertDomainName } from '../../../shared/domain-name';
import {
  DynadotClient,
  DynadotError,
  type DynadotClientOptions,
  type DynadotExternalDomain,
  type DynadotListing,
  type DynadotListingInput,
  type DynadotListingType,
} from '../../markets/dynadot';
import {
  MarketUnsupportedError,
  type Amount,
  type MarketAdapter,
  type MarketCapabilities,
  type MarketConfigField,
  type MarketListing,
  type MarketListingChange,
  type MarketTestResult,
  type MarketWriteResult,
} from '../../markets/types';

// Dynadot's marketplace in the shared market model (docs/markets.md,
// docs/dynadot-marketplace-api.md). One account sells two kinds of name:
// those the Dynadot account holds (`held: 'dynadot'`), read one at a time
// with `get_listing_item`, and those held at other registrars and listed
// through Dynadot's open marketplace (`held: 'elsewhere'`), read from the
// other-registrar list.
//
// Reads are checked live (2026-11-04). Writes ask Dynadot first which kind
// a name is (`domain_info`), then use that kind's command; Dynadot won't
// list a name held elsewhere until it has verified it.

export const DYNADOT_CAPABILITIES: MarketCapabilities = {
  // Listed and read in USD until there's a Listing Currency setting.
  currencies: ['USD'],
  // Sent, never shown back: Dynadot needs one whenever Make Offer is on.
  minOffer: true,
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
  // For names held elsewhere: ask Dynadot to check their verification now.
  verifyDns: true,
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

// Writing

function unsupported(field: string, message: string): never {
  throw new MarketUnsupportedError('dynadot', field, message);
}

/** Rejects what DomBot can't set on Dynadot, before anything is sent. */
export function checkDynadotChange(change: MarketListingChange): void {
  if (change.floor != null) {
    unsupported('floor', 'Dynadot has no floor price.');
  }
  if (change.minOffer != null && Number(change.minOffer) < 1) {
    unsupported('minOffer', 'Dynadot’s minimum offer must be $1.00 or more.');
  }
  if (change.leaseToOwn?.enabled) {
    unsupported('leaseToOwn', 'DomBot doesn’t set Dynadot’s installments yet.');
  }
  if (change.currency && change.currency !== CURRENCY) {
    unsupported('currency', `DomBot lists on Dynadot in ${CURRENCY} for now.`);
  }
  if (change.displayName !== undefined) {
    unsupported('displayName', 'Dynadot has no display name.');
  }
  if (change.forSale === false) {
    unsupported('forSale', 'Dynadot has no hidden listings; delist instead.');
  }
  if (change.extra) {
    unsupported(
      'extra',
      `Settings for ${change.extra.market} don’t apply to Dynadot.`,
    );
  }
}

/**
 * What to send for a change, from the listing's current type and (seller's)
 * price. Dynadot needs a minimum offer of $1 or more whenever Make Offer is
 * on, alone or beside Buy Now ("The minimum_offer_price must be $1.00 or
 * higher", observed), and never shows it back. So a listing that takes
 * offers can't be changed without one: DomBot doesn't know the one on
 * Dynadot. A price alone is Buy Now; a minimum offer alone, Make Offer.
 */
export function listingFor(
  change: MarketListingChange,
  current: { type: DynadotListingType | null; price: Amount | null } | null,
): Pick<DynadotListingInput, 'listingType' | 'price' | 'minOffer'> {
  const price =
    change.price !== undefined ? change.price : (current?.price ?? null);
  const takesOffers =
    current?.type === 'make_offer' || current?.type === 'bin_make_offer';
  if (change.minOffer === undefined && takesOffers) {
    unsupported(
      'minOffer',
      'This Dynadot listing takes offers, and Dynadot needs its minimum offer with every change but never shows it. Give the minimum offer too, or clear it to turn offers off.',
    );
  }
  const minOffer = change.minOffer ?? null;
  if (price === null && minOffer === null) {
    unsupported(
      'price',
      'Dynadot needs a Buy Now price, a minimum offer, or both.',
    );
  }
  return {
    price,
    minOffer,
    listingType:
      price === null
        ? 'make_offer'
        : minOffer === null
          ? 'bin'
          : 'bin_make_offer',
  };
}

function failed(
  name: string,
  code: string,
  message: string,
): MarketWriteResult {
  return {
    name,
    ok: false,
    pending: false,
    saved: null,
    adjusted: [],
    error: { code, message },
  };
}

function failedFrom(name: string, error: unknown): MarketWriteResult {
  // Dynadot changes a listing in the account only while the name and the
  // account are both unlocked (observed). DomBot doesn't turn the account
  // lock off: that's the user's to do on dynadot.com.
  if (error instanceof DynadotError && error.code === 'LOCKED') {
    return failed(
      name,
      'LOCKED',
      `Dynadot only changes ${name}’s listing through its API while your Dynadot account lock is off and the name is unlocked (Dynadot said: ${error.message}). Change it on dynadot.com, or turn those locks off first.`,
    );
  }
  const code =
    error instanceof MarketUnsupportedError
      ? 'UNSUPPORTED'
      : error instanceof DynadotError
        ? error.code
        : 'UNKNOWN';
  return failed(
    name,
    code,
    error instanceof Error ? error.message : String(error),
  );
}

const same = (a: Amount | null, b: Amount | null) =>
  (a === null ? null : Number(a)) === (b === null ? null : Number(b));

/** A write that went through, with what Dynadot shows now when it reads. */
function written(
  name: string,
  change: MarketListingChange,
  saved: MarketListing | null,
): MarketWriteResult {
  return {
    name,
    ok: true,
    pending: false,
    saved,
    adjusted:
      saved && change.price !== undefined && !same(change.price, saved.price)
        ? [{ field: 'price', asked: change.price, saved: saved.price }]
        : [],
    error: null,
  };
}

function ok(name: string): MarketWriteResult {
  return {
    name,
    ok: true,
    pending: false,
    saved: null,
    adjusted: [],
    error: null,
  };
}

/**
 * A name held elsewhere as listed, from what was sent: the listing read
 * shows the buyer's price, with Dynadot's transfer fee added (observed), and
 * the other-registrar list means reading every page.
 */
function asSavedElsewhere(
  name: string,
  input: DynadotListingInput,
  accountId: string,
): MarketListing {
  const listing = listingFromExternal(
    {
      name,
      registrar: null,
      status: '',
      verified: true,
      verifyStatusRaw: 'Verified',
      listingType: input.listingType,
      listingTypeRaw: input.listingType.toUpperCase(),
      price: input.price,
      transferStatus: null,
      updatedAt: null,
    },
    accountId,
  );
  return { ...listing!, minOffer: input.minOffer };
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

  /** One name at a time (`writeBatch` 1): which kind, then its command. */
  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    const out: MarketWriteResult[] = [];
    for (const change of changes) {
      let name = change.name;
      try {
        name = assertDomainName(change.name);
        checkDynadotChange(change);
        out.push(
          (await this.client.holds(name))
            ? await this.writeHeld(name, change)
            : await this.writeElsewhere(name, change),
        );
      } catch (error) {
        out.push(failedFrom(name, error));
      }
    }
    return out;
  }

  /** A name in the account: read what's listed, set it, read it back. */
  private async writeHeld(
    name: string,
    change: MarketListingChange,
  ): Promise<MarketWriteResult> {
    const current = await this.client.getListing(name, CURRENCY);
    if (current?.pendingSale) {
      return failed(
        name,
        'ON_HOLD',
        'A buyer’s purchase is under way on Dynadot, so the listing stays as it is.',
      );
    }
    const input: DynadotListingInput = {
      forSale: true,
      ...listingFor(change, current),
      currency: CURRENCY,
    };
    await this.client.setForSale(name, input);
    // UNVERIFIED: that a name in the account reads at the seller's price
    // (no transfer fee to add).
    const saved = await this.client
      .getListing(name, CURRENCY)
      .catch(() => null);
    return written(
      name,
      change,
      saved
        ? {
            ...listingFromDynadot(saved, this.accountId),
            minOffer: input.minOffer,
          }
        : null,
    );
  }

  /**
   * A name held elsewhere: added to the other-registrar list if it isn't
   * there, and listed once Dynadot has verified it. Until then the result
   * says what to do; Dynadot refuses the listing (observed).
   */
  private async writeElsewhere(
    name: string,
    change: MarketListingChange,
  ): Promise<MarketWriteResult> {
    const verification = await this.client.verification(name);
    if (!verification) {
      await this.client.addExternal([name]);
      return failed(
        name,
        'NOT_VERIFIED',
        `Added ${name} to Dynadot’s list of names held elsewhere. Dynadot lists it once it has verified that you own it: add your ownership verification TXT record, then list it again.`,
      );
    }
    if (!verification.verified) {
      return failed(
        name,
        'NOT_VERIFIED',
        `Dynadot hasn’t verified that you own ${name} yet: add your ownership verification TXT record, then list it again.`,
      );
    }
    // The listing read covers these names too, with the right type but the
    // buyer's price (observed); the seller's is on the other-registrar
    // list, read only when the change keeps the price.
    const current = await this.client
      .getListing(name, CURRENCY)
      .catch(() => null);
    const sellerPrice =
      current && change.price === undefined
        ? ((await this.client.externalDomains()).domains.find(
            (d) => d.name === name,
          )?.price ?? null)
        : null;
    const input: DynadotListingInput = {
      forSale: true,
      ...listingFor(
        change,
        current ? { type: current.type, price: sellerPrice } : null,
      ),
      currency: CURRENCY,
    };
    await this.client.listExternal(name, input);
    return written(name, change, asSavedElsewhere(name, input, this.accountId));
  }

  /**
   * Delist: `not_for_sale` for either kind. A name held elsewhere stays on
   * the other-registrar list, verified, so listing it again is one call. A
   * name with no listing counts as delisted.
   */
  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    const out: MarketWriteResult[] = [];
    for (const raw of names) {
      let name = raw;
      try {
        name = assertDomainName(raw);
        if (await this.client.holds(name)) {
          const current = await this.client.getListing(name, CURRENCY);
          if (current) {
            await this.client.setForSale(name, {
              forSale: false,
              // Required, though it changes nothing here.
              listingType: 'bin',
              price: null,
              minOffer: null,
              currency: CURRENCY,
            });
          }
        } else if (await this.client.verification(name)) {
          await this.client.listExternal(name, {
            forSale: false,
            listingType: 'bin',
            price: null,
            minOffer: null,
            currency: CURRENCY,
          });
        }
        out.push(ok(name));
      } catch (error) {
        out.push(failedFrom(name, error));
      }
    }
    return out;
  }

  /**
   * Recheck ownership for a name held elsewhere: Dynadot checks its TXT
   * record or nameservers now. A name in the account needs none.
   */
  async verifyDns(raw: string): Promise<MarketWriteResult> {
    let name = raw;
    try {
      name = assertDomainName(raw);
      if (await this.client.holds(name)) return ok(name);
      const result = await this.client.verifyExternal([name]);
      if (result.verified.includes(name)) return ok(name);
      return failed(
        name,
        'NOT_VERIFIED',
        `Dynadot didn’t find ${name}’s ownership verification yet. A new TXT record can take a while to show, and Dynadot also checks on its own.`,
      );
    } catch (error) {
      return failedFrom(name, error);
    }
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
