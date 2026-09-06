import {
  broadcastApprovalsChanged,
  broadcastPortfolioChanged,
} from '../events';
import { restartAutoSync } from '../services/auto-sync';
import { getSettings, notifySettingsChanged } from '../services/settings';
import { exportNamespaces, importNamespaces } from './namespace';

// A portable copy of everything DomBot stores — registrar keys, portfolio
// cache, folders, manual prices, settings, MCP pairings, bulk-job history —
// as one JSON document. It's the backup story for a self-hosted instance
// (whose data is unreadable without its root secret), the way to move from
// the desktop app to a web instance without re-entering keys, and what the
// secret-rotation script round-trips through.
//
// The bundle holds API keys in the clear, so it can optionally be sealed with
// a passphrase: PBKDF2-SHA256 (600k iterations) → AES-256-GCM, WebCrypto
// only, so both hosts share the code. A sealed bundle is still JSON, with an
// `encrypted` envelope instead of `namespaces`.

export const BUNDLE_FORMAT = 'dombot-data';
export const BUNDLE_VERSION = 1;

/** Host-specific or transient namespaces that never travel. */
const NEVER_EXPORTED: ReadonlySet<string> = new Set(['auth', 'meta']);

export interface DataBundle {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  exportedAt: string;
  /** Which DomBot wrote it (informational). */
  app: { version: string; platform: string };
  namespaces: Record<string, Record<string, unknown>>;
}

interface SealedBundle {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  exportedAt: string;
  encrypted: {
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    alg: 'AES-256-GCM';
    iv: string;
    ct: string;
  };
}

const PBKDF2_ITERATIONS = 600_000;

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

// ── export ───────────────────────────────────────────────────────────────────

/** Snapshot of the store as a bundle object (unsealed). */
export function buildBundle(app: DataBundle['app']): DataBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    app,
    namespaces: exportNamespaces(NEVER_EXPORTED),
  };
}

/**
 * The bundle as text, sealed under `passphrase` when one is given. The
 * result is what the user downloads.
 */
export async function exportBundle(
  app: DataBundle['app'],
  passphrase?: string,
): Promise<string> {
  const bundle = buildBundle(app);
  if (!passphrase) return JSON.stringify(bundle, null, 2);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(bundle)),
  );
  const sealed: SealedBundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: bundle.exportedAt,
    encrypted: {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: toB64(salt),
      alg: 'AES-256-GCM',
      iv: toB64(iv),
      ct: toB64(new Uint8Array(ct)),
    },
  };
  return JSON.stringify(sealed, null, 2);
}

// ── import ───────────────────────────────────────────────────────────────────

export class BundleError extends Error {}

/** Parses (and, if sealed, opens) bundle text. Throws BundleError. */
export async function parseBundle(
  text: string,
  passphrase?: string,
): Promise<DataBundle> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BundleError('Not a DomBot data file (invalid JSON).');
  }
  const head = raw as Partial<SealedBundle & DataBundle> | null;
  if (!head || head.format !== BUNDLE_FORMAT) {
    throw new BundleError('Not a DomBot data file.');
  }
  if (head.version !== BUNDLE_VERSION) {
    throw new BundleError(
      `This file was made by a newer DomBot (format v${String(head.version)}). Update and try again.`,
    );
  }
  if (head.encrypted) {
    if (!passphrase) throw new BundleError('This file needs its passphrase.');
    const e = head.encrypted;
    if (e.kdf !== 'PBKDF2-SHA256' || e.alg !== 'AES-256-GCM') {
      throw new BundleError('Unsupported encryption in this file.');
    }
    const key = await deriveKey(passphrase, fromB64(e.salt), e.iterations);
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(e.iv) },
        key,
        fromB64(e.ct),
      );
    } catch {
      throw new BundleError('Wrong passphrase.');
    }
    return parseBundle(new TextDecoder().decode(plain));
  }
  if (!head.namespaces || typeof head.namespaces !== 'object') {
    throw new BundleError('This data file has no content.');
  }
  for (const [ns, entries] of Object.entries(head.namespaces)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new BundleError(`Malformed namespace "${ns}" in this file.`);
    }
  }
  return head as DataBundle;
}

/**
 * Replaces the store with a bundle's contents and tells everyone. Returns
 * what was written. The caller (an API method) awaits the flush.
 */
export async function importBundle(
  text: string,
  passphrase?: string,
): Promise<{ namespaces: number; entries: number }> {
  const bundle = await parseBundle(text, passphrase);
  const prevSettings = getSettings();
  const result = importNamespaces(bundle.namespaces, NEVER_EXPORTED);
  // Everyone holding a derived view refreshes: the UI (portfolio, pairings),
  // the host's settings listeners (the MCP server toggle), the sync timer.
  notifySettingsChanged(getSettings(), prevSettings);
  restartAutoSync();
  broadcastPortfolioChanged();
  broadcastApprovalsChanged();
  return result;
}
