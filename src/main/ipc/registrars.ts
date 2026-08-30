import { ipcMain } from 'electron';
import { IpcChannels, type Domain } from '../../shared/ipc';
import { getDynadotClient } from '../services/registrars';

/**
 * Registrar IPC. Handlers stay thin: parse input, call a service, return the
 * result — so the real logic in `services/` is testable without Electron.
 */
export function registerRegistrarIpc(): void {
  ipcMain.handle(IpcChannels.listDynadotDomains, async (): Promise<Domain[]> =>
    getDynadotClient().listDomains(),
  );
}
