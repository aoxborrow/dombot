import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Domain } from '../../shared/ipc';

// The detail loader's pacing, through the store: what reaches the registrar
// and when. window.api is the only boundary.

const getDomainDetail = vi.fn();
vi.stubGlobal('window', { api: { getDomainDetail } });

const { useAppStore } = await import('./app');
const { DETAIL_PACE } = await import('../lib/detail-lane');

const row = (registrar: string, domainName: string): Domain =>
  ({
    domainName,
    registrar,
    accountId: registrar,
    status: 'ok',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: true,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(0),
    deleted: false,
  }) as unknown as Domain;

const names = (n: number, registrar = 'namecheap') =>
  Array.from({ length: n }, (_, i) => row(registrar, `n${i}.com`));

/** Calls that went to the registrar, not just the cache. */
const networkReads = () =>
  getDomainDetail.mock.calls.filter((c) => c[4] !== true).length;

beforeEach(() => {
  vi.useFakeTimers();
  getDomainDetail.mockReset();
  useAppStore.setState({ enriched: {}, enriching: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('enrichVisible at a paced registrar', () => {
  it('serves cached rows at once, without waiting a turn', async () => {
    getDomainDetail.mockImplementation(async (_r, _n, _f, _a, cacheOnly) =>
      cacheOnly ? { locked: true, nameservers: ['ns1.x'] } : null,
    );
    await useAppStore.getState().enrichVisible(names(30));

    expect(Object.keys(useAppStore.getState().enriched)).toHaveLength(30);
    expect(networkReads()).toBe(0);
  });

  it('reads uncached rows a burst at a time', async () => {
    // a minute's worth of reads at once, then the rest as the window refills
    const burst = DETAIL_PACE.namecheap?.windows[0].reads ?? 0;
    expect(burst).toBeGreaterThan(0);
    getDomainDetail.mockImplementation(async (_r, _n, _f, _a, cacheOnly) =>
      cacheOnly ? null : { locked: true, nameservers: ['ns1.x'] },
    );
    const done = useAppStore.getState().enrichVisible(names(burst + 3));

    await vi.advanceTimersByTimeAsync(0);
    expect(networkReads()).toBe(burst);
    expect(Object.keys(useAppStore.getState().enriching)).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(networkReads()).toBe(burst + 3);
    expect(useAppStore.getState().enriching).toEqual({});
  });

  it('keeps a rate-limited row loading and reads it again after the pause', async () => {
    let calls = 0;
    getDomainDetail.mockImplementation(async (_r, _n, _f, _a, cacheOnly) => {
      if (cacheOnly) return null;
      if (++calls === 1)
        throw new Error('Namecheap rate limit reached. Try again later.');
      return { locked: true, nameservers: ['ns1.x'] };
    });
    const done = useAppStore.getState().enrichVisible(names(1));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(useAppStore.getState().enriching).toEqual({
      'namecheap:n0.com': true,
    });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await done;
    expect(useAppStore.getState().enriched['namecheap:n0.com'].locked).toBe(
      true,
    );
  });
});

describe('enrichVisible elsewhere', () => {
  it('asks again later for a row the registrar turned away for quota', async () => {
    getDomainDetail.mockRejectedValueOnce(
      new Error('Dynadot rate limit reached. Try again in a few minutes.'),
    );
    const [d] = names(1, 'dynadot');
    await useAppStore.getState().enrichVisible([d]);
    expect(useAppStore.getState().enriched).toEqual({});

    getDomainDetail.mockResolvedValueOnce({ nameservers: ['ns1.x'] });
    await useAppStore.getState().enrichVisible([d]);
    expect(useAppStore.getState().enriched['dynadot:n0.com']).toBeDefined();
  });
});
