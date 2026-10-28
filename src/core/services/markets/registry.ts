import type { MarketId, MarketInfo } from '../../../shared/markets';
import type { AfternicActions, MarketAdapter } from '../../markets/types';
import {
  AFTERNIC_CAPABILITIES,
  AFTERNIC_CONFIG_FIELDS,
  createAfternicAdapter,
} from './afternic';

// The markets DomBot supports (docs/markets.md): what Settings shows for
// each, and how to build its adapter from an account's stored credentials.
// Adding a market is an entry here plus its adapter.

export type Credentials = Record<string, string>;

/** An adapter, plus whichever market-only actions its market has. */
export type AnyMarketAdapter = MarketAdapter & Partial<AfternicActions>;

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
    },
    create: (accountId, credentials) =>
      createAfternicAdapter(accountId, credentials),
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
  return entry.create(accountId, credentials);
}
