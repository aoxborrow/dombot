import type { DombotApi } from './ipc';

declare global {
  interface Window {
    /** Typed IPC bridge exposed by the preload script via contextBridge. */
    api: DombotApi;
  }
}

export {};
