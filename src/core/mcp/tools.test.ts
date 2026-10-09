import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DomainEvent } from '../../shared/domain-events';
import type { ImportedDomain } from '../../shared/ipc';

// ── Mock every service the tool handlers reach ───────────────────────────────
// registrarNames must be a real non-empty array: tools.ts builds z.enum() from
// it at module load. Everything else is a vi.fn scripted per test.

const findRegistrarsForDomain = vi.fn<(d: string) => string[]>();
const getConfiguredRegistrars = vi.fn(() => ['dynadot']);
const getActiveRegistrars = vi.fn(() => ['dynadot']);
const setDnsRecords = vi.fn();
const getDomain = vi.fn();
const getRegistrarClient = vi.fn((name: string) => {
  void name;
  return { setDnsRecords, getDomain };
});
const registerDomainCached = vi.fn();
const getDomainDetail = vi.fn();
const getMergedPortfolio = vi.fn();
const getPortfolioPricing = vi.fn(() => ({}));
const setRegistrarEnabledCached = vi.fn();

const getImportedDomains = vi.fn<() => Record<string, ImportedDomain>>(
  () => ({}),
);
vi.mock('../services/imported-domains', () => ({
  getImportedDomains: () => getImportedDomains(),
}));
const getPurchases = vi.fn(() => ({}));
const setNotes = vi.fn();
vi.mock('../services/purchases', () => ({
  getPurchases: () => getPurchases(),
  setNotes: (...a: unknown[]) => setNotes(...a),
}));
const getListPrices = vi.fn<() => Record<string, unknown>>(() => ({}));
const setListPrices = vi.fn();
vi.mock('../services/list-prices', () => ({
  getListPrices: () => getListPrices(),
  setListPrices: (...a: unknown[]) => setListPrices(...a),
}));
const getManualPrices = vi.fn<() => Record<string, unknown>>(() => ({}));
const setManualPrice = vi.fn();
vi.mock('../services/pricing', () => ({
  getManualPrices: () => getManualPrices(),
  setManualPrice: (...a: unknown[]) => setManualPrice(...a),
}));
const restoreOwned = vi.fn();
const setDispositions = vi.fn();
vi.mock('../services/domain-history', () => ({
  restoreOwned: (...a: unknown[]) => restoreOwned(...a),
  setDispositions: (...a: unknown[]) => setDispositions(...a),
}));

vi.mock('../services/registrars', () => ({
  resolveAccount: (registrar: string, id?: string) => ({
    registrar,
    id: id ?? registrar,
    label: 'Default',
  }),
  resolveDomainAccount: (registrar: string, _domain: string, id?: string) => ({
    registrar,
    id: id ?? registrar,
    label: 'Default',
  }),
  registrarNames: ['dynadot', 'porkbun', 'godaddy'] as const,
  findRegistrarsForDomain: (d: string) => findRegistrarsForDomain(d),
  getConfiguredRegistrars: () => getConfiguredRegistrars(),
  getActiveRegistrars: () => getActiveRegistrars(),
  getRegistrarClient: (n: string) => getRegistrarClient(n),
  registerDomainCached: (...a: unknown[]) => registerDomainCached(...a),
  getDomainDetail: (...a: unknown[]) => getDomainDetail(...a),
  getMergedPortfolio: () => getMergedPortfolio(),
  getPortfolio: vi.fn(),
  getPortfolioPricing: () => getPortfolioPricing(),
  setRegistrarEnabledCached: (...a: unknown[]) =>
    setRegistrarEnabledCached(...a),
  getRegistrarMetadata: vi.fn(() => []),
  getRenewalPriceLive: vi.fn(),
  syncRegistrar: vi.fn(),
}));

const applyDomainOp = vi.fn();
vi.mock('../services/domain-ops', () => ({
  applyDomainOp: (...a: unknown[]) => applyDomainOp(...a),
}));

type FolderStub = {
  id: string;
  name: string;
  description: string;
  color: string;
};
const getFolders = vi.fn<
  () => { folders: FolderStub[]; assignments: Record<string, string> }
