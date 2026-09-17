import { afterEach, describe, expect, it } from 'vitest';
import { uninstallDemo } from '../../core/demo';
import { setBulkAutoDrive } from '../../core/services/bulk-jobs';
import { createDemoApi } from './demo';

// The in-process `window.api` for the demo build, driven the way the
// renderer drives it: hydrate, list, detail, a bulk job to completion via
// the event subscriptions, and the desktop-parity extras.

afterEach(() => {
  uninstallDemo();
  setBulkAutoDrive(false);
});

describe('createDemoApi', () => {
  it('boots with a full portfolio and answers like a web host', async () => {
    const { api, demo } = await createDemoApi({ latencyMs: 0, size: 40 });
    expect(await api.ping()).toBe('pong');
    expect((await api.getAppInfo()).platform).toBe('web');

    const snap = await api.hydrateFromCache();
    expect(snap.portfolio?.domains).toHaveLength(40);
    expect(snap.portfolio?.domains[0].expirationDate).toBeInstanceOf(Date);
    expect(Object.keys(snap.pricing)).toHaveLength(40);

    const meta = await api.getRegistrarMetadata();
    expect(meta.filter((m) => m.configured)).toHaveLength(
      demo.seed.accounts.length,
    );
    const creds = await api.getRegistrarCredentials('porkbun');
    expect(creds.apiKey).toMatch(/^pk1_demo_/);
    expect((await api.getMcpInfo()).running).toBe(false);
    expect((await api.getFolders()).folders.length).toBe(5);
  });

  it('validates arguments like the other hosts', async () => {
    const { api } = await createDemoApi({ latencyMs: 0, size: 10 });
    await expect(
      // @ts-expect-error deliberately wrong
      api.setManualPrice('nope', 'x.com', 1),
    ).rejects.toThrow(/Invalid arguments/);
  });

  it('runs a bulk job in-process and reports through the event subscriptions', async () => {
    const { api, demo } = await createDemoApi({ latencyMs: 0, size: 30 });
    const targets = demo.seed.records
      .filter((r) => r.registrar === 'porkbun')
      .slice(0, 3)
      .map((r) => ({ registrar: r.registrar, domainName: r.domainName }));
    expect(targets.length).toBe(3);

    const progress: number[] = [];
    const finished = new Promise<void>((resolve) => {
      const off = api.onBulkFinished((job) => {
        expect(job.status).toBe('done');
        expect(job.counts.ok).toBe(3);
        off();
        resolve();
      });
    });
    const offProgress = api.onBulkProgress((p) => progress.push(p.done));

    const job = await api.startBulk(targets, {
      kind: 'autoRenew',
      enabled: false,
    });
    expect(job.status).toBe('running');
    await finished;
    offProgress();
    expect(progress).toEqual([1, 2, 3]);
    for (const t of targets) {
      expect(demo.world.get(t.domainName)!.autoRenew).toBe(false);
    }
    const detail = await api.getDomainDetail('porkbun', targets[0].domainName);
    expect(detail?.autoRenew).toBe(false);
  }, 20_000);

  it('a fresh boot starts over from the seed', async () => {
    const a = await createDemoApi({ latencyMs: 0, size: 12 });
    const name = a.demo.seed.records[0].domainName;
    await a.api.applyDomainOp(
      { registrar: a.demo.seed.records[0].registrar, domainName: name },
      { kind: 'lock', locked: false },
    );
    expect(a.demo.world.get(name)!.locked).toBe(false);
    const b = await createDemoApi({ latencyMs: 0, size: 12 });
    expect(b.demo.world.get(name)!.locked).toBe(b.demo.seed.records[0].locked);
  });
});
