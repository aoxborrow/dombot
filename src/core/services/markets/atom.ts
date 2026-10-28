import { assertDomainName } from '../../../shared/domain-name';
import {
  AtomClient,
  AtomError,
  type AtomAppraisal,
  type AtomCategory,
  type AtomClientOptions,
  type AtomGradeResult,
  type AtomListing,
  type AtomListingType,
  type AtomSale,
} from '../../markets/atom';
import {
  MarketUnsupportedError,
  type AtomActions,
  type MarketAdapter,
  type MarketCapabilities,
  type MarketConfigField,
  type MarketCounters,
  type MarketListing,
  type MarketListingChange,
  type MarketSale,
  type MarketTestResult,
  type MarketWriteResult,
  type ListingStatus,
} from '../../markets/types';

// Atom in the shared market model (docs/markets.md, docs/atom-api.md): maps
// the Atom client's types to and from the shared ones. No storage here.
//
// Atom writes one name per call, and every write here reads the listing
// before and after: before, to know whether to add or reprice it; after,
// because Atom's success answers are at most a message, so the read-back is
// what says what Atom saved.
//
// Reads and writes checked live (2026-10-28, docs/atom-api.md, "Observed").

export const ATOM_CAPABILITIES: MarketCapabilities = {
  currencies: ['USD'],
  // One price: the Make an Offer threshold is an account-wide percentage
  // and the floor exists only in Atom's Google Sheets sync.
  minOffer: false,
  floor: false,
  discount: true,
  // Atom offers payment plans, but not through the API.
  leaseToOwn: false,
  tiers: ['standard', 'plus', 'premium', 'geo'],
  sales: true,
  saleAuthCode: false,
  saleMessages: false,
  accountStats: false,
  // Per-name counters, not a daily series: sync diffs snapshots.
  domainStats: 'snapshot',
  leads: false,
  parkingEarnings: false,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  verifyDns: true,
  asyncInsert: false,
  writeBatch: 1,
  jobs: false,
  // Boost and Premium submissions cost credits; DomBot builds neither.
  spends: false,
  rateLimit: null,
};

export const ATOM_CONFIG_FIELDS: MarketConfigField[] = [
  { name: 'apiToken', label: 'API token', type: 'password', required: true },
  { name: 'userId', label: 'User ID', type: 'text', required: true },
];

/** Atom's minimum for a retail listing. */
export const MIN_PRICE = 100;
/** Atom's cap on a discount, as a share of the price (observed: $195 of $650). */
const MAX_DISCOUNT = 0.3;

// Reading

/**
 * The shared status for Atom's word. Seen live: "Approved" (Premium),
 * "Seller Approved" (Standard), "Transfer Complete" (sold; sold names stay
 * in Atom's list). The rest are guesses at Atom's other words.
 */
export function statusFromAtom(raw: string): ListingStatus {
  const s = raw.trim().toLowerCase();
  if (!s) return 'unknown';
  if (/sold|transfer complete|transferred/.test(s)) return 'sold';
  if (/transfer|escrow|payment/.test(s)) return 'on_hold';
  if (/reject|declin|denied/.test(s)) return 'rejected';
  if (/pending|review|submitted|waiting|processing/.test(s)) return 'pending';
  if (
    /unverified|not verified|verify|dns|inactive|disabled|paused|expired/.test(
      s,
    )
  ) {
    return 'inactive';
  }
  if (/delisted|removed/.test(s)) return 'inactive';
  if (/hold|lock/.test(s)) return 'on_hold';
  if (/approved|active|live|listed|verified|published/.test(s)) return 'active';
  return 'unknown';
}

/** A canonical decimal string ("2500", "1479.09") from dollars. */
export function amountOf(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/** The Monday a discount set at `now` lasts until (UTC), YYYY-MM-DD. */
export function discountUntil(now: number): string {
  const d = new Date(now);
  const days = (8 - d.getUTCDay()) % 7 || 7;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days),
  )
    .toISOString()
    .slice(0, 10);
}

