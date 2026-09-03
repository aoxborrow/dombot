import { ipcMain } from 'electron';
import {
  IpcChannels,
  type RegistrarName,
  type RenewalPricing,
} from '../../shared/ipc';
import { getPortfolioPricing } from '../services/registrars';
import { setManualPrice } from '../services/pricing';

/** Renewal-pricing IPC (backs the Renewals dashboard and the Domains column). */
export function registerPricingIpc(): void {
  ipcMain.handle(
    IpcChannels.getPortfolioPricing,
    async (): Promise<Record<string, RenewalPricing>> => getPortfolioPricing(),
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
}
