import { assertDomainName, toAscii } from '../../../shared/domain-name';
import {
  DYNADOT_CURRENCIES,
  DynadotClient,
  DynadotError,
  isDynadotCurrency,
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
// Reads and writes are checked live (2026-11-04). Writes ask Dynadot first
// which kind a name is (`domain_info`), then use that kind's command.
// Dynadot won't list a name held elsewhere until it has verified it, so
// DomBot keeps that listing pending, the way other markets hold a listing
// while they check ownership, and sends it once Dynadot has verified the
// name (`listVerified`, from a sync or a Recheck).

export const DYNADOT_CAPABILITIES: MarketCapabilities = {
  // The 30 Dynadot documents that DomBot has. A listing keeps its currency,
  // but no read says which it is (see `currencyFor`).
  currencies: DYNADOT_CURRENCIES,
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
  // A name held elsewhere stays pending until Dynadot has verified it.
  asyncInsert: true,
  writeBatch: 1,
  jobs: false,
  spends: false,
  // The account's limit by price level: 60 a minute on Regular, 600 on
  // Bulk, 6,000 on Super Bulk; the client paces under the lowest.
  rateLimit: 60,
};

/** None of its own: the account uses a Dynadot registrar account's key. */
export const DYNADOT_CONFIG_FIELDS: MarketConfigField[] = [];

/** The other-registrar list shows every price in USD, converted (observed). */
const LIST_CURRENCY = 'USD';

// Reading

export function listingFromDynadot(
  l: DynadotListing,
  accountId: string,
  /** The currency it was read in: Dynadot converts to the one asked for. */
  currency: string = LIST_CURRENCY,
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
    currency: currency as MarketListing['currency'],
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
 * transfer is under way (a buyer has paid), on hold. The price is in USD
 * whatever the listing's currency: the list converts it (a listing at
 * €999,999 read "$1115069.88", observed). UNVERIFIED: which transfer
 * statuses Dynadot uses.
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
    currency: LIST_CURRENCY,
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
  if (change.leaseToOwn?.enabled) {
    unsupported('leaseToOwn', 'DomBot doesn’t set Dynadot’s installments yet.');
  }
  if (change.currency && !isDynadotCurrency(change.currency)) {
    unsupported('currency', `Dynadot doesn’t list in ${change.currency}.`);
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
 * higher", observed), and never shows it back. So a change to a listing
 * that takes offers, without a minimum of its own, sends DomBot's minimum
 * offer for the name (`fallbackMinOffer`, in the listing's currency);
 * with none in DomBot, it's refused. A price alone is Buy Now; a minimum
 * offer alone, Make Offer. `currency` is what the listing goes out in.
 */
export function listingFor(
  change: MarketListingChange,
  current: { type: DynadotListingType | null; price: Amount | null } | null,
  fallbackMinOffer: Amount | null = null,
  currency: string = 'USD',
): Pick<DynadotListingInput, 'listingType' | 'price' | 'minOffer'> {
  const price =
    change.price !== undefined ? change.price : (current?.price ?? null);
  const takesOffers =
    current?.type === 'make_offer' || current?.type === 'bin_make_offer';
  let minOffer = change.minOffer ?? null;
  if (change.minOffer === undefined && takesOffers) {
    if (!fallbackMinOffer) {
      unsupported(
        'minOffer',
        'This Dynadot listing takes offers, and Dynadot needs a minimum offer with every change. Set one in DomBot’s asking price, or clear it to turn offers off.',
      );
    }
    minOffer = fallbackMinOffer;
  }
  // Dynadot's floor; in other currencies, Dynadot says.
  if (currency === 'USD' && minOffer !== null && Number(minOffer) < 1) {
    unsupported('minOffer', 'Dynadot’s minimum offer must be $1.00 or more.');
  }
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

/** DomBot unlocked a name to write and couldn't lock it again. */
class RelockError extends Error {}

/** Dynadot's account lock, which DomBot never turns off. */
const ACCOUNT_LOCKED = 'Dynadot account must be unlocked to change listings.';

function failedFrom(
  name: string,
  error: unknown,
  /** The currency the listing went out in, for a refusal of it. */
  currency?: string,
): MarketWriteResult {
  if (error instanceof DynadotError && error.code === 'ACCOUNT_LOCKED') {
    return failed(name, 'ACCOUNT_LOCKED', ACCOUNT_LOCKED);
  }
  // Dynadot documents 32 listing currencies, but one account took only 14
  // (observed): "The value for parameter currency is invalid."
  if (
    error instanceof DynadotError &&
    /parameter currency is invalid/i.test(error.message)
  ) {
    return failed(
      name,
      'CURRENCY',
      `Dynadot didn’t accept ${currency ?? 'the currency'} for this listing.`,
    );
  }
  if (error instanceof RelockError) {
    return failed(name, 'RELOCK_FAILED', error.message);
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

/** A listing with a buyer's purchase under way: written neither way. */
function onHold(name: string): MarketWriteResult {
  return failed(
    name,
    'ON_HOLD',
    'A buyer’s purchase is under way on Dynadot, so the listing stays as it is.',
  );
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
 * the other-registrar list means reading every page. Pending while Dynadot
 * hasn't verified the name: then it also keeps the minimum offer asked for,
 * which goes out with the listing once Dynadot has verified it. A listed
 * name's minimum isn't kept: Dynadot never shows it, so a sync would drop
 * it anyway.
 */
function asSavedElsewhere(
  name: string,
  input: Pick<
    DynadotListingInput,
    'listingType' | 'price' | 'minOffer' | 'currency'
  >,
  accountId: string,
  verified = true,
): MarketListing {
  const listing = listingFromExternal(
    {
      name,
      registrar: null,
      status: '',
      verified,
      verifyStatusRaw: verified ? 'Verified' : 'Unverified',
      listingType: input.listingType,
      listingTypeRaw: LIST_TYPE_LABEL[input.listingType],
      price: input.price,
      transferStatus: null,
      updatedAt: null,
    },
    accountId,
  )!;
  // In the currency sent, until a sync reads the list's USD.
  listing.currency = input.currency as MarketListing['currency'];
  return verified
    ? listing
    : {
        ...listing,
        // What DomBot asked for, which Dynadot lists once it can.
        forSale: true,
        minOffer: input.minOffer,
        listedAt: new Date().toISOString(),
      };
}

/** How the other-registrar list words each listing type (observed). */
const LIST_TYPE_LABEL: Record<DynadotListingType, string> = {
  bin: 'Buy Now',
  make_offer: 'Make Offer',
  bin_make_offer: 'Buy Now + Make Offer',
};

/** A listing DomBot holds until Dynadot has verified the name. */
function pendingResult(saved: MarketListing): MarketWriteResult {
  return {
    name: saved.name,
    ok: true,
    pending: true,
    saved,
    adjusted: [],
    error: null,
  };
}

// The adapter

export interface DynadotAccountCredentials {
  apiKey?: string;
  apiSecret?: string;
}

/** DomBot's asking price for a name, as far as Dynadot writes use it. */
export interface DynadotAsking {
  currency: string;
  minOffer: Amount | null;
}

export class DynadotAdapter implements MarketAdapter {
  readonly market = 'dynadot' as const;
  readonly capabilities = DYNADOT_CAPABILITIES;
  /** The last other-registrar list read, for the verification key. */
  private external: DynadotExternalDomain[] | null = null;

  constructor(
    readonly accountId: string,
    private readonly client: DynadotClient,
    /** DomBot's asking price for a name: its currency and minimum offer. */
    private readonly askingFor: (name: string) => DynadotAsking | null = () =>
      null,
  ) {}

  /**
   * The currency to read and list a name in: its DomBot asking price's,
   * when Dynadot takes it, else USD. No read says a listing's own currency,
   * and Dynadot converts to whichever is asked for, so a listing DomBot
   * made reads back exactly, and one priced in another currency on
   * Dynadot's site reads converted.
   */
  private currencyFor(name: string): string {
    const currency = this.askingFor(name)?.currency;
    return isDynadotCurrency(currency) ? currency : 'USD';
  }

  /** DomBot's minimum offer for a name, when it's in `currency`. */
  private minOfferIn(name: string, currency: string): Amount | null {
    const asking = this.askingFor(name);
    return asking?.currency === currency ? asking.minOffer : null;
  }

  /**
   * A write to a name in the account. Dynadot refuses one while the name is
   * locked (409, observed), so DomBot unlocks it, writes, and locks it again
   * whatever the write did. The account lock it never touches.
   */
  private async withNameUnlocked(
    name: string,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
      return;
    } catch (error) {
      if (!(error instanceof DynadotError && error.code === 'DOMAIN_LOCKED')) {
        throw error;
      }
    }
    try {
      await this.client.setLock(name, false);
    } catch (error) {
      // A refusal changed nothing. With no answer, or a server error,
      // Dynadot may have unlocked it all the same: lock it again.
      const uncertain =
        !(error instanceof DynadotError) ||
        error.status === 0 ||
        error.status >= 500;
      if (uncertain) await this.relock(name, true);
      throw error;
    }
    let failure: unknown = null;
    try {
      await write();
    } catch (error) {
      failure = error;
    }
    await this.relock(name);
    if (failure) throw failure;
  }

  /** Lock a name again after unlocking it (or maybe unlocking it) to write. */
  private async relock(name: string, maybe = false): Promise<void> {
    try {
      await this.client.setLock(name, true);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new RelockError(
        `${name} ${maybe ? 'may be' : 'is'} unlocked: couldn’t lock it again (${why}).`,
      );
    }
  }

  /** The key works: Dynadot answers the account read. */
  async test(): Promise<MarketTestResult> {
    await this.client.accountInfo();
    return { listings: null, notes: [] };
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
        const currency = this.currencyFor(d.name);
        const l = await this.client.getListing(d.name, currency);
        if (l) listings.push(listingFromDynadot(l, this.accountId, currency));
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
    // Punycode, as both of Dynadot's lists key names.
    const wanted = new Set(names.map((n) => toAscii(n)));
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
      const currency = this.currencyFor(name);
      const l = await this.client.getListing(name, currency);
      if (l) out.push(listingFromDynadot(l, this.accountId, currency));
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
        out.push(
          failedFrom(name, error, change.currency ?? this.currencyFor(name)),
        );
      }
    }
    return out;
  }

  /** A name in the account: read what's listed, set it, read it back. */
  private async writeHeld(
    name: string,
    change: MarketListingChange,
  ): Promise<MarketWriteResult> {
    // Read in the currency it goes out in, so a kept price is in it too.
    const currency = change.currency ?? this.currencyFor(name);
    const current = await this.client.getListing(name, currency);
    if (current?.pendingSale) return onHold(name);
    const input: DynadotListingInput = {
      forSale: true,
      ...listingFor(change, current, this.minOfferIn(name, currency), currency),
      currency,
    };
    await this.withNameUnlocked(name, () =>
      this.client.setForSale(name, input),
    );
    // A name in the account reads at the seller's price (no transfer fee),
    // observed in USD.
    const saved = await this.client
      .getListing(name, currency)
      .catch(() => null);
    return written(
      name,
      change,
      saved ? listingFromDynadot(saved, this.accountId, currency) : null,
    );
  }

  /**
   * A name held elsewhere: added to the other-registrar list if it isn't
   * there, and listed once Dynadot has verified it. Dynadot refuses the
   * listing before that (observed), so an unverified name is put to
   * Dynadot's verify first (its TXT record may be in place already); if it
   * still isn't verified, it's pending in DomBot, with the price asked for.
   */
  private async writeElsewhere(
    name: string,
    change: MarketListingChange,
  ): Promise<MarketWriteResult> {
    const verification = await this.client.verification(name);
    if (!verification?.verified) {
      const currency = change.currency ?? this.currencyFor(name);
      const input = { ...listingFor(change, null, null, currency), currency };
      if (!verification) await this.client.addExternal([name]);
      const { verified } = await this.client.verifyExternal([name]);
      if (!verified.includes(name)) {
        return pendingResult(
          asSavedElsewhere(name, input, this.accountId, false),
        );
      }
    }
    // The listing read covers these names too, with the right type but the
    // buyer's price (observed); the seller's is on the other-registrar
    // list, read only when the change keeps the price. A read that fails
    // fails the write: guessing "not listed" could turn offers off.
    const current = await this.client.getListing(name, LIST_CURRENCY);
    if (current?.pendingSale) return onHold(name);
    const keepsPrice = current !== null && change.price === undefined;
    // A kept price comes from the list, which shows it in USD only.
    if (keepsPrice && change.currency && change.currency !== LIST_CURRENCY) {
      unsupported(
        'currency',
        `Give a price in ${change.currency} too: Dynadot shows this listing’s price only in USD.`,
      );
    }
    const currency = keepsPrice
      ? LIST_CURRENCY
      : (change.currency ?? this.currencyFor(name));
    const sellerPrice = keepsPrice
      ? ((await this.client.externalDomains()).domains.find(
          (d) => d.name === name,
        )?.price ?? null)
      : null;
    const input: DynadotListingInput = {
      forSale: true,
      ...listingFor(
        change,
        current ? { type: current.type, price: sellerPrice } : null,
        this.minOfferIn(name, currency),
        currency,
      ),
      currency,
    };
    await this.client.listExternal(name, input);
    return written(name, change, asSavedElsewhere(name, input, this.accountId));
  }

  /**
   * Pending listings of names held elsewhere: Dynadot is asked to verify
   * them all (one call), and those it verifies are listed; sync, Recheck
   * and the end of an Ownership verification TXT job call this. Each
   * result's `saved` is the listing as it stands now: listed, or still
   * pending. A name no longer on Dynadot's other-registrar list fails
   * (NOT_FOUND); sync then treats it like any listing the market never took.
   */
  async listVerified(
    pending: readonly MarketListing[],
  ): Promise<MarketWriteResult[]> {
    if (!pending.length) return [];
    let verified: Set<string>;
    try {
      verified = new Set(
        (await this.client.verifyExternal(pending.map((r) => r.name))).verified,
      );
    } catch (error) {
      return pending.map((r) => failedFrom(r.name, error));
    }
    const out: MarketWriteResult[] = [];
    for (const row of pending) {
      const name = row.name;
      try {
        if (!verified.has(name)) {
          // Verify fails a name that isn't on the list too.
          out.push(
            (await this.client.verification(name))
              ? pendingResult(row)
              : failed(
                  name,
                  'NOT_FOUND',
                  `${name} isn’t on Dynadot’s list of names held elsewhere any more.`,
                ),
          );
          continue;
        }
        const currency = isDynadotCurrency(row.currency)
          ? row.currency
          : this.currencyFor(name);
        const input: DynadotListingInput = {
          forSale: true,
          ...listingFor(
            { name, price: row.price, minOffer: row.minOffer },
            null,
            null,
            currency,
          ),
          currency,
        };
        await this.client.listExternal(name, input);
        out.push(
          written(
            name,
            { name, price: row.price },
            asSavedElsewhere(name, input, this.accountId),
          ),
        );
      } catch (error) {
        out.push(failedFrom(name, error, row.currency ?? undefined));
      }
    }
    return out;
  }

  /**
   * Delist: `not_for_sale` for either kind. A name held elsewhere stays on
   * the other-registrar list, verified, so listing it again is one call. A
   * name with no listing counts as delisted, and so does one held elsewhere
   * that Dynadot hasn't verified, which it can't list (and whose delist it
   * refuses, 409 "This domain is not verified", observed).
   */
  async deleteListings(names: readonly string[]): Promise<MarketWriteResult[]> {
    const out: MarketWriteResult[] = [];
    for (const raw of names) {
      let name = raw;
      try {
        name = assertDomainName(raw);
        if (await this.client.holds(name)) {
          const current = await this.client.getListing(name, LIST_CURRENCY);
          if (current?.pendingSale) {
            out.push(onHold(name));
            continue;
          }
          if (current) {
            await this.withNameUnlocked(name, () =>
              this.client.setForSale(name, {
                forSale: false,
                // Required, though it changes nothing here.
                listingType: 'bin',
                price: null,
                minOffer: null,
                currency: LIST_CURRENCY,
              }),
            );
          }
        } else if ((await this.client.verification(name))?.verified) {
          if (
            (await this.client.getListing(name, LIST_CURRENCY))?.pendingSale
          ) {
            out.push(onHold(name));
            continue;
          }
          await this.client.listExternal(name, {
            forSale: false,
            listingType: 'bin',
            price: null,
            minOffer: null,
            currency: LIST_CURRENCY,
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
  {
    askingFor,
    ...options
  }: Omit<DynadotClientOptions, 'apiKey' | 'apiSecret'> & {
    /** DomBot's asking price for a name (see `currencyFor`, `listingFor`). */
    askingFor?: (name: string) => DynadotAsking | null;
  } = {},
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
    askingFor,
  );
}
