/**
 * Shared IPC contract used by both the main process and the renderer (via the
 * preload bridge). Keeping channel names and payload/return types in one place
 * gives us a single, type-checked source of truth for every IPC round trip.
 */

import type { ReleaseFeed } from './releases';
import type {
  Domain as ProviderDomain,
  ConnectionResult,
  DomainForward,
  EmailForward,
  RegistrarName,
} from '@aoxborrow/registrar-client';
import type { NumberFormatId } from './money';
import type { DomainEvent } from './domain-events';

export type { DomainEvent, DomainNote } from './domain-events';

/** Account identity is supplied by Dombot, never by a registrar response. */
export interface RegistrarAccount {
  id: string;
  registrar: RegistrarName;
  label: string;
  /** The proxy profile this account's API traffic goes through; absent = direct. */
  proxyId?: string;
  /**
   * ms epoch of the first successful sync: from then on, sync records what
   * arrives, leaves, or moves. Absent until then. Exported with the account,
   * so an imported history carries on where it left off.
   */
  trackedSince?: number;
}

/** Where a Domain row comes from (see `Domain.source`). */
export type DomainSource = 'registrar' | 'manual';

export type Domain = ProviderDomain & {
  accountId?: string;
  accountLabel?: string;
  /**
   * Set on a row DomBot kept after the name left the registrar (Sold, Dropped,
   * or Archive). It is not at the registrar, so registrar actions do not apply.
   */
  departed?: boolean;
  /**
   * Public registration lookup is still in flight. History shows a skeleton
   * for registrar, created, and expires until it lands.
   */
  registrationPending?: boolean;
  /** RDAP says nobody holds the name. Those three cells are a dash. */
  unregistered?: boolean;
  /**
   * Current registrar from RDAP, which may not be an account of yours. The
   * mapped name ("Name.com"), else what RDAP or IANA calls it.
   */
  registrationRegistrar?: string;
  /** RDAP's own name and IANA ID for that registrar, for a tooltip. */
  registrationRegistrarDetail?: string;
  /** The built-in registrar that registrar maps to, for its logo. */
  registrationRegistrarId?: RegistrarName;
  /**
   * Where the row comes from. `registrar`: an account's sync. A name in
   * Archive is one too: `departed` says no account reports it any more, and
   * its registrar is the last one it was seen at (empty when unknown).
   * `manual`: a name you added that no connected account reports
   * (`manual-domains`); registrar actions don't apply, and its registrar
   * fields are yours to edit.
   */
  source: DomainSource;
  /** A manual name's registrar as you typed it, when DomBot doesn't know it. */
  manualRegistrarLabel?: string;
  /** A manual name whose auto-renew you haven't set (`autoRenew` reads false). */
  autoRenewUnknown?: boolean;
};

/**
 * A name you own that no connected account reports, kept in
 * `manual-domains` (docs/domain-import-export.md). Dates are `YYYY-MM-DD`.
 */
export interface ManualDomain {
  /** A registrar DomBot knows (registrar-client's id), or null. */
  registrar: string | null;
  /** Free text when DomBot doesn't know the registrar, e.g. "Epik". */
  registrarLabel?: string | null;
  expirationDate?: string | null;
  createdDate?: string | null;
  autoRenew?: boolean | null;
  /** ms epoch, when it was added. */
  addedAt: number;
  /** ms epoch, the last edit; null until edited. */
  updatedAt: number | null;
  /** The import that added it, if one did. */
  importId?: string | null;
}

/** A manual name's registration fields, as edited. */
export interface ManualDomainFields {
  registrar: string | null;
  registrarLabel: string | null;
  createdDate: string | null;
  expirationDate: string | null;
  autoRenew: boolean | null;
}

/** The one proxy the app manages, and the saved accounts routed through it. */
export interface ProxySettings {
  proxy: { url: string; egressIp: string } | null;
  users: {
    accountId: string;
    registrar: RegistrarName;
    label: string;
    /** The registrar has other saved accounts, proxied or not. */
    hasSiblings: boolean;
  }[];
}

/** The address the internet saw for a request sent through the proxy. */
export interface ProxyTestResult {
  ip: string;
  expected: string;
  matches: boolean;
}

