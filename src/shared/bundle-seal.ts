// Passphrase sealing for exported data bundles (src/core/storage/bundle.ts).
//
// A bundle holds registrar API keys in the clear, so the user can seal it:
// PBKDF2-SHA256 (600k iterations) → AES-256-GCM. The result is still JSON,
// with an `encrypted` envelope where the plain bundle has `namespaces`, and
// keeps the bundle's format/version/exportedAt so it's recognizable.
//
// This runs on the *client* — the renderer (both hosts) and the rotate-secret
// script — never in the Worker: 600k PBKDF2 rounds are a few hundred ms of
// CPU, far past the Workers Free 10 ms budget, and the transport to the
// browser is already TLS + the session. WebCrypto only, so the same code
// runs in a browser, Electron's renderer, and Node.

export const SEAL_KDF = 'PBKDF2-SHA256';
export const SEAL_ALG = 'AES-256-GCM';
export const SEAL_ITERATIONS = 600_000;

export interface SealedEnvelope {
  kdf: typeof SEAL_KDF;
  iterations: number;
  salt: string;
  alg: typeof SEAL_ALG;
  iv: string;
  ct: string;
}

/** A sealed file: the bundle's header fields plus the envelope. */
interface SealedBundle {
  format: string;
  version: number;
  exportedAt?: string;
  encrypted: SealedEnvelope;
}

export class SealError extends Error {}

// ── base64 helpers ───────────────────────────────────────────────────────────

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Whether `text` is a sealed bundle (so a passphrase is needed to open it). */
export function isSealedBundle(text: string): boolean {
  try {
    const head = JSON.parse(text) as { encrypted?: unknown } | null;
    return Boolean(head && typeof head === 'object' && head.encrypted);
  } catch {
    return false;
  }
}

/**
 * Seals plain bundle text under `passphrase`. The bundle's `format`,
 * `version`, and `exportedAt` are copied onto the sealed file so it's still
 * recognizably a DomBot data file.
 */
export async function sealBundle(
  text: string,
  passphrase: string,
): Promise<string> {
  const head = JSON.parse(text) as {
    format: string;
    version: number;
    exportedAt?: string;
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, SEAL_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  const sealed: SealedBundle = {
    format: head.format,
    version: head.version,
    exportedAt: head.exportedAt,
    encrypted: {
      kdf: SEAL_KDF,
      iterations: SEAL_ITERATIONS,
      salt: toB64(salt),
      alg: SEAL_ALG,
      iv: toB64(iv),
      ct: toB64(new Uint8Array(ct)),
    },
  };
  return JSON.stringify(sealed, null, 2);
}

/** Opens a sealed bundle, returning the plain bundle text. Throws SealError. */
export async function openBundle(
  text: string,
  passphrase: string,
): Promise<string> {
  let head: SealedBundle | null;
  try {
    head = JSON.parse(text) as SealedBundle | null;
  } catch {
    throw new SealError('Not a DomBot data file (invalid JSON).');
  }
  const e = head?.encrypted;
  if (!e) throw new SealError('This file is not sealed.');
  if (e.kdf !== SEAL_KDF || e.alg !== SEAL_ALG) {
    throw new SealError('Unsupported encryption in this file.');
  }
  if (!passphrase) throw new SealError('This file needs its passphrase.');
  const key = await deriveKey(passphrase, fromB64(e.salt), e.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(e.iv) },
      key,
      fromB64(e.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SealError('Wrong passphrase.');
  }
}
