import type { DocStore } from './doc-store';

// Encryption-at-rest decorator for a DocStore. Values in the chosen namespaces
// are sealed before they reach the inner store and opened on the way back, so
// whoever can read the underlying files or table sees only ciphertext. The
// cipher is pluggable: Electron plugs in OS-backed `safeStorage`; the web host
// plugs in AES-256-GCM under a key derived from its root secret.
//
// Envelope: `{ __sealed: 1, alg, ct }` — a plain JSON object the inner store
// treats like any other value. Reads pass unsealed values through untouched, so
// a namespace can be switched to encryption without a rewrite (and a legacy
// plaintext value still loads).

export interface Cipher {
  /** Short identifier stored in the envelope, e.g. "aes-gcm" or "safeStorage". */
  readonly alg: string;
  /** Seals a UTF-8 string to an opaque base64 string. */
  seal(plaintext: string): Promise<string>;
  /** Reverses `seal`. */
  open(sealed: string): Promise<string>;
}

interface Envelope {
  __sealed: 1;
  alg: string;
  ct: string;
}

function isEnvelope(v: unknown): v is Envelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Envelope).__sealed === 1 &&
    typeof (v as Envelope).ct === 'string'
  );
}

export class EncryptedDocStore implements DocStore {
  /**
   * @param namespaces Which namespaces to seal. Omit to seal every namespace.
   */
  constructor(
    private readonly inner: DocStore,
    private readonly cipher: Cipher,
    private readonly namespaces?: ReadonlySet<string>,
  ) {}

  private sealed(ns: string): boolean {
    return this.namespaces ? this.namespaces.has(ns) : true;
  }

  private async open(value: unknown): Promise<unknown> {
    if (!isEnvelope(value)) return value;
    return JSON.parse(await this.cipher.open(value.ct)) as unknown;
  }

  async get(ns: string, key: string): Promise<unknown | null> {
    const raw = await this.inner.get(ns, key);
    return raw === null ? null : this.open(raw);
  }

  async put(ns: string, key: string, value: unknown): Promise<void> {
    if (!this.sealed(ns)) return this.inner.put(ns, key, value);
    const envelope: Envelope = {
      __sealed: 1,
      alg: this.cipher.alg,
      ct: await this.cipher.seal(JSON.stringify(value)),
    };
    return this.inner.put(ns, key, envelope);
  }

  delete(ns: string, key: string): Promise<void> {
    return this.inner.delete(ns, key);
  }

  async list(ns: string): Promise<Record<string, unknown>> {
    const raw = await this.inner.list(ns);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = await this.open(value);
    }
    return out;
  }

  clear(ns: string): Promise<void> {
    return this.inner.clear(ns);
  }
}

// ── AES-256-GCM via WebCrypto ────────────────────────────────────────────────
// Runs identically on Node, Electron, and Workers. Sealed form is
// base64(iv ‖ ciphertext‖tag), a fresh 96-bit IV per seal.

const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** An AES-256-GCM cipher over a raw 32-byte key. */
export async function aesGcmCipher(rawKey: Uint8Array): Promise<Cipher> {
  if (rawKey.byteLength !== 32) {
    throw new Error('aesGcmCipher: key must be 32 bytes');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    alg: 'aes-gcm',
    async seal(plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          enc.encode(plaintext),
        ),
      );
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv);
      out.set(ct, iv.length);
      return toBase64(out);
    },
    async open(sealed) {
      const bytes = fromBase64(sealed);
      const iv = bytes.subarray(0, IV_BYTES);
      const ct = bytes.subarray(IV_BYTES);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return dec.decode(pt);
    },
  };
}
