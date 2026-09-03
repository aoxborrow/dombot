import { ipcMain } from 'electron';
import { IpcChannels, type AppSettings } from '../../shared/ipc';
import { getSettings, updateSettings } from '../services/settings';
import { restartAutoSync } from '../services/auto-sync';

/** Settings IPC: read and patch user-adjustable app settings. A patch is applied
 *  live — changing the sync interval reschedules the background sync. */
export function registerSettingsIpc(): void {
  ipcMain.handle(IpcChannels.getSettings, async (): Promise<AppSettings> =>
    getSettings(),
  );

  ipcMain.handle(
    IpcChannels.updateSettings,
    async (_e, patch: Partial<AppSettings>): Promise<AppSettings> => {
      const next = updateSettings(patch);
      // Apply live: the auto-sync interval may have changed (or been disabled).
      restartAutoSync();
      return next;
    },
  );
}
