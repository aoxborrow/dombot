import { create } from 'zustand';
import type { AppInfo, Domain } from '../../shared/ipc';

interface AppState {
  appInfo: AppInfo | null;
  clicks: number;
  domains: Domain[];
  domainsLoading: boolean;
  domainsError: string | null;
  loadAppInfo: () => Promise<void>;
  loadDynadotDomains: () => Promise<void>;
  increment: () => void;
}

/** Global renderer store. Kept intentionally small — grow it as needed. */
export const useAppStore = create<AppState>((set) => ({
  appInfo: null,
  clicks: 0,
  domains: [],
  domainsLoading: false,
  domainsError: null,
  loadAppInfo: async () => {
    const appInfo = await window.api.getAppInfo();
    set({ appInfo });
  },
  loadDynadotDomains: async () => {
    set({ domainsLoading: true, domainsError: null });
    try {
      const domains = await window.api.listDynadotDomains();
      set({ domains, domainsLoading: false });
    } catch (err) {
      set({
        domainsLoading: false,
        domainsError: err instanceof Error ? err.message : String(err),
      });
    }
  },
  increment: () => set((state) => ({ clicks: state.clicks + 1 })),
}));