/** Channel identifiers for `ipcRenderer.invoke` / `ipcMain.handle`. */
export const IpcChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
  getReleaseFeed: 'app:getReleaseFeed',
  getUpdaterState: 'app:getUpdaterState',
  downloadUpdate: 'app:downloadUpdate',
  installUpdate: 'app:installUpdate',
  listPortfolio: 'registrar:listPortfolio',
  getDomainDetail: 'registrar:getDomainDetail',
  applyDomainOp: 'domain:apply',
  getUrlForwarding: 'domain:getUrlForwarding',
  getEmailForwarding: 'domain:getEmailForwarding',
  startBulk: 'bulk:start',
  cancelBulk: 'bulk:cancel',
  getBulkJob: 'bulk:get',
  stepBulk: 'bulk:step',
  getPortfolioPricing: 'pricing:getPortfolio',
  getManualPrices: 'pricing:getManualPrices',
  setManualPrice: 'pricing:setManualPrice',
  openExternal: 'app:openExternal',
  saveTextFile: 'app:saveTextFile',
  exportData: 'data:export',
  importData: 'data:import',
  getRegistrarMetadata: 'registrar:getMetadata',
  createRegistrarAccount: 'registrar:createAccount',
  connectRegistrarAccount: 'registrar:connectAccount',
  getRegistrarCatalog: 'registrar:getCatalog',
  renameRegistrarAccount: 'registrar:renameAccount',
  removeRegistrarAccount: 'registrar:removeAccount',
  testRegistrarAccount: 'registrar:testAccount',
  getRegistrarCredentials: 'registrar:getCredentials',
  saveRegistrarCredentials: 'registrar:saveCredentials',
  getProxySettings: 'proxy:get',
  saveProxySettings: 'proxy:save',
  removeProxySettings: 'proxy:remove',
  testProxySettings: 'proxy:test',
  setRegistrarEnabled: 'registrar:setEnabled',
  syncRegistrar: 'registrar:sync',
  getMcpInfo: 'mcp:getInfo',
  listPendingApprovals: 'mcp:listPendingApprovals',
  resolveApproval: 'mcp:resolveApproval',
  listMcpClients: 'mcp:listClients',
  revokeMcpClient: 'mcp:revokeClient',
  hydrateFromCache: 'cache:hydrate',
  clearAllCaches: 'cache:clearAll',
  getFolders: 'folders:list',
  createFolder: 'folders:create',
  updateFolder: 'folders:update',
  deleteFolder: 'folders:delete',
  assignFolder: 'folders:assign',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getPurchases: 'purchases:list',
  setPurchase: 'purchases:set',
  setSale: 'purchases:setSale',
  setNotes: 'purchases:setNotes',
  previewDomainImport: 'domainImport:preview',
  importDomains: 'domainImport:apply',
  getManualDomains: 'manualDomains:list',
  updateManualDomain: 'manualDomains:update',
  getListPrices: 'listPrices:list',
  setListPrices: 'listPrices:set',
  getDomainEvents: 'domainEvents:list',
  setDispositions: 'domainEvents:setDispositions',
  markSold: 'domainEvents:markSold',
  restoreOwned: 'domainEvents:restoreOwned',
  setAlertsDismissed: 'domainEvents:setAlertsDismissed',
  deleteUserEvent: 'domainEvents:deleteUserEvent',
  deleteDomains: 'domainEvents:deleteDomains',
  getRegistrationQuote: 'pricing:registrationQuote',
  lookupRegistrations: 'registration:lookup',
  getRevisions: 'events:getRevisions',
} as const;

/** Events (main → renderer). */
export const IpcEvents = {
  /** Fired when the pending-approval set changes. */
  approvalsChanged: 'mcp:approvalsChanged',
  /**
   * Fired when an out-of-band write (an MCP tool) mutates the on-disk portfolio
   * or detail cache, so an open Domains table can re-read the cache and reflect
   * the change live — without a manual Sync. UI-initiated writes update the
   * store directly and don't rely on this.
   */
  portfolioChanged: 'portfolio:changed',
  /** The app menu's Sync Now was chosen (desktop only). */
  syncRequested: 'sync:requested',
  /** An app menu item wants a route shown, e.g. Settings → About (payload:
   *  the hash route; desktop only). */
  navigateRequested: 'app:navigateRequested',
  /** One bulk-job item finished (payload: BulkProgress). */
  bulkProgress: 'bulk:progress',
  /** A bulk job ended — done or cancelled (payload: the final BulkJob). */
  bulkFinished: 'bulk:finished',
} as const;

/**
 * Cached data at or beyond this age is considered stale. Shared by the main
 * cache layer (as its default TTL for per-domain detail) and the renderer (to
 * highlight a stale "last synced" timestamp). Set to match the default
 * background-sync interval (24h — see services/auto-sync.ts), so a user on the
 * default cadence effectively never sees the stale state; only disabling
 * auto-sync or choosing a longer interval surfaces it.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  /** `process.platform` on desktop ('darwin', 'win32', 'linux', …); 'web'
   *  for a self-hosted browser instance. */
  platform: string;
}

/** The desktop app's update-on-click progress (Settings → About). */
export interface UpdaterState {
  /** Whether this copy can update itself; if not, About shows a plain
   *  download link instead. */
  supported: boolean;
  /** Why not, when that's worth telling the user (null for a dev build). */
  unsupportedReason: string | null;
  status: 'idle' | 'downloading' | 'ready' | 'error';
  /** The last download's failure, when `status` is 'error'. */
  error: string | null;
}

/** Status of the embedded local MCP server. */
export interface McpInfo {
  running: boolean;
  /** Endpoint an MCP client connects to, e.g. http://127.0.0.1:4123/mcp */
  url: string;
  /**
   * Command + args a stdio-only client (Claude Desktop) runs to reach the same
   * server: the app executable with `--mcp-stdio`. In dev builds the command is
   * the Electron binary and the app path is passed as an extra arg.
   */
  stdioCommand: string;
  stdioArgs: string[];
}

/**
 * Change counters for out-of-band updates, one per kind. A client that polls
 * (the web host) remembers the last counters it saw and refetches whatever
 * moved; the desktop host pushes the same changes as IpcEvents instead.
 */
export interface Revisions {
  /** Portfolio/detail cache changed out of band (an MCP tool write). */
  portfolio: number;
  /** A bulk job made progress or finished. */
  bulk: number;
  /** The MCP pending-approval set changed. */
  approvals: number;
}

/** Credential values keyed by config-field name. */
export type CredentialValues = Record<string, string>;

/**
 * User-adjustable app settings, persisted under `userData/settings.json`.
 * Distinct from the caches and credentials; kept across "Clear cache".
 */
