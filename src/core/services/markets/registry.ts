import type { MarketId, MarketInfo } from '../../../shared/markets';
import { AFTERNIC_NAMESERVERS } from '../../markets/afternic';
import { AFTERNIC_BASE_URL } from '../../markets/afternic/client';
import { ATOM_NAMESERVERS } from '../../markets/atom';
import { ATOM_BASE_URL } from '../../markets/atom/wire';
import { DYNADOT_NAMESERVERS } from '../../markets/dynadot';
import { DYNADOT_BASE_URL } from '../../markets/dynadot/wire';
import { SEDO_NAMESERVERS } from '../../markets/sedo';
import { SEDO_BASE_URL } from '../../markets/sedo/wire';
import { SPACESHIP_NAMESERVERS } from '../../markets/spaceship';
import { SPACESHIP_BASE_URL } from '../../markets/spaceship/wire';
import { getListPrices } from '../list-prices';
import type {
  AfternicActions,
  AtomActions,
  MarketAdapter,
  SedoActions,
} from '../../markets/types';
import {
  AFTERNIC_CAPABILITIES,
  AFTERNIC_CONFIG_FIELDS,
  createAfternicAdapter,
} from './afternic';
import {
  ATOM_CAPABILITIES,
  ATOM_CONFIG_FIELDS,
  createAtomAdapter,
} from './atom';
import {
  DYNADOT_CAPABILITIES,
  DYNADOT_CONFIG_FIELDS,
  createDynadotAdapter,
  type DynadotAsking,
} from './dynadot';
import {
  SEDO_CAPABILITIES,
  SEDO_CONFIG_FIELDS,
  createSedoAdapter,
} from './sedo';
import {
  SPACESHIP_CAPABILITIES,
  SPACESHIP_CONFIG_FIELDS,
  createSpaceshipAdapter,
} from './spaceship';

// The markets DomBot supports (docs/markets.md): what Settings shows for
// each, and how to build its adapter from an account's stored credentials.
// Adding a market is an entry here plus its adapter.

export type Credentials = Record<string, string>;

/**
 * How an account's calls go out: for a market on a registrar's API, the
 * registrar account it uses, whose key and proxy route it shares.
 */
export interface AdapterContext {
  registrarAccountId?: string;
  /**
   * The registrar account whose calls share this key's rate limit: the linked
   * one, or one saved with the same key as this account's own.
   */
  limiterKey?: string;
  /** Through the account's proxy, or its registrar account's. */
  fetch?: typeof fetch;
}

/** An adapter, plus whichever market-only actions its market has. */
export type AnyMarketAdapter = MarketAdapter &
  Partial<AfternicActions> &
  Partial<AtomActions> &
  Partial<SedoActions>;

interface MarketEntry {
  info: MarketInfo;
  /** The API's address; a proxied call may go nowhere else. */
  apiBase: string;
  create(
    accountId: string,
    credentials: Credentials,
    context: AdapterContext,
  ): AnyMarketAdapter;
}

/**
 * DomBot's asking price for a name, for Dynadot: the currency to read and
 * list it in, and the minimum offer Dynadot needs with every change to a
 * listing that takes offers.
 */
function askingFor(name: string): DynadotAsking | null {
  const price = getListPrices()[name];
  return price
    ? { currency: price.currency, minOffer: price.minOffer ?? null }
    : null;
}

/** Afternic listings a page through a proxy; 500 could pass its 2 MB limit. */
const PROXIED_AFTERNIC_PAGE = 200;

