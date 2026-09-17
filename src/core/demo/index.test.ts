import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { applyDomainOp } from '../services/domain-ops';
import { getFolders } from '../services/folders';
import {
  getDomainDetail,
  getMergedPortfolio,
  getPortfolio,
  getPortfolioPricing,
  getRegistrarMetadata,
} from '../services/registrars';
import { installDemo, uninstallDemo, type DemoInstallation } from './index';

// The demo wired into a real core: store, accounts, sync, detail, pricing,
// and domain ops all run unmodified against the in-memory registrar.

let demo: DemoInstallation;
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  demo = await installDemo({ size: 60 });
});
afterEach(() => uninstallDemo());

describe('installDemo', () => {
  it('shows the demo accounts as connected and the rest as not', () => {
    const meta = getRegistrarMetadata();
    const configured = meta.filter((m) => m.configured).map((m) => m.name);
    expect(configured.sort()).toEqual(
      demo.seed.accounts.map((a) => a.registrar).sort(),
    );
    expect(meta.find((m) => m.name === 'gandi')!.configured).toBe(false);
    expect(meta.find((m) => m.name === 'godaddy')!.enabled).toBe(true);
    expect(getFolders().folders.map((f) => f.name)).toEqual(
      demo.seed.folders.map((f) => f.name),
    );
  });

  it('a sync fills the portfolio from the world, with pricing and folders', async () => {
    const p = await getPortfolio(true);
    expect(p.errors).toEqual([]);
    expect(p.domains).toHaveLength(60);
    expect(p.registrars.sort()).toEqual(
      demo.seed.accounts.map((a) => a.registrar).sort(),
    );
    const merged = getMergedPortfolio();
    expect(merged.domains).toHaveLength(60);
    expect(merged.domains[0].expirationDate).toBeInstanceOf(Date);

    const pricing = getPortfolioPricing();
    const priced = Object.values(pricing);
    expect(priced.length).toBe(60);
    expect(priced.every((x) => typeof x.renewal === 'number')).toBe(true);
    const manualKey = Object.keys(demo.seed.manualPrices)[0];
    expect(pricing[manualKey].source).toBe('manual');
    expect(pricing[manualKey].renewal).toBe(demo.seed.manualPrices[manualKey]);
    expect(priced.some((x) => x.source === 'base')).toBe(true);

    const { assignments } = getFolders();
    expect(Object.keys(assignments).length).toBe(
      demo.seed.folders.reduce((n, f) => n + f.domains.length, 0),
    );
  });

  it('detail and ops go through the world and update the cache', async () => {
    await getPortfolio(true);
    const rec = demo.seed.records.find((r) => r.registrar === 'porkbun')!;
    const detail = await getDomainDetail('porkbun', rec.domainName, true);
    expect(detail?.nameservers).toEqual(rec.nameservers);

    const result = await applyDomainOp(
      { registrar: 'porkbun', domainName: rec.domainName },
      {
        kind: 'nameservers',
        nameservers: ['ns1.example.net', 'ns2.example.net'],
      },
      { silent: true },
    );
    expect(result.status).toBe('ok');
    expect(demo.world.get(rec.domainName)!.nameservers).toEqual([
      'ns1.example.net',
      'ns2.example.net',
    ]);
    const after = await getDomainDetail('porkbun', rec.domainName, false);
    expect(after?.nameservers).toEqual(['ns1.example.net', 'ns2.example.net']);

    const gd = demo.seed.records.find((r) => r.registrar === 'godaddy')!;
    const before = gd.expirationDate.getTime();
    const renew = await applyDomainOp(
      { registrar: 'godaddy', domainName: gd.domainName },
      { kind: 'renew', years: 1 },
      { silent: true },
    );
    expect(renew.status).toBe('ok');
    expect(
      demo.world.get(gd.domainName)!.expirationDate.getTime(),
    ).toBeGreaterThan(before);

    // Real gating survives: Cloudflare can't change nameservers.
    const cf = demo.seed.records.find((r) => r.registrar === 'cloudflare')!;
    const blocked = await applyDomainOp(
      { registrar: 'cloudflare', domainName: cf.domainName },
      { kind: 'nameservers', nameservers: ['ns1.example.net'] },
      { silent: true },
    );
    expect(blocked.status).toBe('unsupported');
    await flushWrites();
  });

  it('never reaches the network: the real factory is bypassed', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('network');
    }) as typeof fetch;
    try {
      await getPortfolio(true);
      await applyDomainOp(
        { registrar: 'godaddy', domainName: demo.seed.records[0].domainName },
        { kind: 'lock', locked: false },
        { silent: true },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(0);
  });
});
