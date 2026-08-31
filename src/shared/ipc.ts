/**
 * Shared IPC contract used by both the main process and the renderer (via the
 * preload bridge). Keeping channel names and payload/return types in one place
 * gives us a single, type-checked source of truth for every IPC round trip.
 */

// Type-only import: erased at build time, so the renderer bundle never resolves
// the library — only tsc uses it (via the tsconfig `paths` alias to source).
import type { Domain, RegistrarName } from '@aoxborrow/registrar-client';

/** Channel identifiers for `ipcRenderer.invoke` / `ipcMain.handle`. */
export const IpcChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
  listDynadotDomains: 'registrar:listDynadotDomains',
  listPortfolio: 'registrar:listPortfolio',
  getDomainDetail: 'registrar:getDomainDetail',
  getAftermarket: 'market:getAftermarket',
  getRenewalPrice: 'pricing:getRenewalPrice',
  setManualPrice: 'pricing:setManualPrice',
  clearPricingCache: 'pricing:clearCache',
  openExternal: 'app:openExternal',
  saveCsv: 'app:saveCsv',
  getRegistrarMetadata: 'registrar:getMetadata',
  getRegistrarCredentials: 'registrar:getCredentials',
  saveRegistrarCredentials: 'registrar:saveCredentials',
  testRegistrar: 'registrar:test',
  getMcpInfo: 'mcp:getInfo',
  listPendingApprovals: 'mcp:listPendingApprovals',
  resolveApproval: 'mcp:resolveApproval',
  listMcpClients: 'mcp:listClients',
  revokeMcpClient: 'mcp:revokeClient',
  hydrateFromCache: 'cache:hydrate',
  clearAllCaches: 'cache:clearAll',
  foldersList: 'folders:list',
  foldersCreate: 'folders:create',
  foldersUpdate: 'folders:update',
  foldersDelete: 'folders:delete',
  foldersAssign: 'folders:assign',
} as const;

/** Event (main → renderer) fired when the pending-approval set changes. */
export const IpcEvents = {
  approvalsChanged: 'mcp:approvalsChanged',
} as const;

/**
 * Cached data at or beyond this age is considered stale. Shared by the main
 * cache layer (as its default TTL) and the renderer (to highlight a stale
 * "last refreshed" timestamp). We never auto-refresh on staleness — the UI just
 * flags it so the user can choose to refresh.
 */
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
}

/** Status of the embedded local MCP server. */
export interface McpInfo {
  running: boolean;
  /** Endpoint an MCP client connects to, e.g. http://127.0.0.1:4123/mcp */
  url: string;
}

/** Credential values keyed by config-field name. */
export type CredentialValues = Record<string, string>;

/** One input in a registrar's credential form. */
export interface RegistrarConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select';
  required: boolean;
  options?: string[];
}

/** Metadata that drives the Settings > Registrars form. */
export interface RegistrarMeta {
  name: RegistrarName;
  displayName: string;
  helpText: string;
  supportsSandbox: boolean;
  configured: boolean;
  configFields: RegistrarConfigField[];
}

/** Result of a registrar connection test. */
export interface TestResult {
  ok: boolean;
  message: string;
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
  clientName: string;
  code: string;
  createdAt: number;
}

/** A client that has been paired with the MCP server. */
export interface McpClient {
  clientId: string;
  clientName: string;
  pairedAt: number;
}

/** A single marketplace listing for a domain (from DomDB). */
export interface MarketListing {
  /** Display name, e.g. "Afternic", "Sedo". */
  platform: string;
  /** Buy-it-now price in `currency`, or null for offer-only listings. */
  price: number | null;
  currency: string;
  /** e.g. "buy_it_now", "make_offer". */
  serviceType: string;
  canMakeOffer: boolean;
}

/** Aftermarket data for a domain (from DomDB). */
export interface Aftermarket {
  domain: string;
  /** "aftermarket" | "unavailable" | "unregistered" | "untracked" | "unknown". */
  availability: string;
  /** Listings across marketplaces, lowest priced first (offer-only last). */
  listings: MarketListing[];
  /** DomDB detail page, e.g. https://domdb.com/example.com */
  detailUrl: string;
}

/**
 * Where a domain's renewal price came from:
 *  - `api`         a direct, name-accurate quote from the registrar (captures
 *                  premium renewals). Only registrars that price a *specific*
 *                  owned domain qualify.
 *  - `base`        the standard TLD rate from the base pricing database — the
 *                  fill for every domain we can't quote per-name. May understate
 *                  premium names.
 *  - `manual`      a price the user entered by hand.
 *  - `unavailable` no price: nothing in the API, the base database, or a manual
 *                  override covers this domain yet.
 */
export type PriceSource = 'api' | 'base' | 'manual' | 'unavailable';

/** A domain's annual renewal price (USD), with provenance. */
export interface RenewalPricing {
  domain: string;
  registrar: string;
  /** Annual renewal price in USD, or null when unknown. */
  renewal: number | null;
  currency: string;
  source: PriceSource;
}

