import { BrowserWindow } from 'electron';
import { IpcEvents } from '../shared/ipc';
import { onCoreEvent } from '../core/events';

/**
 * Forwards core events to every open window over IPC:
 *  - portfolioChanged: the cache changed out of band (an MCP tool write), so an
 *    open Domains table can re-read it without a manual Sync. UI-initiated
 *    writes update the renderer store directly and don't rely on this.
 *  - bulkProgress / bulkFinished: the bulk-job runner's per-item and final
 *    snapshots.
 * Call once at startup.
 */
export function forwardCoreEventsToWindows(): void {
  const send = (channel: string, ...args: unknown[]) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, ...args);
    }
  };
  onCoreEvent('portfolioChanged', () => send(IpcEvents.portfolioChanged));
  onCoreEvent('bulkProgress', (p) => send(IpcEvents.bulkProgress, p));
  onCoreEvent('bulkFinished', (job) => send(IpcEvents.bulkFinished, job));
}
