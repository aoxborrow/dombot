import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type {
  RegistrarCredentials,
  RegistrarName,
} from '@aoxborrow/registrar-client';

// Persistent, OS-encrypted store for registrar credentials entered in Settings.
// This is the end-user replacement for .env: keys configured once here are used
// by both the UI and the MCP server. On macOS/Windows the blob is encrypted via
// Electron safeStorage (Keychain/DPAPI); if encryption is unavailable it falls
// back to plaintext on disk (dev only) with a warning.

type CredentialStore = Partial<Record<RegistrarName, RegistrarCredentials>>;

let cache: CredentialStore | null = null;

function storeFile(): string {
  return path.join(app.getPath('userData'), 'credentials.dat');
}

function load(): CredentialStore {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(storeFile());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    cache = JSON.parse(json) as CredentialStore;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(store: CredentialStore): void {
  cache = store;
  const json = JSON.stringify(store);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(storeFile(), safeStorage.encryptString(json));
  } else {
    console.warn(
      '[credentials] safeStorage unavailable — storing in plaintext',
    );
    fs.writeFileSync(storeFile(), json, 'utf8');
  }
}

/** Credentials the user has saved for a registrar (empty object if none). */
export function getStoredCredentials(
  name: RegistrarName,
): RegistrarCredentials {
  return load()[name] ?? {};
}

/**
 * Saves credentials for a registrar. Empty/blank fields are dropped; saving an
 * all-empty set clears the registrar entirely.
 */
export function setStoredCredentials(
  name: RegistrarName,
  creds: RegistrarCredentials,
): void {
  const store: CredentialStore = { ...load() };
  const clean: RegistrarCredentials = {};
  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  }
  if (Object.keys(clean).length > 0) {
    store[name] = clean;
  } else {
    delete store[name];
  }
  persist(store);
}
