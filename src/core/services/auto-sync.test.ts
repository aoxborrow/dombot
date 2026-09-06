import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActiveRegistrars = vi.fn<() => string[]>();
const getCachedPortfolio = vi.fn<() => { fetchedAt: number | null } | null>();
const getPortfolio = vi.fn();
vi.mock('./registrars', () => ({
  getActiveRegistrars: () => getActiveRegistrars(),
  getCachedPortfolio: () => getCachedPortfolio(),
  getPortfolio: (...a: unknown[]) => getPortfolio(...a),
}));
const isBulkRunning = vi.fn<() => boolean>();
vi.mock('./bulk-jobs', () => ({ isBulkRunning: () => isBulkRunning() }));
const broadcastPortfolioChanged = vi.fn();
vi.mock('../events', () => ({
  broadcastPortfolioChanged: () => broadcastPortfolioChanged(),
}));
vi.mock('./settings', () => ({
  getSettings: () => ({ autoSyncIntervalMinutes: 60 }),
}));

import { syncAll } from './auto-sync';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-06-01T12:00:00Z'));
  getActiveRegistrars.mockReturnValue(['dynadot']);
  isBulkRunning.mockReturnValue(false);
  getCachedPortfolio.mockReturnValue({ fetchedAt: Date.now() - 30 * 60_000 });
  getPortfolio.mockResolvedValue({});
});

describe('syncAll', () => {
  it('syncs and notifies', async () => {
    expect(await syncAll()).toBe(true);
    expect(getPortfolio).toHaveBeenCalledWith(true);
    expect(broadcastPortfolioChanged).toHaveBeenCalledTimes(1);
  });

  it('skips with nothing configured or a bulk job running', async () => {
    getActiveRegistrars.mockReturnValue([]);
    expect(await syncAll()).toBe(false);
    getActiveRegistrars.mockReturnValue(['dynadot']);
    isBulkRunning.mockReturnValue(true);
    expect(await syncAll()).toBe(false);
    expect(getPortfolio).not.toHaveBeenCalled();
  });

  it('honors ifOlderThanMs: fresh cache → no sync; stale or missing → sync', async () => {
    // Cache is 30 min old.
    expect(await syncAll(60 * 60_000)).toBe(false);
    expect(await syncAll(10 * 60_000)).toBe(true);
    getCachedPortfolio.mockReturnValue(null);
    expect(await syncAll(24 * 60 * 60_000)).toBe(true);
    expect(getPortfolio).toHaveBeenCalledTimes(2);
  });

  it('reports false and does not notify when the sync throws', async () => {
    getPortfolio.mockRejectedValue(new Error('boom'));
    expect(await syncAll()).toBe(false);
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });
});