export interface AppSettings {
  /**
   * Background portfolio-sync interval in minutes; `0` disables auto-sync.
   * Applied live when changed. See services/auto-sync.ts. `DOMBOT_SYNC_INTERVAL_MINUTES`,
   * when set, overrides this (a dev/testing escape hatch).
   */
  autoSyncIntervalMinutes: number;
  /**
   * The last few nameserver sets the user saved from the editor (most recent
   * first, at most 3), offered as presets. Each entry is a full set.
   */
  recentNameservers: string[][];
  /**
   * Whether the embedded MCP server runs. Off by default on a fresh install
   * (an upgrade with already-paired clients keeps it on); toggled live in
   * Settings → MCP. `DOMBOT_MCP_ENABLED=0` forces it off regardless.
   */
  mcpEnabled: boolean;
  /**
   * Default currency for a new purchase amount. Does not rewrite amounts
   * already saved. Fresh install is USD.
   */
  preferredCurrency: string;
  /**
   * How amounts are grouped on screen (thousands separator and decimal mark).
   * Separate from which currency the money is in. Fresh install is US style.
   */
  numberFormat: NumberFormatId;
  /**
   * Whether DomBot checks dombot.ai for a newer release (once a week) and
   * shows a banner when there is one. On by default; "Check now" in
   * Settings → About works either way.
   */
  updateChecks: boolean;
}

/** The registrar's registration fee for one name. `amount` is null when unknown. */
export interface RegistrationQuote {
  amount: string | null;
  currency: string;
}

/**
 * Public registration record for a name you no longer hold. Refreshed from
 * RDAP so created and expires stay current. `registered: false` means the
 * name is free.
 */
export interface RegistrationLookup {
  registered: boolean;
  /** The registrar's name as RDAP reports it, e.g. "Name.com, Inc.". */
  registrar: string | null;
  /** IANA Registrar ID from RDAP `publicIds`. Absent on rows cached before it was read. */
  registrarIanaId?: number | null;
  /** The reseller RDAP names, when the registrar sold it through one. */
  reseller?: string | null;
  /**
   * The registrar to show, mapped from the ID or name (data/registrar-mapping.json),
   * e.g. "Name.com". Added to each row as it's returned, never stored.
   */
  registrarLabel?: string | null;
  /** The built-in registrar it maps to, if any. Added like `registrarLabel`. */
  mappedRegistrar?: RegistrarName | null;
  /** ISO timestamp, or null. */
  created: string | null;
  expires: string | null;
  checkedAt: string;
}

/**
 * Money and notes for one domain name. Purchase fields are what you paid.
 * Sale fields are what you got when you marked it Sold. Notes are one box
 * for the name, shared by both. Amounts are plain decimals, or null.
 * A sale is stored here even though no column lists it yet.
 */
export interface DomainPurchase {
  purchaseDate: string | null;
  amount: string | null;
  currency: string | null;
  /** Hand-registered or bought; absent when there's no purchase on record. */
  purchaseType?: 'registered' | 'purchased';
  /** The purchase's term in years, when recorded. */
  purchaseYears?: number;
  /** The purchase's event id: one newer than an arrival was recorded after it. */
  acquisitionId?: string;
  notes: string;
  /** Absent on records saved before a sale could be stored. */
  saleDate?: string | null;
  saleAmount?: string | null;
  saleCurrency?: string | null;
}

/** One purchase record to save or import. `domainName` is not stored on the record. */
export interface PurchaseInput {
  domainName: string;
  /** Hand-registered vs. bought; omitted keeps what's stored (default purchased). */
  kind?: 'registered' | 'purchased';
  /**
   * The sync `added` alert this answers. Records a new purchase (a new
   * holding) instead of editing the latest one, and closes the alert.
   */
  resolves?: string;
  purchaseDate: string | null;
  amount: string | null;
  currency: string | null;
  notes: string;
}

/** Sale date, sale amount, and the shared notes field. Does not change what you paid. */
/** A name to act on, and the sync alert the action answers, if any. */
export interface OwnershipItem {
  domainName: string;
  resolves?: string;
}

export interface SaleInput {
  domainName: string;
  saleDate: string | null;
  amount: string | null;
  currency: string | null;
  notes: string;
  /** The sync `removed` alert this answers; closes it. */
  resolves?: string;
  /** Mark as Sold: record the sale even with no date or amount (dated today). */
  mark?: boolean;
}

/**
 * Your asking price for a name, synced or manual (docs/domain-import-export.md).
 * Amounts are canonical decimals, all in `currency`. At least one is set.
 */
export interface ListPrice {
  /** What you'd sell it for; null when only offers are set. */
  amount: string | null;
  /** The lowest offer you'll consider. */
  minOffer?: string | null;
  /** The lowest price you'd accept; never shown to buyers. */
  floor?: string | null;
  currency: string;
  /** ms epoch, the last change. */
  updatedAt: number;
}

/**
 * Your yearly renewal price for a name, in any currency. Stored in
 * `domain-prices`; the amount is a canonical decimal.
 */
export interface RenewalPriceInput {
  amount: string;
  currency: string;
}

/**
 * One name's row from an imported file, normalized
 * (docs/domain-import-export.md, "Normalized rows"). Every value is already
 * in stored form; an absent field was blank in the file and means "keep".
 */
