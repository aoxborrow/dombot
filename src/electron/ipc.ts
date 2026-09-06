import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels, IpcEvents } from '../shared/ipc';
import { invoke, type ApiMethodName } from '../core/api';
import { bumpRevision } from '../core/revision';
import { electronApi } from './api';
import { setApprovalListener } from './mcp/oauth';

/**
 * Registers every `ipcMain.handle` responder from the API table: one loop,
 * so adding a method to `DombotApi` + the table is all it takes. Arguments are
 * validated against the method's schema before the handler runs (an ApiValidationError
 * rejects the invoke, which the renderer sees as a thrown error).
 * Call once, after the app is ready and storage is hydrated.
 */
export function registerIpcHandlers(): void {
  for (const name of Object.keys(electronApi) as ApiMethodName[]) {
    ipcMain.handle(IpcChannels[name], (_event, ...args: unknown[]) =>
      invoke(name, electronApi[name], args),
    );
  }

  // When a new MCP connection needs approval, surface the app window and tell
  // the renderer to refresh its pending list.
  setApprovalListener(() => {
    bumpRevision('approvals');
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    for (const win of windows) {
      win.webContents.send(IpcEvents.approvalsChanged);
    }
  });
}
