import { app, ipcMain } from 'electron';
import { IpcChannels, type AppInfo } from '../../shared/ipc';

/** App-level IPC: health check and runtime info. */
export function registerAppIpc(): void {
  ipcMain.handle(IpcChannels.ping, async (): Promise<string> => 'pong');

  ipcMain.handle(IpcChannels.getAppInfo, async (): Promise<AppInfo> => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));
}
