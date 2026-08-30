import { ipcMain } from 'electron';
import {
  IpcChannels,
  type RegistrarName,
  type RenewalPricing,
} from '../../shared/ipc';
import {
  clearPricingCache,
  getRenewalPrice,
  setManualPrice,
} from '../services/pricing';

/** Renewal-pricing IPC (backs the Renewals dashboard). */
export function registerPricingIpc(): void {
  ipcMain.handle(
    IpcChannels.getRenewalPrice,
    async (
      _e,
      registrar: RegistrarName,
      domain: string,
    ): Promise<RenewalPricing> => getRenewalPrice(registrar, domain),
  );

  ipcMain.handle(
    IpcChannels.setManualPrice,
    async (
      _e,
      registrar: RegistrarName,
      domain: string,
      price: number | null,
    ): Promise<void> => {
      setManualPrice(registrar, domain, price);
    },
  );

  ipcMain.handle(IpcChannels.clearPricingCache, async (): Promise<void> => {
    clearPricingCache();
  });
}
