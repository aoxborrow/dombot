import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type {
  RegistrarCredentials,
  RegistrarName,
} from '@aoxborrow/registrar-client';

// Persistent, OS-encrypted store for registrar credentials entered in Settings.
// Keys configured once here are used by both the UI and the MCP server. On
// macOS/Windows the blob is encrypted via Electron safeStorage (Keychain/DPAPI);
// on Linux via the system keyring (libsecret/kwallet).
//
// If OS encryption is unavailable (e.g. a headless Linux box with no keyring),
// we refuse to save rather than silently writing API keys as plaintext to disk.
// Setting DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1 opts into a plaintext fallback
// for those environments — a deliberate, logged choice, never the default. The
// file is written 0600 (owner-only) whichever path is taken.

type CredentialStore = Partial<Record<RegistrarName, RegistrarCredentials>>;

/** Owner-only perms: no other local user can read the credential file. */
const FILE_MODE = 0o600;

/** Explicit opt-in to storing credentials unencrypted (no OS keyring). */
function plaintextAllowed(): boolean {
  return process.env.DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS === '1';
}

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

// Write the store file 0600, tightening perms even when overwriting an existing
// file (writeFileSync's `mode` only applies when creating one).
function writeStoreFile(data: string | Buffer): void {
  const file = storeFile();
  fs.writeFileSync(file, data, { mode: FILE_MODE });
  try {
    fs.chmodSync(file, FILE_MODE);
  } catch {
    // Best effort — e.g. filesystems without POSIX perms (Windows).
  }
}

function persist(store: CredentialStore): void {
  cache = store;
  const json = JSON.stringify(store);
  if (safeStorage.isEncryptionAvailable()) {
    writeStoreFile(safeStorage.encryptString(json));
    return;
  }
  if (!plaintextAllowed()) {
    // Fail loudly instead of quietly writing API keys as plaintext. The throw
    // propagates to the Settings save (IPC), so the user sees the save fail.
    throw new Error(
      'OS credential encryption is unavailable, so registrar API keys cannot ' +
        'be stored securely. On Linux, install/unlock a system keyring ' +
        '(libsecret/gnome-keyring or kwallet). To store credentials ' +
        'unencrypted anyway, set DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1.',
    );
  }
  console.warn(
    '[credentials] safeStorage unavailable and ' +
      'DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1 — writing credentials UNENCRYPTED ' +
      `to ${storeFile()}`,
  );
  writeStoreFile(json);
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
