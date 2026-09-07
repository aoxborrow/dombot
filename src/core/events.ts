import type { BulkJob, BulkProgress } from '../shared/ipc';

// Host-agnostic event bus for things the UI wants to hear about out of band:
// an MCP tool changed the cache, a bulk job made progress. Core emits; each host
// subscribes and forwards however it reaches its UI (Electron pushes over IPC,
// the web host bumps a revision counter the client polls).

export interface CoreEvents {
  /** The portfolio/detail cache changed out of band (an MCP tool write). */
  portfolioChanged: () => void;
  /** One bulk-job item finished. */
  bulkProgress: (progress: BulkProgress) => void;
  /** A bulk job ended — done or cancelled. */
  bulkFinished: (job: BulkJob) => void;
  /** MCP pairing state changed: an approval is pending or decided, a client
   *  paired or was revoked. */
  approvalsChanged: () => void;
}

type Listeners = { [K in keyof CoreEvents]: Set<CoreEvents[K]> };

const listeners: Listeners = {
  portfolioChanged: new Set(),
  bulkProgress: new Set(),
  bulkFinished: new Set(),
  approvalsChanged: new Set(),
};

/** Subscribes; returns the unsubscribe function. */
export function onCoreEvent<K extends keyof CoreEvents>(
  event: K,
  listener: CoreEvents[K],
): () => void {
  listeners[event].add(listener);
  return () => {
    listeners[event].delete(listener);
  };
}

function emit<K extends keyof CoreEvents>(
  event: K,
  ...args: Parameters<CoreEvents[K]>
): void {
  for (const l of listeners[event]) {
    try {
      (l as (...a: Parameters<CoreEvents[K]>) => void)(...args);
    } catch (err) {
      console.error(`[events] ${event} listener threw`, err);
    }
  }
}

export function broadcastPortfolioChanged(): void {
  emit('portfolioChanged');
}

export function broadcastBulkProgress(progress: BulkProgress): void {
  emit('bulkProgress', progress);
}

export function broadcastBulkFinished(job: BulkJob): void {
  emit('bulkFinished', job);
}

export function broadcastApprovalsChanged(): void {
  emit('approvalsChanged');
}
