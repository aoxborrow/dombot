import { assertDomainName, toAscii } from '../../../shared/domain-name';
import {
  SellerHubClient,
  SpaceshipError,
  type SellerHubClientOptions,
  type SellerHubListing,
  type SellerHubListingInput,
  type SellerHubSale,
  type SellerHubStatus,
  type SellerHubVerificationOption,
} from '../../markets/spaceship';
import {
  MarketUnsupportedError,
  type Amount,
  type ListingStatus,
  type MarketAdapter,
  type MarketCapabilities,
  type MarketConfigField,
  type MarketListing,
  type MarketListingChange,
  type MarketSale,
  type MarketTestResult,
  type MarketWriteResult,
} from '../../markets/types';

// Spaceship SellerHub in the shared market model (docs/markets.md,
// docs/sellerhub-api.md), on a Spaceship registrar account's key or its own. One
// call per name: SellerHub has no bulk. Writes read the listing first
// (which says whether to create or change it, and whether a sale holds
// it), and the write answers with the listing as saved, so there's no read
// back. A name held outside the Spaceship account goes in as `verifying`
// until SellerHub has checked its TXT record.

export const SPACESHIP_CAPABILITIES: MarketCapabilities = {
  currencies: ['USD'],
  minOffer: true,
  floor: false,
  discount: false,
  // In SellerHub's dashboard; its API has none yet (on Spaceship's roadmap).
  leaseToOwn: false,
  tiers: null,
  sales: true,
  saleAuthCode: false,
  saleMessages: false,
  accountStats: false,
  domainStats: null,
  leads: false,
  parkingEarnings: false,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  // The dashboard's Verify Domains has no API.
  verifyDns: false,
  asyncInsert: false,
  writeBatch: 1,
  jobs: false,
  spends: false,
  // 300 in 300 seconds per user, per operation.
  rateLimit: 60,
};

/** For an account on its own key, not a Spaceship registrar account's. */
export const SPACESHIP_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiKey', label: 'API Key', type: 'password', required: true },
  { name: 'apiSecret', label: 'API Secret', type: 'password', required: true },
];

/** SellerHub's longest description. */
const DESCRIPTION_MAX = 5000;

// Reading

const STATUS: Record<SellerHubStatus, ListingStatus> = {
  verifying: 'pending',
  onSale: 'active',
  onSaleStopped: 'inactive',
  failed: 'rejected',
  saleProcessing: 'on_hold',
  privateSale: 'on_hold',
  leaseActive: 'on_hold',
  sold: 'sold',
};

/** A sale or deal holds the listing: DomBot writes it neither way. */
function heldBySale(status: SellerHubStatus | null): boolean {
  return status !== null && STATUS[status] === 'on_hold';
}

export function listingFromSellerHub(
  l: SellerHubListing,
  accountId: string,
  /** The names the Spaceship account holds; null when unknown. */
  held: ReadonlySet<string> | null = null,
): MarketListing {
  // SellerHub sends a display name for every listing, the Unicode name
  // itself unless the seller set capitals (seen live): only a different one
  // counts, then an IDN's Unicode form.
  const shown =
    l.displayName && l.displayName !== l.unicodeName
      ? l.displayName
      : l.unicodeName !== l.name
        ? l.unicodeName
        : null;
  return {
    market: 'spaceship',
    accountId,
    name: l.name,
    displayName: shown,
    status: l.status ? STATUS[l.status] : 'unknown',
    statusRaw: l.statusRaw,
    forSale: l.status === 'onSale',
    price: l.binPriceEnabled ? l.binPrice : null,
    buyNow: l.binPriceEnabled && l.binPrice !== null,
    minOffer: l.minPriceEnabled ? l.minPrice : null,
    floor: null,
    discount: null,
    currency: 'USD',
    leaseToOwn: null,
    tier: null,
    listedAt: null,
    updatedAt: null,
    extra: {
      market: 'spaceship',
      held: held ? (held.has(l.name) ? 'spaceship' : 'elsewhere') : null,
      description: l.description,
    },
  };
}

/** Cents of a decimal string, exactly. */
function cents(v: Amount): number {
  return Math.round(Number(v) * 100);
}

