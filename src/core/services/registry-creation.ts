import type { Domain } from '../../shared/ipc';
import { qualifyCreationDate } from '../../shared/creation-date';
import { Namespace } from '../storage/namespace';
import {
  cachedRegistryCreation,
  lookupRegistrations,
  registryCreationMissing,
} from './registration-lookup';
const retry = new Namespace<number>('rdap-creation-retries', { cache: true });

/** A pure projection; portfolio reads never start registry traffic. */
export function withCachedRegistryCreation<T extends Partial<Domain>>(
  domain: T,
): T & Partial<Domain> {
  const qualified = qualifyCreationDate(domain);
  if (domain.source === 'imported' || !domain.domainName) return qualified;
  const known = cachedRegistryCreation(domain.domainName);
  if (
    !known &&
    domain.createdDateSource?.kind === 'registry-rdap' &&
    registryCreationMissing(domain.domainName)
  ) {
    const missing = {
      ...qualified,
      createdDate: null,
      createdDateIssue: 'invalid' as const,
    };
    delete missing.createdDateSource;
    return missing;
  }
  return known ? qualifyCreationDate({ ...qualified, ...known }) : qualified;
}

/** Fetch authoritative evidence only for anomalous registrar dates or evidence
 * already being maintained. Failure keeps a previously verified date. */
export async function recoverCreationDates<T extends Partial<Domain>>(
  domains: T[],
  refresh = false,
): Promise<(T & Partial<Domain>)[]> {
  const names = [
    ...new Set(
      domains
        .filter(
          (d) =>
            d.source !== 'imported' &&
            d.domainName &&
            (qualifyCreationDate(d).createdDateIssue ||
              cachedRegistryCreation(d.domainName)),
        )
        .map((d) => d.domainName!),
    ),
  ].filter((name) => {
    if (refresh) return true;
    const known = cachedRegistryCreation(name);
    const stale =
      !known ||
      Date.now() - Date.parse(known.createdDateSource!.checkedAt) >= 86_400_000;
    return stale && (!retry.loaded || (retry.get(name) ?? 0) <= Date.now());
  });
  if (names.length) {
    try {
      await lookupRegistrations(names, { authoritative: true, refresh });
    } catch {
      /* Registry outage must not break registrar inventory or controls. */
    }
    for (const name of names) {
      if (retry.loaded) await retry.set(name, Date.now() + 60_000);
    }
  }
  return domains.map(withCachedRegistryCreation);
}
