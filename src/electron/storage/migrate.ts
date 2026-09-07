import fs from 'node:fs';
import path from 'node:path';
import type { RegistrarCredentials } from '@aoxborrow/registrar-client';
import type { DocStore } from '../../core/storage/doc-store';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { CREDENTIALS_NAMESPACE } from '../../core/services/credentials';
import { MCP_NAMESPACE, legacyTokenEntry } from '../../core/mcp/oauth';

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

export const LEGACY_MCP_TOKENS_FILE = 'mcp-tokens.json';

/**
 * Migrates `userData/mcp-tokens.json` (the pre-DocStore MCP pairings, stored
 * as raw bearer tokens) into the `mcp` namespace, where tokens are kept by
 * hash. Idempotent: the trigger is the legacy file existing; on success it's
 * renamed `.pre-v1.bak`. Returns the number of tokens migrated.
 */
export async function migrateLegacyMcpTokens(
  userData: string,
  store: DocStore,
): Promise<number> {
  const file = path.join(userData, LEGACY_MCP_TOKENS_FILE);
  let list: AuthInfo[];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    list = Array.isArray(parsed) ? (parsed as AuthInfo[]) : [];
  } catch {
    return 0; // nothing to migrate (or unreadable — leave it)
  }
  let count = 0;
  for (const info of list) {
    if (!info || typeof info.token !== 'string' || !info.clientId) continue;
    const { key, value } = await legacyTokenEntry(info);
    await store.put(MCP_NAMESPACE, key, value);
    count++;
  }
  fs.renameSync(file, `${file}.pre-v1.bak`);
  console.log(
    `[storage] migrated ${count} MCP pairing(s) from ${LEGACY_MCP_TOKENS_FILE}`,
  );
  return count;
}
