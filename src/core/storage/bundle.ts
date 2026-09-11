import { validateAccountRecords } from '../services/accounts';
import {
  broadcastApprovalsChanged,
  broadcastPortfolioChanged,
} from '../events';
import { restartAutoSync } from '../services/auto-sync';
import { resetRegistrarClients } from '../services/registrars';
import { getSettings, notifySettingsChanged } from '../services/settings';
import { exportNamespaces, importNamespaces } from './namespace';
import { parseNamecheapProxy } from '../../shared/namecheap-proxy';

// A portable copy of everything DomBot stores — registrar keys, portfolio
// cache, folders, manual prices, settings, MCP pairings, bulk-job history —
// as one JSON document. It's the backup story for a self-hosted instance
// (whose data is unreadable without its root secret), the way to move from
// the desktop app to a web instance without re-entering keys, and what the
// secret-rotation script round-trips through.
//
// The bundle holds API keys in the clear. Sealing it with a passphrase is
// the client's job (src/shared/bundle-seal.ts): the renderer seals what it
// downloads and opens what it uploads, so the key stretching never runs on
// a Worker's CPU budget. This module only ever sees plain bundles.

export const BUNDLE_FORMAT = 'dombot-data';
export const BUNDLE_VERSION = 2;

/** Host-specific or transient namespaces that never travel. */
const NEVER_EXPORTED: ReadonlySet<string> = new Set(['auth', 'meta']);

export interface DataBundle {
  format: typeof BUNDLE_FORMAT;
  version: 1 | typeof BUNDLE_VERSION;
  exportedAt: string;
  /** Which DomBot wrote it (informational). */
  app: { version: string; platform: string };
  namespaces: Record<string, Record<string, unknown>>;
}

// ── export ───────────────────────────────────────────────────────────────────

/** Snapshot of the store as a bundle object. */
export function buildBundle(app: DataBundle['app']): DataBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    app,
    namespaces: exportNamespaces(NEVER_EXPORTED),
  };
}

/** The bundle as text — what the client downloads (sealing it first if the
 *  user gave a passphrase). */
export function exportBundle(app: DataBundle['app']): string {
  return JSON.stringify(buildBundle(app), null, 2);
}

// ── import ───────────────────────────────────────────────────────────────────

export class BundleError extends Error {}

/** Parses plain bundle text. Throws BundleError. */
export function parseBundle(text: string): DataBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BundleError('Not a DomBot data file (invalid JSON).');
  }
  const head = raw as (Partial<DataBundle> & { encrypted?: unknown }) | null;
  if (!head || head.format !== BUNDLE_FORMAT) {
    throw new BundleError('Not a DomBot data file.');
  }
  if (head.version !== 1 && head.version !== BUNDLE_VERSION) {
    throw new BundleError(
      `This file was made by a newer DomBot (format v${String(head.version)}). Update and try again.`,
    );
  }
  if (head.encrypted) {
    throw new BundleError(
      'This file is sealed with a passphrase; open it before importing.',
    );
  }
  if (!head.namespaces || typeof head.namespaces !== 'object') {
    throw new BundleError('This data file has no content.');
  }
  for (const [ns, entries] of Object.entries(head.namespaces)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new BundleError(`Malformed namespace "${ns}" in this file.`);
    }
  }
  try {
    validateAccountRecords(head.namespaces['registrar-accounts'] ?? {});
  } catch (err) {
    throw new BundleError(err instanceof Error ? err.message : String(err));
  }
  // Validate the fixed-IP proxy settings for every Namecheap account in the
  // bundle — the legacy default key plus any UUID-keyed accounts — so an import
  // can't smuggle in a private/reserved-IP or otherwise malformed proxy.
  const accountRecords = (head.namespaces['registrar-accounts'] ?? {}) as Record<
    string,
    { registrar?: unknown } | null
  >;
  const namecheapIds = new Set<string>(['namecheap']);
  for (const [id, record] of Object.entries(accountRecords))
    if (record && typeof record === 'object' && record.registrar === 'namecheap')
      namecheapIds.add(id);
  const credentials = (head.namespaces.credentials ?? {}) as Record<
    string,
    unknown
  >;
  for (const id of namecheapIds) {
    const bag = credentials[id];
    if (bag && typeof bag === 'object') {
      try {
        parseNamecheapProxy(bag as Record<string, unknown>);
      } catch (error) {
        throw new BundleError(
          error instanceof Error
            ? error.message
            : 'Invalid Namecheap proxy settings.',
        );
      }
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
): Promise<{ namespaces: number; entries: number }> {
  const bundle = parseBundle(text);
  const prevSettings = getSettings();
  const result = importNamespaces(bundle.namespaces, NEVER_EXPORTED);
  // Everyone holding a derived view refreshes: the registrar clients built
  // from the old credentials, the UI (portfolio, pairings), the host's
  // settings listeners (the MCP server toggle), the sync timer.
  resetRegistrarClients();
  notifySettingsChanged(getSettings(), prevSettings);
  restartAutoSync();
  broadcastPortfolioChanged();
  broadcastApprovalsChanged();
  return result;
}
