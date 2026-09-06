import fs from 'node:fs';
import path from 'node:path';
import type { RegistrarCredentials } from '@aoxborrow/registrar-client';
import type { DocStore } from '../../core/storage/doc-store';
import { CREDENTIALS_NAMESPACE } from '../../core/services/credentials';

// One-time migration from the pre-DocStore layout. Every JSON store kept its
// file name and shape under FsDocStore, so nothing needs rewriting except
// credentials: they used to be one `credentials.dat` blob (the whole
// `{ registrar: creds }` map encrypted with safeStorage, or plaintext under
// DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1). Now each registrar is its own key in
// the `credentials` namespace, sealed per value by EncryptedDocStore.
//
// Runs before hydration, idempotent: the trigger is the legacy file existing.
// On success it's renamed `credentials.dat.pre-v1.bak` (kept for one release).
// If the blob can't be read — encrypted, but no keyring available right now —
// it's left in place and retried next launch, so nothing is lost.

export const LEGACY_CREDENTIALS_FILE = 'credentials.dat';

export interface LegacyCredentialsReader {
  /** Decrypts a safeStorage blob, or returns null if that's not possible now. */
  decrypt(blob: Buffer): string | null;
}

/** Parses the legacy blob to the registrar map, or null if unreadable. */
function parseLegacy(
  raw: Buffer,
  reader: LegacyCredentialsReader,
): Record<string, RegistrarCredentials> | null {
  const attempt = (text: string | null) => {
    if (text === null) return null;
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, RegistrarCredentials>)
        : null;
    } catch {
      return null;
    }
  };
  // Plaintext first (cheap, and what the opt-in fallback wrote), then decrypt.
  return attempt(raw.toString('utf8')) ?? attempt(reader.decrypt(raw));
}

/**
 * Migrates `userData/credentials.dat` into `store`. Returns true when the
 * legacy file was migrated (or didn't exist), false when it exists but
 * couldn't be read yet.
 */
export async function migrateLegacyCredentials(
  userData: string,
  store: DocStore,
  reader: LegacyCredentialsReader,
): Promise<boolean> {
  const file = path.join(userData, LEGACY_CREDENTIALS_FILE);
  let raw: Buffer;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return true; // nothing to migrate
  }
  const legacy = parseLegacy(raw, reader);
  if (!legacy) {
    console.warn(
      `[storage] ${LEGACY_CREDENTIALS_FILE} can't be read right now; ` +
        'will retry next launch',
    );
    return false;
  }
  for (const [registrar, creds] of Object.entries(legacy)) {
    if (creds && typeof creds === 'object' && Object.keys(creds).length > 0) {
      await store.put(CREDENTIALS_NAMESPACE, registrar, creds);
    }
  }
  fs.renameSync(file, `${file}.pre-v1.bak`);
  console.log(
    `[storage] migrated ${Object.keys(legacy).length} registrar credential ` +
      `set(s) from ${LEGACY_CREDENTIALS_FILE}`,
  );
  return true;
}
