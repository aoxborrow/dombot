import { toAscii } from './domain-name';

export type SaleFilter = 'all' | 'for-sale' | 'not-for-sale';

export function matchesSaleFilter(
  domainName: string,
  flags: Record<string, boolean>,
  filter: SaleFilter,
): boolean {
  if (filter === 'all') return true;
  const forSale = flags[toAscii(domainName)] === true;
  return filter === 'for-sale' ? forSale : !forSale;
}