export function listingFromAtom(
  l: AtomListing,
  accountId: string,
  options: { syndicated?: ReadonlySet<string> | null; now?: number } = {},
): MarketListing {
  const price = amountOf(l.price);
  const discount = amountOf(l.discount);
  return {
    market: 'atom',
    accountId,
    name: l.name,
    displayName: l.displayName,
    status: statusFromAtom(l.status),
    statusRaw: l.status,
    // Atom has no hidden listings: a listed name is for sale.
    forSale: true,
    price,
    // Atom's price is always a Buy Now price.
    buyNow: price !== null,
    minOffer: null,
    floor: null,
    discount: discount
      ? { amount: discount, until: discountUntil(options.now ?? Date.now()) }
      : null,
    currency: 'USD',
    leaseToOwn: null,
    tier: l.type,
    listedAt: l.listedAt,
    updatedAt: null,
    extra: {
      market: 'atom',
      id: l.id,
      category: l.primaryCategory,
      description: l.description,
      syndicationAuthorized:
        l.type === 'premium' && options.syndicated
          ? options.syndicated.has(l.name)
          : null,
    },
  };
}

/** Atom's published commission for a sale (docs/atom-api.md). */
export function estimatedCommission(
  type: AtomListingType | null,
  price: number,
): number | null {
  switch (type) {
    case 'standard':
    case 'geo':
      return price * 0.075;
    case 'plus':
      return price * 0.15;
    case 'premium':
      if (price < 4999) return price * 0.3;
      if (price < 50_000) return price * 0.25;
      if (price < 75_000) return price * 0.2;
      return price * 0.15;
    default:
      return null;
  }
}

/**
 * Every row of Atom's sales is a sale that happened; its transfer status
 * ("AuthCode Sent", or null once done, observed) says where the transfer
 * is, not whether it sold. Only a refund or cancellation undoes it.
 */
function saleStatus(s: AtomSale): MarketSale['status'] {
  return /cancel|refund|void|revers/i.test(
    `${s.transferStatus ?? ''} ${s.terms ?? ''}`,
  )
    ? 'cancelled'
    : 'completed';
}

export function saleFromAtom(s: AtomSale, accountId: string): MarketSale {
  const given = s.commission;
  const estimate =
    given === null && s.price !== null
      ? estimatedCommission(s.type, s.price)
      : null;
  const commission = given ?? estimate;
  const net =
    s.net ??
    (s.price !== null && commission !== null ? s.price - commission : null);
  const plan =
    (s.installments && (s.installments.total ?? 0) > 1) ||
    /install|plan|lease|month/i.test(s.terms ?? '');
  return {
    market: 'atom',
    accountId,
    id: s.id,
    name: s.name,
    soldOn: s.soldOn,
    status: saleStatus(s),
    statusRaw: [s.terms, s.transferStatus].filter(Boolean).join(', '),
    kind: plan ? 'lease' : 'unknown',
    price: amountOf(s.price),
    commission: amountOf(commission),
    commissionEstimated: given === null && estimate !== null,
    net: amountOf(net),
    currency: 'USD',
    installments: s.installments
      ? {
          amount: null,
          paid: s.installments.paid,
          total: s.installments.total,
          next: null,
        }
      : null,
    paidOutOn: s.paidOutOn,
    action: null,
  };
}

// Writing

function unsupported(field: string, message: string): never {
  throw new MarketUnsupportedError('atom', field, message);
}

/** Whole dollars from a shared amount, or a rejection saying why not. */
function wholeDollars(field: string, amount: string): number {
  if (!/^\d+(\.0+)?$/.test(amount.trim())) {
    unsupported(field, 'Atom takes whole-dollar amounts.');
  }
  return Number.parseInt(amount, 10);
}

