import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Mock every service the tool handlers reach ───────────────────────────────
// registrarNames must be a real non-empty array: tools.ts builds z.enum() from
// it at module load. Everything else is a vi.fn scripted per test.

const findRegistrarsForDomain = vi.fn<(d: string) => string[]>();
const getConfiguredRegistrars = vi.fn(() => ['dynadot']);
const getActiveRegistrars = vi.fn(() => ['dynadot']);
const setDnsRecords = vi.fn();
const getRegistrarClient = vi.fn((_name: string) => ({ setDnsRecords }));
const registerDomainCached = vi.fn();

vi.mock('../services/registrars', () => ({
  registrarNames: ['dynadot', 'porkbun', 'godaddy'] as const,
  findRegistrarsForDomain: (d: string) => findRegistrarsForDomain(d),
  getConfiguredRegistrars: () => getConfiguredRegistrars(),
  getActiveRegistrars: () => getActiveRegistrars(),
  getRegistrarClient: (n: string) => getRegistrarClient(n),
  registerDomainCached: (...a: unknown[]) => registerDomainCached(...a),
  // Unused by the tools exercised here, but imported at module load.
  getDomainDetail: vi.fn(),
  getMergedPortfolio: vi.fn(),
  getPortfolio: vi.fn(),
  getRegistrarMetadata: vi.fn(),
  getRenewalPriceLive: vi.fn(),
  syncRegistrar: vi.fn(),
}));

const applyDomainOp = vi.fn();
vi.mock('../services/domain-ops', () => ({
  applyDomainOp: (...a: unknown[]) => applyDomainOp(...a),
}));

vi.mock('../services/folders', () => ({ getFolders: vi.fn(() => []) }));

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
  registerTool: (name: string, config: Tool['config'], handler: Tool['handler']) => {
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

const schema = (name: string) =>
  z.object(tools.get(name)!.config.inputSchema);

beforeEach(() => {
  vi.clearAllMocks();
  getRegistrarClient.mockReturnValue({ setDnsRecords });
  getConfiguredRegistrars.mockReturnValue(['dynadot']);
  getActiveRegistrars.mockReturnValue(['dynadot']);
});

describe('json() payload shape', () => {
  it('wraps a result in a single pretty-printed text block', async () => {
    const tool = tools.get('registrar_list')!;
    const res = await tool.handler({});
    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse(res.content[0].text)).toEqual({
      all: ['dynadot', 'porkbun', 'godaddy'],
      configured: ['dynadot'],
      active: ['dynadot'],
    });
  });
});

describe('resolveRegistrar (via domain_set_autorenew)', () => {
  beforeEach(() => applyDomainOp.mockResolvedValue({ status: 'ok', message: 'done' }));

  it('uses an explicit registrar without a cache lookup', async () => {
    await call('domain_set_autorenew', {
      registrar: 'dynadot',
      domain: 'example.com',
      enabled: true,
    });
    expect(findRegistrarsForDomain).not.toHaveBeenCalled();
    expect(applyDomainOp).toHaveBeenCalledWith(
      { registrar: 'dynadot', domainName: 'example.com' },
      { kind: 'autoRenew', enabled: true },
    );
  });

  it('resolves the registrar from the cache when omitted', async () => {
    findRegistrarsForDomain.mockReturnValue(['porkbun']);
    await call('domain_set_autorenew', { domain: 'example.com', enabled: false });
    expect(applyDomainOp).toHaveBeenCalledWith(
      { registrar: 'porkbun', domainName: 'example.com' },
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
    applyDomainOp.mockResolvedValue({ status: 'ok', message: 'Auto-renew enabled' });
    const out = await call('domain_set_autorenew', { domain: 'a.com', enabled: true });
    expect(out).toEqual({ success: true, status: 'ok', message: 'Auto-renew enabled' });
  });

  it('maps a non-ok status to success:false', async () => {
    applyDomainOp.mockResolvedValue({ status: 'failed', message: 'rejected' });
    const out = await call('domain_set_autorenew', { domain: 'a.com', enabled: true });
    expect(out).toEqual({ success: false, status: 'failed', message: 'rejected' });
  });

  it('unsupported maps to success:false too', async () => {
    applyDomainOp.mockResolvedValue({ status: 'unsupported', message: 'no api' });
    const out = await call('domain_set_autorenew', { domain: 'a.com', enabled: true });
    expect(out.success).toBe(false);
    expect(out.status).toBe('unsupported');
  });
});

describe('cachedWrite() (via domain_dns_set)', () => {
  beforeEach(() => findRegistrarsForDomain.mockReturnValue(['dynadot']));

  it('broadcasts on success and returns the raw OperationResult', async () => {
    setDnsRecords.mockResolvedValue({ success: true, message: 'Records written' });
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
      s.safeParse({ registrar: 'dynadot', domain: 'a.com', input: { contacts } })
        .success,
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
