import { create } from 'zustand';
import type { AppInfo, Domain, McpInfo } from '../../shared/ipc';

interface AppState {
  appInfo: AppInfo | null;
  mcpInfo: McpInfo | null;
  domains: Domain[];
  domainsLoading: boolean;
  domainsError: string | null;
  loadAppInfo: () => Promise<void>;
  loadMcpInfo: () => Promise<void>;
  loadDynadotDomains: () => Promise<void>;
}

/** Global renderer store. Kept intentionally small — grow it as needed. */
export const useAppStore = create<AppState>((set) => ({
  appInfo: null,
  mcpInfo: null,
  domains: [],
  domainsLoading: false,
  domainsError: null,
  loadAppInfo: async () => {
    const appInfo = await window.api.getAppInfo();
    set({ appInfo });
  },
  loadMcpInfo: async () => {
    const mcpInfo = await window.api.getMcpInfo();
    set({ mcpInfo });
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
}));