>(() => ({ folders: [], assignments: {} }));
const createFolder = vi.fn((input: Omit<FolderStub, 'id'>) => ({
  id: 'new-id',
  ...input,
}));
const updateFolder = vi.fn();
const deleteFolder = vi.fn();
const assignFolder = vi.fn();
vi.mock('../services/folders', () => ({
  getFolders: () => getFolders(),
  createFolder: (i: Omit<FolderStub, 'id'>) => createFolder(i),
  updateFolder: (...a: unknown[]) => updateFolder(...a),
  deleteFolder: (...a: unknown[]) => deleteFolder(...a),
  assignFolder: (...a: unknown[]) => assignFolder(...a),
}));

const listEvents = vi.fn<() => DomainEvent[]>(() => []);
vi.mock('../services/domain-events', () => ({
  listEvents: () => listEvents(),
  eventsFor: (d: string) => listEvents().filter((e) => e.domain === d),
}));

const broadcastPortfolioChanged = vi.fn();
vi.mock('../events', () => ({
  broadcastPortfolioChanged: () => broadcastPortfolioChanged(),
}));

import { registerTools } from './tools';

// A fake MCP server that just records what registerTools wires up, so each
// handler can be invoked directly with parsed args.
type Tool = {
  config: { inputSchema: z.ZodRawShape };
  handler: (args: unknown) => Promise<{ content: { text: string }[] }>;
};
const tools = new Map<string, Tool>();
const fakeServer = {
  registerTool: (
    name: string,
    config: Tool['config'],
    handler: Tool['handler'],
  ) => {
    tools.set(name, { config, handler });
  },
} as unknown as McpServer;

registerTools(fakeServer);

// Invoke a tool's handler and parse its single JSON text block back to a value.
async function call(name: string, args: unknown = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  const res = await tool.handler(args);
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

const schema = (name: string) => z.object(tools.get(name)!.config.inputSchema);

beforeEach(() => {
  vi.clearAllMocks();
  getRegistrarClient.mockReturnValue({ setDnsRecords, getDomain });
  getConfiguredRegistrars.mockReturnValue(['dynadot']);
  getActiveRegistrars.mockReturnValue(['dynadot']);
  getFolders.mockReturnValue({ folders: [], assignments: {} });
  listEvents.mockReturnValue([]);
  getImportedDomains.mockReturnValue({});
  getPurchases.mockReturnValue({});
  getListPrices.mockReturnValue({});
  getManualPrices.mockReturnValue({});
  getPortfolioPricing.mockReturnValue({});
});

/** A sync or user event for one name. */
let eventSeq = 0;
const event = (patch: Partial<DomainEvent>): DomainEvent => ({
  id: `E${String(++eventSeq).padStart(4, '0')}`,
  domain: 'a.com',
  type: 'added',
  source: 'sync',
  date: '2026-09-25',
  createdAt: eventSeq,
  updatedAt: null,
  accountId: 'dynadot',
  ...patch,
});

describe('json() payload shape', () => {
  it('wraps a result in a single pretty-printed text block', async () => {
    const tool = tools.get('registrar_list')!;
    const res = await tool.handler({});
    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse(res.content[0].text)).toEqual({
      accounts: [],
      all: ['dynadot', 'porkbun', 'godaddy'],
      configured: ['dynadot'],
      active: ['dynadot'],
    });
  });
});

