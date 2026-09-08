import type { RegistrarCredentials } from '@aoxborrow/registrar-client';
import { Namespace } from '../storage/namespace';

// Registrar credentials entered in Settings, one entry per registrar. Keys
// configured once here are used by both the UI and the MCP server.
//
// Encryption at rest is the host's job, not this module's: the host wraps its
// DocStore in an `EncryptedDocStore` covering this namespace (Electron with OS
// `safeStorage`, the web host with AES-GCM under its root secret — see
// storage/encrypted.ts). A host whose cipher is unavailable makes the write
// fail, which `setStoredCredentials` surfaces to the caller so the Settings
// save shows the error instead of silently storing keys in the clear.

export const CREDENTIALS_NAMESPACE = 'credentials';

const store = new Namespace<RegistrarCredentials>(CREDENTIALS_NAMESPACE);

/** Credentials the user has saved for a registrar (empty object if none). */
export function getStoredCredentials(name: string): RegistrarCredentials {
  return store.get(name) ?? {};
}

/**
 * Saves credentials for a registrar. Empty/blank fields are dropped; saving an
 * all-empty set clears the registrar entirely. Rejects if the host can't
 * persist them (e.g. no OS encryption available).
 */
export async function setStoredCredentials(
  name: string,
  creds: RegistrarCredentials,
): Promise<void> {
  const clean: RegistrarCredentials = {};
  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  }
  const previous = store.get(name);
  const next = Object.keys(clean).length > 0 ? clean : undefined;
  try {
    if (next) await store.set(name, next);
    else await store.delete(name);
  } catch (err) {
    // A failed encrypted write must not leave unsaved credentials usable in
    // memory. Do not undo a newer concurrent save or another account's edit.
    if (store.get(name) === next) {
      const all = store.all();
      if (previous) all[name] = previous;
      else delete all[name];
      store.replace(all);
    }
    throw err;
  }
}
