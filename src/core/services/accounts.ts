import {
  registrars,
  type RegistrarName,
  type RegistrarCredentials,
} from '@aoxborrow/registrar-client';
import type { RegistrarAccount } from '../../shared/ipc';
import { Namespace } from '../storage/namespace';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import {
  accountDisplayLabel,
  accountNumber,
  autoLabel,
} from '../../shared/account-label';

// Default IDs deliberately equal legacy storage keys: no credential rewrite or
// loss of cached domains, folders, manual prices, or disabled state on upgrade.
const store = new Namespace<RegistrarAccount & { removed?: boolean }>(
  'registrar-accounts',
);

export function listAccounts(): RegistrarAccount[] {
  const saved = store.all();
  const defaults = (Object.keys(registrars) as RegistrarName[]).map(
    (registrar) =>
      saved[registrar] ?? { id: registrar, registrar, label: 'Default' },
  );
  return [
    ...defaults,
    ...Object.values(saved).filter((a) => a.id !== a.registrar),
  ].filter((a) => !('removed' in a && a.removed));
}

export function accountById(id: string): RegistrarAccount {
  const account = listAccounts().find((a) => a.id === id);
  if (!account)
    throw new Error(`Unknown account "${id}". Choose an account in Settings.`);
  return account;
}

/** An account the user actually has, as opposed to the placeholder every
 * registrar gets so legacy single-account storage keys keep resolving. */
export function isSavedAccount(id: string): boolean {
  return store.has(id) || Object.keys(getStoredCredentials(id)).length > 0;
}

/** Nicknames tell sibling accounts apart, so they are unique per registrar
 * (case-insensitively) among accounts the user actually has. */
export function assertUniqueAccountLabel(
  registrar: RegistrarName,
  label: string,
  exceptId?: string,
): void {
  // Compare what is shown: `Default`, `Main` and `Account 1` are all "#1".
  const shown = (value: string) => accountDisplayLabel(value).toLowerCase();
  const wanted = shown(label);
  const clash = listAccounts().find(
    (a) =>
      a.registrar === registrar &&
      a.id !== exceptId &&
      isSavedAccount(a.id) &&
      shown(a.label) === wanted,
  );
  if (clash)
    throw new Error(
      `Another account is already named "${accountDisplayLabel(clash.label)}". Choose a different nickname.`,
    );
}

/** Numbers already standing for a registrar's unnamed accounts. */
function numbersInUse(registrar: RegistrarName, exceptId?: string): number[] {
  return listAccounts()
    .filter(
      (a) =>
        a.registrar === registrar && a.id !== exceptId && isSavedAccount(a.id),
    )
    .map((a) => accountNumber(a.label))
    .filter((n): n is number => n !== null);
}

/** The label for a new unnamed account: one past the highest number in use, so
 * a number is never handed to a different account while its owner exists and
 * removing #1 doesn't turn #2 into #1. */
export function nextAccountLabel(registrar: RegistrarName): string {
  return autoLabel(Math.max(0, ...numbersInUse(registrar)) + 1);
}

function cleanLabel(label: string): string {
  const value = label.trim();
  if (!value || value.length > 100)
    throw new Error('Account label must contain 1–100 characters.');
  return value;
}

export async function createAccount(
  registrar: RegistrarName,
  label: string,
  credentials?: RegistrarCredentials,
  proxyId?: string,
): Promise<RegistrarAccount> {
  if (!Object.hasOwn(registrars, registrar))
    throw new Error('Unknown registrar.');
  const account: RegistrarAccount = {
    id: crypto.randomUUID(),
    registrar,
    label: cleanLabel(label),
    ...(proxyId ? { proxyId } : {}),
  };
  assertUniqueAccountLabel(registrar, account.label);
  // Persist secrets first. A failed test/save never exposes an empty account.
  if (credentials) await setStoredCredentials(account.id, credentials);
  try {
    await store.set(account.id, account);
  } catch (err) {
    const all = store.all();
    delete all[account.id];
    store.replace(all);
    if (credentials) await setStoredCredentials(account.id, {});
    throw err;
  }
  return account;
}

/** Sets an account's nickname. A blank nickname removes it: the account goes
 * back to a number, the lowest its siblings aren't using (so the account that
 * was #1 before it was named is #1 again). */
export async function renameAccount(id: string, label: string): Promise<void> {
  const account = accountById(id);
  let next: string;
  if (label.trim()) {
    next = cleanLabel(label);
    assertUniqueAccountLabel(account.registrar, next, id);
  } else {
    const taken = new Set(numbersInUse(account.registrar, id));
    let n = 1;
    while (taken.has(n)) n++;
    next = autoLabel(n);
  }
  await store.set(id, { ...account, label: next });
}

/** Routes an account through a proxy profile, or back to a direct connection. */
export async function setAccountProxy(
  id: string,
  proxyId: string | null,
): Promise<void> {
  const { proxyId: current, ...account } = accountById(id);
  if ((current ?? null) === proxyId) return;
  await store.set(id, proxyId ? { ...account, proxyId } : account);
}

/** Accounts whose changes sync records (see `trackedSince`). */
export function trackedAccountIds(): Set<string> {
  const out = new Set<string>();
  for (const a of Object.values(store.all()))
    if (typeof a.trackedSince === 'number') out.add(a.id);
  return out;
}

/** Starts tracking changes for accounts that just synced for the first time. */
export function markAccountsTracked(ids: string[], now: number): void {
  for (const id of ids) {
    const account = store.get(id) ?? listAccounts().find((a) => a.id === id);
    if (!account || typeof account.trackedSince === 'number') continue;
    void store.set(id, { ...account, trackedSince: now });
  }
}

export async function removeAccountRecord(id: string): Promise<void> {
  const account = accountById(id);
  // Tombstones prevent default IDs (and old queued work) from being reused.
  await store.set(id, { ...account, removed: true });
}

/** Validate account routing metadata before replacing any live store on import. */
export function validateAccountRecords(records: Record<string, unknown>): void {
  for (const [key, raw] of Object.entries(records)) {
    const a = raw as (Partial<RegistrarAccount> & { removed?: boolean }) | null;
    const legacyId = Object.hasOwn(registrars, key);
    if (
      !a ||
      typeof a !== 'object' ||
      a.id !== key ||
      typeof a.registrar !== 'string' ||
      !Object.hasOwn(registrars, a.registrar) ||
      (legacyId
        ? key !== a.registrar
        : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            key,
          )) ||
      typeof a.label !== 'string' ||
      !a.label.trim() ||
      a.label.length > 100 ||
      (a.proxyId !== undefined &&
        (typeof a.proxyId !== 'string' ||
          !a.proxyId ||
          a.proxyId.length > 64)) ||
      (a.removed !== undefined && typeof a.removed !== 'boolean') ||
      (a.trackedSince !== undefined && typeof a.trackedSince !== 'number')
    ) {
      throw new Error(`Invalid account metadata for "${key}".`);
    }
  }
}