describe('resolveRegistrar (via domain_set_autorenew)', () => {
  beforeEach(() =>
    applyDomainOp.mockResolvedValue({ status: 'ok', message: 'done' }),
  );

  it('says a name in Archive has no registrar to act on, not to sync', async () => {
    findRegistrarsForDomain.mockReturnValue([]);
    listEvents.mockReturnValue([
      event({ domain: 'gone.com' }),
      event({ domain: 'gone.com', type: 'removed' }),
      event({ domain: 'gone.com', type: 'dropped', source: 'user' }),
    ]);
    await expect(
      call('domain_set_autorenew', { domain: 'gone.com', enabled: true }),
    ).rejects.toThrow(/is in Archive \(dropped\)/);
    expect(applyDomainOp).not.toHaveBeenCalled();
  });

  it('says an imported name has no registrar to act on', async () => {
    findRegistrarsForDomain.mockReturnValue([]);
    getImportedDomains.mockReturnValue({
      'mine.com': { registrar: null, addedAt: 1, updatedAt: null },
    });
    await expect(
      call('domain_set_autorenew', { domain: 'Mine.com', enabled: true }),
    ).rejects.toThrow(/is an imported domain/);
    expect(applyDomainOp).not.toHaveBeenCalled();
  });

  it('uses an explicit registrar without a cache lookup', async () => {
    await call('domain_set_autorenew', {
      registrar: 'dynadot',
      domain: 'example.com',
      enabled: true,
    });
    expect(findRegistrarsForDomain).not.toHaveBeenCalled();
    expect(applyDomainOp).toHaveBeenCalledWith(
      { registrar: 'dynadot', accountId: 'dynadot', domainName: 'example.com' },
      { kind: 'autoRenew', enabled: true },
    );
  });

  it('resolves the registrar from the cache when omitted', async () => {
    findRegistrarsForDomain.mockReturnValue(['porkbun']);
    await call('domain_set_autorenew', {
      domain: 'example.com',
      enabled: false,
    });
    expect(applyDomainOp).toHaveBeenCalledWith(
      { registrar: 'porkbun', accountId: 'porkbun', domainName: 'example.com' },
      { kind: 'autoRenew', enabled: false },
    );
  });

  it('throws a guiding error when the domain is not in the cache', async () => {
    findRegistrarsForDomain.mockReturnValue([]);
    await expect(
      call('domain_set_autorenew', { domain: 'ghost.com', enabled: true }),
    ).rejects.toThrow(/isn.t in the cached portfolio/i);
    expect(applyDomainOp).not.toHaveBeenCalled();
  });

  it('throws a disambiguation error when the cache lists it twice', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot', 'porkbun']);
    await expect(
      call('domain_set_autorenew', { domain: 'dup.com', enabled: true }),
    ).rejects.toThrow(/multiple registrars.*dynadot, porkbun/i);
  });
});

describe('domainOp() result mapping', () => {
  beforeEach(() => findRegistrarsForDomain.mockReturnValue(['dynadot']));

  it('maps status ok to success:true and preserves status + message', async () => {
    applyDomainOp.mockResolvedValue({
      status: 'ok',
      message: 'Auto-renew enabled',
    });
    const out = await call('domain_set_autorenew', {
      domain: 'a.com',
      enabled: true,
    });
    expect(out).toEqual({
      registrar: 'dynadot',
      accountId: 'dynadot',
      success: true,
      status: 'ok',
      message: 'Auto-renew enabled',
    });
  });

  it('maps a non-ok status to success:false', async () => {
    applyDomainOp.mockResolvedValue({ status: 'failed', message: 'rejected' });
    const out = await call('domain_set_autorenew', {
      domain: 'a.com',
      enabled: true,
    });
    expect(out).toEqual({
      registrar: 'dynadot',
      accountId: 'dynadot',
      success: false,
      status: 'failed',
      message: 'rejected',
    });
  });

  it('unsupported maps to success:false too', async () => {
    applyDomainOp.mockResolvedValue({
      status: 'unsupported',
      message: 'no api',
    });
    const out = await call('domain_set_autorenew', {
      domain: 'a.com',
      enabled: true,
    });
    expect(out.success).toBe(false);
    expect(out.status).toBe('unsupported');
  });
});

describe('cachedWrite() (via domain_dns_set)', () => {
  beforeEach(() => findRegistrarsForDomain.mockReturnValue(['dynadot']));

  it('broadcasts on success and returns the raw OperationResult', async () => {
    setDnsRecords.mockResolvedValue({
      success: true,
      message: 'Records written',
    });
    const out = await call('domain_dns_set', { domain: 'a.com', records: [] });
    expect(out).toEqual({ success: true, message: 'Records written' });
    expect(broadcastPortfolioChanged).toHaveBeenCalledTimes(1);
  });

  it('does not broadcast on failure', async () => {
    setDnsRecords.mockResolvedValue({ success: false, message: 'nope' });
    const out = await call('domain_dns_set', { domain: 'a.com', records: [] });
    expect(out).toEqual({ success: false, message: 'nope' });
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });
});

