import { safeStorage } from 'electron';
import type { Cipher } from '../../core/storage/encrypted';

// The desktop cipher for the credentials namespace: Electron `safeStorage`,
// which is the OS keychain on macOS, DPAPI on Windows, and the system keyring
// (libsecret/kwallet) on Linux.
//
// If OS encryption is unavailable (e.g. a headless Linux box with no keyring),
// `seal` refuses rather than silently writing API keys as plaintext; the error
// propagates to the Settings save so the user sees it. Setting
// DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1 opts into a plaintext fallback for those
// environments — a deliberate, logged choice, never the default (in that case
// the host skips this cipher entirely; see storage/index.ts).
//
// `open` decrypts an envelope written by `seal`. Only call after app 'ready'
// (safeStorage isn't usable before then).

/** Explicit opt-in to storing credentials unencrypted (no OS keyring). */
export function plaintextCredentialsAllowed(): boolean {
  return process.env.DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS === '1';
}

export const UNAVAILABLE_MESSAGE =
  'OS credential encryption is unavailable, so registrar API keys cannot ' +
  'be stored securely. On Linux, install/unlock a system keyring ' +
  '(libsecret/gnome-keyring or kwallet). To store credentials ' +
  'unencrypted anyway, set DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1.';

export const safeStorageCipher: Cipher = {
  alg: 'safeStorage',
  async seal(plaintext) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(UNAVAILABLE_MESSAGE);
    }
    return safeStorage.encryptString(plaintext).toString('base64');
  },
  async open(sealed) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(UNAVAILABLE_MESSAGE);
    }
    return safeStorage.decryptString(Buffer.from(sealed, 'base64'));
  },
};
