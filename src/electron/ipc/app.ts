import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { IpcChannels, type AppInfo, type SaveResult } from '../../shared/ipc';

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

  // Write text (e.g. an exported CSV) to a user-chosen location via the native
  // save dialog. The renderer is sandboxed and can't touch the filesystem, so
  // it hands us the fully-built content and we prompt + write here.
  ipcMain.handle(
    IpcChannels.saveCsv,
    async (
      event,
      content: string,
      suggestedName: string,
    ): Promise<SaveResult> => {
      const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
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
  );
}