export interface ImportRow {
  /** The file line the row came from (the first, when rows were merged). */
  line: number;
  /** `toAscii(name)`. */
  domain: string;
  status?: 'owned' | 'sold' | 'dropped' | 'archived' | 'removed';
  /** A folder name; "Hidden" is the built-in one. */
  folder?: string;
  notes?: string;
  registration?: {
    /** A registrar id DomBot knows. */
    registrar?: string;
    /** Free text, for a registrar DomBot doesn't know. */
    registrarLabel?: string;
    createdDate?: string;
    expirationDate?: string;
    autoRenew?: boolean;
  };
  renewal?: { amount: string; currency: string };
  listPrice?: {
    amount?: string;
    minOffer?: string;
    floor?: string;
    currency: string;
  };
  purchase?: {
    type?: 'registered' | 'purchased';
    date?: string;
    amount?: string;
    currency?: string;
    years?: number;
  };
  sale?: { date?: string; amount?: string; currency?: string };
}

export interface ImportChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** What an import does, or would do, to one name. */
export interface ImportOutcome {
  line: number;
  domain: string;
  /**
   * `new`: added as a manual name. `update`: something changes.
   * `unchanged`: nothing to do. `history`: a name that's only in Archive.
   */
  result: 'new' | 'update' | 'unchanged' | 'history';
  changes: ImportChange[];
  warnings: string[];
}

export interface ImportPlan {
  outcomes: ImportOutcome[];
  counts: Record<ImportOutcome['result'], number>;
  /** Folders the import creates. */
  newFolders: string[];
}

/** One name's asking price to save. All three amounts blank clears it. */
export interface ListPriceInput {
  domainName: string;
  amount: string | null;
  minOffer: string | null;
  floor: string | null;
  currency: string | null;
}

/** One input in a registrar's credential form. */
export interface RegistrarConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select';
  required: boolean;
  options?: string[];
}

/**
 * Per-registrar sync state. A registrar is "connected" when it's configured and
 * its last domain sync succeeded — i.e. `lastSyncedAt` is set and `lastError` is
 * null. This drives the three-state light on the settings card (not set /
 * configured-but-not-connected / connected) and the status-bar pill.
 */
export interface RegistrarSync {
  /** Last SUCCESSFUL domain sync (ms epoch), or null if it never succeeded. */
  lastSyncedAt: number | null;
  /** Error from the most recent sync attempt, or null when it succeeded. */
  lastError: string | null;
  /** When that error happened (ms epoch); null when there's none, or it
   *  predates this being recorded. */
  lastErrorAt: number | null;
  /** Domains held from the last successful sync. */
  domainCount: number;
  /** When sync started recording this account's changes (ms epoch), or null. */
  trackedSince: number | null;
}

/** Metadata that drives the Settings > Registrars form. Help copy is not
 *  carried here — the renderer reads it from `registrar-help.ts`. */
export type RegistrarDefinition = Pick<
  RegistrarMeta,
  'name' | 'displayName' | 'supportsSandbox' | 'configFields' | 'features'
>;

export interface RegistrarMeta {
  /** An actual saved account, rather than an implicit migration placeholder. */
  saved?: boolean;
  accountId?: string;
  accountLabel?: string;
  /** Whether this account's API traffic goes through the fixed IP proxy. */
  proxy?: boolean;
  name: RegistrarName;
  displayName: string;
  supportsSandbox: boolean;
  configured: boolean;
  /** Whether the registrar is enabled (default). Disabled = credentials and cached data kept but
   *  excluded from syncs and portfolio; only meaningful when `configured`. */
  enabled: boolean;
  /** Sync state (from cache), present regardless of whether it's configured. */
  sync: RegistrarSync;
  configFields: RegistrarConfigField[];
  /**
   * The library's capability list for this provider (registrar-client `Feature`
   * ids, e.g. "getAuthCode", "setEmailForwarding"). Drives which domain edits
   * the UI offers — see shared/domain-ops.ts.
   */
  features: string[];
}

/** Outcome of a native "save file" dialog. */
export interface SaveResult {
  /** False when the user dismissed the dialog. */
  saved: boolean;
  /** Absolute path written, when `saved`. */
  path?: string;
}

/** A connection awaiting the user's approval in the app window. */
export interface McpPendingApproval {
  id: string;
  /** Self-reported at registration; anyone can register a client. */
  clientName: string;
  /** Where the authorization code will be sent — the part to actually check. */
  redirectUri: string;
  code: string;
  createdAt: number;
}

/** A client that has been paired with the MCP server. */
export interface McpClient {
  clientId: string;
  clientName: string;
  pairedAt: number;
}

/**
 * Where a domain's renewal price came from:
 *  - `api`         a direct, name-accurate quote from the registrar (captures
 *                  premium renewals). Only registrars that price a *specific*
 *                  owned domain qualify.
 *  - `tld`         the account's own annual rate for this TLD, captured on Sync
 *                  — it reflects whatever discount that account holds (e.g. a
 *                  GoDaddy Discount Domain Club membership).
 *  - `base`        the standard TLD rate from the base pricing database — the
 *                  fill for every domain we can't quote per-name. May understate
 *                  premium names.
 *  - `manual`      a price the user entered by hand for one domain.
 *  - `unavailable` no price: nothing in the API, a TLD rate, the base database,
 *                  or a manual override covers this domain yet.
 */
export type PriceSource = 'api' | 'tld' | 'base' | 'manual' | 'unavailable';

/** A domain's annual renewal price (USD), with provenance. */
export interface RenewalPricing {
  accountId?: string;
  domain: string;
  registrar: string;
  /** Annual renewal price in `currency`, or null when unknown. */
  renewal: number | null;
  currency: string;
  source: PriceSource;
}

