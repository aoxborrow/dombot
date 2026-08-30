import { ipcMain } from 'electron';
import { listPortfolio } from '@aoxborrow/registrar-client';
import {
  IpcChannels,
  type CredentialValues,
  type Domain,
  type Portfolio,
  type RegistrarMeta,
  type RegistrarName,
  type TestResult,
} from '../../shared/ipc';
import {
  getConfiguredRegistrars,
  getDomainDetail,
  getPortfolioSources,
  getRegistrarClient,
  getRegistrarCredentialValues,
  getRegistrarMetadata,
  saveRegistrarCredentials,
  testRegistrar,
} from '../services/registrars';

/**
 * Registrar IPC. Handlers stay thin: parse input, call a service, return the
 * result — so the real logic in `services/` is testable without Electron.
 */
export function registerRegistrarIpc(): void {
  ipcMain.handle(IpcChannels.listDynadotDomains, async (): Promise<Domain[]> =>
    getRegistrarClient('dynadot').listDomains(),
  );

  // Aggregate every configured registrar into one portfolio. `listPortfolio`
  // queries sources concurrently with per-registrar error isolation; we flatten
  // its Error objects to plain messages so the result survives structured clone.
  ipcMain.handle(IpcChannels.listPortfolio, async (): Promise<Portfolio> => {
    const registrars = getConfiguredRegistrars();
    const { domains, errors } = await listPortfolio(getPortfolioSources());
    // id → nicely capitalized display name, for the UI's filter and table.
    const registrarLabels = Object.fromEntries(
      getRegistrarMetadata().map((r) => [r.name, r.displayName]),
    );
    return {
      domains,
      errors: errors.map(({ registrar, error }) => ({
        registrar,
        message: error.message,
      })),
      registrars,
      registrarLabels,
    };
  });

  ipcMain.handle(
    IpcChannels.getDomainDetail,
    async (
      _e,
      name: RegistrarName,
      domainName: string,
    ): Promise<Domain | null> => getDomainDetail(name, domainName),
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
    IpcChannels.testRegistrar,
    async (_e, name: RegistrarName): Promise<TestResult> => testRegistrar(name),
  );
}
