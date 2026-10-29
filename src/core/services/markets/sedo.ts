import { assertDomainName } from '../../../shared/domain-name';
import {
  SedoClient,
  SedoError,
  WRITE_BATCH,
  SEDO_CURRENCIES,
  type SedoCategory,
  type SedoClientOptions,
  type SedoCurrency,
  type SedoLanguage,
  type SedoListing,
  type SedoListingInput,
  type SedoParkingStats,
  type SedoPayment,
} from '../../markets/sedo';
import {
  MarketUnsupportedError,
  type MarketAdapter,
  type MarketCapabilities,
  type MarketConfigField,
  type MarketListing,
  type MarketListingChange,
  type MarketStatsDay,
  type MarketTestResult,
  type MarketWriteResult,
  type SedoActions,
} from '../../markets/types';

// Sedo in the shared market model (docs/markets.md, docs/sedo-api.md): maps
// the Sedo client's types to and from the shared ones. No storage here.
//
// Reads and writes checked against a live account (2026-10-28);
// docs/sedo-api.md, "Unverified", lists what's left.

export const SEDO_CAPABILITIES: MarketCapabilities = {
  currencies: SEDO_CURRENCIES,
  minOffer: true,
  floor: false,
  discount: false,
  leaseToOwn: false,
  tiers: null,
  // The API has no sales, offers or leads: Sedo sales are recorded by hand
  // or imported from Sedo's CSV export.
  sales: false,
  saleAuthCode: false,
  saleMessages: false,
  accountStats: true,
  // Parking visitors per day, for the last 31 days only.
  domainStats: 'daily',
  leads: false,
  parkingEarnings: true,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  verifyDns: false,
  // A new listing is checked before it's added; until then it's in no list.
  asyncInsert: true,
  writeBatch: WRITE_BATCH,
  jobs: false,
  spends: false,
  // Unpublished; the client paces itself at a guessed 60 a minute.
  rateLimit: null,
};

export const SEDO_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'partnerId', label: 'Partner ID', type: 'text', required: true },
  { name: 'signKey', label: 'Sign key', type: 'password', required: true },
  { name: 'username', label: 'Sedo username', type: 'text', required: true },
  {
    name: 'password',
    label: 'Sedo password',
    type: 'password',
    required: true,
  },
];

/** Daily parking stats go back this far, no further. */
const DAILY_DAYS = 31;
/**
 * Sedo refuses a fixed price under 199 USD or EUR (fault E3123); GBP isn't
 * mentioned. UNVERIFIED beyond the fault text.
 */
const MIN_FIXED_PRICE = 199;
/** The language a new listing gets when DomBot isn't told one. */
const DEFAULT_LANGUAGE = 'en';

// Reading

export function listingFromSedo(
  l: SedoListing,
  accountId: string,
): MarketListing {
  return {
    market: 'sedo',
    accountId,
    name: l.name,
    displayName: null,
    // In the account's list means Sedo accepted it: it's live, parked, and
    // shown for sale or not. A name still being checked isn't in the list.
    status: 'active',
    statusRaw: l.forSale ? 'for sale' : 'not for sale',
    forSale: l.forSale,
    // Every price DomBot shows is Buy Now, as in aftermarket's Sedo driver:
    // a "Seller's asking price" (not fixed) is neither Buy Now nor a minimum
    // offer, so it reads as offers only, and an update clears it
    // (mergeSedoChange).
    price: l.fixedPrice ? l.price : null,
    buyNow: l.fixedPrice && l.price != null,
    minOffer: l.minPrice,
    floor: null,
    discount: null,
    currency: l.currency,
    leaseToOwn: null,
    tier: null,
    listedAt: l.insertedAt,
    updatedAt: null,
    extra: {
      market: 'sedo',
      categories: l.categories,
      language: l.language,
      parkingEarnings: l.earningsTotal,
      keywords: (l.keywords ?? []).map((k) => k.keyword).filter(Boolean),
    },
  };
}

export function statsFromSedo(
  rows: readonly SedoParkingStats[],
  accountId: string,
  name: string | null,
): MarketStatsDay[] {
  return rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .map((r) => ({
      market: 'sedo',
      accountId,
      name,
      date: r.date,
      views: r.visitors,
      leads: null,
      clicks: r.clicks,
      earnings: r.earnings,
      // UNVERIFIED: the docs don't say which currency parking earnings are
      // in, so they're stored without one.
      currency: null,
      shortlists: null,
      trackers: null,
      source: 'market',
    }));
}

/** The last `days` of daily rows, as the shared stats methods promise. */
function lastDays(rows: MarketStatsDay[], days: number): MarketStatsDay[] {
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-Math.max(0, days));
}

// Writing

function unsupported(field: string, message: string): never {
  throw new MarketUnsupportedError('sedo', field, message);
}

