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
import { PROXIES_NAMESPACE, parseProxy } from '../../shared/proxy';
import { migrateLegacyProxies } from '../services/proxies';
import { sanitizeBundleDiagnostics } from './sanitize-diagnostics';
import { upgradeLegacyNamespaces } from './migrations';
import {
  EVENTS_NAMESPACE,
  NOTES_NAMESPACE,
  cleanEntries,
  cleanEvent,
  cleanNote,
} from '../services/domain-events';
import { CREDENTIALS_NAMESPACE } from './names';

// A portable copy of everything DomBot stores — registrar keys, portfolio
// cache, folders, manual prices, TLD rates, settings, MCP pairings, bulk-job
// history — as one JSON document. It's the backup story for a self-hosted instance
// (whose data is unreadable without its root secret), the way to move from
// the desktop app to a web instance without re-entering keys, and what the
// secret-rotation script round-trips through.
//
// The bundle holds API keys in the clear. Sealing it with a passphrase is
// the client's job (src/shared/bundle-seal.ts): the renderer seals what it
// downloads and opens what it uploads, so the key stretching never runs on
// a Worker's CPU budget. This module only ever sees plain bundles.

export const BUNDLE_FORMAT = 'dombot-data';
// v3 adds the `proxies` namespace and `proxyId` on accounts. Older builds would
// silently drop both and then connect directly, so they must refuse the file.
// v4 renames namespaces and keys folders and prices by domain name
// (docs/storage-model.md); v1–v3 files are upgraded on import. Namespaces
// flagged `local` (meta, …) never travel.
// v5 adds the domain history (`domain-events`, `domain-notes`). A v4 build
// would skip those namespaces and silently drop the history, so it must
// refuse the file. Rule: any release that adds a non-cache namespace bumps
// this version.
export const BUNDLE_VERSION = 5;

export interface DataBundle {
  format: typeof BUNDLE_FORMAT;
  version: 1 | 2 | 3 | 4 | typeof BUNDLE_VERSION;
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
    namespaces: exportNamespaces(),
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
  if (![1, 2, 3, 4, BUNDLE_VERSION].includes(head.version as number)) {
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
  // Files before v4 use the old names and account-scoped keys; bring them up
  // to date first so every check below sees one layout. (v4 has the current
  // names and simply has no history yet.)
  if ((head.version as number) < 4) {
    head.namespaces = upgradeLegacyNamespaces(head.namespaces);
  }
  head.version = BUNDLE_VERSION;
  try {
    validateAccountRecords(head.namespaces['registrar-accounts'] ?? {});
  } catch (err) {
    throw new BundleError(err instanceof Error ? err.message : String(err));
  }
  // Events and notes are user data the screens read directly, so re-check
  // every record the way the services would have written it; a record that
  // doesn't hold is dropped (and logged) rather than failing the import.
  const events = head.namespaces[EVENTS_NAMESPACE];
  if (events)
    head.namespaces[EVENTS_NAMESPACE] = cleanEntries(
      EVENTS_NAMESPACE,
      events,
      cleanEvent,
    );
  const notes = head.namespaces[NOTES_NAMESPACE];
  if (notes)
    head.namespaces[NOTES_NAMESPACE] = cleanEntries(
      NOTES_NAMESPACE,
      notes,
      cleanNote,
    );
  // Validate every proxy profile, and every account's pointer to one, so an
  // import can't smuggle in a private/reserved-IP or otherwise malformed proxy
  // or leave an account pointing at nothing.
  const profiles = (head.namespaces[PROXIES_NAMESPACE] ?? {}) as Record<
    string,
    { id?: unknown; url?: unknown; egressIp?: unknown } | null
  >;
  for (const [id, profile] of Object.entries(profiles)) {
    try {
      if (!profile || typeof profile !== 'object' || profile.id !== id)
        throw new Error('Malformed proxy settings.');
      if (!parseProxy(profile)) throw new Error('Incomplete proxy settings.');
    } catch (error) {
      throw new BundleError(
        error instanceof Error ? error.message : 'Invalid proxy settings.',
      );
    }
  }
  for (const record of Object.values(
    (head.namespaces['registrar-accounts'] ?? {}) as Record<
      string,
      { proxyId?: string; removed?: boolean } | null
    >,
  )) {
    if (record?.proxyId && !record.removed && !profiles[record.proxyId])
      throw new BundleError(
        'An account in this file uses a proxy the file does not contain.',
      );
  }
  // Older bundles kept a Namecheap account's proxy in its credentials — the
  // legacy default key plus any UUID-keyed accounts. Validate those too; they
  // are lifted into a profile after import.
  const accountRecords = (head.namespaces['registrar-accounts'] ??
    {}) as Record<string, { registrar?: unknown } | null>;
  const namecheapIds = new Set<string>(['namecheap']);
  for (const [id, record] of Object.entries(accountRecords))
    if (
      record &&
      typeof record === 'object' &&
      record.registrar === 'namecheap'
    )
      namecheapIds.add(id);
  const credentials = (head.namespaces[CREDENTIALS_NAMESPACE] ?? {}) as Record<
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
  sanitizeBundleDiagnostics(bundle.namespaces);
  const prevSettings = getSettings();
  const result = importNamespaces(bundle.namespaces);
  await migrateLegacyProxies();
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
