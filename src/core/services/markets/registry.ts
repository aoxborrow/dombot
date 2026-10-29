import type { MarketId, MarketInfo } from '../../../shared/markets';
import { AFTERNIC_NAMESERVERS } from '../../markets/afternic';
import { ATOM_NAMESERVERS } from '../../markets/atom';
import { SEDO_NAMESERVERS } from '../../markets/sedo';
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
  SEDO_CAPABILITIES,
  SEDO_CONFIG_FIELDS,
  createSedoAdapter,
} from './sedo';

// The markets DomBot supports (docs/markets.md): what Settings shows for
// each, and how to build its adapter from an account's stored credentials.
// Adding a market is an entry here plus its adapter.

export type Credentials = Record<string, string>;

/** An adapter, plus whichever market-only actions its market has. */
export type AnyMarketAdapter = MarketAdapter &
  Partial<AfternicActions> &
  Partial<AtomActions> &
  Partial<SedoActions>;

interface MarketEntry {
  info: MarketInfo;
  create(accountId: string, credentials: Credentials): AnyMarketAdapter;
}

const MARKETS: Partial<Record<MarketId, MarketEntry>> = {
  afternic: {
    info: {
      id: 'afternic',
      name: 'Afternic',
      website: 'afternic.com',
      keysUrl: 'https://www.afternic.com/account/profile',
      helpText:
        'Create an API key under Account Profile → Security → API Keys on Afternic, and paste both the key and the secret.',
      configFields: AFTERNIC_CONFIG_FIELDS,
      capabilities: AFTERNIC_CAPABILITIES,
      nameservers: AFTERNIC_NAMESERVERS,
    },
    create: (accountId, credentials) =>
      createAfternicAdapter(accountId, credentials),
  },
  // Checked live, reads and writes (docs/atom-api.md).
  atom: {
    info: {
      id: 'atom',
      name: 'Atom',
      website: 'atom.com',
      keysUrl: 'https://www.atom.com/dashboard/seller/api-access',
      helpText:
        'Request API access under Dashboard → API Access on atom.com, then paste the API token and the user ID shown with it.',
      configFields: ATOM_CONFIG_FIELDS,
      capabilities: ATOM_CAPABILITIES,
      nameservers: ATOM_NAMESERVERS,
    },
    create: (accountId, credentials) =>
      createAtomAdapter(accountId, credentials),
  },
  // Checked live, reads and writes (docs/sedo-api.md).
  sedo: {
    info: {
      id: 'sedo',
      name: 'Sedo',
      website: 'sedo.com',
      keysUrl: 'https://sedo.com/',
      helpText:
        'Sedo’s API needs a partner ID and sign key, which Sedo grants on request (ask Sedo support for API access), plus your Sedo username and password. Sedo’s API has no sales, so record Sedo sales by hand or import Sedo’s CSV export.',
      configFields: SEDO_CONFIG_FIELDS,
      capabilities: SEDO_CAPABILITIES,
      nameservers: SEDO_NAMESERVERS,
    },
    create: (accountId, credentials) =>
      createSedoAdapter(accountId, credentials),
  },
};

/** Every supported market, for Settings. */
export function marketCatalog(): MarketInfo[] {
  return Object.values(MARKETS).map((m) => m.info);
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
export function buildAdapter(
  market: MarketId,
  accountId: string,
  credentials: Credentials,
): AnyMarketAdapter {
  const entry = MARKETS[market];
  if (!entry) throw new Error(`DomBot doesn't support ${market} yet.`);
  for (const field of entry.info.configFields) {
    if (field.required && !credentials[field.name]?.trim()) {
      throw new Error(`${field.label} is required.`);
    }
  }
  return factory
    ? factory(market, accountId, credentials)
    : entry.create(accountId, credentials);
}
