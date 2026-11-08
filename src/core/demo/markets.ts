import type {
  AccountSettingsInput,
  AfternicAccountSettings,
} from '../markets/afternic/types';
import type {
  MarketCapabilities,
  MarketCounters,
  MarketId,
  MarketListing,
  MarketListingChange,
  MarketSale,
  MarketStatsDay,
  MarketTestResult,
  MarketWriteResult,
} from '../markets/types';
import { SEARCH_DATA_FLAG } from '../../shared/markets';
import { AFTERNIC_CAPABILITIES } from '../services/markets/afternic';
import { ATOM_CAPABILITIES } from '../services/markets/atom';
import { DYNADOT_CAPABILITIES } from '../services/markets/dynadot';
import type { AnyMarketAdapter } from '../services/markets/registry';
import { SEDO_CAPABILITIES } from '../services/markets/sedo';
import { SPACESHIP_CAPABILITIES } from '../services/markets/spaceship';
import { pick, rng, type DemoAskingPrice } from './seed';

// The demo's marketplaces: an Afternic, a Sedo, an Atom and a Dynadot account
// over one in-memory world, so the Markets page, the listing columns, the listing
// editor and the bell have something real-looking to show without a key.
// Writes change the world the way each market would, within its
// capabilities: Sedo holds a new name pending, Afternic caps lease months by
// price, Atom takes one whole-dollar price. Nothing leaves the page.

const CAPABILITIES: Record<MarketId, MarketCapabilities> = {
  afternic: AFTERNIC_CAPABILITIES,
  atom: ATOM_CAPABILITIES,
  dynadot: DYNADOT_CAPABILITIES,
  sedo: SEDO_CAPABILITIES,
  spaceship: SPACESHIP_CAPABILITIES,
};

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A stable number from a string, for per-name traffic. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Afternic keeps each lease payment above about $80 (docs/afternic-api.md). */
const MIN_LEASE_PAYMENT = 80;

/** Everything the demo markets hold, by account. */
export class DemoMarketWorld {
  readonly listings = new Map<string, Map<string, MarketListing>>();
  readonly sales = new Map<string, MarketSale[]>();
  readonly settings = new Map<string, AfternicAccountSettings>();
  readonly market = new Map<string, MarketId>();
  /** Names the demo's Dynadot registrar account holds. */
  heldAtDynadot: (name: string) => boolean = () => false;
  /** Names the demo's Spaceship registrar account holds. */
  heldAtSpaceship: (name: string) => boolean = () => false;
  constructor(readonly now: number = Date.now()) {}

  account(id: string): Map<string, MarketListing> {
    let m = this.listings.get(id);
    if (!m) this.listings.set(id, (m = new Map()));
    return m;
  }
}

function ok(saved: MarketListing | null, name: string): MarketWriteResult {
  return {
    name,
    ok: true,
    pending: saved?.status === 'pending',
    saved,
    adjusted: [],
    error: null,
  };
}

function refused(name: string, message: string): MarketWriteResult {
  return {
    name,
    ok: false,
    pending: false,
    saved: null,
    adjusted: [],
    error: { code: 'UNSUPPORTED', message },
  };
}

/** Why a market refuses a change, or null when it takes it. */
function refusal(
  market: MarketId,
  caps: MarketCapabilities,
  change: MarketListingChange,
  price: string | null,
  currency: string,
): string | null {
  if (change.floor != null && !caps.floor)
    return 'This market has no floor price.';
  if (change.minOffer != null && !caps.minOffer)
    return 'This market has no minimum offer.';
  if (change.leaseToOwn?.enabled && !caps.leaseToOwn)
    return 'This market has no lease-to-own.';
  if (!caps.currencies.includes(currency as never))
    return `Prices here are in ${caps.currencies.join(', ')}.`;
  if (market === 'atom') {
    if (change.forSale === false) return 'Atom listings are always shown.';
    if (price && (!/^\d+(\.0+)?$/.test(price) || Number(price) < 100))
      return 'Atom takes one whole-dollar price of $100 or more.';
  }
  if (market === 'sedo' && price && currency !== 'GBP' && Number(price) < 199)
    return `Sedo needs a Buy Now price of at least 199 ${currency}.`;
  if (market === 'dynadot' && change.forSale === false)
    return 'Dynadot has no hidden listings; delist instead.';
  if (market === 'spaceship' && change.forSale === false)
    return 'SellerHub’s API can’t pause a sale; delist instead.';
  return null;
}

