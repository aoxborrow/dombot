import { z } from 'zod';
import type { DombotApi } from '../../shared/ipc';
import {
  coreMethods,
  invoke,
  method,
  type ApiMethod,
  type ApiMethodName,
  type ApiTable,
  type CoreMethodName,
} from '../../core/api';
import { setAppIdentity } from '../../core/app-info';
import { installDemo, type DemoInstallation } from '../../core/demo';
import { onCoreEvent } from '../../core/events';
import { setBulkAutoDrive } from '../../core/services/bulk-jobs';
import { getPortfolio } from '../../core/services/registrars';
import { MemoryDocStore } from '../../core/storage/doc-store';
import { configureStore, hydrateStores } from '../../core/storage/namespace';
import pkg from '../../../package.json';
import { openExternalInBrowser, saveTextFileInBrowser } from './http';

// `window.api` for the demo build: the whole core runs inside the page, over
// an in-memory store, against the in-memory registrar (src/core/demo). This
// is the third host after the Electron preload bridge and the HTTP client —
// and the simplest: every method call goes straight into the same validated
// method table the other two hosts dispatch through, with no transport, so
// Dates and events don't need reviving or polling. Bulk jobs auto-drive
// in-process exactly as on the desktop.
//
// Nothing here persists: a reload regenerates the portfolio from the seed.

export const DEMO_VERSION: string = pkg.version;

const none = z.tuple([]);

/** The host-specific half of the table (cf. src/worker/api.ts). */
const demoMethods: Omit<ApiTable, CoreMethodName> = {
  ping: method(none, async () => 'pong'),
  getAppInfo: method(none, async () => ({
    name: 'DomBot',
    version: DEMO_VERSION,
    electron: '',
    chrome: '',
    node: '',
    platform: 'web' as const,
  })),
  openExternal: method(z.tuple([z.string()]), async (url) => {
    openExternalInBrowser(url);
  }),
  saveTextFile: method(z.tuple([z.string(), z.string()]), async (c, n) =>
    saveTextFileInBrowser(c, n),
  ),
  // No MCP server in a static page; the settings tab is hidden in the demo.
  getMcpInfo: method(none, async () => ({
    running: false,
    url: '',
    stdioCommand: '',
    stdioArgs: [],
  })),
};

export interface DemoApiOptions {
  /** Per-call latency of the fake registrar, ms. Default 150. */
  latencyMs?: number;
  /** Portfolio size. Default: the seed's. */
  size?: number;
}

export interface DemoApi {
  api: DombotApi;
  demo: DemoInstallation;
}

/**
 * Boots a fresh in-memory core, installs the demo, runs the first sync so
 * the portfolio is full before anything renders, and returns the API.
 */
export async function createDemoApi(
  options: DemoApiOptions = {},
): Promise<DemoApi> {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  setAppIdentity({ version: DEMO_VERSION, platform: 'web' });
  setBulkAutoDrive(true);
  const demo = await installDemo({
    latencyMs: options.latencyMs ?? 150,
    size: options.size,
  });
  await getPortfolio(true);

  const table: ApiTable = { ...coreMethods, ...demoMethods };
  const api: Record<string, unknown> = {};
  for (const name of Object.keys(table) as ApiMethodName[]) {
    api[name] = (...args: unknown[]) =>
      invoke(name, table[name] as ApiMethod, args);
  }
  const events: Pick<
    DombotApi,
    | 'onBulkProgress'
    | 'onBulkFinished'
    | 'onApprovalsChanged'
    | 'onPortfolioChanged'
  > = {
    onBulkProgress: (cb) => onCoreEvent('bulkProgress', cb),
    onBulkFinished: (cb) => onCoreEvent('bulkFinished', cb),
    onApprovalsChanged: (cb) => onCoreEvent('approvalsChanged', cb),
    onPortfolioChanged: (cb) => onCoreEvent('portfolioChanged', cb),
  };
  return { api: { ...api, ...events } as DombotApi, demo };
}
