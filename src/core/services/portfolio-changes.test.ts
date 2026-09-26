import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHIVE_FOLDER_ID,
  DROPPED_FOLDER_ID,
  SOLD_FOLDER_ID,
} from '../../shared/ipc';
import type { AccountHoldings } from '../../shared/portfolio-changes';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import { assignFolder, getFolders } from './folders';
import {
  baselineAccountsIfUnset,
  getPortfolioChanges,
  recordPortfolioDiff,
  resolvePortfolioChange,
} from './portfolio-changes';

let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

function holding(
  accountId: string,
  names: string[],
  synced = true,
): AccountHoldings {
  return {
    accountId,
    registrar: 'dynadot',
    label: 'Main',
    names,
    synced,
  };
}

describe('portfolio change history', () => {
  it('keeps history across Clear cache and files a dismissal in Archive', async () => {
    recordPortfolioDiff(
      [holding('dynadot', [])],
      [holding('dynadot', ['a.com'])],
    );
    expect(getPortfolioChanges()).toEqual([]);
    recordPortfolioDiff(
      [holding('dynadot', ['a.com'])],
      [holding('dynadot', [])],
    );
    const removal = getPortfolioChanges()[0];
    expect(removal.kind).toBe('removed');
    resolvePortfolioChange(removal.id, 'dismissed');
    clearAll();
    expect(getPortfolioChanges()).toHaveLength(1);
    expect(getPortfolioChanges()[0]).toMatchObject({
      resolved: true,
      resolution: 'archive',
    });
    expect(getFolders().assignments[removal.domainName]).toBe(
      ARCHIVE_FOLDER_ID,
    );
    await flushWrites();
    expect(await store.get('portfolio-changes', 'changes')).toHaveLength(1);
  });

  it('files Sold on the account the name left and keeps the row', () => {
    recordPortfolioDiff(
      [holding('dynadot', [])],
      [holding('dynadot', ['a.com'])],
    );
    recordPortfolioDiff(
      [holding('dynadot', ['a.com'])],
      [holding('dynadot', [])],
    );
    const removal = getPortfolioChanges()[0];
    resolvePortfolioChange(removal.id, 'sold');
    expect(getPortfolioChanges()[0].resolution).toBe('sold');
    expect(getFolders().assignments['a.com']).toBe(SOLD_FOLDER_ID);
  });

  it('closes a departure on its own when the name was already filed', () => {
    recordPortfolioDiff(
      [holding('dynadot', [])],
      [holding('dynadot', ['sold.com', 'dropped.com'])],
    );
    assignFolder('sold.com', SOLD_FOLDER_ID);
    assignFolder('dropped.com', DROPPED_FOLDER_ID);
    recordPortfolioDiff(
      [holding('dynadot', ['sold.com', 'dropped.com'])],
      [holding('dynadot', [])],
    );
    const byName = new Map(
      getPortfolioChanges().map((change) => [change.domainName, change]),
    );
    expect(byName.get('sold.com')).toMatchObject({
      kind: 'removed',
      resolved: true,
      resolution: 'sold',
    });
    expect(byName.get('dropped.com')).toMatchObject({
      resolved: true,
      resolution: 'dropped',
    });
    expect(getPortfolioChanges().some((change) => !change.resolved)).toBe(
      false,
    );
  });

  it('baselines a restored portfolio that has no history yet', () => {
    baselineAccountsIfUnset(['dynadot']);
    baselineAccountsIfUnset(['porkbun']);
    recordPortfolioDiff(
      [holding('dynadot', ['a.com'])],
      [holding('dynadot', ['b.com'])],
    );
    expect(getPortfolioChanges().map((change) => change.domainName)).toEqual([
      'a.com',
      'b.com',
    ]);
  });
});