/** When each demo account last asked Atom for a DNS check. */
const dnsChecks = new Map<string, number>();

/** One demo market account, behaving like its market. */
export class DemoMarketAdapter {
  readonly capabilities: MarketCapabilities;
  constructor(
    readonly market: MarketId,
    readonly accountId: string,
    private readonly world: DemoMarketWorld,
  ) {
    this.capabilities = CAPABILITIES[market];
  }

  private get mine() {
    return this.world.account(this.accountId);
  }

  async test(): Promise<MarketTestResult> {
    const listings = [...this.mine.values()];
    return {
      listings: listings.length,
      notes: [],
      status:
        this.market === 'afternic'
          ? [
              {
                label: SEARCH_DATA_FLAG,
                on: listings.some(
                  (l) => l.extra.market === 'afternic' && l.extra.searches,
                ),
              },
            ]
          : [],
    };
  }

  async allListings() {
    return { listings: [...this.mine.values()], complete: true };
  }

  async getListings(names: readonly string[]) {
    return names.flatMap((n) => this.mine.get(n) ?? []);
  }

  async writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]> {
    return changes.map((change) => {
      const name = change.name.toLowerCase();
      const current = this.mine.get(name);
      const price =
        change.price !== undefined ? change.price : (current?.price ?? null);
      const currency = change.currency ?? current?.currency ?? 'USD';
      const why = refusal(
        this.market,
        this.capabilities,
        change,
        price,
        currency,
      );
      if (why) return refused(name, why);
      const now = new Date().toISOString();
      const next: MarketListing = {
        ...(current ?? newListing(this.market, this.accountId, name, now)),
        price,
        buyNow: price != null,
        currency: currency as MarketListing['currency'],
        updatedAt: now,
      };
      if (change.minOffer !== undefined) next.minOffer = change.minOffer;
      if (change.floor !== undefined) next.floor = change.floor;
      if (change.forSale !== undefined && next.status !== 'pending')
        next.forSale = change.forSale;
      // Dynadot lists a name held elsewhere only once it has verified it:
      // a new one is added to its list and stays pending meanwhile. A
      // listed name's minimum offer never shows.
      if (
        this.market === 'dynadot' &&
        !current &&
        !this.world.heldAtDynadot(name)
      ) {
        Object.assign(next, {
          status: 'pending',
          statusRaw: 'Buy Now · Unverified',
          extra: {
            ...next.extra,
            held: 'elsewhere',
            listingId: null,
            offers: false,
            verified: false,
          },
        });
      }
      if (this.market === 'dynadot' && next.status !== 'pending')
        next.minOffer = null;
      // SellerHub takes a name held outside the Spaceship account and
      // checks its TXT record before it goes on sale.
      if (this.market === 'spaceship' && !current) {
        const home = this.world.heldAtSpaceship(name);
        Object.assign(next, {
          status: home ? 'active' : 'pending',
          statusRaw: home ? 'onSale' : 'verifying',
          forSale: home,
          extra: {
            market: 'spaceship',
            held: home ? 'spaceship' : 'elsewhere',
            description: null,
          },
        });
      }
      const adjusted: MarketWriteResult['adjusted'] = [];
      if (change.leaseToOwn) {
        const asked = change.leaseToOwn.maxPayments;
        let months = asked ?? next.leaseToOwn?.maxPayments ?? 30;
        // Afternic quietly lowers the months to keep payments up.
        if (price) {
          const cap = Math.max(
            2,
            Math.floor(Number(price) / MIN_LEASE_PAYMENT),
          );
          if (months > cap) months = cap;
        }
        if (asked !== undefined && months !== asked)
          adjusted.push({
            field: 'leaseToOwn.maxPayments',
            asked,
            saved: months,
          });
        next.leaseToOwn = {
          enabled: change.leaseToOwn.enabled,
          maxPayments: months,
        };
      }
      this.mine.set(name, next);
      return { ...ok(next, name), adjusted };
    });
  }

  async deleteListings(names: readonly string[]) {
    return names.map((n) => {
      this.mine.delete(n.toLowerCase());
      return ok(null, n.toLowerCase());
    });
  }

  async allSales(): Promise<MarketSale[]> {
    return this.world.sales.get(this.accountId) ?? [];
  }

  async getSale(saleId: string): Promise<MarketSale | null> {
    return (
      (this.world.sales.get(this.accountId) ?? []).find(
        (s) => s.id === saleId,
      ) ?? null
    );
  }

  async accountStats(days: number): Promise<MarketStatsDay[]> {
    const span = this.market === 'sedo' ? Math.min(days, 31) : days;
    return Array.from({ length: span }, (_, i) => {
      const at = this.world.now - (span - i) * DAY;
      const weekday = new Date(at).getUTCDay();
      const base = this.market === 'sedo' ? 28 : 70;
      const views = Math.round(
        base * (weekday === 0 || weekday === 6 ? 0.7 : 1) +
          (hash(`${this.accountId}${i}`) % base),
      );
      return this.day(null, isoDay(at), views);
    });
  }

  async domainStats(name: string, days: number): Promise<MarketStatsDay[]> {
    const span = this.market === 'sedo' ? Math.min(days, 31) : days;
    const h = hash(name);
    // Some names get most of the traffic.
    const level = h % 7 === 0 ? 9 : h % 3 === 0 ? 3 : 1;
    return Array.from({ length: span }, (_, i) => {
      const at = this.world.now - (span - i) * DAY;
      const roll = hash(`${name}${i}`);
      const views = roll % (level + 2);
      // Now and then a visitor asks about it.
      const leads =
        this.market === 'afternic' && views && roll % 53 === 0 ? 1 : 0;
      return { ...this.day(name, isoDay(at), views), leads };
    }).filter((d) => d.views);
  }

  async domainCounters(name: string): Promise<MarketCounters> {
    const h = hash(name);
    return { name, views: 40 + (h % 400), shortlists: h % 9, offers: h % 3 };
  }

  private day(
    name: string | null,
    date: string,
    views: number,
  ): MarketStatsDay {
    const leads = this.market === 'afternic' ? Math.floor(views / 35) : null;
    return {
      market: this.market,
      accountId: this.accountId,
      name,
      date,
      views,
      leads,
      clicks: this.market === 'sedo' ? Math.floor(views / 12) : null,
      earnings: null,
      currency: null,
      shortlists: null,
      trackers: null,
      source: 'market',
    };
  }

  // Afternic's actions.

  async relist(names: readonly string[]) {
    return names.map((n) => {
      const l = this.mine.get(n.toLowerCase());
      if (l)
        this.mine.set(l.name, { ...l, status: 'active', statusRaw: 'ACTIVE' });
      return ok(l ?? null, n.toLowerCase());
    });
  }

  // Atom's: one DNS check per account every 12 hours, which goes through
  // straight away here and lists a pending name.

  async verifyDns(name: string): Promise<MarketWriteResult> {
    const key = name.toLowerCase();
    // Dynadot checks a list of names whenever it's asked.
    if (this.market === 'dynadot') {
      const l = this.mine.get(key);
      if (l?.extra.market === 'dynadot' && l.extra.verified === false) {
        this.mine.set(key, {
          ...l,
          status: 'active',
          statusRaw: 'Buy Now · Verified',
          forSale: true,
          minOffer: null,
          extra: { ...l.extra, verified: true },
        });
      }
      return ok(this.mine.get(key) ?? null, key);
    }
    const last = dnsChecks.get(this.accountId);
    if (last !== undefined && Date.now() - last < 12 * 60 * 60 * 1000) {
      return refused(
        key,
        'DNS check Request in progress, please try again after 12 hrs',
      );
    }
    dnsChecks.set(this.accountId, Date.now());
    const l = this.mine.get(key);
    if (l?.status === 'pending')
      this.mine.set(l.name, { ...l, status: 'active', statusRaw: 'Active' });
    return ok(this.mine.get(key) ?? null, key);
  }

  async getListingDefaults(): Promise<AfternicAccountSettings> {
    return this.world.settings.get(this.accountId) ?? DEFAULT_SETTINGS;
  }

  async setListingDefaults(settings: AccountSettingsInput): Promise<void> {
    this.world.settings.set(this.accountId, {
      ...(this.world.settings.get(this.accountId) ?? DEFAULT_SETTINGS),
      ...settings,
    });
  }

  async setSaleAuthCode(saleId: string): Promise<void> {
    const sales = this.world.sales.get(this.accountId) ?? [];
    this.world.sales.set(
      this.accountId,
      sales.map((s) =>
        s.id === saleId
          ? {
              ...s,
              action: 'transfer',
              statusRaw: 'PENDING_TRANSFER',
              authCodeSent: true,
            }
          : s,
      ),
    );
  }

  async sendSaleMessage(): Promise<void> {}
}

