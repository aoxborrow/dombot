import { ipcMain } from 'electron';
import {
  IpcChannels,
  type CredentialValues,
  type Domain,
  type Portfolio,
  type RegistrarMeta,
  type RegistrarName,
} from '../../shared/ipc';
import {
  getDomainDetail,
  getPortfolio,
  getRegistrarClient,
  getRegistrarCredentialValues,
  getRegistrarMetadata,
  saveRegistrarCredentials,
  setDomainAutoRenew,
  syncRegistrar,
} from '../services/registrars';

/**
 * Registrar IPC. Handlers stay thin: parse input, call a service, return the
 * result — so the real logic in `services/` is testable without Electron.
 */
export function registerRegistrarIpc(): void {
  ipcMain.handle(IpcChannels.listDynadotDomains, async (): Promise<Domain[]> =>
    getRegistrarClient('dynadot').listDomains(),
  );

  // Aggregate every configured registrar into one portfolio (cache-backed).
  // refresh=false serves the cached portfolio for instant launch; the default
  // re-queries every registrar and updates the cache.
  ipcMain.handle(
    IpcChannels.listPortfolio,
    async (_e, refresh = true): Promise<Portfolio> => getPortfolio(refresh),
  );

  ipcMain.handle(
    IpcChannels.getDomainDetail,
    async (
      _e,
      name: RegistrarName,
      domainName: string,
      refresh = false,
    ): Promise<Partial<Domain> | null> =>
      getDomainDetail(name, domainName, refresh),
  );

  ipcMain.handle(
    IpcChannels.setAutoRenew,
    async (
      _e,
      name: RegistrarName,
      domainName: string,
      enabled: boolean,
    ): Promise<void> => {
      await setDomainAutoRenew(name, domainName, enabled);
    },
  );

  ipcMain.handle(
    IpcChannels.getRegistrarMetadata,
    async (): Promise<RegistrarMeta[]> => getRegistrarMetadata(),
  );

  ipcMain.handle(
    IpcChannels.getRegistrarCredentials,
    async (_e, name: RegistrarName): Promise<CredentialValues> =>
      getRegistrarCredentialValues(name),
  );

  ipcMain.handle(
    IpcChannels.saveRegistrarCredentials,
    async (_e, name: RegistrarName, creds: CredentialValues): Promise<void> => {
      saveRegistrarCredentials(name, creds);
    },
  );

  ipcMain.handle(
    IpcChannels.syncRegistrar,
    async (_e, name: RegistrarName): Promise<Portfolio> => syncRegistrar(name),
  );
}