/** Rejects what Atom can't do, before anything is sent. */
export function checkAtomChange(change: MarketListingChange): void {
  if (change.minOffer != null) {
    unsupported(
      'minOffer',
      'Atom has no minimum offer per listing (its Make an Offer threshold is an account setting on atom.com).',
    );
  }
  if (change.floor != null) {
    unsupported('floor', 'Atom’s API has no floor price.');
  }
  if (change.leaseToOwn) {
    unsupported('leaseToOwn', 'Atom’s payment plans aren’t in its API.');
  }
  if (change.currency && change.currency !== 'USD') {
    unsupported('currency', `Atom prices are in USD, not ${change.currency}.`);
  }
  if (change.forSale === false) {
    unsupported(
      'forSale',
      'Atom has no hidden listings; delist the name instead.',
    );
  }
  if (change.buyNow === false) {
    unsupported('buyNow', 'Atom’s price is always a Buy Now price.');
  }
  if (change.displayName !== undefined) {
    unsupported('displayName', 'Atom’s API has no display name.');
  }
  if (change.price != null) {
    const price = wholeDollars('price', change.price);
    if (price < MIN_PRICE) {
      unsupported('price', `Atom’s minimum price is $${MIN_PRICE}.`);
    }
  }
  if (change.extra && change.extra.market !== 'atom') {
    unsupported(
      'extra',
      `Settings for ${change.extra.market} don't apply to Atom.`,
    );
  }
  const category =
    change.extra?.market === 'atom' ? change.extra.category : undefined;
  if (category?.includes('&')) {
    // Observed: "Wrong category name in the request" for every name with
    // an ampersand, however it's encoded, though Atom lists them.
    unsupported(
      'category',
      `Atom’s API refuses category names with “&” (${category}); set it on atom.com.`,
    );
  }
  const tier = change.extra?.market === 'atom' ? change.extra.tier : undefined;
  if (tier && tier !== 'standard' && tier !== 'plus') {
    unsupported(
      'tier',
      'DomBot adds Standard or Plus listings; submit Premium names on atom.com.',
    );
  }
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

function errorOf(error: unknown): { code: string; message: string } {
  if (error instanceof MarketUnsupportedError) {
    return { code: 'UNSUPPORTED', message: error.message };
  }
  if (error instanceof AtomError)
    return { code: error.code, message: error.message };
  return {
    code: 'INVALID',
    message: error instanceof Error ? error.message : String(error),
  };
}

// The adapter

export interface AtomAccountCredentials {
  apiToken?: string;
  userId?: string;
}

export class AtomAdapter implements MarketAdapter, AtomActions {
  readonly market = 'atom' as const;
  readonly capabilities = ATOM_CAPABILITIES;

  constructor(
    readonly accountId: string,
    private readonly client: AtomClient,
    private readonly now: () => number = Date.now,
  ) {}

  private toListing(l: AtomListing, syndicated?: ReadonlySet<string> | null) {
    return listingFromAtom(l, this.accountId, { syndicated, now: this.now() });
  }

  async test(): Promise<MarketTestResult> {
    const page = await this.client.listListings({ limit: 1 });
    return {
      listings: page.total,
      notes: [
        'Atom’s API has no minimum offer, floor or listing defaults: set those on atom.com.',
      ],
    };
  }

  async allListings() {
    const read = await this.client.allListings();
    // Which Premium names may be listed elsewhere; optional, so a failure
    // here leaves the flag unknown rather than failing the sync.
    let syndicated: Set<string> | null = null;
    if (read.listings.some((l) => l.type === 'premium')) {
      try {
        syndicated = new Set(await this.client.allSyndicationAuthorized());
      } catch {
        syndicated = null;
      }
    }
    return {
      listings: read.listings.map((l) => this.toListing(l, syndicated)),
      complete: read.complete,
    };
  }

  async getListings(names: readonly string[]): Promise<MarketListing[]> {
    const out: MarketListing[] = [];
    for (const name of new Set(names.map(assertDomainName))) {
      const l = await this.client.getListing(name);
      if (l) out.push(this.toListing(l));
    }
    return out;
  }

  /**
   * List or update one name (Atom writes one at a time): add it if it isn't
   * listed, else reprice it, then set its category and description, then
   * read it back. Steps that already match Atom are skipped. A failure part
   * way says which steps were saved.
   */
  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    if (changes.length > this.capabilities.writeBatch) {
      throw new Error('Atom writes one name per call.');
    }
    const out: MarketWriteResult[] = [];
    for (const change of changes) out.push(await this.writeOne(change));
    return out;
  }

  private async writeOne(
    change: MarketListingChange,
  ): Promise<MarketWriteResult> {
    let name = change.name;
    const done: string[] = [];
    try {
      name = assertDomainName(change.name);
      checkAtomChange(change);
      const atom = change.extra?.market === 'atom' ? change.extra : undefined;
      // null is Make an Offer, which Atom stores as a price of 0.
      const price =
        change.price === undefined
          ? undefined
          : change.price === null
            ? null
            : wholeDollars('price', change.price);

      const current = await this.client.getListing(name);
      if (!current) {
        if (price === undefined) {
          return failed(
            name,
            'NO_PRICE',
            'Give a price to list a name on Atom.',
          );
        }
        await this.client.createListing(name, {
          price: price ?? 0,
          type: atom?.tier ?? 'standard',
        });
        done.push('listed');
      } else {
        if (atom?.tier && atom.tier !== current.type) {
          unsupported('tier', 'Atom’s API can’t change a listing’s tier.');
        }
        if (price !== undefined && price !== current.price) {
          if (current.price === null && price !== null) {
            // Atom's price update ignores a Make an Offer listing; adding
            // the name again updates it in place (observed).
            if (current.type === 'premium') {
              unsupported(
                'price',
                'Atom’s API can’t price a Make an Offer Premium listing; set it on atom.com.',
              );
            }
            await this.client.createListing(name, {
              price,
              type: current.type === 'plus' ? 'plus' : 'standard',
            });
          } else {
            await this.client.updatePrice(name, price ?? 0);
          }
          done.push('price');
        }
      }
      if (
        atom?.category !== undefined &&
        atom.category !== current?.primaryCategory
      ) {
        await this.client.setPrimaryCategory(name, atom.category);
        done.push('category');
      }
      if (
        atom?.description !== undefined &&
        atom.description.trim() !== (current?.description ?? '')
      ) {
        await this.client.setDescription(name, atom.description);
        done.push('description');
      }

      const after = done.length ? await this.client.getListing(name) : current;
      const saved = after ? this.toListing(after) : null;
      const adjusted: MarketWriteResult['adjusted'] = [];
      const asked = price === undefined ? undefined : amountOf(price);
      if (saved && asked !== undefined && saved.price !== asked) {
        // Atom can answer "Successfully updated selling price" and keep the
        // old price (observed on a Make an Offer listing, before DomBot
        // priced those by adding them again): an unchanged price is a
        // failure, not an adjustment.
        if (done.includes('price') && after?.price === current?.price) {
          const shown =
            current?.price == null ? 'Make an Offer' : `$${current.price}`;
          return failed(
            name,
            'NOT_APPLIED',
            `Atom said it saved the price, but the listing still shows ${shown}. Change it on atom.com.${
              done.length > 1
                ? ` (Saved: ${done.filter((d) => d !== 'price').join(', ')}.)`
                : ''
            }`,
          );
        }
        adjusted.push({ field: 'price', asked, saved: saved.price });
      }
      return {
        name,
        ok: true,
        // Added but not in Atom's details yet.
        pending: done.includes('listed') && !after,
        saved,
        adjusted,
        error: null,
      };
    } catch (error) {
      const e = errorOf(error);
      const partial = done.length ? ` (already saved: ${done.join(', ')})` : '';
      return failed(name, e.code, `${e.message}${partial}`);
    }
  }

  /** Delist Standard and Plus names. A name that isn't listed counts as done. */
  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    if (names.length > this.capabilities.writeBatch) {
      throw new Error('Atom writes one name per call.');
    }
    const out: MarketWriteResult[] = [];
    for (const raw of names) {
      let name = raw;
      try {
        name = assertDomainName(raw);
        const current = await this.client.getListing(name);
        if (current?.type === 'premium') {
          out.push(
            failed(
              name,
              'PREMIUM',
              'Atom removes Premium listings only on a 7-day notice: ask Atom support (service@atom.com).',
            ),
          );
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
        const e = errorOf(error);
        out.push(failed(name, e.code, e.message));
      }
    }
    return out;
  }

  /** Every sale; Atom takes no date filter, so `since` is applied here. */
  async allSales(since?: string): Promise<MarketSale[]> {
    const sales = (await this.client.allSales()).map((s) =>
      saleFromAtom(s, this.accountId),
    );
    return since ? sales.filter((s) => !s.soldOn || s.soldOn >= since) : sales;
  }

  async domainCounters(name: string): Promise<MarketCounters> {
    const a = await this.client.getAnalytics(name);
    return {
      name: a.name,
      views: a.views,
      shortlists: a.shortlists,
      offers: a.offers,
    };
  }

  // Atom only

  async setDiscount(
    name: string,
    amount: string | null,
  ): Promise<MarketWriteResult> {
    let key = name;
    try {
      key = assertDomainName(name);
      const dollars = amount ? wholeDollars('discount', amount) : 0;
      const current = await this.client.getListing(key);
      if (!current)
        return failed(key, 'NOT_LISTED', 'Not listed on this Atom account.');
      if (current.price === null) {
        unsupported(
          'discount',
          'A Make an Offer listing has no price to discount.',
        );
      }
      if (dollars > current.price * MAX_DISCOUNT) {
        unsupported(
          'discount',
          `Atom allows a discount of up to 30% of the price ($${Math.floor(current.price * MAX_DISCOUNT)} here).`,
        );
      }
      if (dollars) {
        await this.client.setDiscount(key, dollars);
      } else if (current.discount !== null) {
        // Atom refuses a 0 discount; setting the price again clears it.
        await this.client.updatePrice(key, current.price);
      }
      const after = await this.client.getListing(key);
      const saved = after ? this.toListing(after) : null;
      const asked = dollars ? String(dollars) : null;
      return {
        name: key,
        ok: true,
        pending: false,
        saved,
        adjusted:
          saved && (saved.discount?.amount ?? null) !== asked
            ? [
                {
                  field: 'discount',
                  asked,
                  saved: saved.discount?.amount ?? null,
                },
              ]
            : [],
        error: null,
      };
    } catch (error) {
      const e = errorOf(error);
      return failed(key, e.code, e.message);
    }
  }

  async verifyDns(name: string): Promise<MarketWriteResult> {
    let key = name;
    try {
      key = assertDomainName(name);
      await this.client.verifyDns(key);
      const after = await this.client.getListing(key);
      return {
        name: key,
        ok: true,
        pending: false,
        saved: after ? this.toListing(after) : null,
        adjusted: [],
        error: null,
      };
    } catch (error) {
      const e = errorOf(error);
      return failed(key, e.code, e.message);
    }
  }

  primaryCategories(): Promise<AtomCategory[]> {
    return this.client.listPrimaryCategories();
  }

  async submitForGrading(
    names: readonly string[],
  ): Promise<{ submitted: number }> {
    await this.client.submitForGrading(names);
    return { submitted: new Set(names.map(assertDomainName)).size };
  }

  async gradingResults(
    options: { page?: number; brandFitOnly?: boolean } = {},
  ): Promise<{
    results: AtomGradeResult[];
    total: number | null;
  }> {
    const page = await this.client.getGradingResults(options);
    return { results: page.items, total: page.total };
  }

  appraisal(name: string): Promise<AtomAppraisal> {
    return this.client.getAppraisal(name);
  }
}

/** An adapter for a stored Atom account. */
export function createAtomAdapter(
  accountId: string,
  credentials: AtomAccountCredentials,
  options: Omit<AtomClientOptions, 'apiToken' | 'userId'> = {},
): AtomAdapter {
  const { apiToken, userId } = credentials;
  if (!apiToken || !userId) {
    throw new Error('This Atom account needs an API token and user ID.');
  }
  return new AtomAdapter(
    accountId,
    new AtomClient({ ...options, apiToken, userId }),
  );
}