const DEFAULT_SETTINGS: AfternicAccountSettings = {
  landingPage: 'SALES_TYPE',
  intakeStyle: 'BUYNOW',
  leasingEnabled: true,
  maxLeasePeriod: 60,
  showLanderBuynowOption: true,
  showLanderMakeOfferOption: true,
  showLanderLeaseToOwnOption: true,
  selfBrokerEnabled: false,
};

function newListing(
  market: MarketId,
  accountId: string,
  name: string,
  now: string,
): MarketListing {
  return {
    market,
    accountId,
    name,
    displayName: null,
    // Sedo checks ownership before a new name goes up for sale.
    status: market === 'sedo' ? 'pending' : 'active',
    statusRaw: market === 'sedo' ? 'not for sale' : 'ACTIVE',
    forSale: market !== 'sedo',
    price: null,
    buyNow: false,
    minOffer: market === 'afternic' ? '100' : null,
    floor: null,
    discount: null,
    currency: 'USD',
    leaseToOwn:
      market === 'afternic' ? { enabled: true, maxPayments: 30 } : null,
    tier: market === 'atom' ? 'standard' : null,
    listedAt: now,
    updatedAt: now,
    extra: extraFor(market, false),
  };
}

function extraFor(
  market: MarketId,
  searches: boolean,
  h = 0,
): MarketListing['extra'] {
  if (market === 'afternic')
    return {
      market: 'afternic',
      landingPage: 'SALES_TYPE',
      intakeStyle: 'BUYNOW',
      showLanderBuynowOption: true,
      showLanderMakeOfferOption: true,
      showLanderLeaseToOwnOption: true,
      featured: null,
      fastTransferStatus: h % 3 === 0 ? 'ACTIVE' : null,
      registrar: null,
      registrarRaw: null,
      searches: searches
        ? {
            total: {
              days30: h % 40,
              days90: (h % 40) * 3,
              days365: (h % 40) * 11,
            },
            unique: {
              days30: h % 25,
              days90: (h % 25) * 3,
              days365: (h % 25) * 10,
            },
          }
        : null,
    };
  if (market === 'dynadot')
    return {
      market: 'dynadot',
      held: 'dynadot',
      listingId: String(21000000 + (h % 900000)),
      offers: h % 2 === 0,
      pendingSale: false,
      verified: null,
      registrar: null,
      transferStatus: null,
    };
  if (market === 'spaceship')
    return { market: 'spaceship', held: null, description: null };
  if (market === 'sedo')
    return {
      market: 'sedo',
      categories: [],
      language: 'en',
      parkingEarnings:
        (h % 900) / 100 > 1 ? ((h % 900) / 100).toFixed(2) : null,
      keywords: [],
    };
  return {
    market: 'atom',
    id: String(100000 + (h % 900000)),
    category: pick(rng(h), ['Technology', 'Finance', 'Travel', 'Food & Drink']),
    description: null,
    syndicationAuthorized: null,
  };
}

