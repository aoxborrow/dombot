import { app, ipcMain } from 'electron';
import {
  RegistrarClient,
  createRegistrar,
  type Domain,
} from '@aoxborrow/registrar-client';
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

  ipcMain.handle(
    IpcChannels.listDynadotDomains,
    async (): Promise<Domain[]> => {
      const apiKey = process.env.DYNADOT_API_KEY;
      const apiSecret = process.env.DYNADOT_API_SECRET;
      if (!apiKey || !apiSecret) {
        throw new Error(
          'Missing DYNADOT_API_KEY / DYNADOT_API_SECRET in the environment (.env).',
        );
      }

      const client = new RegistrarClient(
        createRegistrar('dynadot', { apiKey, apiSecret }),
      );
      return client.listDomains();
    },
  );
}
