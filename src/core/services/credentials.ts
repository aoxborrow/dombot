import type {
  RegistrarCredentials,
  RegistrarName,
} from '@aoxborrow/registrar-client';
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
export function getStoredCredentials(
  name: RegistrarName,
): RegistrarCredentials {
  return store.get(name) ?? {};
}

/**
 * Saves credentials for a registrar. Empty/blank fields are dropped; saving an
 * all-empty set clears the registrar entirely. Rejects if the host can't
 * persist them (e.g. no OS encryption available).
 */
export function setStoredCredentials(
  name: RegistrarName,
  creds: RegistrarCredentials,
): Promise<void> {
  const clean: RegistrarCredentials = {};
  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  }
  if (Object.keys(clean).length > 0) return store.set(name, clean);
  return store.delete(name);
}