/** Re-exported so the renderer can type data without importing the lib. */
export type { Domain, RegistrarName };

/** A per-registrar failure from a portfolio fetch, flattened for IPC transport. */
export interface PortfolioErrorInfo {
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
 * UI paints a full portfolio (domains, per-domain detail, aftermarket, pricing)
 * with no network calls. `portfolio.fetchedAt` is the headline "last refreshed"
 * timestamp shown to the user.
 */
export interface CachedSnapshot {
  /** Cached portfolio, or null when nothing has ever been fetched. */
  portfolio: Portfolio | null;
  /** Per-domain detail (nameservers/privacy/lock/created), keyed `registrar:domain`. */
  detail: Record<string, Partial<Domain>>;
  /** Aftermarket data keyed by domain name; null = fetched-but-untracked. */
  aftermarket: Record<string, Aftermarket | null>;
  /** Renewal pricing keyed `registrar:domain`, computed from cache (no network). */
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
 * Reserved id for the built-in "Hidden" folder. Assigning a domain to it hides
 * the domain from the table by default; it's surfaced again by selecting Hidden
 * in the Folder filter. Not a real folder — it isn't stored in the folders list
 * and has no color — but it's a valid assignment target.
 */
export const HIDDEN_FOLDER_ID = '__hidden__';

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
 * domain→folder map (keyed `${registrar}:${domainName}`). Mirrors the shape of
 * CachedSnapshot. A domain absent from `assignments` is unassigned.
 */
export interface FoldersSnapshot {
  folders: Folder[];
  /** domainKey → folderId. */
  assignments: Record<string, string>;
}

/**
 * The API surface exposed on `window.api` by the preload script. Add new
 * methods here and they become type-checked on both sides of the bridge.
 */
export interface DombotApi {
  ping: () => Promise<string>;
  getAppInfo: () => Promise<AppInfo>;
  /** Open a URL in the user's default browser. */
  openExternal: (url: string) => Promise<void>;
  /**
   * Prompt for a save location and write `content` there as a UTF-8 text file.
   * `suggestedName` seeds the dialog's filename. Resolves with the chosen path,
   * or `{ saved: false }` if the user cancels.
   */
  saveCsv: (content: string, suggestedName: string) => Promise<SaveResult>;

  /** Restore the full cached portfolio + detail + aftermarket + pricing from
   * disk with no network calls, for instant paint on launch. */
  hydrateFromCache: () => Promise<CachedSnapshot>;
  /** Drop every on-disk data cache (portfolio, detail, market, pricing). */
  clearAllCaches: () => Promise<void>;

  /**
   * Aftermarket pricing for a domain (DomDB), or null if unavailable. With
   * `refresh` false, a fresh-enough cached value is returned without a network
   * call; otherwise it re-fetches and updates the cache.
   */
  getAftermarket: (
    domain: string,
    refresh?: boolean,
  ) => Promise<Aftermarket | null>;

  /** Annual renewal price for a domain, cached and manual-override aware. */
  getRenewalPrice: (
    registrar: RegistrarName,
    domain: string,
  ) => Promise<RenewalPricing>;
  /** Set (or clear, with null) a manual annual renewal price for a domain. */
  setManualPrice: (
    registrar: RegistrarName,
    domain: string,
    price: number | null,
  ) => Promise<void>;
  /** Drop the on-disk pricing cache so the next lookups re-fetch (keeps manual overrides). */
  clearPricingCache: () => Promise<void>;

  // Registrars
  listDynadotDomains: () => Promise<Domain[]>;
  /**
   * Aggregate portfolio across every configured registrar. With `refresh` false,
   * a cached portfolio is returned when present (no network); otherwise it
   * re-queries every registrar and updates the cache. Defaults to refresh.
   */
  listPortfolio: (refresh?: boolean) => Promise<Portfolio>;
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
  ) => Promise<Partial<Domain> | null>;
  getRegistrarMetadata: () => Promise<RegistrarMeta[]>;
  getRegistrarCredentials: (name: RegistrarName) => Promise<CredentialValues>;
  saveRegistrarCredentials: (
    name: RegistrarName,
    creds: CredentialValues,
  ) => Promise<void>;
  testRegistrar: (name: RegistrarName) => Promise<TestResult>;

  // MCP server
  getMcpInfo: () => Promise<McpInfo>;
  listPendingApprovals: () => Promise<McpPendingApproval[]>;
  resolveApproval: (id: string, approve: boolean) => Promise<void>;
  listMcpClients: () => Promise<McpClient[]>;
  revokeMcpClient: (clientId: string) => Promise<void>;
  /** Subscribe to pending-approval changes. Returns an unsubscribe function. */
  onApprovalsChanged: (callback: () => void) => () => void;

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
  assignFolder: (domainKey: string, folderId: string | null) => Promise<void>;
}
