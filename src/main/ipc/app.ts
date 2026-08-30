import { app, ipcMain, shell } from 'electron';
import { IpcChannels, type AppInfo } from '../../shared/ipc';

/** App-level IPC: health check, runtime info, opening external links. */
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

  // Open a link in the user's browser. Only http(s) — never let the renderer
  // hand the OS an arbitrary scheme (file:, etc.).
  ipcMain.handle(
    IpcChannels.openExternal,
    async (_e, url: string): Promise<void> => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        await shell.openExternal(parsed.toString());
      }
    },
  );
}
