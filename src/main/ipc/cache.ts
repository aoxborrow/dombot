import { ipcMain } from 'electron';
import { IpcChannels, type CachedSnapshot } from '../../shared/ipc';
import { clearAll } from '../services/cache';
import {
  getCachedDetail,
  getCachedPortfolio,
  getConfiguredRegistrars,
  getPortfolioPricing,
} from '../services/registrars';

/**
 * Cache IPC: launch hydration and a cache reset. Hydration reads only from disk
 * — no registrar calls — so the UI can paint the full portfolio the moment it
 * opens, then the user refreshes on demand.
 */
export function registerCacheIpc(): void {
  ipcMain.handle(
    IpcChannels.hydrateFromCache,
    async (): Promise<CachedSnapshot> => {
      // The portfolio/detail/pricing caches were all fetched under registrar
      // credentials. If none are configured now — a fresh install, or every
      // credential removed — that cached data is orphaned: it would paint stale
      // domain counts and "N/N connected" over a UI that otherwise (correctly)
      // reports no registrars. Drop it and hydrate nothing so the whole app
      // reflects the true unconfigured state.
      if (getConfiguredRegistrars().length === 0) {
        clearAll();
        return { portfolio: null, detail: {}, pricing: {} };
      }

      return {
        portfolio: getCachedPortfolio(),
        detail: getCachedDetail(),
        // Renewal prices for every cached domain, computed locally (no network).
        pricing: getPortfolioPricing(),
      };
    },
  );

  ipcMain.handle(IpcChannels.clearAllCaches, async (): Promise<void> => {
    clearAll();
  });
}
