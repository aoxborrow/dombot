import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { EncryptedDocStore, aesGcmCipher } from '../storage/encrypted';
import { createAccount, listAccounts, renameAccount } from './accounts';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import {
  getRegistrarClient,
  getRegistrarMetadata,
  getPortfolio,
  getCachedPortfolio,
  getDomainDetail,
  getCachedDetail,
  getPortfolioPricing,
  removeRegistrarAccount,
  resetRegistrarClients,
  resolveDomainAccount,
  saveRegistrarCredentials,
  setRegistrarEnabledCached,
  syncRegistrar,
} from './registrars';
import { writeEntry, readEntry } from './cache';
import { setRegistrarEnabled } from './registrar-state';
import { setManualPrice } from './pricing';
import { createFolder, assignFolder, getFolders } from './folders';
import { buildBundle, exportBundle, importBundle } from '../storage/bundle';
import { coreMethods, invoke } from '../api';
import { registerTools } from '../mcp/tools';
import {
  resetBulkMemory,
  setBulkAutoDrive,
  startBulk,
  stepBulk,
} from './bulk-jobs';
import { domainKey } from '../../shared/account-key';
import type { Domain, DomainTarget } from '../../shared/ipc';

const fakes = vi.hoisted(() => ({
  providers: new Map<string, Record<string, ReturnType<typeof vi.fn>>>(),
}));
vi.mock('@aoxborrow/registrar-client', async (original) => {
  const actual = await original<typeof import('@aoxborrow/registrar-client')>();
  return {
    ...actual,
    createRegistrar: vi.fn((_name: string, creds: { apiKey: string }) => {
      let provider = fakes.providers.get(creds.apiKey);
      if (!provider) {
        provider = Object.fromEntries(
          [
            'listDomains',
            'getDomain',
            'getNameservers',
            'testConnection',
            'setAutoRenew',
            'renewDomain',
            'updateNameservers',
            'setDnsRecords',
            'registerDomain',
            'transferIn',
            'getPricing',
          ].map((name) => [name, vi.fn()]),
        );
        provider.listDomains.mockResolvedValue([]);
        provider.getDomain.mockResolvedValue(null);
        provider.getNameservers.mockResolvedValue([]);
        provider.testConnection.mockResolvedValue({ success: true });
        for (const name of [
          'setAutoRenew',
          'renewDomain',
          'updateNameservers',
          'setDnsRecords',
          'registerDomain',
          'transferIn',
        ])
          provider[name].mockResolvedValue({ success: true, message: 'ok' });
        fakes.providers.set(creds.apiKey, provider);
      }
      return provider;
    }),
    RegistrarClient: class {
      constructor(provider: object) {
        Object.assign(this, provider, { provider });
      }
    },
    listPortfolio: async (
      clients: { listDomains: () => Promise<Domain[]> }[],
    ) => ({ domains: await clients[0].listDomains(), errors: [] }),
  };
});
vi.mock('../dns', () => ({ resolveNameservers: vi.fn(async () => []) }));

let disk: MemoryDocStore;
const domain = (domainName: string): Domain => ({
  domainName,
  registrar: 'dynadot',
  status: 'active',
  autoRenew: false,
  locked: true,
  privacy: true,
  nameservers: [],
  createdDate: null,
  expirationDate: new Date('2027-01-01'),
  renewalDate: null,
  syncedAt: new Date(),
  deleted: false,
});
const APP = { version: 'test', platform: 'test' };
async function twoAccounts() {
  await saveRegistrarCredentials(
    'dynadot',
    { apiKey: 'personal', apiSecret: 'test-secret' },
    'dynadot',
  );
  const company = await createAccount('dynadot', 'Company');
  await saveRegistrarCredentials(
    'dynadot',
    { apiKey: 'company', apiSecret: 'test-secret' },
    company.id,
  );
  getRegistrarClient('dynadot', 'dynadot');
  getRegistrarClient('dynadot', company.id);
  fakes.providers
    .get('personal')!
    .listDomains.mockResolvedValue([domain('personal.com')]);
  fakes.providers
    .get('company')!
    .listDomains.mockResolvedValue([domain('company.com')]);
  await getPortfolio();
  return company;
}
const tools = new Map<
  string,
  {
    schema: z.ZodRawShape;
    handler: (args: unknown) => Promise<{ content: { text: string }[] }>;
  }
