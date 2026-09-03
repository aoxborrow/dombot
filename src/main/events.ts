import { BrowserWindow } from 'electron';
import { IpcEvents } from '../shared/ipc';

/**
 * Tells every open window that the on-disk portfolio/detail cache changed out of
 * band (an MCP tool write), so an open Domains table can re-read the cache and
 * reflect the change without a manual Sync. UI-initiated writes update the
 * renderer store directly, so this is only meaningful for MCP-side mutations.
 */
export function broadcastPortfolioChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcEvents.portfolioChanged);
  }
}