// ── Domain operations ───────────────────────────────────────────────────────
//
// A domain-scoped write (or secret read) is one `DomainOp`, applied to one
// `DomainTarget`. The same unit backs a row control in the table, a bulk job,
// and the MCP `domain_*` tools, so every caller shares one code path in main
// (services/domain-ops.ts): capability gating, cache patching, error
// classification. See docs/domain-editing.md.

/** `masked` is read-only in the library; the UI can only write these two. */
export interface UrlForwardInput {
  /** Source host relative to the apex: "@", "www", or a subdomain label. */
  host: string;
  /** Destination URL. */
  url: string;
  type: 'temporary' | 'permanent';
}

export type DomainOp =
  | { kind: 'autoRenew'; enabled: boolean }
  | { kind: 'privacy'; enabled: boolean }
  | { kind: 'lock'; locked: boolean }
  | { kind: 'nameservers'; nameservers: string[] }
  | {
      kind: 'urlForwarding';
      forwards: UrlForwardInput[];
      /** Read the current rules first and skip the domain if it has any
       *  (the set is a full replace). */
      skipIfExisting?: boolean;
    }
  | {
      kind: 'emailForwarding';
      forwards: EmailForward[];
      skipIfExisting?: boolean;
    }
  | { kind: 'authCode' }
  | { kind: 'renew'; years: number };

export type DomainOpKind = DomainOp['kind'];

export interface DomainTarget {
  accountId?: string;
  registrar: RegistrarName;
  domainName: string;
}

export type DomainOpStatus =
  /** Applied; `patch` carries the new field values where there are any. */
  | 'ok'
  /** The registrar rejected it — `message` says why. */
  | 'failed'
  /** The registrar can't do this op (gated up front, or NotImplementedError). */
  | 'unsupported'
  /** Nothing to do — already in the target state, or had existing rules. */
  | 'skipped'
  /** Still rate-limited after the client's own retries. */
  | 'rate-limited'
  /** Aborted via the caller's signal. */
  | 'cancelled'
  /**
   * The request may have reached the registrar (it timed out, the connection
   * dropped, or the registrar answered 5xx) and re-reading the domain couldn't
   * settle whether it was applied. Never re-sent automatically: `message` says
   * to check the domain first.
   */
  | 'unknown';

export interface DomainOpResult {
  target: DomainTarget;
  status: DomainOpStatus;
  message: string;
  /** Fields the caller can overlay on the row: autoRenew/privacy/locked/
   *  nameservers, or expirationDate/renewalDate/status after a renew. */
  patch?: Partial<Domain>;
  /** Op-specific payload — the auth code. Never persisted by main. */
  data?: { authCode?: string };
}

/**
 * A bulk job: one `DomainOp` applied to many targets by the runner
 * (core/services/bulk-jobs.ts). Persisted, one at a time; survives a restart.
 * The renderer mirrors it from `startBulk`'s return plus the progress events.
 */
export interface BulkJob {
  id: string;
  op: DomainOp;
  status: 'running' | 'done' | 'cancelled';
  total: number;
  /** Results so far, in completion order. */
  results: DomainOpResult[];
  counts: Record<DomainOpStatus, number>;
  startedAt: number;
  finishedAt: number | null;
}

/** What one `stepBulk` call did: the job after the slice, and the earliest
 *  time another slice can do work (null once the job has finished). */
export interface BulkStep {
  job: BulkJob;
  nextAt: number | null;
}

/** Streamed to windows as each bulk item completes. */
export interface BulkProgress {
  jobId: string;
  result: DomainOpResult;
  done: number;
  total: number;
}

/** Re-exported so the renderer can type data without importing the lib. */
export type { DomainForward, EmailForward, RegistrarName };

/** A per-registrar failure from a portfolio fetch, flattened for IPC transport. */
export interface PortfolioErrorInfo {
  accountId?: string;
  accountLabel?: string;
  /** The registrar id that failed, e.g. "godaddy". */
  registrar: string;
  /** The error message (Error objects don't survive structured clone as-is). */
  message: string;
}

/**
 * Aggregated portfolio across every configured registrar. Mirrors the library's
 * `PortfolioResult`, but flattens `errors` to plain messages for IPC.
 */
export interface Portfolio {
  domains: Domain[];
  errors: PortfolioErrorInfo[];
  /** Registrar ids that had credentials configured and were queried. */
  registrars: string[];
  /** Map of registrar id → nicely capitalized display name, e.g. dynadot → "Dynadot". */
  registrarLabels: Record<string, string>;
  /** When this portfolio was fetched from the registrars (ms epoch). Null for
   * a live result that predates caching; set for cached and freshly-fetched. */
  fetchedAt: number | null;
}

/**
 * Everything the renderer can restore from the on-disk cache on launch, so the
 * UI paints a full portfolio (domains, per-domain detail, pricing) with no
 * network calls. `portfolio.fetchedAt` is the headline "last refreshed"
 * timestamp shown to the user.
 */
export interface CachedSnapshot {
  /** Cached portfolio, or null when nothing has ever been fetched. */
  portfolio: Portfolio | null;
  /** Per-domain detail (nameservers/privacy/lock/created), keyed `accountId:domain`. */
  detail: Record<string, Partial<Domain>>;
  /** Renewal pricing keyed `accountId:domain`, computed from cache (no network). */
  pricing: Record<string, RenewalPricing>;
}

// ── Folders ─────────────────────────────────────────────────────────────────

