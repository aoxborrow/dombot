import { app, safeStorage } from 'electron';
import { CREDENTIALS_NAMESPACE } from '../../core/services/credentials';
import { EncryptedDocStore } from '../../core/storage/encrypted';
import { configureStore, hydrateStores } from '../../core/storage/namespace';
import type { DocStore } from '../../core/storage/doc-store';
import { FsDocStore } from './fs-doc-store';
import { migrateLegacyCredentials, migrateLegacyMcpTokens } from './migrate';
import {
  plaintextCredentialsAllowed,
  safeStorageCipher,
} from './safe-storage-cipher';

// Wires the desktop host's storage: JSON files under userData, with the
// credentials namespace sealed by OS safeStorage — unless the user has opted
// into plaintext for a keyring-less machine, in which case the files are
// written as-is (loudly). Call once after app 'ready', before anything reads a
// store; it also runs the legacy-credentials migration and hydrates every
// namespace into memory.

function buildStore(): DocStore {
  const files = new FsDocStore(app.getPath('userData'));
  if (!safeStorage.isEncryptionAvailable() && plaintextCredentialsAllowed()) {
    console.warn(
      '[storage] safeStorage unavailable and DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1 ' +
        `— registrar credentials will be written UNENCRYPTED under ${files.fileFor(CREDENTIALS_NAMESPACE)}`,
    );
    return files;
  }
  return new EncryptedDocStore(
    files,
    safeStorageCipher,
    new Set([CREDENTIALS_NAMESPACE]),
  );
}

export async function initStorage(): Promise<void> {
  const store = buildStore();
  configureStore(store);
  await migrateLegacyCredentials(app.getPath('userData'), store, {
    decrypt: (blob) => {
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        return safeStorage.decryptString(blob);
      } catch {
        return null;
      }
    },
  });
  await migrateLegacyMcpTokens(app.getPath('userData'), store);
  await hydrateStores();
}
