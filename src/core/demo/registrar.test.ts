import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  NotImplementedError,
  RegistrarClient,
} from '@aoxborrow/registrar-client';
import {
  DemoRegistrar,
  DemoWorld,
  authCodeFor,
  defaultNameservers,
  type DemoDomainRecord,
} from './registrar';

const NOW = new Date('2026-09-07T00:00:00Z');
const YEAR = 365.25 * 24 * 60 * 60 * 1000;

function record(
  domainName: string,
  registrar: DemoDomainRecord['registrar'] = 'porkbun',
  accountId = registrar,
): DemoDomainRecord {
  return {
    domainName,
    registrar,
    accountId,
    status: 'active',
    createdDate: new Date(NOW.getTime() - 3 * YEAR),
    expirationDate: new Date(NOW.getTime() + YEAR),
    autoRenew: true,
    locked: true,
    privacy: true,
    nameservers: defaultNameservers(registrar),
    contacts: {},
    dnsRecords: [{ type: 'A', name: '@', value: '203.0.113.7' }],
    emailForwards: [],
    domainForwards: [],
    dnssec: { enabled: false, dsRecords: [] },
    authCode: authCodeFor(domainName),
  };
}

function setup() {
  const world = new DemoWorld([
    record('brightharbor.com'),
    record('quietloop.dev'),
    record('elsewhere.net', 'godaddy'),
  ]);
  const porkbun = new DemoRegistrar('porkbun', 'porkbun', world);
  return { world, porkbun };
}

describe('DemoRegistrar reads', () => {
  it('lists only its own account and looks like a real provider', async () => {
    const { porkbun } = setup();
    const domains = await porkbun.listDomains();
    expect(domains.map((d) => d.domainName).sort()).toEqual([
      'brightharbor.com',
      'quietloop.dev',
    ]);
    const d = domains[0];
    expect(d.registrar).toBe('porkbun');
    expect(d.expirationDate).toBeInstanceOf(Date);
    expect(d.nameservers).toEqual(defaultNameservers('porkbun'));
    expect(porkbun.features).toContain('getDnssec');
    expect(porkbun.requiresNameserversFetch).toBe(false);
    expect(await porkbun.listDomains({ search: 'quiet' })).toHaveLength(1);
    expect((await porkbun.testConnection()).success).toBe(true);
  });

  it('works through the library client (detailed listing, enrichment)', async () => {
    const { porkbun } = setup();
    const client = new RegistrarClient(porkbun);
    const detailed = await client.listDomains({ detailed: true });
    expect(detailed).toHaveLength(2);
    expect(await client.getNameservers('quietloop.dev')).toEqual(
      defaultNameservers('porkbun'),
    );
  });

  it('prices from the bundled base table', async () => {
    const { porkbun } = setup();
    const p = await porkbun.getPricing('anything.com');
    expect(p.tld).toBe('com');
    expect(p.renewal).toBeGreaterThan(5);
    const avail = await porkbun.checkAvailability([
      'brightharbor.com',
      'somethingnew.com',
    ]);
    expect(avail[0].available).toBe(false); // already in the world
  });

  it('refuses a domain that is not in this account', async () => {
    const { porkbun } = setup();
    await expect(porkbun.getDomain('elsewhere.net')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(porkbun.getDomain('nope.com')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('mirrors the real provider: an op it lacks throws NotImplementedError', async () => {
    const world = new DemoWorld([record('x.com', 'namebright')]);
    const nb = new DemoRegistrar('namebright', 'namebright', world);
    expect(nb.supports('getDnssec')).toBe(false);
    await expect(nb.getDnssec('x.com')).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    expect((await nb.getAuthCode('x.com')).startsWith('DEMO-')).toBe(true);
  });
});

describe('DemoRegistrar writes', () => {
  it('mutate the world and report success', async () => {
    const { world, porkbun } = setup();
    expect(
      (
        await porkbun.updateNameservers('brightharbor.com', [
          'NS1.Vercel-DNS.com',
          'ns2.vercel-dns.com',
        ])
      ).success,
    ).toBe(true);
    expect(world.get('brightharbor.com')!.nameservers).toEqual([
      'ns1.vercel-dns.com',
      'ns2.vercel-dns.com',
    ]);
    await porkbun.setAutoRenew('brightharbor.com', false);
    await porkbun.unlockDomain('brightharbor.com');
    await porkbun.setPrivacy('brightharbor.com', false);
    const d = await porkbun.getDomain('brightharbor.com');
    expect([d.autoRenew, d.locked, d.privacy]).toEqual([false, false, false]);

    await porkbun.setDnsRecords('quietloop.dev', [
      { type: 'TXT', name: '@', value: 'hello' },
    ]);
    expect(await porkbun.getDnsRecords('quietloop.dev')).toEqual([
      { type: 'TXT', name: '@', value: 'hello' },
    ]);
    await porkbun.setDomainForwarding('quietloop.dev', [
      { host: '@', url: 'https://example.com', type: 'permanent' },
    ]);
    expect(await porkbun.getDomainForwarding('quietloop.dev')).toHaveLength(1);
    await porkbun.updateContacts('quietloop.dev', {
      registrant: {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.c',
        phone: '+1.1',
        address1: '1',
        city: 'c',
        postalCode: 'p',
        country: 'US',
      },
    });
    expect(
      (await porkbun.getContacts('quietloop.dev')).registrant?.firstName,
    ).toBe('A');
  });

  it('renew extends expiry by whole years; register adds to the world', async () => {
    const { world, porkbun } = setup();
    const before = world.get('brightharbor.com')!.expirationDate.getTime();
    const r = await porkbun.renewDomain('brightharbor.com', 2);
    expect(r.success).toBe(true);
    expect(
      world.get('brightharbor.com')!.expirationDate.getTime() - before,
    ).toBeCloseTo(2 * YEAR, -3);

    const reg = await porkbun.registerDomain('NewThing.io', {
      contacts: {},
      years: 3,
      privacy: false,
    });
    expect(reg.success).toBe(true);
    const added = world.get('newthing.io')!;
    expect(added.registrar).toBe('porkbun');
    expect(added.privacy).toBe(false);
    expect(added.nameservers).toEqual(defaultNameservers('porkbun'));
    expect((await porkbun.listDomains()).map((d) => d.domainName)).toContain(
      'newthing.io',
    );
    // Twice is a soft failure, like a real registrar.
    expect(
      (await porkbun.registerDomain('newthing.io', { contacts: {} })).success,
    ).toBe(false);
  });

  it('honors an abort signal and simulated latency', async () => {
    const world = new DemoWorld([record('slow.com')]);
    const slow = new DemoRegistrar('porkbun', 'porkbun', world, {
      latencyMs: 50,
    });
    const t0 = Date.now();
    await slow.getDomain('slow.com');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    const ctl = new AbortController();
    const p = slow.lockDomain('slow.com', { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});
