import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  createDomain,
  createRegistrar,
  RateLimitError,
} from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import {
  configureRegistrarFactory,
  getPortfolio,
  getRegistrarMetadata,
  removeRegistrarAccount,
  resetRegistrarClients,
  saveRegistrarCredentials,
  setRegistrarEnabledCached,
  syncRegistrar,
} from './registrars';
import { syncAll } from './auto-sync';
import { createAccount } from './accounts';
import { writeEntry } from './cache';

const list = vi.fn();
let raw: MemoryDocStore;
const state = () =>
  getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync;
const held = () => [
  createDomain({ domainName: 'held.example', registrar: 'dynadot' }),
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
  raw = new MemoryDocStore();
  configureStore(raw);
  await hydrateStores();
  resetRegistrarClients();
  configureRegistrarFactory((name, credentials) => {
    const provider = createRegistrar(name, credentials);
    provider.listDomains = list;
    provider.getPricing = vi.fn().mockResolvedValue([]);
    return provider;
  });
  list.mockReset().mockImplementation(async () => held());
  await saveRegistrarCredentials('dynadot', {
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  });
});
afterEach(async () => {
  await flushWrites();
  resetRegistrarClients();
  configureRegistrarFactory(null);
  vi.useRealTimers();
});

describe('Dynadot inventory recovery', () => {
  it('coalesces overlapping manual and scheduled reads of the same account', async () => {
    let finish!: (domains: ReturnType<typeof held>) => void;
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const manual = syncRegistrar('dynadot');
    const scheduled = syncAll();
    expect(list).toHaveBeenCalledTimes(1);
    finish(held());
    await Promise.all([manual, scheduled]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('persists Retry-After and holdings, then recovers despite a fresh sibling', async () => {
    await syncRegistrar('dynadot');
    const lastGood = state().lastSyncedAt;
    vi.setSystemTime(Date.now() + 1000);
    list.mockRejectedValueOnce(new RateLimitError('HTTP 429', 180));
    expect((await syncRegistrar('dynadot')).domains).toHaveLength(1);
    const failureAt = Date.now();
    expect(state()).toMatchObject({
      lastSyncedAt: lastGood,
      recovery: { state: 'deferred', retryAt: failureAt + 180000, attempts: 1 },
    });
    await flushWrites();
    configureStore(raw);
    await hydrateStores();
    resetRegistrarClients();
    await syncRegistrar('dynadot');
    expect(list).toHaveBeenCalledTimes(2);
    await saveRegistrarCredentials('porkbun', {
      apiKey: 'pk',
      secretApiKey: 'secret',
    });
    writeEntry('portfolio', 'porkbun', {
      domains: [],
      lastSyncedAt: failureAt + 180000,
      lastError: null,
    });
    vi.setSystemTime(failureAt + 179999);
    expect(await syncAll(86400000)).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
    vi.setSystemTime(failureAt + 180000);
    expect(await syncAll(86400000)).toBe(true);
    expect(list).toHaveBeenCalledTimes(3);
    expect(state().lastError).toBeNull();
    expect(state().recovery).toBeUndefined();
  });

  it('stops automatic retries after three failed inventory attempts and allows a later manual retry', async () => {
    await syncRegistrar('dynadot');
    list.mockRejectedValue(new RateLimitError('HTTP 429', 60));
    await syncRegistrar('dynadot');
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(Date.now() + 240001);
      await syncAll();
    }
    expect(list).toHaveBeenCalledTimes(4); // one success, three failures
    expect(state()).toMatchObject({
      domainCount: 1,
      recovery: { state: 'failed', attempts: 3 },
    });
    list.mockResolvedValue(held());
    await syncRegistrar('dynadot');
    expect(list).toHaveBeenCalledTimes(5);
    expect(state().lastError).toBeNull();
  });

  it.each([undefined, NaN, Infinity, -10])(
    'uses a finite fallback cooldown for invalid Retry-After %s',
    async (retryAfter) => {
      list.mockRejectedValueOnce(new RateLimitError('HTTP 429', retryAfter));
      await syncRegistrar('dynadot');
      expect(state().recovery).toMatchObject({
        retryAt: Date.now() + 60000,
        attempts: 1,
      });
      expect(list).toHaveBeenCalledWith(undefined);
    },
  );

  it('does not bypass the persisted cooldown on manual refresh', async () => {
    list.mockRejectedValueOnce(new RateLimitError('HTTP 429', 300));
    await syncRegistrar('dynadot');
    await getPortfolio(true);
    expect(list).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 300000);
    await syncRegistrar('dynadot');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not recover authentication failures through the rate-limit retry path', async () => {
    list.mockRejectedValueOnce(new AuthenticationError('Invalid credentials'));
    await syncRegistrar('dynadot');
    expect(state().recovery).toBeUndefined();
    await saveRegistrarCredentials('porkbun', {
      apiKey: 'pk',
      secretApiKey: 'secret',
    });
    writeEntry('portfolio', 'porkbun', {
      domains: [],
      lastSyncedAt: Date.now(),
      lastError: null,
    });
    vi.setSystemTime(Date.now() + 300000);
    expect(await syncAll(86400000)).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('leaves other registrars retry behavior unchanged', async () => {
    await saveRegistrarCredentials('porkbun', {
      apiKey: 'pk',
      secretApiKey: 'secret',
    });
    list.mockRejectedValue(new RateLimitError('HTTP 429', 300));
    await syncRegistrar('porkbun');
    await syncRegistrar('porkbun');
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(undefined);
    expect(
      getRegistrarMetadata().find((m) => m.name === 'porkbun')!.sync.recovery,
    ).toBeUndefined();
  });

  it('keeps sibling account requests independent', async () => {
    const second = await createAccount('dynadot', 'Second', {
      apiKey: 'second',
      apiSecret: 'secret',
    });
    list.mockRejectedValueOnce(new RateLimitError('HTTP 429', 180));
    await syncRegistrar('dynadot', 'dynadot');
    await syncRegistrar('dynadot', second.id);
    expect(list).toHaveBeenCalledTimes(2);
    expect(
      getRegistrarMetadata().find((m) => m.accountId === second.id)!.sync
        .lastError,
    ).toBeNull();
  });

  it('does not revive disabled or removed accounts when recovery is due', async () => {
    list.mockRejectedValueOnce(new RateLimitError('HTTP 429', 60));
    await syncRegistrar('dynadot');
    await setRegistrarEnabledCached('dynadot', false);
    vi.setSystemTime(Date.now() + 600000);
    expect(await syncAll()).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
    await removeRegistrarAccount('dynadot');
    expect(await syncAll()).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('fences an old in-flight result after credentials change', async () => {
    let finish!: (domains: ReturnType<typeof held>) => void;
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = syncRegistrar('dynadot');
    await saveRegistrarCredentials('dynadot', {
      apiKey: 'replacement',
      apiSecret: 'secret',
    });
    list.mockResolvedValueOnce([]);
    await syncRegistrar('dynadot');
    finish(held());
    await old;
    expect(list).toHaveBeenCalledTimes(2);
    expect(state().domainCount).toBe(0);
    expect(state().lastError).toBeNull();
  });
});