function isSedoCurrency(c: string): c is SedoCurrency {
  return (SEDO_CURRENCIES as readonly string[]).includes(c);
}

/** Rejects what Sedo can't do, before anything is sent. */
export function checkSedoChange(change: MarketListingChange): void {
  if (change.floor != null) {
    unsupported('floor', 'Sedo has no floor price.');
  }
  if (change.leaseToOwn) {
    unsupported('leaseToOwn', 'Sedo’s API has no lease-to-own.');
  }
  if (change.currency && !isSedoCurrency(change.currency)) {
    unsupported(
      'currency',
      `Sedo prices are in EUR, USD or GBP, not ${change.currency}.`,
    );
  }
  if (change.extra && change.extra.market !== 'sedo') {
    unsupported(
      'extra',
      `Settings for ${change.extra.market} don't apply to Sedo.`,
    );
  }
  if (change.extra?.market === 'sedo' && change.extra.categories) {
    if (change.extra.categories.length > 3) {
      unsupported('categories', 'Sedo takes at most three categories.');
    }
  }
  if (change.displayName !== undefined) {
    unsupported('displayName', 'Sedo’s API has no display name.');
  }
}

/** A shared change applied to a Sedo listing (or to a new one). */
export function mergeSedoChange(
  change: MarketListingChange,
  current: SedoListing | null,
): SedoListingInput {
  const sedo = change.extra?.market === 'sedo' ? change.extra : undefined;
  // DomBot sends a Buy Now price, a minimum offer, or both. An update
  // clears a "Seller's asking price" (a price that isn't fixed) rather than
  // keeping it.
  const price =
    change.price !== undefined
      ? change.price
      : current?.fixedPrice
        ? current.price
        : null;
  const input: SedoListingInput = {
    name: change.name,
    categories: sedo?.categories ?? current?.categories ?? [],
    forSale: change.forSale ?? current?.forSale ?? true,
    price,
    minPrice:
      change.minOffer !== undefined
        ? change.minOffer
        : (current?.minPrice ?? null),
    fixedPrice: price != null,
    currency:
      (change.currency as SedoCurrency | undefined) ??
      current?.currency ??
      'USD',
    // An edit keeps the name's language, which is often unset (all 43 of
    // the first account checked live); only a new listing needs one.
    language: sedo?.language ?? (current ? current.language : DEFAULT_LANGUAGE),
  };
  if (input.minPrice && price && Number(input.minPrice) > Number(price)) {
    unsupported('minOffer', 'Sedo’s minimum offer can’t be above the price.');
  }
  if (
    input.fixedPrice &&
    price &&
    input.currency !== 'GBP' &&
    Number(price) < MIN_FIXED_PRICE
  ) {
    unsupported(
      'price',
      `Sedo needs a Buy Now price of at least ${MIN_FIXED_PRICE} ${input.currency}; leave the price empty for offers only, with a minimum offer.`,
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

/** What a written listing will look like, before Sedo shows it. */
function asSaved(
  input: SedoListingInput,
  accountId: string,
  pending: boolean,
  listedAt: string | null,
): MarketListing {
  const listing = listingFromSedo(
    {
      name: input.name,
      categories: input.categories ?? [],
      forSale: input.forSale,
      price: input.price,
      minPrice: input.minPrice,
      fixedPrice: input.fixedPrice,
      currency: input.currency,
      language: input.language ?? null,
      insertedAt: listedAt,
      earningsTotal: null,
      keywords: null,
    },
    accountId,
  );
  return pending
    ? {
        ...listing,
        status: 'pending',
        statusRaw: 'awaiting Sedo’s checks',
      }
    : listing;
}

// The adapter

export interface SedoAccountCredentials {
  partnerId?: string;
  signKey?: string;
  username?: string;
  password?: string;
}

export class SedoAdapter implements MarketAdapter, SedoActions {
  readonly market = 'sedo' as const;
  readonly capabilities = SEDO_CAPABILITIES;

  constructor(
    readonly accountId: string,
    private readonly client: SedoClient,
    private readonly now: () => number = Date.now,
  ) {}

  async test(): Promise<MarketTestResult> {
    if (!(await this.client.checkMember())) {
      throw new Error('Sedo doesn’t recognize this username.');
    }
    return {
      // Sedo's list has no total; counting means reading every page.
      listings: null,
      notes: [],
    };
  }

  async allListings() {
    const listings = await this.client.allListings(true);
    return {
      listings: listings.map((l) => listingFromSedo(l, this.accountId)),
      // No total to check against; a failed page throws instead.
      complete: true,
    };
  }

  async getListings(names: readonly string[]) {
    return (await this.client.getListings(names)).map((l) =>
      listingFromSedo(l, this.accountId),
    );
  }

  /**
   * List or update up to 50 names. One read finds which are listed already:
   * those are edited with the change merged into what Sedo has (DomainEdit
   * replaces the whole listing), the rest inserted. Inserts come back
   * `pending`: Sedo checks a name before adding it, and only says why it
   * refused by email.
   */
  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    if (changes.length > WRITE_BATCH) {
      throw new Error(`At most ${WRITE_BATCH} changes per call.`);
    }
    const keys: string[] = [];
    const results = new Map<string, MarketWriteResult>();
    const valid: MarketListingChange[] = [];
    for (const change of changes) {
      let key = change.name;
      try {
        key = assertDomainName(change.name);
        checkSedoChange(change);
        valid.push({ ...change, name: key });
      } catch (error) {
        results.set(
          key,
          failed(
            key,
            error instanceof MarketUnsupportedError ? 'UNSUPPORTED' : 'INVALID',
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      keys.push(key);
    }

    const current = new Map(
      valid.length
        ? (await this.client.getListings(valid.map((c) => c.name))).map((l) => [
            l.name,
            l,
          ])
        : [],
    );
    const edits: SedoListingInput[] = [];
    const inserts: SedoListingInput[] = [];
    for (const change of valid) {
      try {
        const now = current.get(change.name) ?? null;
        (now ? edits : inserts).push(mergeSedoChange(change, now));
      } catch (error) {
        results.set(
          change.name,
          failed(
            change.name,
            'UNSUPPORTED',
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    const listedAt = new Date(this.now())
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    const record = async (
      inputs: SedoListingInput[],
      write: (i: SedoListingInput[]) => Promise<
        {
          name: string;
          ok: boolean;
          code: string | null;
          message: string | null;
        }[]
      >,
      pending: boolean,
    ) => {
      if (!inputs.length) return;
      const byName = new Map(inputs.map((i) => [i.name, i]));
      for (const r of await write(inputs)) {
        const input = byName.get(r.name);
        results.set(r.name, {
          name: r.name,
          ok: r.ok,
          pending: r.ok && pending,
          // An `ok` edit is live at once (checked live). A new name shows in
          // Sedo's list within seconds but not for sale until its checks
          // pass; the next sync brings that state in.
          saved:
            r.ok && input
              ? asSaved(
                  input,
                  this.accountId,
                  pending,
                  pending
                    ? listedAt
                    : (current.get(r.name)?.insertedAt ?? null),
                )
              : null,
          adjusted: [],
          error: r.ok
            ? null
            : { code: r.code ?? 'UNKNOWN', message: r.message ?? '' },
        });
      }
    };
    await record(edits, (i) => this.client.editListings(i), false);
    await record(inserts, (i) => this.client.insertListings(i), true);

    return keys.map(
      (key) =>
        results.get(key) ??
        failed(key, 'NO_RESULT', 'Sedo returned no result for this name.'),
    );
  }

  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    const results = await this.client.deleteListings(names);
    return results.map((r) => {
      // E4101: "not yet in our database or has possibly been deleted".
      const gone = r.ok || r.code === 'E4101';
      return {
        name: r.name,
        ok: gone,
        pending: false,
        saved: null,
        adjusted: [],
        error: gone
          ? null
          : { code: r.code ?? 'UNKNOWN', message: r.message ?? '' },
      };
    });
  }

  /** Parking visitors, clicks and earnings per day; at most 31 days back. */
  async accountStats(days: number): Promise<MarketStatsDay[]> {
    const rows = await this.client.dailyParkingStats();
    return lastDays(
      statsFromSedo(rows, this.accountId, null),
      Math.min(days, DAILY_DAYS),
    );
  }

  async domainStats(name: string, days: number): Promise<MarketStatsDay[]> {
    try {
      const rows = await this.client.dailyParkingStats(name);
      return lastDays(
        statsFromSedo(rows, this.accountId, name),
        Math.min(days, DAILY_DAYS),
      );
    } catch (error) {
      // E2104: the name isn't in Sedo's parking system (yet): no traffic.
      if (error instanceof SedoError && error.code === 'E2104') return [];
      throw error;
    }
  }

  // Sedo only

  categories(): Promise<SedoCategory[]> {
    return this.client.categories();
  }

  languages(): Promise<SedoLanguage[]> {
    return this.client.languages();
  }

  parkingPayments(month: string): Promise<SedoPayment[]> {
    return this.client.parkingPayments(month);
  }
}

/** An adapter for a stored Sedo account. */
export function createSedoAdapter(
  accountId: string,
  credentials: SedoAccountCredentials,
  options: Omit<
    SedoClientOptions,
    'partnerId' | 'signKey' | 'username' | 'password'
  > = {},
): SedoAdapter {
  const { partnerId, signKey, username, password } = credentials;
  if (!partnerId || !signKey || !username || !password) {
    throw new Error(
      'This Sedo account needs a partner ID, sign key, username and password.',
    );
  }
  return new SedoAdapter(
    accountId,
    new SedoClient({ ...options, partnerId, signKey, username, password }),
  );
}
