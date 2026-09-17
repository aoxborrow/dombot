import type {
  Domain,
  RegistrarDefinition,
  RegistrarMeta,
} from '../../shared/ipc';

export interface AccountCardModel {
  provider: RegistrarDefinition;
  account: RegistrarMeta;
  /** True when the registrar has sibling accounts, so the nickname matters. */
  showLabel: boolean;
}

const isSaved = (a: RegistrarMeta) => a.saved ?? a.configured;
const labelOf = (a: RegistrarMeta) => a.accountLabel ?? '';

/** One card per account the user actually has. Every registrar also carries a
 * placeholder account so legacy storage keys resolve; those are not cards.
 * Sorted by registrar name, then nickname, so the order never depends on when
 * an account was added. */
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
      cards.push({ provider, account, showLabel: saved.length > 1 });
  }
  return cards.sort(
    (a, b) =>
      a.provider.displayName.localeCompare(b.provider.displayName) ||
      labelOf(a.account).localeCompare(labelOf(b.account), undefined, {
        sensitivity: 'base',
      }) ||
      (a.account.accountId ?? '').localeCompare(b.account.accountId ?? ''),
  );
}

/** Saved accounts for one registrar: what a new account must be told apart from. */
export function savedSiblings(
  accounts: RegistrarMeta[],
  name: string,
): RegistrarMeta[] {
  return accounts.filter((a) => a.name === name && isSaved(a));
}

/** Labels DomBot assigned itself ("Default" for adopted legacy accounts, "Main"
 * and "Account N" for new ones). Worth replacing once an account has a sibling. */
export function isAutoLabel(label: string | undefined): boolean {
  return !label || /^(default|main|account \d+)$/i.test(label.trim());
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
