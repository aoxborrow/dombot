import type {
  Domain,
  RegistrarDefinition,
  RegistrarMeta,
} from '../../shared/ipc';

/** Keep the original one-card-per-provider layout; migration placeholders are
 * empty credential forms, not additional accounts. */
export function registrarGroups(
  catalog: RegistrarDefinition[],
  accounts: RegistrarMeta[],
) {
  return catalog.map((provider) => {
    const saved = accounts.filter(
      (a) => a.name === provider.name && (a.saved ?? a.configured),
    );
    return {
      provider,
      accounts: saved,
      canAddAccount: saved.some((a) => a.configured),
    };
  });
}

/** The collapsed row describes the whole registrar, independently of selection.
 * Counts include every saved account's cache. Freshness covers enabled accounts
 * and uses the oldest sync so one recent account cannot hide stale siblings. */
export function registrarSummary(
  provider: RegistrarDefinition,
  accounts: RegistrarMeta[],
): RegistrarMeta {
  const configured = accounts.filter((account) => account.configured);
  const active = configured.filter((account) => account.enabled);
  const failures = active.filter((account) => account.sync.lastError);
  return {
    ...provider,
    configured: configured.length > 0,
    enabled: active.length > 0,
    sync: {
      domainCount: accounts.reduce(
        (sum, account) => sum + account.sync.domainCount,
        0,
      ),
      lastSyncedAt:
        active.length > 0 &&
        active.every((account) => account.sync.lastSyncedAt != null)
          ? Math.min(...active.map((account) => account.sync.lastSyncedAt!))
          : null,
      lastError: failures.length
        ? `${failures.length} account${failures.length === 1 ? '' : 's'} failed to sync. Expand to view account details.`
        : null,
    },
  };
}

/** Account UI is useful only when a provider has more than one saved account.
 * Include cached rows during initial hydration, before metadata has arrived. */
export function multiAccountRegistrars(
  accounts: RegistrarMeta[] | null,
  domains: Domain[] = [],
): Set<string> {
  const ids = new Map<string, Set<string>>();
  const add = (provider: string, id: string) => {
    const set = ids.get(provider) ?? new Set<string>();
    set.add(id);
    ids.set(provider, set);
  };
  for (const a of accounts ?? [])
    if (a.saved ?? a.configured) add(a.name, a.accountId ?? a.name);
  // Once metadata is loaded it is authoritative, including removed accounts.
  if (accounts === null)
    for (const d of domains) add(d.registrar, d.accountId ?? d.registrar);
  return new Set(
    [...ids].filter(([, set]) => set.size > 1).map(([provider]) => provider),
  );
}
