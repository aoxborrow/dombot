import { ipcMain } from 'electron';
import { IpcChannels, type Aftermarket } from '../../shared/ipc';
import { getAftermarket } from '../services/domdb';

/** Aftermarket-pricing IPC (DomDB). */
export function registerMarketIpc(): void {
  ipcMain.handle(
    IpcChannels.getAftermarket,
    async (_e, domain: string, refresh = false): Promise<Aftermarket | null> =>
      getAftermarket(domain, refresh),
  );
}
