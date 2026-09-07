import type { Revisions } from '../shared/ipc';
import { onCoreEvent } from './events';
import { Namespace } from './storage/namespace';

// Change counters a client can poll instead of being pushed to. Each kind of
// out-of-band change bumps its own counter; a client that remembers the last
// counters it saw asks `getRevisions()` and refetches only what moved. The
// desktop host still pushes events over IPC — this exists for the web host,
// where the renderer polls (docs/web-deployment.md, "Events").
//
// Persisted in the `meta` namespace so counters survive a Worker isolate
// restart; a client comparing against a stale isolate would otherwise miss
// changes.

export type RevisionKind = keyof Revisions;

const store = new Namespace<number>('meta');

const KEYS: Record<RevisionKind, string> = {
  portfolio: 'rev:portfolio',
  bulk: 'rev:bulk',
  approvals: 'rev:approvals',
};

/** Advances one counter. Hosts call this for changes core doesn't see itself
 *  (MCP approvals, until the OAuth provider moves into core). */
export function bumpRevision(kind: RevisionKind): void {
  void store.set(KEYS[kind], (store.get(KEYS[kind]) ?? 0) + 1);
}

/** The current counters. */
export function getRevisions(): Revisions {
  return {
    portfolio: store.get(KEYS.portfolio) ?? 0,
    bulk: store.get(KEYS.bulk) ?? 0,
    approvals: store.get(KEYS.approvals) ?? 0,
  };
}

let wired = false;

/** Bumps counters from core events. Idempotent; called by the API table. */
export function trackRevisions(): void {
  if (wired) return;
  wired = true;
  onCoreEvent('portfolioChanged', () => bumpRevision('portfolio'));
  onCoreEvent('bulkProgress', () => bumpRevision('bulk'));
  onCoreEvent('bulkFinished', () => bumpRevision('bulk'));
}
