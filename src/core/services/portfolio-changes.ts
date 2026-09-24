import {
  ARCHIVE_FOLDER_ID,
  DROPPED_FOLDER_ID,
  SOLD_FOLDER_ID,
  type PortfolioChange,
  type PortfolioChangeResolution,
} from '../../shared/ipc';
import {
  diffHoldings,
  type AccountHoldings,
} from '../../shared/portfolio-changes';
import { Namespace } from '../storage/namespace';
import { assignFolder, getFolders } from './folders';

// History of names that arrived, left, or moved between the user's accounts.
// Not a cache: Clear cache does not wipe it, and Export data includes it
// because the namespace is registered.
// A move stores the account the name left and the account it joined. Dismiss
// keeps that row. No screen lists past moves. The Domains History view is
// only Sold, Dropped, and Archive.

const store = new Namespace<unknown>('portfolio-changes');

interface ChangeStore {
  changes: PortfolioChange[];
  baselinedAccountIds: string[];
}

function load(): ChangeStore {
  const changes = store.get('changes');
  const baselined = store.get('baselines');
  return {
    changes: Array.isArray(changes) ? (changes as PortfolioChange[]) : [],
    baselinedAccountIds: Array.isArray(baselined)
      ? baselined.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function persist(next: ChangeStore): void {
  void store.set('changes', next.changes);
  void store.set('baselines', next.baselinedAccountIds);
}

export function getPortfolioChanges(): PortfolioChange[] {
  return load().changes;
}

const HIDDEN = new Set([ARCHIVE_FOLDER_ID, SOLD_FOLDER_ID, DROPPED_FOLDER_ID]);

type UserResolution = Exclude<PortfolioChangeResolution, 'returned'>;

/** A name that came back should show in the usual list again. */
function releaseHiddenFolder(
  accountId: string | null,
  domainName: string,
): void {
  if (!accountId) return;
  const key = `${accountId}:${domainName}`;
  const folderId = getFolders().assignments[key];
  if (folderId && HIDDEN.has(folderId)) assignFolder(key, null);
}

/**
 * Record what a sync changed. The first successful sync of an account is a
 * baseline and creates no alerts. Failures are the caller's job: pass
 * `synced: false` for an account whose list did not update.
 */
export function recordPortfolioDiff(
  before: AccountHoldings[],
  after: AccountHoldings[],
): void {
  const current = load();
  const priorById = new Map(
    current.changes.map((change) => [change.id, change]),
  );
  const next = diffHoldings(
    before,
    after,
    current.changes,
    current.baselinedAccountIds,
    new Date().toISOString(),
    () => crypto.randomUUID(),
  );
  persist({
    changes: next.changes,
    baselinedAccountIds: next.baselinedAccountIds,
  });
  for (const change of next.changes) {
    const prev = priorById.get(change.id);
    if (!prev && change.kind === 'added') {
      releaseHiddenFolder(change.toAccountId, change.domainName);
    }
    if (change.resolution === 'returned' && prev?.resolution !== 'returned') {
      releaseHiddenFolder(change.fromAccountId, change.domainName);
    }
    // Already filed from the domain list. Record the departure and do not ask again.
    if (!prev && change.kind === 'removed' && !change.resolved) {
      const filed = filedResolution(change.fromAccountId, change.domainName);
      if (filed) resolvePortfolioChange(change.id, filed);
    }
  }
}

function filedResolution(
  accountId: string | null,
  domainName: string,
): UserResolution | null {
  if (!accountId) return null;
  const folderId = getFolders().assignments[`${accountId}:${domainName}`];
  if (folderId === SOLD_FOLDER_ID) return 'sold';
  if (folderId === DROPPED_FOLDER_ID) return 'dropped';
  if (folderId === ARCHIVE_FOLDER_ID) return 'archive';
  return null;
}

/**
 * After importing a backup that predates this history, treat the restored
 * portfolio as the baseline so the next Sync alerts on real differences.
 * A backup that already has baselines is left alone.
 */
export function baselineAccountsIfUnset(accountIds: string[]): void {
  const current = load();
  if (current.baselinedAccountIds.length > 0) return;
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (ids.length === 0) return;
  persist({ ...current, baselinedAccountIds: ids });
}

function folderFor(resolution: UserResolution): string | null {
  if (resolution === 'sold') return SOLD_FOLDER_ID;
  if (resolution === 'dropped') return DROPPED_FOLDER_ID;
  if (resolution === 'archive') return ARCHIVE_FOLDER_ID;
  return null;
}

/**
 * Close one alert. The history row stays.
 * Dismissing a removal files the name in Archive. Dismissing a move or an
 * arrival does not, so a move has no folder and no later screen.
 */
export function resolvePortfolioChange(
  id: string,
  resolution: UserResolution,
): void {
  const current = load();
  const index = current.changes.findIndex((change) => change.id === id);
  if (index < 0) return;
  const change = current.changes[index];
  if (change.resolved) return;

  let next = resolution;
  if (change.kind === 'removed' && resolution === 'dismissed') next = 'archive';
  if (
    change.kind !== 'removed' &&
    (next === 'sold' || next === 'dropped' || next === 'archive')
  ) {
    throw new Error(
      'Only a name that left can be marked sold, dropped, or archived.',
    );
  }

  const updated: PortfolioChange = {
    ...change,
    resolved: true,
    resolution: next,
  };
  const changes = current.changes.slice();
  changes[index] = updated;
  persist({ ...current, changes });

  const folderId = folderFor(next);
  if (folderId && change.fromAccountId) {
    assignFolder(`${change.fromAccountId}:${change.domainName}`, folderId);
  }
}
