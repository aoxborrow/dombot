import { ipcMain } from 'electron';
import { IpcChannels, type McpInfo } from '../../shared/ipc';
import { getMcpInfo } from '../mcp/server';

/** Exposes the local MCP server's status/connection details to the UI. */
export function registerMcpIpc(): void {
  ipcMain.handle(IpcChannels.getMcpInfo, async (): Promise<McpInfo> =>
    getMcpInfo(),
  );
}
