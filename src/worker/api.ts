import { z } from 'zod';
import {
  coreMethods,
  method,
  type ApiTable,
  type CoreMethodName,
} from '../core/api';

// The web host's half of the API table (the desktop's is src/electron/api.ts).
// Methods that are host-specific get web answers; the ones the browser does
// natively (`openExternal`, `saveCsv`) are handled client-side in
// src/renderer/api/http.ts and never reach here, but the table must still be
// complete so `ApiTable` type-checks.
//
// MCP on the web lands in phase 5; until then the status says so.

const none = z.tuple([]);

import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;

const webMethods: Omit<ApiTable, CoreMethodName> = {
  ping: method(none, async () => 'pong'),

  getAppInfo: method(none, async () => ({
    name: 'DomBot',
    version: APP_VERSION,
    electron: '',
    chrome: '',
    node: '',
    platform: 'web' as const,
  })),

  openExternal: method(z.tuple([z.string()]), async () => {
    // Handled in the browser (window.open); nothing to do server-side.
  }),
  saveCsv: method(z.tuple([z.string(), z.string()]), async () => ({
    saved: false,
  })),

  getMcpInfo: method(none, async () => ({
    running: false,
    url: '',
    stdioCommand: '',
    stdioArgs: [],
  })),
  listPendingApprovals: method(none, async () => []),
  resolveApproval: method(z.tuple([z.string(), z.boolean()]), async () => {}),
  listMcpClients: method(none, async () => []),
  revokeMcpClient: method(z.tuple([z.string()]), async () => {}),
};

/** The complete table the web host serves. */
export const webApi: ApiTable = { ...coreMethods, ...webMethods };
