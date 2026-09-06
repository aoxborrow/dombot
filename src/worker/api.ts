import { z } from 'zod';
import {
  coreMethods,
  method,
  type ApiTable,
  type CoreMethodName,
} from '../core/api';
import { getSettings } from '../core/services/settings';

// The web host's half of the API table (the desktop's is src/electron/api.ts).
// Methods that are host-specific get web answers; the ones the browser does
// natively (`openExternal`, `saveCsv`) are handled client-side in
// src/renderer/api/http.ts and never reach here, but the table must still be
// complete so `ApiTable` type-checks.
//
// The MCP endpoint is mounted on this same origin (src/core/mcp/routes.ts);
// `url` is relative because a handler doesn't know the public origin — the
// renderer resolves it against its own.

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
    running: getSettings().mcpEnabled,
    url: '/mcp',
    stdioCommand: '',
    stdioArgs: [],
  })),
};

/** The complete table the web host serves. */
export const webApi: ApiTable = { ...coreMethods, ...webMethods };