/** The demo's market accounts, with fixed ids so a reload matches. */
export const DEMO_MARKET_ACCOUNTS = [
  {
    id: 'demo-afternic',
    market: 'afternic',
    label: 'Afternic',
    credentials: { apiKey: 'demo-key', apiSecret: 'demo-secret' },
    // Obviously fake, in each market's format; Sedo's is left for you.
    verification: 'afternic-verification-d3m0Af7rn1cV3r1fy',
  },
  {
    id: 'demo-sedo',
    market: 'sedo',
    label: 'Sedo',
    credentials: {
      partnerId: '12345',
      signKey: 'demo-sign-key',
      username: 'demo',
      password: 'demo',
    },
  },
  {
    id: 'demo-atom',
    market: 'atom',
    label: 'Atom',
    credentials: { apiToken: 'demo-token', userId: '1234567' },
    verification: 'de30de30de30de30de30de30de30de30de30de30',
  },
  {
    id: 'demo-dynadot',
    market: 'dynadot',
    label: 'Dynadot',
    // None of its own: it uses the demo's Dynadot registrar account's key.
    credentials: {},
    registrarAccountId: 'dynadot',
    verification: 'de30de30de30de30de30de30de30de30',
  },
  {
    id: 'demo-spaceship',
    market: 'spaceship',
    label: 'Spaceship',
    // None of its own: it uses the demo's Spaceship registrar account's key.
    credentials: {},
    registrarAccountId: 'spaceship',
    verification: 'de30de30-de30-4e30-8e30-de30de30de30',
  },
] as const;