/**
 * Palette key for a folder's color. The renderer maps this to theme-aware
 * Tailwind classes (see renderer/lib/folders.ts); main only ever stores and
 * returns the key, so it stays presentation-agnostic.
 */
export type FolderColor =
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink';

/** Every palette key, in display order — the source of truth for the picker. */
export const FOLDER_COLORS: FolderColor[] = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
];

/**
 * The built-in Hidden folder: names you still own but don't want in the usual
 * list (personal names, expiring ones you're letting go). Not stored in the
 * folders list and has no color, but a valid assignment target; like any
 * folder, a name is in it or in one other folder, never both. Hidden names
 * stay out of Owned until the folder filter selects Hidden.
 *
 * Before the domain history work the same idea was the Archive folder
 * (`'__archive__'`, and before that `'__hidden__'`); migration 2 moves those
 * assignments here. Archive is now an ownership action, not a folder.
 */
export const HIDDEN_FOLDER_ID = '__hidden__';

/** "Hidden" for the built-in folder; null for a user folder or no folder. */
export function builtInFolderName(
  id: string | null | undefined,
): string | null {
  return id === HIDDEN_FOLDER_ID ? 'Hidden' : null;
}

/** True for the built-in Hidden folder. */
export function isHiddenFolder(id: string | null | undefined): boolean {
  return id === HIDDEN_FOLDER_ID;
}

/**
 * Future per-folder configuration that cascades to the folder's domains. Kept
 * as an optional bag so new keys are purely additive; empty/absent today. The
 * motivating case is `forSale` — not yet acted on anywhere.
 */
export interface FolderSettings {
  /** Marks the folder's domains as listed for sale. Groundwork only. */
  forSale?: boolean;
  // future: autoRenew?: boolean; nameserverProfile?: string; ...
}

/** A user-defined folder for organizing domains (name, description, color). */
export interface Folder {
  /** Stable id (crypto.randomUUID() in main). */
  id: string;
  name: string;
  /** Short, may be empty. */
  description: string;
  color: FolderColor;
  /** Per-folder config; absent until a feature uses it. */
  settings?: FolderSettings;
}

/** Fields a caller supplies when creating a folder (id is assigned in main). */
export interface FolderInput {
  name: string;
  description: string;
  color: FolderColor;
}

/** A patch to an existing folder — any subset of its editable fields. */
export type FolderPatch = Partial<
  Pick<Folder, 'name' | 'description' | 'color' | 'settings'>
>;

/**
 * Everything the renderer restores on launch: the folder definitions plus the
 * domain→folder map, keyed `toAscii(domainName)` so a domain keeps its folder
 * across accounts. Mirrors the shape of CachedSnapshot. A domain absent from
 * `assignments` is unassigned.
 */
export interface FoldersSnapshot {
  folders: Folder[];
  /** toAscii(domainName) → folderId. */
  assignments: Record<string, string>;
}

/**
 * The API surface exposed on `window.api` by the preload script. Add new
 * methods here and they become type-checked on both sides of the bridge.
 */
export interface DombotApi {
  ping: () => Promise<string>;
  getAppInfo: () => Promise<AppInfo>;
  /**
   * Published releases with their notes, from dombot.ai. Cached for a few
   * hours on the host; `force` refetches (Settings → About → Check now).
   */
  getReleaseFeed: (force: boolean) => Promise<ReleaseFeed>;
  /** Desktop update-on-click: whether this copy can update itself, and how
   *  far along a download is. Self-hosted and the demo can't. */
  getUpdaterState: () => Promise<UpdaterState>;
  /** Download the newest release; resolves when it's ready (or failed). */
  downloadUpdate: () => Promise<UpdaterState>;
  /** Quit and relaunch into the downloaded release. */
  installUpdate: () => Promise<void>;
  /** Open a URL in the user's default browser. */
  openExternal: (url: string) => Promise<void>;
  /**
   * Prompt for a save location and write `content` there as a UTF-8 text file
   * (a .csv gets a BOM so Excel reads it). `suggestedName` seeds the dialog's
   * filename. Resolves with the chosen path, or `{ saved: false }` if the user
   * cancels. In the browser it's a download and always "saves".
   */
  saveTextFile: (content: string, suggestedName: string) => Promise<SaveResult>;
  /**
   * Everything the store holds as one JSON document (see
   * src/core/storage/bundle.ts), in the clear. The caller seals it if the
   * user wants a passphrase (src/shared/bundle-seal.ts).
   */
  exportData: () => Promise<string>;
  /** Replaces the store with an exported (plain) bundle. Returns what was
   *  written. A sealed file must be opened first. */
  importData: (
    text: string,
  ) => Promise<{ namespaces: number; entries: number }>;

  /** Restore the full cached portfolio + detail + pricing from disk with no
   * network calls, for instant paint on launch. */
  hydrateFromCache: () => Promise<CachedSnapshot>;
  /** Drop every on-disk data cache (portfolio, detail, pricing). */
  clearAllCaches: () => Promise<void>;

  /** Renewal prices for the whole cached portfolio, keyed `accountId:domain`.
   *  Computed locally (base rates + TLD rates + Sync-captured quotes +
   *  manual overrides). */
  getPortfolioPricing: () => Promise<Record<string, RenewalPricing>>;
  /** Every manual renewal price, keyed by the normalized domain name, for
   *  names you own or not (the CSV export reads Archive names' prices here). */
  getManualPrices: () => Promise<Record<string, RenewalPriceInput>>;
  /** Set (or clear, with null) a manual annual renewal price for a domain, in
   *  any currency. Keyed by name, so it applies whichever account holds it. */
  setManualPrice: (
    domain: string,
    price: RenewalPriceInput | null,
  ) => Promise<void>;