>();
registerTools({
  registerTool: (
    name: string,
    config: { inputSchema: z.ZodRawShape },
    handler: (args: unknown) => Promise<{ content: { text: string }[] }>,
  ) => tools.set(name, { schema: config.inputSchema, handler }),
} as unknown as McpServer);
async function mcp(name: string, args: unknown) {
  const tool = tools.get(name)!;
  return JSON.parse(
    (await tool.handler(z.object(tool.schema).parse(args))).content[0].text,
  );
}

beforeEach(async () => {
  await flushWrites();
  disk = new MemoryDocStore();
  configureStore(disk);
  await hydrateStores();
  resetRegistrarClients();
  resetBulkMemory();
  setBulkAutoDrive(false);
  fakes.providers.clear();
});

describe('multi-account storage, routing and portable migration', () => {
  it('adopts legacy IDs in place, preserving encrypted keys, disabled state, caches and annotations', async () => {
    await setStoredCredentials('dynadot', {
      apiKey: 'legacy',
      apiSecret: 'test-secret',
    });
    writeEntry('portfolio', 'dynadot', {
      domains: [domain('legacy.com')],
      lastSyncedAt: 123,
      lastError: null,
    });
    writeEntry('detail', 'dynadot:legacy.com', {
      nameservers: ['ns.legacy.com'],
    });
    setManualPrice('dynadot', 'legacy.com', 17);
    const folder = createFolder({
      name: 'Keep',
      color: 'green',
      description: '',
    });
    assignFolder('dynadot:legacy.com', folder.id);
    await flushWrites();
    await hydrateStores();
    expect(getCachedPortfolio()!.domains[0]).toMatchObject({
      accountId: 'dynadot',
      accountLabel: 'Default',
    });
    expect(getPortfolioPricing()['dynadot:legacy.com'].renewal).toBe(17);
    expect(getFolders().assignments['dynadot:legacy.com']).toBe(folder.id);
    setRegistrarEnabled('dynadot', false);
    await flushWrites();
    await hydrateStores();
    expect(
      getRegistrarMetadata().find((a) => a.accountId === 'dynadot'),
    ).toMatchObject({
      enabled: false,
      configured: true,
      sync: { lastSyncedAt: 123 },
    });
    expect(getCachedPortfolio()).toBeNull();
    expect(getStoredCredentials('dynadot')).toEqual({
      apiKey: 'legacy',
      apiSecret: 'test-secret',
    });
  });

  it('saves, tests, syncs and restores two independent clients after restart', async () => {
    const company = await twoAccounts();
    for (const id of ['dynadot', company.id])
      expect(
        await invoke('testRegistrarAccount', coreMethods.testRegistrarAccount, [
          'dynadot',
          id,
        ]),
      ).toMatchObject({ success: true });
    expect(getRegistrarClient('dynadot', company.id)).not.toBe(
      getRegistrarClient('dynadot', 'dynadot'),
    );
    await flushWrites();
    configureStore(disk);
    await hydrateStores();
    resetRegistrarClients();
    expect(getCachedPortfolio()!.domains.map((d) => d.accountId)).toEqual([
      'dynadot',
      company.id,
    ]);
    expect(getStoredCredentials(company.id)).toEqual({
      apiKey: 'company',
      apiSecret: 'test-secret',
    });
  });

  it('renames without changing credentials, client, cache, or domain identity', async () => {
    const company = await twoAccounts();
    const client = getRegistrarClient('dynadot', company.id);
    const prior = readEntry('portfolio', company.id);
    await renameAccount(company.id, 'Business');
    expect(getRegistrarClient('dynadot', company.id)).toBe(client);
    expect(readEntry('portfolio', company.id)).toEqual(prior);
    expect(getCachedPortfolio()!.domains[1]).toMatchObject({
      accountId: company.id,
      accountLabel: 'Business',
    });
  });

  it('failed sync keeps both last-good slices and scopes its error', async () => {
    const company = await twoAccounts();
    const prior = readEntry('portfolio', 'dynadot');
    fakes.providers
      .get('company')!
      .listDomains.mockRejectedValue(new Error('company offline'));
    const portfolio = await syncRegistrar('dynadot', company.id);
    expect(portfolio.domains).toHaveLength(2);
    expect(portfolio.errors).toEqual([
      {
        registrar: 'dynadot',
        accountId: company.id,
        accountLabel: 'Company',
        message: 'company offline',
      },
    ]);
    expect(readEntry('portfolio', 'dynadot')).toEqual(prior);
  });

  it('updating, disabling and removing one account preserves the sibling', async () => {
    const company = await twoAccounts();
    const prior = readEntry('portfolio', 'dynadot');
    await setRegistrarEnabledCached('dynadot', false, company.id);
    expect(getCachedPortfolio()!.domains).toHaveLength(1);
    expect(readEntry('portfolio', company.id)).not.toBeNull();
    await saveRegistrarCredentials(
      'dynadot',
      { apiKey: 'replacement', apiSecret: 'test-secret' },
      company.id,
    );
    await removeRegistrarAccount(company.id);
    await flushWrites();
    await hydrateStores();
    expect(getStoredCredentials(company.id)).toEqual({});
    expect(getStoredCredentials('dynadot')).toEqual({
      apiKey: 'personal',
      apiSecret: 'test-secret',
    });
    expect(readEntry('portfolio', 'dynadot')).toEqual(prior);
    expect(() => getRegistrarClient('dynadot', company.id)).toThrow(
      /Unknown account/,
    );
    await removeRegistrarAccount('dynadot');
    expect(listAccounts().some((a) => a.id === 'dynadot')).toBe(false);
    expect((await createAccount('dynadot', 'New')).id).not.toBe('dynadot');
  });

  it.each(['disable', 'remove', 'replace'] as const)(
    'in-flight sync cannot resurrect data after %s',
    async (action) => {
      const company = await twoAccounts();
      let finish!: (domains: Domain[]) => void;
      fakes.providers.get('company')!.listDomains.mockImplementation(
        () =>
          new Promise<Domain[]>((r) => {
            finish = r;
          }),
      );
      const syncing = syncRegistrar('dynadot', company.id);
      if (action === 'disable')
        await setRegistrarEnabledCached('dynadot', false, company.id);
      if (action === 'remove') await removeRegistrarAccount(company.id);
      if (action === 'replace')
        await saveRegistrarCredentials(
          'dynadot',
          { apiKey: 'new', apiSecret: 'test-secret' },
          company.id,
        );
      finish([domain('stale.com')]);
      await syncing;
      expect(getCachedPortfolio()!.domains.map((d) => d.domainName)).toEqual([
        'personal.com',
      ]);
    },
  );

  it('rejects unknown, wrong-provider, wrong-owner, disabled and ambiguous selections before mutations', async () => {
    const company = await twoAccounts();
    for (const target of [
      {
        registrar: 'dynadot',
        domainName: 'personal.com',
        accountId: company.id,
      },
      {
        registrar: 'porkbun',
        domainName: 'company.com',
        accountId: company.id,
      },
      { registrar: 'dynadot', domainName: 'company.com', accountId: 'missing' },
      { registrar: 'dynadot', domainName: 'uncached.com' },
    ]) {
      const result = await invoke('applyDomainOp', coreMethods.applyDomainOp, [
        target,
        { kind: 'renew', years: 1 },
      ]);
      expect(result.status).toBe('failed');
    }
    fakes.providers
      .get('personal')!
      .listDomains.mockResolvedValue([domain('shared.com')]);
    fakes.providers
      .get('company')!
      .listDomains.mockResolvedValue([domain('shared.com')]);
    await getPortfolio();
    expect(() => resolveDomainAccount('dynadot', 'shared.com')).toThrow(
      /Multiple accounts/,
    );
    await setRegistrarEnabledCached('dynadot', false, company.id);
    expect(() =>
      resolveDomainAccount('dynadot', 'shared.com', company.id),
    ).toThrow(/disabled/);
    for (const fake of fakes.providers.values())
      expect(fake.renewDomain).not.toHaveBeenCalled();
  });

  it('routes UI renewals, detail, manual prices, and persisted bulk work to the selected account', async () => {
    const company = await twoAccounts();
    fakes.providers.get('company')!.getDomain.mockResolvedValue({
      ...domain('company.com'),
      expirationDate: new Date('2028-01-01'),
    });
    const target: DomainTarget = {
      registrar: 'dynadot',
      domainName: 'company.com',
      accountId: company.id,
    };
    const renewed = await invoke('applyDomainOp', coreMethods.applyDomainOp, [
      target,
      { kind: 'renew', years: 2 },
    ]);
    expect(renewed).toMatchObject({ status: 'ok', target });
    expect(fakes.providers.get('company')!.renewDomain).toHaveBeenCalledWith(
      'company.com',
      2,
      expect.objectContaining({ retries: 0 }),
    );
    expect(fakes.providers.get('personal')!.renewDomain).not.toHaveBeenCalled();
    expect(
      await getDomainDetail('dynadot', 'company.com', false, company.id),
    ).toMatchObject({ expirationDate: new Date('2028-01-01') });
    expect(getCachedDetail()[domainKey(target)]).toBeDefined();
    await invoke('setManualPrice', coreMethods.setManualPrice, [
      'dynadot',
      'company.com',
      19,
      company.id,
    ]);
    expect(getPortfolioPricing()[domainKey(target)].renewal).toBe(19);
    const job = startBulk([target], {
      kind: 'nameservers',
      nameservers: ['ns.company.com'],
    });
    await flushWrites();
    resetBulkMemory();
    await hydrateStores();
    expect((await stepBulk(job.id)).job.results[0]).toMatchObject({
      target,
      status: 'ok',
    });
    expect(
      fakes.providers.get('company')!.updateNameservers,
    ).toHaveBeenCalledWith(
      'company.com',
      ['ns.company.com'],
      expect.anything(),
    );
    expect(
      fakes.providers.get('personal')!.updateNameservers,
    ).not.toHaveBeenCalled();
  });

  it('MCP infers unique owners, exposes accounts, filters, and refuses ambiguous registration/transfer/DNS', async () => {
    const company = await twoAccounts();
    expect((await mcp('registrar_list', {})).accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: company.id, label: 'Company' }),
      ]),
    );
    expect(
      (await mcp('portfolio_query', { accountId: company.id })).rows,
    ).toMatchObject([{ domainName: 'company.com', accountId: company.id }]);
    await mcp('domain_dns_set', { domain: 'company.com', records: [] });
    expect(fakes.providers.get('company')!.setDnsRecords).toHaveBeenCalledTimes(
      1,
    );
    await expect(
      mcp('domain_dns_set', {
        registrar: 'dynadot',
        domain: 'company.com',
        accountId: 'dynadot',
        records: [],
      }),
    ).rejects.toThrow(/different account/);
    await expect(
      mcp('registrar_transfer_domain', {
        registrar: 'dynadot',
        domain: 'new.com',
        input: { authCode: 'test' },
      }),
    ).rejects.toThrow(/Multiple accounts/);
    const input = {
      contacts: {
        registrant: {
          firstName: 'Test',
          lastName: 'Test',
          email: 'test@example.com',
          phone: '+1.5551234567',
          address1: 'Test',
          city: 'Test',
          postalCode: '12345',
          country: 'US',
        },
      },
    };
    await expect(
      mcp('registrar_register_domain', {
        registrar: 'dynadot',
        domain: 'new.com',
        input,
      }),
    ).rejects.toThrow(/Multiple accounts/);
    await mcp('registrar_register_domain', {
      registrar: 'dynadot',
      accountId: company.id,
      domain: 'new.com',
      input,
    });
    expect(
      fakes.providers.get('company')!.registerDomain,
    ).toHaveBeenCalledOnce();
    expect(
      fakes.providers.get('personal')!.registerDomain,
    ).not.toHaveBeenCalled();
    await mcp('registrar_transfer_domain', {
      registrar: 'dynadot',
      accountId: company.id,
      domain: 'new.com',
      input: { authCode: 'test' },
    });
    expect(fakes.providers.get('company')!.transferIn).toHaveBeenCalledOnce();
  });

  it('retains unambiguous single-account MCP calls', async () => {
    await saveRegistrarCredentials('dynadot', {
      apiKey: 'personal',
      apiSecret: 'test-secret',
    });
    expect(await mcp('registrar_test', { registrar: 'dynadot' })).toMatchObject(
      { success: true },
    );
    expect(
      await mcp('domain_set_autorenew', {
        registrar: 'dynadot',
        domain: 'uncached.com',
        enabled: true,
      }),
    ).toMatchObject({ success: true, accountId: 'dynadot' });
  });

  it('round trips v2 desktop/web encrypted storage and imports legacy v1 without re-entering credentials', async () => {
    const company = await twoAccounts();
    const text = exportBundle({ ...APP, platform: 'darwin' });
    expect(JSON.parse(text).version).toBe(2);
    const raw = new MemoryDocStore();
    const key = crypto.getRandomValues(new Uint8Array(32));
    configureStore(new EncryptedDocStore(raw, await aesGcmCipher(key)));
    await hydrateStores();
    await importBundle(text);
    await flushWrites();
    expect(JSON.stringify(await raw.list('credentials'))).not.toContain(
      'personal',
    );
    expect(await raw.get('credentials', company.id)).toMatchObject({
      __sealed: 1,
    });
    await hydrateStores();
    expect(getCachedPortfolio()!.domains).toHaveLength(2);
    const webBundle = exportBundle({ ...APP, platform: 'web' });
    configureStore(
      new EncryptedDocStore(
        new MemoryDocStore(),
        await aesGcmCipher(key),
        new Set(['credentials']),
      ),
    );
    await hydrateStores();
    await importBundle(webBundle);
    await flushWrites();
    await hydrateStores();
    expect(getStoredCredentials(company.id)).toEqual({
      apiKey: 'company',
      apiSecret: 'test-secret',
    });
    const legacy = buildBundle(APP);
    legacy.version = 1;
    delete legacy.namespaces['registrar-accounts'];
    delete legacy.namespaces.credentials[company.id];
    delete legacy.namespaces['cache-portfolio'][company.id];
    await importBundle(JSON.stringify(legacy));
    await flushWrites();
    expect(getCachedPortfolio()!.domains).toHaveLength(1);
    expect(
      getRegistrarMetadata().find((a) => a.accountId === 'dynadot'),
    ).toMatchObject({ configured: true, accountLabel: 'Default' });
  });

  it('keeps detail and prices separate for duplicate domain names across accounts', async () => {
    const company = await twoAccounts();
    for (const key of ['personal', 'company']) {
      fakes.providers
        .get(key)!
        .listDomains.mockResolvedValue([domain('shared.com')]);
      fakes.providers.get(key)!.getDomain.mockResolvedValue({
        ...domain('shared.com'),
        nameservers: [`ns.${key}.com`],
      });
    }
    await getPortfolio();
    await getDomainDetail('dynadot', 'shared.com', true, 'dynadot');
    await getDomainDetail('dynadot', 'shared.com', true, company.id);
    setManualPrice('dynadot', 'shared.com', 10, 'dynadot');
    setManualPrice('dynadot', 'shared.com', 20, company.id);
    expect(getCachedDetail()['dynadot:shared.com'].nameservers).toEqual([
      'ns.personal.com',
    ]);
    expect(getCachedDetail()[`${company.id}:shared.com`].nameservers).toEqual([
      'ns.company.com',
    ]);
    expect(getPortfolioPricing()['dynadot:shared.com'].renewal).toBe(10);
    expect(getPortfolioPricing()[`${company.id}:shared.com`].renewal).toBe(20);
  });

  it('rejects corrupt account routing metadata before import changes credentials', async () => {
    await twoAccounts();
    const bundle = buildBundle(APP);
    bundle.namespaces['registrar-accounts'].dynadot = {
      id: 'dynadot',
      registrar: 'porkbun',
      label: 'Wrong provider',
    };
    await expect(importBundle(JSON.stringify(bundle))).rejects.toThrow(
      /Invalid account metadata/,
    );
    expect(getStoredCredentials('dynadot').apiKey).toBe('personal');
  });

  it('a failed encryption write cannot leave new credentials usable in memory', async () => {
    const raw = new MemoryDocStore();
    configureStore(
      new EncryptedDocStore(
        raw,
        {
          alg: 'unavailable',
          seal: async () => {
            throw new Error('keyring unavailable');
          },
          open: async () => '',
        },
        new Set(['credentials']),
      ),
    );
    await hydrateStores();
    await expect(
      saveRegistrarCredentials('dynadot', {
        apiKey: 'unsaved',
        apiSecret: 'synthetic',
      }),
    ).rejects.toThrow(/keyring unavailable/);
    expect(getStoredCredentials('dynadot')).toEqual({});
    expect(await raw.get('credentials', 'dynadot')).toBeNull();
    await expect(flushWrites()).rejects.toThrow(/keyring unavailable/);
  });

  it('an older sync cannot overwrite a newer successful sync for the same account', async () => {
    const company = await twoAccounts();
    let finish!: (rows: Domain[]) => void;
    fakes.providers.get('company')!.listDomains.mockImplementationOnce(
      () =>
        new Promise<Domain[]>((r) => {
          finish = r;
        }),
    );
    const oldSync = syncRegistrar('dynadot', company.id);
    fakes.providers
      .get('company')!
      .listDomains.mockResolvedValue([domain('new.com')]);
    await syncRegistrar('dynadot', company.id);
    finish([domain('old.com')]);
    await oldSync;
    expect(getCachedPortfolio()!.domains.map((d) => d.domainName)).toEqual([
      'personal.com',
      'new.com',
    ]);
  });

  it('never reroutes an old queued job to a newly-added account after the default is removed', async () => {
    const company = await twoAccounts();
    const job = startBulk(
      [{ registrar: 'dynadot', domainName: 'personal.com' }],
      { kind: 'renew', years: 1 },
    );
    await flushWrites();
    const stored = (await disk.get('bulk-jobs', 'job')) as Record<
      string,
      unknown
    >;
    stored.pending = [{ registrar: 'dynadot', domainName: 'personal.com' }];
    await disk.put('bulk-jobs', 'job', stored);
    await removeRegistrarAccount('dynadot');
    fakes.providers
      .get('company')!
      .listDomains.mockResolvedValue([domain('personal.com')]);
    await syncRegistrar('dynadot', company.id);
    await flushWrites();
    resetBulkMemory();
    await hydrateStores();
    const completed = await stepBulk(job.id);
    expect(completed.job.results[0]).toMatchObject({
      status: 'failed',
      target: { accountId: 'dynadot' },
    });
    expect(fakes.providers.get('company')!.renewDomain).not.toHaveBeenCalled();
  });

  it('rebuilds cached clients when another host changes persisted credentials', async () => {
    await saveRegistrarCredentials('dynadot', {
      apiKey: 'old',
      apiSecret: 'test-secret',
    });
    const old = getRegistrarClient('dynadot');
    await disk.put('credentials', 'dynadot', {
      apiKey: 'new',
      apiSecret: 'test-secret',
    });
    await hydrateStores();
    expect(getRegistrarClient('dynadot')).not.toBe(old);
  });
});