/** Names sold before the demo begins: on no account, so they're in Archive. */
const SOLD_FIRST = [
  'amber',
  'cedar',
  'lumen',
  'harbor',
  'quill',
  'north',
  'ember',
  'silver',
  'cobalt',
  'sable',
  'juniper',
  'marble',
  'saffron',
  'tidal',
  'wren',
  'granite',
] as const;
const SOLD_SECOND = [
  'lane',
  'field',
  'stone',
  'works',
  'lark',
  'mint',
  'line',
  'fern',
  'crest',
  'gate',
  'labs',
  'path',
] as const;
const SOLD_PRICES = [
  4500, 6800, 9500, 12000, 14500, 18000, 24000, 32500, 48000, 85000,
] as const;
/** About one sale every two months, over three years. */
const SOLD_COUNT = 18;
const SOLD_YEARS = 3;

/**
 * Fills the world from the names you've priced in DomBot: half listed on
 * all three markets, most of the rest on Afternic alone, mostly at your
 * price; with sales over three years, one under way at each step (the
 * auth code, payee details, the transfer) and one cancelled.
 */
export function seedDemoMarkets(
  world: DemoMarketWorld,
  names: readonly string[],
  asking: Readonly<Record<string, DemoAskingPrice>> = {},
  /** Names whose registrar can hand over an auth code. */
  givesAuthCode: (name: string) => boolean = () => true,
  /** Names whose registrar can approve a transfer-out. */
  approvesTransfer: (name: string) => boolean = () => true,
  /** Names the demo's Dynadot registrar account holds. */
  heldAtDynadot: (name: string) => boolean = () => false,
  /** Names the demo's Spaceship registrar account holds. */
  heldAtSpaceship: (name: string) => boolean = () => false,
  seed = 7,
): void {
  const r = rng(seed);
  const now = world.now;
  world.heldAtDynadot = heldAtDynadot;
  world.heldAtSpaceship = heldAtSpaceship;
  for (const a of DEMO_MARKET_ACCOUNTS) world.market.set(a.id, a.market);
  const listed = (
    accountId: string,
    market: MarketId,
    name: string,
    at: number,
    ask: DemoAskingPrice,
  ) => {
    const h = hash(name);
    // Mostly at your DomBot price; now and then the market has another
    // (raised there, or not pushed yet), which the table flags.
    const roll = r();
    const price =
      ask.amount === null
        ? null
        : roll < 0.07
          ? String(Math.round((Number(ask.amount) * 0.85) / 5) * 5)
          : roll < 0.14
            ? String(Math.round((Number(ask.amount) * 1.2) / 5) * 5)
            : ask.amount;
    // Mostly live; a few waiting, switched off, refused, or hidden.
    const roll2 = r();
    const status =
      roll2 < 0.06
        ? 'pending'
        : market === 'afternic' && roll2 < 0.1
          ? 'inactive'
          : market === 'afternic' && roll2 < 0.12
            ? 'rejected'
            : 'active';
    const hidden = market === 'afternic' && status === 'active' && r() < 0.04;
    const base = newListing(market, accountId, name, isoDay(at));
    const listing: MarketListing = {
      ...base,
      status,
      statusRaw:
        status === 'active'
          ? market === 'sedo'
            ? 'for sale'
            : 'ACTIVE'
          : status === 'pending'
            ? market === 'sedo'
              ? 'not for sale'
              : 'PENDING'
            : status === 'rejected'
              ? 'FAILED_COMPLIANCE'
              : 'INACTIVE',
      forSale: !hidden && (status !== 'pending' || market !== 'sedo'),
      price,
      buyNow: price != null,
      // Atom has one price; Afternic always has a minimum offer.
      minOffer:
        market === 'atom'
          ? null
          : (ask.minOffer ?? (market === 'afternic' ? '100' : null)),
      floor: market === 'afternic' ? ask.floor : null,
      currency: 'USD',
      leaseToOwn:
        market === 'afternic'
          ? {
              enabled: r() < 0.7,
              maxPayments: price
                ? Math.min(60, Math.max(2, Math.floor(Number(price) / 80)))
                : 30,
            }
          : null,
      tier: market === 'atom' ? (r() < 0.25 ? 'plus' : 'standard') : null,
      discount:
        market === 'atom' && price && r() < 0.2
          ? {
              amount: String(Math.round(Number(price) * 0.1)),
              until: isoDay(now + 4 * DAY),
            }
          : null,
      extra: extraFor(market, market === 'afternic', h),
    };
    world.account(accountId).set(name, listing);
  };

  // Of the names with an asking price: half on all three markets, four in
  // ten on Afternic alone, the rest not listed yet.
  const forSale = Object.keys(asking).sort(
    (a, b) => hash(`${a}${seed}`) - hash(`${b}${seed}`),
  );
  forSale.forEach((name, i) => {
    const at = now - (30 + (hash(name) % 700)) * DAY;
    const share = i / forSale.length;
    if (share >= 0.9) return;
    listed('demo-afternic', 'afternic', name, at, asking[name]);
    if (share < 0.5) {
      listed('demo-sedo', 'sedo', name, at, asking[name]);
      listed('demo-atom', 'atom', name, at, asking[name]);
    }
    // Dynadot: names its registrar account holds, and names held elsewhere
    // listed through its open marketplace, a few still being verified.
    if (share >= 0.25 && share < 0.55) {
      listed('demo-dynadot', 'dynadot', name, at, asking[name]);
      const l = world.account('demo-dynadot').get(name);
      if (l?.extra.market === 'dynadot') {
        const home = heldAtDynadot(name);
        const pending = !home && l.status === 'pending';
        world.account('demo-dynadot').set(name, {
          ...l,
          status: pending ? 'pending' : 'active',
          statusRaw: home
            ? l.extra.offers
              ? 'BIN_MAKE_OFFER'
              : 'BIN'
            : `Buy Now · ${pending ? 'Unverified' : 'Verified'}`,
          // A pending one is DomBot's, held until Dynadot verifies the name.
          forSale: true,
          minOffer: pending ? l.minOffer : null,
          listedAt: home ? null : l.listedAt,
          extra: {
            ...l.extra,
            held: home ? 'dynadot' : 'elsewhere',
            listingId: home ? l.extra.listingId : null,
            verified: home ? null : !pending,
          },
        });
      }
    }
    // SellerHub: names its registrar account holds, and names held
    // elsewhere, a few still being verified.
    if (share >= 0.1 && share < 0.3) {
      listed('demo-spaceship', 'spaceship', name, at, asking[name]);
      const l = world.account('demo-spaceship').get(name);
      if (l) {
        const home = heldAtSpaceship(name);
        const pending = !home && l.status === 'pending';
        world.account('demo-spaceship').set(name, {
          ...l,
          status: pending ? 'pending' : 'active',
          statusRaw: pending ? 'verifying' : 'onSale',
          forSale: !pending,
          extra: {
            market: 'spaceship',
            held: home ? 'spaceship' : 'elsewhere',
            description: null,
          },
        });
      }
    }
  });

  const held = new Set(names);
  const soldNames = new Set<string>();
  for (let i = 0; i < SOLD_COUNT; i++) {
    let name: string;
    do {
      name = `${pick(r, SOLD_FIRST)}${pick(r, SOLD_SECOND)}.${pick(r, ['com', 'com', 'com', 'io', 'co'])}`;
    } while (held.has(name) || soldNames.has(name));
    soldNames.add(name);
    // SellerHub only lately: it opened in 2025.
    const market: MarketId =
      i % 6 === 5
        ? 'atom'
        : i % 6 === 2 && i < SOLD_COUNT / 5
          ? 'spaceship'
          : 'afternic';
    const amount = pick(r, SOLD_PRICES);
    // Spread over the years, a little uneven.
    const daysAgo = Math.round(
      ((i + 0.5 + (r() - 0.5) * 0.8) / SOLD_COUNT) * 365 * SOLD_YEARS,
    );
    const accountId = `demo-${market}`;
    const rate = market === 'atom' ? 0.15 : market === 'spaceship' ? 0.1 : 0.2;
    const sales = world.sales.get(accountId) ?? [];
    sales.push({
      market,
      accountId,
      id: `demo-${name}`,
      name,
      soldOn: isoDay(now - daysAgo * DAY),
      status: 'completed',
      statusRaw: market === 'spaceship' ? 'sold · forSalePage' : 'COMPLETED',
      kind: market === 'spaceship' ? 'unknown' : 'buy_now',
      price: String(amount),
      commission: String(amount * rate),
      commissionEstimated: market === 'atom',
      net: String(amount * (1 - rate)),
      currency: 'USD',
      installments: null,
      // SellerHub's sold report has no payout date.
      paidOutOn:
        market === 'spaceship'
          ? null
          : isoDay(now - Math.max(0, daysAgo - 12) * DAY),
      action: null,
    });
    world.sales.set(accountId, sales);
  }

  // Sales under way on names you hold, one at each step, and one that fell
  // through. The auth code one is on a name whose registrar can produce
  // one, so Send auth code goes through; the transfer one, where it can, on
  // a name whose registrar can approve the buyer's transfer. A second waits
  // on the auth code where the registrar can't produce one, so its row takes
  // the code pasted in.
  const onAfternic = [...world.account('demo-afternic').values()].filter(
    (l) => l.price && l.status === 'active',
  );
  const used = new Set<string>();
  const take = (ok: (name: string) => boolean = () => true) => {
    const l = onAfternic.find((x) => !used.has(x.name) && ok(x.name));
    if (l) used.add(l.name);
    return l;
  };
  const underWay = (
    l: MarketListing | undefined,
    daysAgo: number,
    status: MarketSale['status'],
    statusRaw: string,
    action: MarketSale['action'],
  ) => {
    if (!l?.price) return;
    world.sales.get('demo-afternic')!.push({
      market: 'afternic',
      accountId: 'demo-afternic',
      id: `demo-${l.name}`,
      name: l.name,
      soldOn: isoDay(now - daysAgo * DAY),
      status,
      statusRaw,
      kind: 'buy_now',
      price: l.price,
      commission: String(Number(l.price) * 0.2),
      commissionEstimated: false,
      net: String(Number(l.price) * 0.8),
      currency: 'USD',
      installments: null,
      paidOutOn: null,
      action,
      // Past the auth code step, the market has it.
      authCodeSent: action === 'transfer' ? true : null,
    });
  };
  underWay(
    take(givesAuthCode),
    2,
    'in_progress',
    'AWAITING_AUTH_CODE',
    'auth_code',
  );
  underWay(take(), 5, 'in_progress', 'AWAITING_PAYEE_INFO', 'payee_details');
  underWay(
    take(approvesTransfer) ?? take(),
    9,
    'in_progress',
    'PENDING_TRANSFER',
    'transfer',
  );
  underWay(take(), 140, 'cancelled', 'CANCELLED', null);
  // Last, so the sales above keep their names.
  underWay(
    take((name) => !givesAuthCode(name)),
    3,
    'in_progress',
    'AWAITING_AUTH_CODE',
    'auth_code',
  );
}

/** A factory for registry.configureMarketFactory over one world. */
export function demoMarketFactory(world: DemoMarketWorld) {
  return (market: MarketId, accountId: string): AnyMarketAdapter =>
    new DemoMarketAdapter(
      market,
      accountId,
      world,
    ) as unknown as AnyMarketAdapter;
}
