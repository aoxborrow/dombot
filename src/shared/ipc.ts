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
  getRegistrarMetadata: 'registrar:getMetadata',
  getRegistrarCredentials: 'registrar:getCredentials',
  saveRegistrarCredentials: 'registrar:saveCredentials',
  testRegistrar: 'registrar:test',
  getMcpInfo: 'mcp:getInfo',
  listPendingApprovals: 'mcp:listPendingApprovals',
  resolveApproval: 'mcp:resolveApproval',
  listMcpClients: 'mcp:listClients',
  revokeMcpClient: 'mcp:revokeClient',
} as const;

/** Event (main → renderer) fired when the pending-approval set changes. */
export const IpcEvents = {
  approvalsChanged: 'mcp:approvalsChanged',
} as const;

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
}

/**
 * The API surface exposed on `window.api` by the preload script. Add new
 * methods here and they become type-checked on both sides of the bridge.
 */
export interface DombotApi {
  ping: () => Promise<string>;
  getAppInfo: () => Promise<AppInfo>;

  // Registrars
  listDynadotDomains: () => Promise<Domain[]>;
  listPortfolio: () => Promise<Portfolio>;
  /**
   * Full per-domain detail (nameservers/privacy/lock) for one domain, or `null`
   * when the registrar can't supply it (e.g. a TLD its detail API rejects).
   */
  getDomainDetail: (
    registrar: RegistrarName,
    domainName: string,
  ) => Promise<Domain | null>;
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
}
