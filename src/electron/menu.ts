import { app, BrowserWindow, Menu } from 'electron';
import { IpcEvents } from '../shared/ipc';

/**
 * The macOS application menu: the standard one, with Check for Updates…
 * (opens Settings → About and checks) and Settings… (⌘,) after About;
 * plus File → Sync Now, which asks the focused window to sync like the status
 * bar's Sync button. Windows and Linux have no menu bar (see removeMenu in
 * index.ts).
 */
function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/** Brings the window forward and asks it to show `route`. */
function show(route: string): void {
  const win = focusedWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.webContents.send(IpcEvents.navigateRequested, route);
}

export function setAppMenu(): void {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          {
            label: 'Check for Updates…',
            click: () => show('/settings?tab=about&check=1'),
          },
          { type: 'separator' },
          {
            label: 'Settings…',
            accelerator: 'CommandOrControl+,',
            click: () => show('/settings'),
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'Sync Now',
            click: () =>
              focusedWindow()?.webContents.send(IpcEvents.syncRequested),
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
