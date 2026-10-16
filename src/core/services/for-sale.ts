import {
  assertDomainName,
  isDomainKey,
  toAscii,
} from '../../shared/domain-name';
import { Namespace } from '../storage/namespace';

export const FOR_SALE_NAMESPACE = 'domain-for-sale';
const flags = new Namespace<boolean>(FOR_SALE_NAMESPACE);

/** User metadata, keyed by name: independent of accounts, prices and folders. */
export const getForSale = (): Record<string, boolean> => flags.all();

export function setForSale(domains: string[], enabled: boolean): void {
  // Validate the entire batch before writing anything.
  const keys = [...new Set(domains.map(assertDomainName))];
  void flags.setMany(keys.map((key) => [key, enabled]));
}

export function deleteForSale(domains: string[]): void {
  for (const domain of domains) void flags.delete(toAscii(domain));
}

export function cleanForSale(key: string, value: unknown): boolean | null {
  return isDomainKey(key) && toAscii(key) === key && typeof value === 'boolean'
    ? value
    : null;
}