function fromCents(n: number): Amount {
  return (n / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

/**
 * A row of the sold report. It has no transaction id, so a sale is keyed by
 * its name and time (by name alone when SellerHub has no time). Every row
 * is a finished sale as far as anyone has seen (docs/sellerhub-api.md, open
 * question 1); the commission is what the payout leaves out, not an
 * estimate.
 */
export function saleFromSellerHub(
  s: SellerHubSale,
  accountId: string,
): MarketSale {
  const commission =
    s.salePrice !== null && s.payout !== null
      ? fromCents(cents(s.salePrice) - cents(s.payout))
      : null;
  return {
    market: 'spaceship',
    accountId,
    id: s.saleDateTime ? `${s.name}:${s.saleDateTime}` : s.name,
    name: s.name,
    soldOn: s.saleDateTime
      ? new Date(s.saleDateTime).toISOString().slice(0, 10)
      : null,
    status: 'completed',
    statusRaw: ['sold', s.source].filter(Boolean).join(' · '),
    kind: s.source === 'checkoutLink' ? 'buy_now' : 'unknown',
    price: s.salePrice,
    commission,
    commissionEstimated: false,
    net: s.payout,
    currency: s.currency as MarketSale['currency'],
    installments: null,
    paidOutOn: null,
    action: null,
  };
}

/**
 * The account's TXT verification value: the option that is one TXT record
 * at the apex. SellerHub's other option (A and AAAA records at
 * `_spaceship_verify`) isn't one DomBot sets.
 */
export function txtVerificationValue(
  options: readonly SellerHubVerificationOption[],
): string | null {
  for (const o of options) {
    const [r] = o.records;
    if (o.records.length === 1 && r.type === 'TXT' && r.name === '@') {
      return r.value;
    }
  }
  return null;
}

// Writing

function unsupported(field: string, message: string): never {
  throw new MarketUnsupportedError('spaceship', field, message);
}

/** Rejects what DomBot can't set on SellerHub, before anything is sent. */
export function checkSpaceshipChange(change: MarketListingChange): void {
  if (change.floor != null) {
    unsupported('floor', 'SellerHub has no floor price.');
  }
  if (change.leaseToOwn?.enabled) {
    unsupported(
      'leaseToOwn',
      'SellerHub’s lease-to-own isn’t in its API yet; set it on spaceship.com.',
    );
  }
  if (change.currency && change.currency !== 'USD') {
    unsupported('currency', 'SellerHub lists in USD only.');
  }
  // The spec takes two decimal places, but SellerHub drops the cents
  // (1499.99 saved as 1499, observed): refused rather than cut.
  for (const field of ['price', 'minOffer'] as const) {
    const amount = change[field];
    if (amount != null && !Number.isInteger(Number(amount))) {
      unsupported(field, 'SellerHub takes whole-dollar amounts.');
    }
  }
  if (change.forSale === false) {
    unsupported(
      'forSale',
      'SellerHub’s API can’t pause a sale; delist instead.',
    );
  }
  if (change.extra && change.extra.market !== 'spaceship') {
    unsupported(
      'extra',
      `Settings for ${change.extra.market} don’t apply to SellerHub.`,
    );
  }
  if (
    change.displayName !== undefined &&
    toAscii(change.displayName) !== toAscii(change.name)
  ) {
    unsupported(
      'displayName',
      'A SellerHub display name is the name itself, with capitals where you want them.',
    );
  }
  const description =
    change.extra?.market === 'spaceship' ? change.extra.description : undefined;
  if (description !== undefined && description.length > DESCRIPTION_MAX) {
    unsupported(
      'description',
      `SellerHub descriptions are up to ${DESCRIPTION_MAX.toLocaleString('en-US')} characters.`,
    );
  }
}

/**
 * What to send: a price turns Buy It Now on at that price, `null` turns it
 * off (SellerHub keeps the old amount); the same for a minimum offer and
 * Make an Offer. A listing has to end up with one of the two on.
 */
export function inputFor(
  change: MarketListingChange,
  current: SellerHubListing | null,
): SellerHubListingInput {
  const input: SellerHubListingInput = {};
  if (change.price !== undefined) {
    input.binPriceEnabled = change.price !== null;
    if (change.price !== null) input.binPrice = change.price;
  }
  if (change.minOffer !== undefined) {
    input.minPriceEnabled = change.minOffer !== null;
    if (change.minOffer !== null) input.minPrice = change.minOffer;
  }
  if (change.displayName !== undefined) input.displayName = change.displayName;
  if (change.extra?.market === 'spaceship') {
    if (change.extra.description !== undefined) {
      input.description = change.extra.description;
    }
  }
  const bin = input.binPriceEnabled ?? current?.binPriceEnabled ?? false;
  const offers = input.minPriceEnabled ?? current?.minPriceEnabled ?? false;
  if (!bin && !offers) {
    unsupported(
      'price',
      'SellerHub needs a Buy It Now price, a minimum offer, or both.',
    );
  }
  return input;
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
  const code =
    error instanceof MarketUnsupportedError
      ? 'UNSUPPORTED'
      : error instanceof SpaceshipError
        ? error.code
        : 'UNKNOWN';
  return failed(
    name,
    code,
    error instanceof Error ? error.message : String(error),
  );
}

function onHold(name: string, status: string): MarketWriteResult {
  return failed(
    name,
    'ON_HOLD',
    `A sale or deal is under way on SellerHub (${status}), so the listing stays as it is.`,
  );
}

const same = (a: Amount | null, b: Amount | null) =>
  (a === null ? null : Number(a)) === (b === null ? null : Number(b));

function written(
  name: string,
  change: MarketListingChange,
  saved: MarketListing | null,
): MarketWriteResult {
  const adjusted: MarketWriteResult['adjusted'] = [];
  if (saved) {
    for (const field of ['price', 'minOffer'] as const) {
      const asked = change[field];
      if (asked !== undefined && !same(asked, saved[field])) {
        adjusted.push({ field, asked, saved: saved[field] });
      }
    }
  }
  return {
    name,
    ok: true,
    // Held outside the account: SellerHub checks ownership first.
    pending: saved?.status === 'pending',
    saved,
    adjusted,
    error: null,
  };
}

// The adapter

export interface SpaceshipAccountCredentials {
  apiKey?: string;
  apiSecret?: string;
}

export class SpaceshipAdapter implements MarketAdapter {
  readonly market = 'spaceship' as const;
  readonly capabilities = SPACESHIP_CAPABILITIES;
  /** The account's own names, read once per adapter. */
  private held: Promise<ReadonlySet<string> | null> | null = null;

  constructor(
    readonly accountId: string,
    private readonly client: SellerHubClient,
  ) {}

  /**
   * The names the Spaceship account holds. A read that fails leaves `held`
   * unknown on the listings rather than failing them, unless it's the key.
   */
  private heldNames(): Promise<ReadonlySet<string> | null> {
    this.held ??= this.client
      .accountDomainNames()
      .then(({ names, complete }) => (complete ? new Set(names) : null))
      .catch((error) => {
        if (error instanceof SpaceshipError && error.code === 'AUTH') {
          throw error;
        }
        return null;
      });
    return this.held;
  }

  /**
   * The key works and reaches SellerHub: one listing's page, which also
   * says how many there are. A key without SellerHub's scopes fails here,
   * with what to add.
   */
  async test(): Promise<MarketTestResult> {
    const { total } = await this.client.listingsPage(0, 1);
    return { listings: total, notes: [] };
  }

  async allListings() {
    const [read, held] = await Promise.all([
      this.client.allListings(),
      this.heldNames(),
    ]);
    return {
      listings: read.listings.map((l) =>
        listingFromSellerHub(l, this.accountId, held),
      ),
      complete: read.complete,
    };
  }

  async getListings(names: readonly string[]): Promise<MarketListing[]> {
    const held = await this.heldNames();
    const out: MarketListing[] = [];
    for (const name of names) {
      const l = await this.client.getListing(name);
      if (l) out.push(listingFromSellerHub(l, this.accountId, held));
    }
    return out;
  }

  /** One name at a time: read it, then create it or change it. */
  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    const out: MarketWriteResult[] = [];
    for (const change of changes) {
      let name = change.name;
      try {
        name = assertDomainName(change.name);
        checkSpaceshipChange(change);
        const current = await this.client.getListing(name);
        if (current && heldBySale(current.status)) {
          out.push(onHold(name, current.statusRaw));
          continue;
        }
        if (current?.status === 'sold') {
          out.push(failed(name, 'SOLD', `${name} has sold on SellerHub.`));
          continue;
        }
        const input = inputFor(change, current);
        const saved = current
          ? await this.client.updateListing(name, input)
          : await this.client.createListing(name, input);
        out.push(
          written(
            name,
            change,
            saved
              ? listingFromSellerHub(
                  saved,
                  this.accountId,
                  await this.heldNames(),
                )
              : null,
          ),
        );
      } catch (error) {
        out.push(failedFrom(name, error));
      }
    }
    return out;
  }

  /**
   * Delist: SellerHub's delete, the only way off sale its API has. A name
   * that isn't listed counts as delisted; one a sale holds is left alone.
   */
  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    const out: MarketWriteResult[] = [];
    for (const raw of names) {
      let name = raw;
      try {
        name = assertDomainName(raw);
        const current = await this.client.getListing(name);
        if (current && heldBySale(current.status)) {
          out.push(onHold(name, current.statusRaw));
          continue;
        }
        if (current) await this.client.deleteListing(name);
        out.push({
          name,
          ok: true,
          pending: false,
          saved: null,
          adjusted: [],
          error: null,
        });
      } catch (error) {
        out.push(failedFrom(name, error));
      }
    }
    return out;
  }

  /**
   * Sales from `since` (inclusive) to `until` (exclusive), both
   * YYYY-MM-DD; the sold report filters by time on SellerHub's side.
   */
  async allSales(since?: string, until?: string): Promise<MarketSale[]> {
    const sales = await this.client.soldDomains({
      ...(since && { from: `${since}T00:00:00.000Z` }),
      ...(until && { to: `${until}T00:00:00.000Z` }),
    });
    return sales.map((s) => saleFromSellerHub(s, this.accountId));
  }

  /** The account's TXT verification value, one for every name. */
  async verificationId(): Promise<string | null> {
    return txtVerificationValue(await this.client.verificationRecords());
  }
}

/** An adapter for a SellerHub market account. */
export function createSpaceshipAdapter(
  accountId: string,
  credentials: SpaceshipAccountCredentials,
  options: Omit<SellerHubClientOptions, 'apiKey' | 'apiSecret'> = {},
): SpaceshipAdapter {
  const { apiKey, apiSecret } = credentials;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'This SellerHub account has no API key and secret. Check its registrar account in Settings → Registrars, or give it a separate key.',
    );
  }
  return new SpaceshipAdapter(
    accountId,
    new SellerHubClient({ ...options, apiKey, apiSecret }),
  );
}