const MARKETS: Partial<Record<MarketId, MarketEntry>> = {
  afternic: {
    info: {
      id: 'afternic',
      name: 'Afternic',
      website: 'afternic.com',
      keysUrl: 'https://www.afternic.com/account/profile',
      helpText:
        'Create an API key under Account Profile → Security → API Keys on Afternic.',
      configFields: AFTERNIC_CONFIG_FIELDS,
      capabilities: AFTERNIC_CAPABILITIES,
      nameservers: AFTERNIC_NAMESERVERS,
    },
    apiBase: AFTERNIC_BASE_URL,
    create: (accountId, credentials, context) =>
      createAfternicAdapter(accountId, credentials, {
        fetch: context.fetch,
        // Proxied responses stop at 2 MB (MAX_PROXY_RESPONSE_BYTES).
        ...(context.fetch && { listingsPage: PROXIED_AFTERNIC_PAGE }),
      }),
  },
  // Checked live, reads and writes (docs/atom-api.md).
  atom: {
    info: {
      id: 'atom',
      name: 'Atom',
      website: 'atom.com',
      keysUrl: 'https://www.atom.com/dashboard/seller/api-access',
      helpText: 'Request API access under Dashboard → API Access on atom.com.',
      configFields: ATOM_CONFIG_FIELDS,
      capabilities: ATOM_CAPABILITIES,
      nameservers: ATOM_NAMESERVERS,
    },
    apiBase: ATOM_BASE_URL,
    create: (accountId, credentials, context) =>
      createAtomAdapter(accountId, credentials, { fetch: context.fetch }),
  },
  // Checked live, reads and writes (docs/dynadot-marketplace-api.md).
  dynadot: {
    info: {
      id: 'dynadot',
      name: 'Dynadot',
      website: 'dynadot.com',
      keysUrl: 'https://www.dynadot.com/help/question/open-marketplace',
      helpText:
        'Sells the names in your Dynadot account, and names you hold at other registrars once Dynadot has verified them. Use a Dynadot registrar account’s API key and proxy, or a separate key.',
      configFields: DYNADOT_CONFIG_FIELDS,
      capabilities: DYNADOT_CAPABILITIES,
      nameservers: DYNADOT_NAMESERVERS,
      registrar: 'dynadot',
    },
    apiBase: DYNADOT_BASE_URL,
    create: (accountId, credentials, context) =>
      createDynadotAdapter(accountId, credentials, {
        fetch: context.fetch,
        limiterKey: context.limiterKey ?? accountId,
        askingFor,
      }),
  },
  // Checked live, reads and writes (docs/sedo-api.md).
  sedo: {
    info: {
      id: 'sedo',
      name: 'Sedo',
      website: 'sedo.com',
      keysUrl: 'https://sedo.com/',
      helpText:
        'Sedo grants API access (a partner ID and sign key) on request: ask Sedo support. Sedo’s API has no sales, so record Sedo sales by hand or import Sedo’s CSV export.',
      configFields: SEDO_CONFIG_FIELDS,
      capabilities: SEDO_CAPABILITIES,
      nameservers: SEDO_NAMESERVERS,
    },
    apiBase: SEDO_BASE_URL,
    create: (accountId, credentials, context) =>
      createSedoAdapter(accountId, credentials, { fetch: context.fetch }),
  },
  // Reads checked live (docs/sellerhub-api.md).
  spaceship: {
    info: {
      id: 'spaceship',
      name: 'Spaceship',
      website: 'spaceship.com',
      keysUrl: 'https://www.spaceship.com/application/api-manager/',
      helpText:
        'Sells your names on Spaceship SellerHub. Use a Spaceship registrar account’s API key and proxy, or a separate key. The key needs SellerHub access (sellerhub:read, and sellerhub:write to list) in Spaceship’s API Manager.',
      configFields: SPACESHIP_CONFIG_FIELDS,
      capabilities: SPACESHIP_CAPABILITIES,
      nameservers: SPACESHIP_NAMESERVERS,
      registrar: 'spaceship',
    },
    apiBase: SPACESHIP_BASE_URL,
    create: (accountId, credentials, context) =>
      createSpaceshipAdapter(accountId, credentials, {
        fetch: context.fetch,
        limiterKey: context.limiterKey ?? accountId,
      }),
  },
};

/** Every supported market, for Settings. */
export function marketCatalog(): MarketInfo[] {
  return Object.values(MARKETS)
    .map((m) => m.info)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isMarketId(value: unknown): value is MarketId {
  return typeof value === 'string' && Object.hasOwn(MARKETS, value);
}

export function marketInfo(market: MarketId): MarketInfo {
  const entry = MARKETS[market];
  if (!entry) throw new Error(`DomBot doesn't support ${market} yet.`);
  return entry.info;
}

/** Builds adapters in place of the real ones (the demo's in-memory markets). */
export type MarketFactory = (
  market: MarketId,
  accountId: string,
  credentials: Credentials,
) => AnyMarketAdapter;

let factory: MarketFactory | null = null;

/** Swap in a market factory, or null to put the real adapters back. */
export function configureMarketFactory(next: MarketFactory | null): void {
  factory = next;
}

/** The adapter for one account; throws when a required field is missing. */
/** The origin a market's proxied calls are pinned to. */
export function marketApiOrigin(market: MarketId): string {
  const entry = MARKETS[market];
  if (!entry) throw new Error(`DomBot doesn't support ${market} yet.`);
  return new URL(entry.apiBase).origin;
}

export function buildAdapter(
  market: MarketId,
  accountId: string,
  credentials: Credentials,
  context: AdapterContext = {},
): AnyMarketAdapter {
  const entry = MARKETS[market];
  if (!entry) throw new Error(`DomBot doesn't support ${market} yet.`);
  // A linked account's key is the registrar's, whose form checked it.
  if (!context.registrarAccountId) {
    for (const field of entry.info.configFields) {
      if (field.required && !credentials[field.name]?.trim()) {
        throw new Error(`${field.label} is required.`);
      }
    }
  }
  return factory
    ? factory(market, accountId, credentials)
    : entry.create(accountId, credentials, context);
}
