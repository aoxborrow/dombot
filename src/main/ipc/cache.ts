import { ipcMain } from 'electron';
import {
  IpcChannels,
  type CachedSnapshot,
  type RegistrarName,
  type RenewalPricing,
} from '../../shared/ipc';
import { clearAll } from '../services/cache';
import {
  getCachedDetail,
  getCachedPortfolio,
  getConfiguredRegistrars,
} from '../services/registrars';
import { getCachedAftermarket } from '../services/domdb';
import { clearPricingCache, getCachedRenewalPrice } from '../services/pricing';

/**
 * Cache IPC: launch hydration and a cache reset. Hydration reads only from disk
 * — no registrar or DomDB calls — so the UI can paint the full portfolio the
 * moment it opens, then the user refreshes on demand.
 */
export function registerCacheIpc(): void {
  ipcMain.handle(
    IpcChannels.hydrateFromCache,
    async (): Promise<CachedSnapshot> => {
      // The portfolio/detail/market/pricing caches were all fetched under
      // registrar credentials. If none are configured now — a fresh install, or
      // every credential removed — that cached data is orphaned: it would paint
      // stale domain counts and "N/N connected" over a UI that otherwise
      // (correctly) reports no registrars. Drop it and hydrate nothing so the
      // whole app reflects the true unconfigured state.
      if (getConfiguredRegistrars().length === 0) {
        clearAll();
        clearPricingCache();
        return { portfolio: null, detail: {}, aftermarket: {}, pricing: {} };
      }

      const portfolio = getCachedPortfolio();

      // Compute pricing for every cached domain from local data only.
      const pricing: Record<string, RenewalPricing> = {};
      for (const d of portfolio?.domains ?? []) {
        const registrar = d.registrar as RegistrarName;
        pricing[`${d.registrar}:${d.domainName}`] = getCachedRenewalPrice(
          registrar,
          d.domainName,
        );
      }

      return {
        portfolio,
        detail: getCachedDetail(),
        aftermarket: getCachedAftermarket(),
        pricing,
      };
    },
  );

  ipcMain.handle(IpcChannels.clearAllCaches, async (): Promise<void> => {
    clearAll();
    clearPricingCache();
  });
}
