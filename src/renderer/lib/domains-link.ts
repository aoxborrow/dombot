import type { AskingKind } from '../../shared/list-prices';
import {
  MARKET_STATE_CHOICES,
  PRICE_COMPARISONS,
  type MarketStateChoice,
  type PriceComparison,
} from '../../shared/market-filter';

// Links into Domains with a view and filters set, e.g. Listings with the
// rejected listings.

export interface DomainsLink {
  /** Listings or Archive; Active when left out. */
  view?: 'listings' | 'archive';
  /** The Markets filter: markets in play (empty: all), states, comparisons. */
  markets?: string[];
  states?: MarketStateChoice[];
  comparisons?: PriceComparison[];
  /** The Pricing filter's kinds, e.g. `forSale` for names with a price. */
  asking?: AskingKind[];
}

const ASKING: readonly AskingKind[] = [
  'forSale',
  'bin',
  'minOffer',
  'floor',
  'none',
];

/** Domains (`/?…`) with the filters as query parameters. */
export function domainsLink(link: DomainsLink): string {
  const params = new URLSearchParams();
  const put = (key: string, values: readonly string[] | undefined) => {
    if (values?.length) params.set(key, values.join(','));
  };
  if (link.view) params.set('view', link.view);
  put('markets', link.markets);
  put('states', link.states);
  put('prices', link.comparisons);
  put('asking', link.asking);
  const q = params.toString();
  return q ? `/?${q}` : '/';
}

/** The filters a `domainsLink` set, read back; unknown values are dropped. */
export function parseDomainsLink(params: URLSearchParams): DomainsLink {
  const list = <T extends string>(key: string, known?: readonly T[]): T[] =>
    (params.get(key) ?? '')
      .split(',')
      .filter((v): v is T => !!v && (!known || known.includes(v as T)));
  const view = params.get('view');
  return {
    ...(view === 'listings' || view === 'archive' ? { view } : {}),
    markets: list('markets'),
    states: list('states', MARKET_STATE_CHOICES),
    comparisons: list('prices', PRICE_COMPARISONS),
    asking: list('asking', ASKING),
  };
}