describe('input schemas', () => {
  it('registerInput requires a registrant contact', () => {
    const s = schema('registrar_register_domain');
    const contacts = { admin: fullContact() }; // no registrant
    expect(
      s.safeParse({
        registrar: 'dynadot',
        domain: 'a.com',
        input: { contacts },
      }).success,
    ).toBe(false);
    expect(
      s.safeParse({
        registrar: 'dynadot',
        domain: 'a.com',
        input: { contacts: { registrant: fullContact() } },
      }).success,
    ).toBe(true);
  });

  it('transferInput requires an authCode', () => {
    const s = schema('registrar_transfer_domain');
    expect(
      s.safeParse({ registrar: 'dynadot', domain: 'a.com', input: {} }).success,
    ).toBe(false);
    expect(
      s.safeParse({
        registrar: 'dynadot',
        domain: 'a.com',
        input: { authCode: 'EPP-1' },
      }).success,
    ).toBe(true);
  });

  it('domainForward rejects the read-only "masked" type', () => {
    const s = schema('domain_url_forwarding_set');
    const base = { domain: 'a.com' };
    expect(
      s.safeParse({
        ...base,
        forwards: [{ host: '@', url: 'https://x', type: 'masked' }],
      }).success,
    ).toBe(false);
    expect(
      s.safeParse({
        ...base,
        forwards: [{ host: '@', url: 'https://x', type: 'permanent' }],
      }).success,
    ).toBe(true);
  });

  it('registrar enum rejects an unknown registrar', () => {
    const s = schema('domain_set_autorenew');
    expect(
      s.safeParse({ registrar: 'wat', domain: 'a.com', enabled: true }).success,
    ).toBe(false);
    // optional — omitting it is fine (resolved from cache at run time).
    expect(s.safeParse({ domain: 'a.com', enabled: true }).success).toBe(true);
  });
});

