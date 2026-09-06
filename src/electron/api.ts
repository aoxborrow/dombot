import { app, BrowserWindow, dialog, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  coreMethods,
  method,
  type ApiTable,
  type CoreMethodName,
} from '../core/api';
import { getMcpInfo } from './mcp/server';

// The desktop host's half of the API table: methods that need Electron (a
// native dialog, the OS browser, the local MCP server's status and approvals).
// Merged with `coreMethods` into the full table the IPC layer serves; the
// `ApiTable` annotation makes tsc fail if any DombotApi method is missing.

const none = z.tuple([]);

const electronMethods: Omit<ApiTable, CoreMethodName> = {
  ping: method(none, async () => 'pong'),

  getAppInfo: method(none, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  })),

  // Open a link in the user's browser. Only http(s) — never let the renderer
  // hand the OS an arbitrary scheme (file:, etc.). The schema enforces it.
  openExternal: method(
    z.tuple([
      z
        .string()
        .url()
        .regex(/^https?:\/\//),
    ]),
    async (url) => {
      await shell.openExternal(new URL(url).toString());
    },
  ),

  // Write text (e.g. an exported CSV) to a user-chosen location via the native
  // save dialog. The renderer is sandboxed and can't touch the filesystem, so
  // it hands us the fully-built content and we prompt + write here.
  saveCsv: method(
    z.tuple([z.string(), z.string().min(1).max(255)]),
    async (content, suggestedName) => {
      const window =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows()[0] ??
        undefined;
      const options = {
        defaultPath: suggestedName,
        filters: [
          { name: 'CSV', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (canceled || !filePath) return { saved: false };
      // UTF-8 with a BOM so Excel detects the encoding and renders accents
      // and other non-ASCII characters correctly.
      await writeFile(filePath, '\uFEFF' + content, 'utf8');
      return { saved: true, path: filePath };
    },
  ),

  // The local MCP server's status (pairing itself is in core).
  getMcpInfo: method(none, async () => getMcpInfo()),
};

/** The complete table the desktop host serves. */
export const electronApi: ApiTable = { ...coreMethods, ...electronMethods };