// Manual renderer QA against the real shared API and synthetic providers only.
// npm run web:build && DOMBOT_ACCOUNT_QA=1 npx vitest run src/core/services/accounts.test.ts -t 'browser QA server'
it.skipIf(!process.env.DOMBOT_ACCOUNT_QA)(
  'browser QA server',
  async () => {
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');
    const { resolve, extname } = await import('node:path');
    const root = resolve('dist/web');
    const server = createServer(async (req, res) => {
      try {
        if (req.url === '/auth/status') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ mode: 'external', authenticated: true }));
          return;
        }
        if (req.url?.startsWith('/api/')) {
          const method = req.url.slice(5) as keyof typeof coreMethods;
          const parts: Buffer[] = [];
          for await (const part of req) parts.push(part);
          const { args = [] } = JSON.parse(Buffer.concat(parts).toString());
          let result: unknown;
          if (method in coreMethods) {
            if (method === 'syncRegistrar' || method === 'listPortfolio') {
              for (const a of listAccounts()) {
                const creds = getStoredCredentials(a.id);
                if (creds.apiKey) {
                  getRegistrarClient(a.registrar, a.id);
                  fakes.providers
                    .get(creds.apiKey)!
                    .listDomains.mockResolvedValue([
                      domain(`${creds.apiKey}.example.com`),
                    ]);
                }
              }
            }
            result = await invoke(method, coreMethods[method], args);
            await flushWrites();
          } else if (req.url === '/api/getAppInfo')
            result = { name: 'Dombot QA', version: 'test', platform: 'web' };
          else if (req.url === '/api/getMcpInfo')
            result = {
              running: false,
              url: '',
              stdioCommand: '',
              stdioArgs: [],
            };
          else throw new Error(`Unknown method ${method}`);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ result }));
          return;
        }
        const path = resolve(
          root,
          '.' + (req.url === '/' ? '/index.html' : req.url!.split('?')[0]),
        );
        if (!path.startsWith(root + '/')) throw new Error('Invalid path');
        const contents = await readFile(path);
        res.setHeader(
          'Content-Type',
          (
            {
              '.html': 'text/html',
              '.js': 'text/javascript',
              '.css': 'text/css',
              '.svg': 'image/svg+xml',
            } as Record<string, string>
          )[extname(path)] ?? 'application/octet-stream',
        );
        res.end(contents);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    await new Promise<void>((r) => server.listen(4173, '127.0.0.1', r));
    console.log('Synthetic account QA: http://127.0.0.1:4173');
    try {
      await new Promise((r) => setTimeout(r, 600_000));
    } finally {
      server.close();
    }
  },
  610_000,
);