describe('end-to-end handlers', () => {
  it('portfolio_query runs the query over the merged portfolio + folders', async () => {
    getMergedPortfolio.mockReturnValue({
      domains: [
        {
          registrar: 'dynadot',
          domainName: 'a.com',
          status: 'active',
          createdDate: null,
          expirationDate: null,
          renewalDate: null,
          autoRenew: false,
          locked: false,
          privacy: false,
          nameservers: [],
          syncedAt: new Date(0),
          deleted: false,
        },
      ],
      fetchedAt: 1000,
      registrars: ['dynadot'],
      errors: [],
    });
    getFolders.mockReturnValue({ folders: [], assignments: {} });

    const out = await call('portfolio_query', {});
    expect(out.total).toBe(1);
    expect((out.rows as { domainName: string }[])[0].domainName).toBe('a.com');
    expect(out.registrars).toEqual(['dynadot']);
  });

  it('portfolio_query adds imported names no account reports', async () => {
    getMergedPortfolio.mockReturnValue({
      domains: [
        {
          registrar: 'dynadot',
          domainName: 'a.com',
          status: 'active',
          createdDate: null,
          expirationDate: null,
          renewalDate: null,
          autoRenew: false,
          locked: false,
          privacy: false,
          nameservers: [],
          syncedAt: new Date(0),
          deleted: false,
          source: 'registrar',
        },
      ],
      fetchedAt: 1000,
      registrars: ['dynadot'],
      errors: [],
    });
    getImportedDomains.mockReturnValue({
      // Synced since: the registrar's row wins.
      'a.com': { registrar: null, addedAt: 1, updatedAt: null },
      'b.com': { registrar: null, addedAt: 1, updatedAt: null },
    });
    getPurchases.mockReturnValue({
      'b.com': {
        purchaseDate: null,
        amount: null,
        currency: null,
        notes: 'hi',
      },
    });

    const out = await call('portfolio_query', { sort: 'domainName' });
    expect(
      (out.rows as { domainName: string; source: string; notes: string }[]).map(
        (r) => [r.domainName, r.source, r.notes],
      ),
    ).toEqual([
      ['a.com', 'registrar', null],
      ['b.com', 'imported', 'hi'],
    ]);
  });

  it('portfolio_query reads Owned / Archive from the event log', async () => {
    const live = (domainName: string) => ({
      registrar: 'dynadot',
      domainName,
      status: 'active',
      createdDate: null,
      expirationDate: null,
      renewalDate: null,
      autoRenew: true,
      locked: false,
      privacy: false,
      nameservers: [],
      syncedAt: new Date(0),
      deleted: false,
    });
    getMergedPortfolio.mockReturnValue({
      domains: [live('kept.com'), live('escrow.com')],
      fetchedAt: 1000,
      registrars: ['dynadot'],
      errors: [],
    });
    listEvents.mockReturnValue([
      event({ domain: 'escrow.com' }),
      event({ domain: 'escrow.com', type: 'sold', source: 'user' }),
      event({ domain: 'gone.com' }),
      event({ domain: 'gone.com', type: 'removed' }),
    ]);
    type Row = Record<string, unknown>;
    const rows = async (args: object) =>
      ((await call('portfolio_query', args)).rows as Row[]).map((r) => ({
        domainName: r.domainName,
        ownership: r.ownership,
        archiveLabel: r.archiveLabel,
        inAccount: r.inAccount,
      }));

    expect(await rows({})).toEqual([
      {
        domainName: 'kept.com',
        ownership: 'owned',
        archiveLabel: null,
        inAccount: true,
      },
    ]);
    expect(await rows({ ownership: 'archive', sort: 'domainName' })).toEqual([
      {
        domainName: 'escrow.com',
        ownership: 'archive',
        archiveLabel: 'sold',
        inAccount: true,
      },
      {
        domainName: 'gone.com',
        ownership: 'archive',
        archiveLabel: 'removed',
        inAccount: false,
      },
    ]);
    expect(await rows({ ownership: 'all' })).toHaveLength(3);
  });

  it('domain_get returns cached detail when present', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot']);
    getDomainDetail.mockResolvedValue({
      domainName: 'a.com',
      nameservers: ['ns.x'],
    });
    const out = await call('domain_get', { domain: 'a.com' });
    expect(out).toMatchObject({ domainName: 'a.com', nameservers: ['ns.x'] });
    expect(getDomain).not.toHaveBeenCalled();
  });

  it('domain_get falls back to a live getDomain when detail is null', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot']);
    getDomainDetail.mockResolvedValue(null);
    getDomain.mockResolvedValue({ domainName: 'a.com', status: 'active' });
    const out = await call('domain_get', { domain: 'a.com', refresh: true });
    expect(out).toMatchObject({ domainName: 'a.com', status: 'active' });
    expect(getDomain).toHaveBeenCalledWith('a.com');
  });

  it('domain_renew dispatches a renew op with the given years', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot']);
    applyDomainOp.mockResolvedValue({ status: 'ok', message: 'Renewed' });
    const out = await call('domain_renew', { domain: 'a.com', years: 3 });
    expect(applyDomainOp).toHaveBeenCalledWith(
      { registrar: 'dynadot', accountId: 'dynadot', domainName: 'a.com' },
      { kind: 'renew', years: 3 },
    );
    expect(out).toMatchObject({ success: true, status: 'ok' });
  });

  it('domain_renew defaults to 1 year', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot']);
    applyDomainOp.mockResolvedValue({ status: 'ok', message: 'Renewed' });
    await call('domain_renew', { domain: 'a.com' });
    expect(applyDomainOp).toHaveBeenCalledWith(expect.anything(), {
      kind: 'renew',
      years: 1,
    });
  });

  it('domain_auth_code_get returns the code on ok', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot']);
    applyDomainOp.mockResolvedValue({
      status: 'ok',
      message: '',
      data: { authCode: 'EPP-9' },
    });
    const out = await call('domain_auth_code_get', { domain: 'a.com' });
    expect(out).toEqual({ domain: 'a.com', authCode: 'EPP-9' });
  });

  it('domain_auth_code_get throws a non-ok outcome as the tool error', async () => {
    findRegistrarsForDomain.mockReturnValue(['dynadot']);
    applyDomainOp.mockResolvedValue({
      status: 'unsupported',
      message: 'no api',
    });
    await expect(
      call('domain_auth_code_get', { domain: 'a.com' }),
    ).rejects.toThrow('no api');
  });
});

function fullContact() {
  return {
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.com',
    phone: '+1.4805551234',
    address1: '1 St',
    city: 'Town',
    postalCode: '00000',
    country: 'US',
  };
}

