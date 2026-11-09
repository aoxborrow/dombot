import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  hydrateStores,
  flushWrites,
} from '../storage/namespace';
import {
  recoverCreationDates,
  withCachedRegistryCreation,
} from './registry-creation';
import { mergeDomainDetail } from '../../shared/creation-date';
import type { Domain } from '../../shared/ipc';
const registry = 'https://registry.example/rdap/';
const created = '2025-12-28T21:22:06.214Z';
const name = 'two-year.ai';
const bad = {
  domainName: name,
  registrar: 'namecheap',
  createdDate: new Date('2026-12-28T00:00:00Z'),
  expirationDate: new Date('2027-12-28T00:00:00Z'),
  autoRenew: false,
  locked: true,
  privacy: true,
  nameservers: ['ns1.example'],
};
const doc = () => ({
  ldhName: name,
  events: [
    { eventAction: 'registration', eventDate: created },
    { eventAction: 'expiration', eventDate: '2027-12-28T21:22:06.214Z' },
  ],
});
const mockFetch = (body = doc()) =>
  vi.fn(async (url: string) =>
    new URL(String(url)).hostname === 'data.iana.org'
      ? Response.json({ services: [[['ai'], [registry]]] })
      : Response.json(body),
  );
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  configureStore(new MemoryDocStore());
  await hydrateStores();
});
afterEach(async () => {
  await flushWrites();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('verified registration creation recovery', () => {
  it('recovers the exact registry instant and provenance, retaining expiry and controls', async () => {
    const send = mockFetch();
    vi.stubGlobal('fetch', send);
    const [result] = await recoverCreationDates([bad]);
    expect(result).toMatchObject({
      createdDate: new Date(created),
      expirationDate: bad.expirationDate,
      autoRenew: false,
      locked: true,
      privacy: true,
      nameservers: bad.nameservers,
      createdDateSource: {
        kind: 'registry-rdap',
        url: registry + 'domain/' + name,
        checkedAt: new Date().toISOString(),
      },
    });
    expect(result).not.toHaveProperty('createdDateIssue');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every(([url]) => new URL(String(url)).hostname !== 'rdap.org')).toBe(
      true,
    );
    expect(withCachedRegistryCreation(bad).createdDate).toEqual(
      new Date(created),
    );
  });
  it('keeps registry truth across another bad sync, detail overlay and a failed forced registry refresh', async () => {
    const send = mockFetch();
    vi.stubGlobal('fetch', send);
    const [first] = await recoverCreationDates([bad]);
    const [again] = await recoverCreationDates([bad]);
    expect(again.createdDate).toEqual(new Date(created));
    expect(send).toHaveBeenCalledTimes(2);
    const overlaid = mergeDomainDetail(first, bad);
    expect(overlaid.createdDate).toEqual(new Date(created));
    expect(overlaid.createdDateSource?.kind).toBe('registry-rdap');
    send.mockRejectedValue(new Error('registry unavailable'));
    const [refreshed] = await recoverCreationDates([bad], true);
    expect(refreshed.createdDate).toEqual(new Date(created));
    expect(refreshed.createdDateSource).toEqual(first.createdDateSource);
  });
  it('keeps healthy and imported dates free of extra lookups', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const healthy = { ...bad, createdDate: new Date(created) };
    expect((await recoverCreationDates([healthy]))[0].createdDate).toEqual(
      healthy.createdDate,
    );
    expect(
      (await recoverCreationDates([{ ...bad, source: 'imported' as const }]))[0]
        .createdDate,
    ).toEqual(bad.createdDate);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    'wrong domain',
    'future registry date',
    'creation after registry expiry',
    'no registration event',
  ])('rejects unusable evidence: %s', async (scenario) => {
    const body = doc();
    if (scenario === 'wrong domain') body.ldhName = 'another.ai';
    if (scenario === 'future registry date')
      body.events[0].eventDate = '2027-12-28T00:00:00Z';
    if (scenario === 'creation after registry expiry')
      body.events[1].eventDate = '2024-12-28T00:00:00Z';
    if (scenario === 'no registration event') body.events.shift();
    vi.stubGlobal('fetch', mockFetch(body));
    const [result] = await recoverCreationDates([bad]);
    expect(result.createdDate).toBeNull();
    expect(result).not.toHaveProperty('createdDateSource');
  });
  it('backs off a failed lookup and does not replace unrelated dates', async () => {
    const send = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', send);
    const [first] = await recoverCreationDates([bad]);
    await recoverCreationDates([bad]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(first.createdDate).toBeNull();
  });
  it('never fetches a private or insecure bootstrap authority', async () => {
    const send = vi.fn(async () =>
      Response.json({
        services: [
          [
            ['ai'],
            [
              'http://registry.example/',
              'https://127.0.0.1/',
              'https://service.internal/',
            ],
          ],
        ],
      }),
    );
    vi.stubGlobal('fetch', send);
    const [result] = await recoverCreationDates([bad]);
    expect(result.createdDate).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not assign old registry provenance to a different registrar date', () => {
    const before: Partial<Domain> = {
      ...bad,
      createdDate: new Date(created),
      createdDateSource: {
        kind: 'registry-rdap',
        url: registry + 'domain/' + name,
        checkedAt: new Date().toISOString(),
      },
    };
    const merged = mergeDomainDetail(before, {
      createdDate: new Date('2024-01-01'),
    });
    expect(merged).not.toHaveProperty('createdDateSource');
  });
  it('retains verified truth when a later registry response has an invalid creation date', async () => {
    const send = mockFetch();
    vi.stubGlobal('fetch', send);
    const [first] = await recoverCreationDates([bad]);
    send.mockImplementation(async () =>
      Response.json({
        ...doc(),
        events: [{ eventAction: 'registration', eventDate: '2029-12-28' }],
      }),
    );
    const [again] = await recoverCreationDates([bad], true);
    expect(again.createdDate).toEqual(first.createdDate);
    expect(again.createdDateSource?.checkedAt).toEqual(
      first.createdDateSource?.checkedAt,
    );
  });
  it('invalidates old recovered creation after an authoritative unregistered response', async () => {
    const send = mockFetch();
    vi.stubGlobal('fetch', send);
    const [first] = await recoverCreationDates([bad]);
    send.mockImplementation(async () => new Response('', { status: 404 }));
    const [gone] = await recoverCreationDates([first], true);
    expect(gone.createdDate).toBeNull();
    expect(gone).not.toHaveProperty('createdDateSource');
  });
});
