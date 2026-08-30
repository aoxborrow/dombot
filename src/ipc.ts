import { app, ipcMain } from 'electron';
import { IpcChannels, type AppInfo } from './shared/ipc';

/**
 * Registers all `ipcMain.handle` responders. Call once, after the app is ready.
 * Each handler's return type is checked against the shared {@link DombotApi}.
 */
export function registerIpcHandlers(): void {
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
