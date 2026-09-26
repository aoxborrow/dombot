import { isDomainKey, toAscii } from '../../shared/domain-name';
import { ARCHIVE_FOLDER_ID } from '../../shared/ipc';
import type { DocStore } from './doc-store';

// Storage schema migrations (docs/storage-model.md). Each host calls
// `runMigrations` once, before `hydrateStores()`; a data bundle from an older
// DomBot goes through `upgradeLegacyNamespaces` instead, so both paths share
// one table of renames and one set of re-keying rules.

/** The storage schema this build writes. Stored at `meta/schemaVersion`. */
export const SCHEMA_VERSION = 1;

/** v0 → v1: old namespace name → new. */
export const RENAMED_NAMESPACES: Readonly<Record<string, string>> = {
  'cache-portfolio': 'registrar-domains',
  'cache-detail': 'registrar-details',
  'tld-rates': 'registrar-tld-rates',
  credentials: 'registrar-credentials',
  proxies: 'registrar-proxies',
  'registrar-state': 'registrars',
  'pricing-overrides': 'domain-prices',
};

/** Renamed namespaces whose keys also change, from account-scoped to name. */
const REKEYED_BY_NAME = new Set(['pricing-overrides']);

// Folder assignments lived in `folders` under this key until v1.
const LEGACY_ASSIGNMENTS_KEY = 'assignments';
// The Archive folder's id before it became ARCHIVE_FOLDER_ID.
const LEGACY_ARCHIVE_FOLDER_ID = '__hidden__';

/** `${accountId ?? registrar}:${domain}` → `toAscii(domain)`, or null when the
 *  key doesn't end in a domain name. */
export function nameKeyOf(legacyKey: string): string | null {
  const key = toAscii(legacyKey.slice(legacyKey.lastIndexOf(':') + 1));
  return isDomainKey(key) ? key : null;
}

/**
 * Re-keys account-scoped entries by domain name. A name held by two accounts
 * keeps the first entry found; the rest are logged and dropped.
 */
export function rekeyByName<T>(
  entries: Record<string, T>,
  label: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [legacyKey, value] of Object.entries(entries)) {
    const key = nameKeyOf(legacyKey);
    if (!key) {
      console.warn(`[storage] ${label}: dropping ${legacyKey} (not a domain)`);
    } else if (Object.hasOwn(out, key)) {
      console.warn(
        `[storage] ${label}: ${legacyKey} conflicts with another account's entry for ${key}; keeping the first`,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The pre-v1 `folders/assignments` map, keyed by name, with the legacy
 *  Archive id normalized. */
export function assignmentsByName(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const ids: Record<string, string> = {};
  for (const [key, folderId] of Object.entries(raw)) {
    if (typeof folderId !== 'string') continue;
    ids[key] =
      folderId === LEGACY_ARCHIVE_FOLDER_ID ? ARCHIVE_FOLDER_ID : folderId;
  }
  return rekeyByName(ids, 'folder assignments');
}

/** A v1–v3 bundle's namespaces under the current names and keys. */
export function upgradeLegacyNamespaces(
  namespaces: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out = { ...namespaces };
  for (const [from, to] of Object.entries(RENAMED_NAMESPACES)) {
    const entries = out[from];
    if (!entries) continue;
    delete out[from];
    out[to] = REKEYED_BY_NAME.has(from) ? rekeyByName(entries, from) : entries;
  }
  const folders = out.folders;
  if (folders && Object.hasOwn(folders, LEGACY_ASSIGNMENTS_KEY)) {
    const { [LEGACY_ASSIGNMENTS_KEY]: assignments, ...definitions } = folders;
    out.folders = definitions;
    out['domain-folders'] = assignmentsByName(assignments);
  }
  return out;
}

/**
 * Brings a store written by an older DomBot up to SCHEMA_VERSION. Idempotent:
 * a step with nothing to move is skipped, and the version is recorded last.
 *
 * `raw` is the store beneath any EncryptedDocStore. Renames copy values
 * exactly as stored, so a sealed value moves still sealed and a value the
 * cipher can't open right now (a locked keyring) is never dropped. `store` is
 * the host's configured store: the version marker goes through it, and so does
 * the one value that has to be read, the folder-assignment map.
 */
export async function runMigrations(
  raw: DocStore,
  store: DocStore,
): Promise<void> {
  const version = await store.get('meta', 'schemaVersion');
  if (typeof version === 'number' && version >= SCHEMA_VERSION) return;

  const assignments = await store.get('folders', LEGACY_ASSIGNMENTS_KEY);
  if (assignments === null) {
    if ((await raw.get('folders', LEGACY_ASSIGNMENTS_KEY)) !== null) {
      // Stored but unreadable: leave everything as is and retry next start.
      throw new Error("[storage] can't read folder assignments to migrate");
    }
  } else {
    await store.putMany(
      'domain-folders',
      Object.entries(assignmentsByName(assignments)),
    );
    await store.delete('folders', LEGACY_ASSIGNMENTS_KEY);
  }

  for (const [from, to] of Object.entries(RENAMED_NAMESPACES)) {
    const entries = await raw.list(from);
    if (Object.keys(entries).length === 0) continue;
    const moved = REKEYED_BY_NAME.has(from)
      ? rekeyByName(entries, from)
      : entries;
    await raw.putMany(to, Object.entries(moved));
    await raw.clear(from);
  }

  await store.put('meta', 'schemaVersion', SCHEMA_VERSION);
}