  // Registrars
  /**
   * Aggregate portfolio across every configured registrar. With `refresh` false,
   * the cached portfolio is returned (no network); otherwise it re-syncs every
   * registrar and updates the cache. Defaults to refresh (a full "Sync domains").
   */
  listPortfolio: (refresh?: boolean) => Promise<Portfolio>;
  /**
   * Sync a single registrar's domains, merge the result into the cached
   * portfolio, and return the updated aggregate. Used right after saving that
   * registrar's credentials so its domains appear without a full re-sync.
   */
  syncRegistrar: (
    name: RegistrarName,
    accountId?: string,
  ) => Promise<Portfolio>;
  /**
   * Best-available per-domain detail (nameservers/privacy/lock) to merge over
   * the list summary — a partial, or `null` when nothing could be resolved.
   * With `refresh` false, a fresh-enough cached partial is served without a
   * network call; otherwise it re-fetches and updates the cache.
   */
  getDomainDetail: (
    registrar: RegistrarName,
    domainName: string,
    refresh?: boolean,
    accountId?: string,
  ) => Promise<Partial<Domain> | null>;
  /**
   * Apply one domain operation (toggle a flag, replace nameservers/forwarding,
   * renew, or fetch the auth code) at the domain's registrar. Never rejects for
   * a registrar-side outcome — the result's `status` says what happened; only a
   * transport failure rejects.
   */
  applyDomainOp: (
    target: DomainTarget,
    op: DomainOp,
  ) => Promise<DomainOpResult>;
  /** A domain's current URL forwarding rules, read live (not cached). Rejects
   *  when the registrar can't report them. */
  getUrlForwarding: (target: DomainTarget) => Promise<DomainForward[]>;
  /** A domain's current email forwarding rules, read live (not cached). */
  getEmailForwarding: (target: DomainTarget) => Promise<EmailForward[]>;

  // Bulk jobs
  /** Start applying `op` to every target. Rejects if a job is already running.
   *  Returns the job's initial snapshot; progress arrives via onBulkProgress. */
  startBulk: (targets: DomainTarget[], op: DomainOp) => Promise<BulkJob>;
  /** Abort the running job; queued items are recorded as cancelled. */
  cancelBulk: (jobId: string) => Promise<void>;
  /** The current or last job, for re-attaching after navigation / relaunch. */
  getBulkJob: () => Promise<BulkJob | null>;
  /**
   * Advance the running job one slice (a host that can't hold a loop — the
   * web — has the renderer call this until `nextAt` is null). On desktop the
   * main process drives the job itself; calling this is harmless there.
   */
  stepBulk: (jobId: string) => Promise<BulkStep>;
  onBulkProgress: (callback: (p: BulkProgress) => void) => () => void;
  onBulkFinished: (callback: (job: BulkJob) => void) => () => void;
  getRegistrarCatalog: () => Promise<RegistrarDefinition[]>;
  connectRegistrarAccount: (
    name: RegistrarName,
    creds: CredentialValues,
    label?: string,
    /** Route the new account through the fixed IP proxy (and test it that way). */
    useProxy?: boolean,
  ) => Promise<RegistrarAccount>;
  createRegistrarAccount: (
    name: RegistrarName,
    label: string,
  ) => Promise<RegistrarAccount>;
  renameRegistrarAccount: (accountId: string, label: string) => Promise<void>;
  removeRegistrarAccount: (accountId: string) => Promise<void>;
  testRegistrarAccount: (
    name: RegistrarName,
    accountId?: string,
  ) => Promise<ConnectionResult>;
  getRegistrarMetadata: () => Promise<RegistrarMeta[]>;
  getRegistrarCredentials: (
    name: RegistrarName,
    accountId?: string,
  ) => Promise<CredentialValues>;
  saveRegistrarCredentials: (
    name: RegistrarName,
    creds: CredentialValues,
    accountId?: string,
    /** Turn the fixed IP proxy on or off for this account; omitted = unchanged. */
    useProxy?: boolean,
  ) => Promise<void>;
  getProxySettings: () => Promise<ProxySettings>;
  saveProxySettings: (proxy: {
    url: string;
    egressIp: string;
  }) => Promise<void>;
  /** Rejects while any account still has the proxy switched on. */
  removeProxySettings: () => Promise<void>;
  /** One request through the given proxy (saved or not), reporting the address seen. */
  testProxySettings: (proxy: {
    url: string;
    egressIp: string;
  }) => Promise<ProxyTestResult>;
  /** Enable/disable a registrar (keeps credentials). Disabling keeps its cached
   *  data and stops syncs; enabling re-syncs it. Returns the updated portfolio. */
  setRegistrarEnabled: (
    name: RegistrarName,
    enabled: boolean,
    accountId?: string,
  ) => Promise<Portfolio>;

