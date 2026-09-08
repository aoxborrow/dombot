import { registrars, type RegistrarName } from '@aoxborrow/registrar-client';
import type { RegistrarAccount } from '../../shared/ipc';
import { Namespace } from '../storage/namespace';

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

function cleanLabel(label: string): string {
  const value = label.trim();
  if (!value || value.length > 100)
    throw new Error('Account label must contain 1–100 characters.');
  return value;
}

export async function createAccount(
  registrar: RegistrarName,
  label: string,
): Promise<RegistrarAccount> {
  if (!Object.hasOwn(registrars, registrar))
    throw new Error('Unknown registrar.');
  const account = {
    id: crypto.randomUUID(),
    registrar,
    label: cleanLabel(label),
  };
  await store.set(account.id, account);
  return account;
}

export async function renameAccount(id: string, label: string): Promise<void> {
  await store.set(id, { ...accountById(id), label: cleanLabel(label) });
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
      (a.removed !== undefined && typeof a.removed !== 'boolean')
    ) {
      throw new Error(`Invalid account metadata for "${key}".`);
    }
  }
}
