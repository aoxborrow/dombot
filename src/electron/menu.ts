import { BrowserWindow, Menu } from 'electron';
import { IpcEvents } from '../shared/ipc';

/**
 * The macOS application menu: the standard one, plus File → Sync Now, which
 * asks the focused window to sync like the status bar's Sync button. Windows
 * and Linux have no menu bar (see removeMenu in index.ts).
 */
export function setAppMenu(): void {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'File',
        submenu: [
          {
            label: 'Sync Now',
            click: () => {
              const win =
                BrowserWindow.getFocusedWindow() ??
                BrowserWindow.getAllWindows()[0];
              win?.webContents.send(IpcEvents.syncRequested);
            },
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}