  // MCP server
  getMcpInfo: () => Promise<McpInfo>;
  listPendingApprovals: () => Promise<McpPendingApproval[]>;
  resolveApproval: (id: string, approve: boolean) => Promise<void>;
  listMcpClients: () => Promise<McpClient[]>;
  revokeMcpClient: (clientId: string) => Promise<void>;
  /** Subscribe to pending-approval changes. Returns an unsubscribe function. */
  onApprovalsChanged: (callback: () => void) => () => void;
  /** Subscribe to out-of-band portfolio/detail cache changes (from MCP writes).
   * Returns an unsubscribe function. */
  onPortfolioChanged: (callback: () => void) => () => void;
  /** Subscribe to the app menu's Sync Now (desktop only; a no-op elsewhere).
   * Returns an unsubscribe function. */
  onSyncRequested: (callback: () => void) => () => void;
  /** Subscribe to the app menu asking for a route (About DomBot, Check for
   *  Updates…, Settings…; desktop only, a no-op elsewhere). Returns an
   *  unsubscribe function. */
  onNavigateRequested: (callback: (route: string) => void) => () => void;

  // Folders
  /** The folder definitions plus the domain→folder map, read from disk. */
  getFolders: () => Promise<FoldersSnapshot>;
  /** Create a folder and return it (with its freshly-assigned id). */
  createFolder: (input: FolderInput) => Promise<Folder>;
  /** Patch a folder's editable fields. */
  updateFolder: (id: string, patch: FolderPatch) => Promise<void>;
  /** Delete a folder and drop every assignment pointing at it. */
  deleteFolder: (id: string) => Promise<void>;
  /** Assign a domain to a folder, or unassign it with a null folderId. */
  assignFolder: (domainName: string, folderId: string | null) => Promise<void>;

  // Settings
  /** Read the user-adjustable app settings. */
  getSettings: () => Promise<AppSettings>;
  /** Patch app settings; applied live (e.g. reschedules the background sync).
   * Returns the updated settings. */
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;

  // Purchase records (keyed by domain name; not cleared by Sync or Clear cache)
  /** Every saved purchase record, keyed by the normalized domain name. */
  getPurchases: () => Promise<Record<string, DomainPurchase>>;
  /** Save one name's purchase fields. Null deletes the record (all fields empty). Keeps any sale already stored. */
  setPurchase: (input: PurchaseInput) => Promise<DomainPurchase | null>;
  /** Save what a sold name went for, and the shared notes. Keeps what you paid. */
  setSale: (input: SaleInput) => Promise<DomainPurchase | null>;
  /** Save a name's note alone; its purchase and sale stay. Blank deletes it. */
  setNotes: (
    domainName: string,
    notes: string,
  ) => Promise<DomainPurchase | null>;

  // Domain import (docs/domain-import-export.md)
  /** What importing these normalized rows would change. Writes nothing. */
  previewDomainImport: (rows: ImportRow[]) => Promise<ImportPlan>;
  /** Import the rows (a chunk of up to 10,000, under one `importId`). */
  importDomains: (
    rows: ImportRow[],
    options: { importId: string },
  ) => Promise<ImportPlan & { importId: string }>;

  // Manual domains (names no connected account reports)
  /** Every manual name, keyed by the normalized domain name. */
  getManualDomains: () => Promise<Record<string, ManualDomain>>;
  /** Edit a manual name's registration fields. Returns every manual name. */
  updateManualDomain: (
    domainName: string,
    fields: ManualDomainFields,
  ) => Promise<Record<string, ManualDomain>>;

  // Asking prices (keyed by domain name; any name, synced or manual)
  /** Every asking price, keyed by the normalized domain name. */
  getListPrices: () => Promise<Record<string, ListPrice>>;
  /**
   * Set or clear (all amounts blank) asking prices in one write. Returns every
   * asking price afterwards.
   */
  setListPrices: (
    inputs: ListPriceInput[],
  ) => Promise<Record<string, ListPrice>>;

  // Domain history (docs/storage-model.md). Each change returns the whole log.
  /** Every domain event, oldest first. */
  getDomainEvents: () => Promise<DomainEvent[]>;
  /**
   * Mark names Dropped or Archived on `date` (blank: today). Each `resolves`
   * closes the alert it answers.
   */
  setDispositions: (
    items: OwnershipItem[],
    type: 'dropped' | 'archived',
    date?: string | null,
  ) => Promise<DomainEvent[]>;
  /** Mark names Sold with no price, dated `date` (blank: today). */
  markSold: (
    items: OwnershipItem[],
    date?: string | null,
  ) => Promise<DomainEvent[]>;
  /**
   * "Move back to Owned": undo each name's Sold, Dropped, or Archived event.
   * Names only removed by their registrar are skipped.
   */
  restoreOwned: (domainNames: string[]) => Promise<DomainEvent[]>;
  /** Acknowledge sync alerts with no action, or bring them back. */
  setAlertsDismissed: (
    ids: string[],
    dismissed: boolean,
  ) => Promise<DomainEvent[]>;
  /** Undo one of your own events. Sync events can't be deleted. */
  deleteUserEvent: (id: string) => Promise<DomainEvent[]>;
  /** Delete everything DomBot holds about each name. */
  deleteDomains: (domainNames: string[]) => Promise<DomainEvent[]>;
  /** This registrar's registration fee for a name that just arrived. */
  getRegistrationQuote: (
    registrar: RegistrarName,
    domainName: string,
    accountId?: string,
  ) => Promise<RegistrationQuote>;
  /**
   * Current public registration for names on History. Cached for a day.
   * A name missing from the result could not be looked up.
   */
  lookupRegistrations: (
    domainNames: string[],
  ) => Promise<Record<string, RegistrationLookup>>;

  // Events (polling)
  /** Current change counters — see `Revisions`. */
  getRevisions: () => Promise<Revisions>;
}
