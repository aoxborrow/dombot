import { ipcMain } from 'electron';
import {
  IpcChannels,
  type CredentialValues,
  type Domain,
  type RegistrarMeta,
  type RegistrarName,
  type TestResult,
} from '../../shared/ipc';
import {
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
