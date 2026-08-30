import { create } from 'zustand';
import type { AppInfo } from '../../shared/ipc';

interface AppState {
  appInfo: AppInfo | null;
  clicks: number;
  loadAppInfo: () => Promise<void>;
  increment: () => void;
}

/** Global renderer store. Kept intentionally small — grow it as needed. */
export const useAppStore = create<AppState>((set) => ({
  appInfo: null,
  clicks: 0,
  loadAppInfo: async () => {
    const appInfo = await window.api.getAppInfo();
    set({ appInfo });
  },
  increment: () => set((state) => ({ clicks: state.clicks + 1 })),
}));
