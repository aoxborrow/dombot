import type {
  Domain,
  RegistrarDefinition,
  RegistrarMeta,
} from '../../shared/ipc';
import { accountNumber } from '../../shared/account-label';

export interface AccountCardModel {
  provider: RegistrarDefinition;
  account: RegistrarMeta;
  /** The registrar has other accounts, so an unnamed one shows its number. */
  hasSiblings: boolean;
}

const isSaved = (a: RegistrarMeta) => a.saved ?? a.configured;
// Sort by what is shown: unnamed accounts by number, then nicknames by name.
const sortKey = (a: RegistrarMeta): [number, string] => {
  const n = accountNumber(a.accountLabel);
  return n === null
    ? [Number.MAX_SAFE_INTEGER, a.accountLabel!.trim()]
    : [n, ''];
};

/** One card per account the user actually has. Every registrar also carries a
 * placeholder account so legacy storage keys resolve; those are not cards.
 * Sorted by registrar name, then account number, then nickname. */
export function accountCards(
  catalog: RegistrarDefinition[],
  accounts: RegistrarMeta[],
): AccountCardModel[] {
  const cards: AccountCardModel[] = [];
  for (const provider of catalog) {
    const saved = accounts.filter(
      (a) => a.name === provider.name && isSaved(a),
    );
    for (const account of saved)
      cards.push({ provider, account, hasSiblings: saved.length > 1 });
  }
  return cards.sort(
    (a, b) =>
      a.provider.displayName.localeCompare(b.provider.displayName) ||
      sortKey(a.account)[0] - sortKey(b.account)[0] ||
      sortKey(a.account)[1].localeCompare(sortKey(b.account)[1], undefined, {
        sensitivity: 'base',
      }) ||
      (a.account.accountId ?? '').localeCompare(b.account.accountId ?? ''),
  );
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
