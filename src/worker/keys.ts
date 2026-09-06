// Key derivation for the web host. One operator secret (DOMBOT_SECRET, 32
// random bytes base64) is the root; every key the Worker uses is derived from
// it with HKDF so none of them is ever stored:
//
//   enc      AES-256-GCM key sealing every value in D1 (EncryptedDocStore)
//   session  HMAC key signing login cookies — mixed with a hash of
//            DOMBOT_PASSWORD, so rotating the password invalidates every
//            session with no server-side state
//
// (MCP access tokens need no key: they're random and stored by hash in the
// encrypted `mcp` namespace — src/core/mcp/oauth.ts.)
//
// Everything is WebCrypto, so it runs identically on Workers and Node.

const enc = new TextEncoder();

function fromBase64(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Parses DOMBOT_SECRET; throws a clear error if it's missing or too short. */
export function parseRootSecret(secret: string | undefined): Uint8Array {
  if (!secret) {
    throw new Error(
      'DOMBOT_SECRET is not set. Run `npm run web:secrets` (see docs/self-hosting.md).',
    );
  }
  const bytes = fromBase64(secret);
  if (bytes.byteLength < 32) {
    throw new Error('DOMBOT_SECRET must be at least 32 random bytes (base64).');
  }
  return bytes;
}

async function hkdf(
  root: Uint8Array,
  info: string,
  salt: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', root, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', enc.encode(input)),
  );
}

/** Raw 32-byte key for EncryptedDocStore. */
export function deriveEncryptionKey(root: Uint8Array): Promise<Uint8Array> {
  return hkdf(root, 'dombot/enc/v1');
}

/**
 * HMAC key for session cookies. The password's hash is the HKDF salt, so a
 * password rotation yields a different key and every existing cookie fails
 * verification.
 */
export async function deriveSessionKey(
  root: Uint8Array,
  password: string,
): Promise<CryptoKey> {
  const raw = await hkdf(root, 'dombot/session/v1', await sha256(password));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Constant-time equality of two strings (compared as SHA-256 digests, so
 *  length differences leak nothing either). */
export async function timingSafeEqualStrings(
  a: string,
  b: string,
): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}
