/**
 * Shared IPC contract used by both the main process and the renderer (via the
 * preload bridge). Keeping channel names and payload/return types in one place
 * gives us a single, type-checked source of truth for every IPC round trip.
 */

// Type-only import: erased at build time, so the renderer bundle never resolves
// the library — only tsc uses it (via the tsconfig `paths` alias to source).
import type { Domain } from '@aoxborrow/registrar-client';

/** Channel identifiers for `ipcRenderer.invoke` / `ipcMain.handle`. */
export const IpcChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
  listDynadotDomains: 'registrar:listDynadotDomains',
  getMcpInfo: 'mcp:getInfo',
} as const;

/** Status of the embedded local MCP server. */
export interface McpInfo {
  running: boolean;
  /** Endpoint an MCP client connects to, e.g. http://127.0.0.1:4123/mcp */
  url: string;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
}

/** Re-exported so the renderer can type domain data without importing the lib. */
export type { Domain };

/**
 * The API surface exposed on `window.api` by the preload script. Add new
 * methods here and they become type-checked on both sides of the bridge.
 */
export interface DombotApi {
  ping: () => Promise<string>;
  getAppInfo: () => Promise<AppInfo>;
  listDynadotDomains: () => Promise<Domain[]>;
  getMcpInfo: () => Promise<McpInfo>;
}
