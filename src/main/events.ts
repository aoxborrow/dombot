import { BrowserWindow } from 'electron';
import { IpcEvents, type BulkJob, type BulkProgress } from '../shared/ipc';

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

/** One bulk-job item finished: the renderer overlays its patch on the row. */
export function broadcastBulkProgress(progress: BulkProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcEvents.bulkProgress, progress);
  }
}

/** A bulk job ended (done or cancelled) — the final snapshot. */
export function broadcastBulkFinished(job: BulkJob): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcEvents.bulkFinished, job);
  }
}
