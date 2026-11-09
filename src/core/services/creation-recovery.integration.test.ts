import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRegistrar, createDomain } from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  hydrateStores,
  flushWrites,
} from '../storage/namespace';
import { createAccount } from './accounts';
import {
  configureRegistrarFactory,
  getDomainDetail,
  getCachedDetail,
  getMergedPortfolio,
  syncRegistrar,
} from './registrars';
import { writeEntry, readEntry } from './cache';
const name = 'two-year.ai';
const registryDate = '2025-12-28T21:22:06.214Z';
let registryCalls = 0;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  configureStore(new MemoryDocStore());
  await hydrateStores();
  registryCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      if (url === 'https://data.iana.org/rdap/dns.json')
        return Response.json({
          services: [[['ai'], ['https://registry.example/rdap/']]],
        });
      if (url === 'https://registry.example/rdap/domain/' + name) {
        registryCalls++;
        return Response.json({
          ldhName: name,
          events: [
            { eventAction: 'registration', eventDate: registryDate },
            {
              eventAction: 'expiration',
              eventDate: '2027-12-28T21:22:06.214Z',
            },
          ],
        });
      }
      throw Error('Unexpected external request');
    }),
  );
  configureRegistrarFactory((registrar, credentials) =>
    createRegistrar(registrar, credentials, {
      fetch: async (input) => {
        const command = new URL(String(input)).searchParams.get('Command')!;
        const payload = command.endsWith('.getList')
          ? `<DomainGetListResult><Domain Name="${name}" Created="12/28/2026" Expires="12/28/2027" AutoRenew="true" /></DomainGetListResult>`
          : command.endsWith('.getInfo')
            ? `<DomainGetInfoResult DomainName="${name}" Status="Ok"><DomainDetails><CreatedDate>12/28/2026</CreatedDate><ExpiredDate>12/28/2027</ExpiredDate></DomainDetails><DnsDetails><Nameserver>ns1.example</Nameserver></DnsDetails><Whoisguard Enabled="True" /></DomainGetInfoResult>`
            : command.endsWith('.getRegistrarLock')
              ? '<DomainGetRegistrarLockResult RegistrarLockStatus="true" />'
              : '<UserGetPricingResult />';
        return new Response(
          `<ApiResponse Status="OK"><CommandResponse>${payload}</CommandResponse></ApiResponse>`,
        );
      },
      retries: 0,
    }),
  );
});
afterEach(async () => {
  await flushWrites();
  configureRegistrarFactory(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('returns actual creation through the shipped Namecheap adapter, detail, sync, cached reads and reload', async () => {
  const account = await createAccount('namecheap', 'Fixture', {
    username: 'fixture',
    apiKey: 'fixture',
    clientIp: '192.0.2.1',
  });
  writeEntry('portfolio', account.id, {
    domains: [
      createDomain({
        domainName: name,
        registrar: 'namecheap',
        createdDate: '12/28/2026',
        expirationDate: '12/28/2027',
        autoRenew: true,
      }),
    ],
    lastSyncedAt: Date.now(),
    lastError: null,
  });
  const detail = await getDomainDetail('namecheap', name, true, account.id);
  expect(detail).toMatchObject({
    createdDate: new Date(registryDate),
    expirationDate: new Date('12/28/2027'),
    locked: true,
    privacy: true,
    nameservers: ['ns1.example'],
    createdDateSource: {
      kind: 'registry-rdap',
      url: 'https://registry.example/rdap/domain/' + name,
    },
  });
  expect(detail).not.toHaveProperty('autoRenew');
  expect(getMergedPortfolio().domains[0]).toMatchObject({
    createdDate: new Date(registryDate),
    autoRenew: true,
  });
  await syncRegistrar('namecheap', account.id);
  expect(getMergedPortfolio().domains[0].createdDate).toEqual(
    new Date(registryDate),
  );
  expect(getCachedDetail()[account.id + ':' + name].createdDate).toEqual(
    new Date(registryDate),
  );
  await flushWrites();
  await hydrateStores();
  expect(
    (await getDomainDetail('namecheap', name, false, account.id))?.createdDate,
  ).toEqual(new Date(registryDate));
  expect(getMergedPortfolio().domains[0].createdDateSource?.url).toBe(
    'https://registry.example/rdap/domain/' + name,
  );
  expect(registryCalls).toBe(1);
});

it('repairs an already cached partial without pretending its controls or quote were refreshed', async () => {
  const account = await createAccount('namecheap', 'Fixture', {
    username: 'fixture',
    apiKey: 'fixture',
    clientIp: '192.0.2.1',
  });
  writeEntry('portfolio', account.id, {
    domains: [
      createDomain({
        domainName: name,
        registrar: 'namecheap',
        createdDate: '12/28/2026',
        expirationDate: '12/28/2027',
      }),
    ],
    lastSyncedAt: Date.now(),
    lastError: null,
  });
  const key = account.id + ':' + name;
  const before = writeEntry('detail', key, {
    nameservers: ['cached.example'],
    renewalQuote: { renewal: 100, currency: 'USD' },
    renewalQuoteFetchedAt: 123,
  });
  vi.setSystemTime(new Date('2026-11-09T12:00:01Z'));
  const detail = await getDomainDetail('namecheap', name, false, account.id);
  expect(detail).toMatchObject({
    createdDate: new Date(registryDate),
    nameservers: ['cached.example'],
  });
  expect(readEntry('detail', key)).toMatchObject({
    fetchedAt: before.fetchedAt,
    data: {
      renewalQuote: { renewal: 100, currency: 'USD' },
      renewalQuoteFetchedAt: 123,
    },
  });
});
