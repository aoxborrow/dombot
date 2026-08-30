import { BrowserWindow, ipcMain } from 'electron';
import {
  IpcChannels,
  IpcEvents,
  type McpClient,
  type McpInfo,
  type McpPendingApproval,
} from '../../shared/ipc';
import { getMcpInfo } from '../mcp/server';
import {
  listMcpClients,
  listPendingApprovals,
  resolvePending,
  revokeMcpClient,
  setApprovalListener,
} from '../mcp/oauth';

/** Exposes MCP server status, pending approvals, and paired clients to the UI. */
export function registerMcpIpc(): void {
  ipcMain.handle(IpcChannels.getMcpInfo, async (): Promise<McpInfo> =>
    getMcpInfo(),
  );

  ipcMain.handle(
    IpcChannels.listPendingApprovals,
    async (): Promise<McpPendingApproval[]> => listPendingApprovals(),
  );

  ipcMain.handle(
    IpcChannels.resolveApproval,
    async (_e, id: string, approve: boolean): Promise<void> => {
      resolvePending(id, approve);
    },
  );

  ipcMain.handle(IpcChannels.listMcpClients, async (): Promise<McpClient[]> =>
    listMcpClients(),
  );

  ipcMain.handle(
    IpcChannels.revokeMcpClient,
    async (_e, clientId: string): Promise<void> => {
      revokeMcpClient(clientId);
    },
  );

  // When a new connection needs approval, surface the app window and tell the
  // renderer to refresh its pending list.
  setApprovalListener(() => {
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