describe('folder tools', () => {
  const work: FolderStub = {
    id: 'f1',
    name: 'Work',
    description: 'Client names',
    color: 'green',
  };
  beforeEach(() => {
    getFolders.mockReturnValue({
      folders: [
        work,
        { id: 'f2', name: 'Ideas', description: '', color: 'blue' },
      ],
      assignments: { 'a.com': 'f1', 'b.com': 'f1', 'c.com': '__hidden__' },
    });
    getMergedPortfolio.mockReturnValue({
      domains: [{ domainName: 'a.com' }, { domainName: 'd.com' }],
      fetchedAt: 0,
      registrars: [],
      errors: [],
    });
  });

  it('folder_list counts domains per folder and includes Hidden', async () => {
    const out = (await call('folder_list')) as {
      folders: { id: string; domainCount: number; builtIn: boolean }[];
    };
    expect(out.folders.map((f) => [f.id, f.domainCount, f.builtIn])).toEqual([
      ['f1', 2, false],
      ['f2', 0, false],
      ['__hidden__', 1, true],
    ]);
  });

  it('folder_create defaults the color and broadcasts', async () => {
    const out = await call('folder_create', { name: 'Sale' });
    expect(createFolder).toHaveBeenCalledWith({
      name: 'Sale',
      description: '',
      color: 'blue',
    });
    expect(out).toMatchObject({ id: 'new-id', name: 'Sale', domainCount: 0 });
    expect(broadcastPortfolioChanged).toHaveBeenCalled();
  });

  it('folder_create rejects a duplicate name or "Hidden"', async () => {
    await expect(call('folder_create', { name: 'work' })).rejects.toThrow(
      /already exists/,
    );
    await expect(call('folder_create', { name: 'hidden' })).rejects.toThrow(
      /built-in/,
    );
    expect(createFolder).not.toHaveBeenCalled();
  });

  it('folder_rename resolves by name and keeps its own name free', async () => {
    const out = await call('folder_rename', { folder: 'work', name: 'Work' });
    expect(updateFolder).toHaveBeenCalledWith('f1', { name: 'Work' });
    expect(out).toEqual({ id: 'f1', name: 'Work', previousName: 'Work' });
    await expect(
      call('folder_rename', { folder: 'f1', name: 'Ideas' }),
    ).rejects.toThrow(/already exists/);
  });

  it('folder_rename / folder_delete refuse Hidden and unknown folders', async () => {
    await expect(
      call('folder_rename', { folder: 'Hidden', name: 'X' }),
    ).rejects.toThrow(/can't be renamed/);
    await expect(
      call('folder_delete', { folder: '__hidden__' }),
    ).rejects.toThrow(/can't be deleted/);
    await expect(call('folder_delete', { folder: 'Nope' })).rejects.toThrow(
      /folder_list/,
    );
    expect(deleteFolder).not.toHaveBeenCalled();
  });

  it('folder_delete reports how many domains went back to no folder', async () => {
    const out = await call('folder_delete', { folder: 'Work' });
    expect(deleteFolder).toHaveBeenCalledWith('f1');
    expect(out).toEqual({
      id: 'f1',
      name: 'Work',
      deleted: true,
      unassigned: 2,
    });
  });

  it('domain_set_folder assigns by name, Hidden, or null', async () => {
    expect(
      await call('domain_set_folder', { domain: 'D.com', folder: 'ideas' }),
    ).toEqual({
      domain: 'd.com',
      folder: { id: 'f2', name: 'Ideas' },
      previous: null,
    });
    expect(assignFolder).toHaveBeenLastCalledWith('d.com', 'f2');

    expect(
      await call('domain_set_folder', { domain: 'a.com', folder: 'Hidden' }),
    ).toMatchObject({ previous: { id: 'f1', name: 'Work' } });
    expect(assignFolder).toHaveBeenLastCalledWith('a.com', '__hidden__');

    await call('domain_set_folder', { domain: 'a.com', folder: null });
    expect(assignFolder).toHaveBeenLastCalledWith('a.com', null);
    expect(broadcastPortfolioChanged).toHaveBeenCalledTimes(3);
  });

  it('domain_set_folder accepts an Archive name from the event log', async () => {
    listEvents.mockReturnValue([event({ domain: 'gone.com' })]);
    await call('domain_set_folder', { domain: 'gone.com', folder: 'f1' });
    expect(assignFolder).toHaveBeenCalledWith('gone.com', 'f1');
  });

  it('domain_set_folder rejects a name not in the portfolio or an unknown folder', async () => {
    await expect(
      call('domain_set_folder', { domain: 'x.com', folder: 'Work' }),
    ).rejects.toThrow(/isn't in your portfolio/);
    await expect(
      call('domain_set_folder', { domain: 'a.com', folder: 'Nope' }),
    ).rejects.toThrow(/No folder named/);
    expect(assignFolder).not.toHaveBeenCalled();
  });
});

describe('local write tools', () => {
  beforeEach(() => {
    getMergedPortfolio.mockReturnValue({
      domains: [{ domainName: 'a.com' }],
      fetchedAt: 0,
      registrars: [],
      errors: [],
    });
  });

  it('refuse a name DomBot doesn’t know', async () => {
    await expect(
      call('domain_note_set', { domain: 'x.com', notes: 'hi' }),
    ).rejects.toThrow(/isn't in your portfolio/);
    expect(setNotes).not.toHaveBeenCalled();
  });

  it('domain_note_set saves the note and reports what was kept', async () => {
    setNotes.mockReturnValue({ notes: 'Brandable' });
    expect(
      await call('domain_note_set', { domain: 'A.com', notes: 'Brandable' }),
    ).toEqual({ domain: 'a.com', notes: 'Brandable' });
    expect(setNotes).toHaveBeenCalledWith('a.com', 'Brandable');
    expect(broadcastPortfolioChanged).toHaveBeenCalled();
  });

  it('domain_asking_price_set clears what it leaves out', async () => {
    getListPrices.mockReturnValue({
      'a.com': { amount: '2500', currency: 'USD', updatedAt: 1 },
    });
    expect(
      await call('domain_asking_price_set', {
        domain: 'a.com',
        amount: '2500',
        currency: 'usd',
      }),
    ).toEqual({
      domain: 'a.com',
      askingPrice: {
        amount: '2500',
        minOffer: null,
        floor: null,
        currency: 'USD',
      },
    });
    expect(setListPrices).toHaveBeenCalledWith([
      {
        domainName: 'a.com',
        amount: '2500',
        minOffer: null,
        floor: null,
        currency: 'usd',
      },
    ]);
  });

  it('domain_renewal_price_set defaults to USD and clears with null', async () => {
    await call('domain_renewal_price_set', { domain: 'a.com', amount: '89' });
    expect(setManualPrice).toHaveBeenLastCalledWith('a.com', {
      amount: '89',
      currency: 'USD',
    });
    expect(
      await call('domain_renewal_price_set', { domain: 'a.com', amount: null }),
    ).toEqual({ domain: 'a.com', renewalPrice: null });
    expect(setManualPrice).toHaveBeenLastCalledWith('a.com', null);
  });

  it('domain_ownership_set records an agent drop, or moves a name back', async () => {
    await call('domain_ownership_set', {
      domain: 'a.com',
      ownership: 'dropped',
      date: '2026-10-01',
    });
    expect(setDispositions).toHaveBeenCalledWith(
      [{ domainName: 'a.com' }],
      'dropped',
      '2026-10-01',
      'agent',
    );
    await call('domain_ownership_set', { domain: 'a.com', ownership: 'owned' });
    expect(restoreOwned).toHaveBeenCalledWith(['a.com']);
  });

  it('domain_ownership_set reports the label from the event log', async () => {
    listEvents.mockReturnValue([
      event({ domain: 'a.com' }),
      event({ domain: 'a.com', type: 'archived', source: 'agent' }),
    ]);
    expect(
      await call('domain_ownership_set', {
        domain: 'a.com',
        ownership: 'archived',
      }),
    ).toEqual({
      domain: 'a.com',
      ownership: 'archive',
      archiveLabel: 'archived',
    });
  });

  it('registrar_set_enabled resolves the account and broadcasts', async () => {
    setRegistrarEnabledCached.mockResolvedValue({
      domains: [],
      fetchedAt: null,
      errors: [],
    });
    const out = await call('registrar_set_enabled', {
      registrar: 'dynadot',
      enabled: false,
    });
    expect(setRegistrarEnabledCached).toHaveBeenCalledWith(
      'dynadot',
      false,
      'dynadot',
    );
    expect(out).toMatchObject({
      accountId: 'dynadot',
      registrar: 'dynadot',
      enabled: false,
    });
    expect(broadcastPortfolioChanged).toHaveBeenCalled();
  });
});
