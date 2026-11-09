import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Feature, registrars } from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import { getPortfolio } from '../services/registrars';
import { marketAccountViews } from '../services/markets/accounts';
import {
  marketListings,
  marketSales,
  syncMarkets,
} from '../services/markets/sync';
import {
  setSaleAuthCode,
  verifyMarketDns,
  writeMarketListings,
} from '../services/markets/writes';
import { installDemo, uninstallDemo, type DemoInstallation } from './index';

// The demo's markets through the real market services: accounts connect,
// sync fills listings and sales, and writes behave like each market.

let demo: DemoInstallation;
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  demo = await installDemo({ size: 240 });
  await getPortfolio(true);
  await syncMarkets();
});
afterEach(() => uninstallDemo());

describe('demo markets', () => {
  it('lists the names priced in DomBot: half on Sedo and Atom, most on Afternic', () => {
    expect(
      marketAccountViews()
        .map((a) => a.market)
        .sort(),
    ).toEqual(['afternic', 'atom', 'dynadot', 'sedo', 'spaceship']);
    const priced = Object.keys(demo.seed.askingPrices);
    expect(priced.length).toBe(Math.round((240 * 2) / 3));
    const on = (m: string) =>
      new Set(
        marketListings()
          .filter((l) => l.market === m)
          .map((l) => l.name),
      );
    const afternic = on('afternic');
    const sedo = on('sedo');
    const atom = on('atom');
    // Only priced names are listed.
    for (const n of [...afternic, ...sedo, ...atom])
      expect(priced).toContain(n);
    expect(afternic.size).toBe(Math.round(priced.length * 0.9));
    expect(sedo.size).toBe(Math.round(priced.length * 0.5));
    expect([...sedo]).toEqual([...atom].filter((n) => sedo.has(n)));
    expect(atom.size).toBe(sedo.size);
    // Dynadot: a share of the priced names, both those its registrar
    // account holds and names held elsewhere.
    const dynadot = marketListings().filter((l) => l.market === 'dynadot');
    expect(dynadot.length).toBe(Math.round(priced.length * 0.3));
    const held = new Set(
      dynadot.map((l) => (l.extra.market === 'dynadot' ? l.extra.held : '')),
    );
    expect(held).toEqual(new Set(['dynadot', 'elsewhere']));
    // Some market prices differ from DomBot's.
    const differs = marketListings().filter(
      (l) => l.price && l.price !== demo.seed.askingPrices[l.name].amount,
    );
    expect(differs.length).toBeGreaterThan(0);
  });

  it('keeps Personal and Projects unpriced; For Sale holds the priced', () => {
    const folder = (name: string) =>
      demo.seed.folders.find((f) => f.name === name)!.domains;
    const priced = new Set(Object.keys(demo.seed.askingPrices));
    for (const n of [...folder('Personal'), ...folder('Projects')])
      expect(priced.has(n)).toBe(false);
    expect(folder('Projects').length).toBeLessThanOrEqual(20);
    for (const n of folder('For Sale')) expect(priced.has(n)).toBe(true);
    const elsewhere = new Set([...folder('Dropping'), ...folder('Transfer')]);
    for (const n of priced)
      expect(folder('For Sale').includes(n) || elsewhere.has(n)).toBe(true);
  });

  it('has sales over three years, one at each step, and one cancelled', () => {
    const sales = marketSales();
    expect(sales.filter((s) => s.status === 'completed').length).toBe(18);
    expect(
      sales.filter((s) => s.status === 'in_progress').map((s) => s.action),
    ).toEqual(
      expect.arrayContaining(['auth_code', 'payee_details', 'transfer']),
    );
    // Twice at the auth code: fetched from the registrar, or pasted in.
    expect(sales.filter((s) => s.action === 'auth_code')).toHaveLength(2);
    expect(sales.filter((s) => s.status === 'cancelled')).toHaveLength(1);
  });

  // The two sales waiting on the auth code, by whether the registrar holding
  // the name can produce it.
  const waitingOnCode = () => {
    const registrarOf = (name: string) =>
      demo.seed.records.find((r) => r.domainName === name)!.registrar;
    const waiting = marketSales().filter((s) => s.action === 'auth_code');
    const gives = (name: string) =>
      registrars[registrarOf(name)].features.includes(Feature.GetAuthCode);
    return {
      fetched: waiting.find((s) => gives(s.name))!,
      pasted: waiting.find((s) => !gives(s.name))!,
    };
  };

  it('sends the waiting sale its auth code from the registrar', async () => {
    const { fetched } = waitingOnCode();
    await expect(
      setSaleAuthCode(fetched.accountId, fetched.id),
    ).resolves.toEqual({ name: fetched.name, fetched: true });
  });

  it('takes the code pasted in where the registrar can’t produce it', async () => {
    const { pasted } = waitingOnCode();
    await expect(setSaleAuthCode(pasted.accountId, pasted.id)).rejects.toThrow(
      `Couldn't get the auth code for ${pasted.name}`,
    );
    await expect(
      setSaleAuthCode(pasted.accountId, pasted.id, 'PASTED-CODE'),
    ).resolves.toEqual({ name: pasted.name, fetched: false });
  });

  it('holds a new Sedo name pending and caps Afternic lease months', async () => {
    const [sedo] = await writeMarketListings('demo-sedo', [
      { name: 'brand-new-name.com', price: '2500' },
    ]);
    expect(sedo).toMatchObject({ ok: true, pending: true });
    const [afternic] = await writeMarketListings('demo-afternic', [
      {
        name: 'cheap-name.com',
        price: '800',
        leaseToOwn: { enabled: true, maxPayments: 60 },
      },
    ]);
    expect(afternic.adjusted).toEqual([
      { field: 'leaseToOwn.maxPayments', asked: 60, saved: 10 },
    ]);
    const [atom] = await writeMarketListings('demo-atom', [
      { name: 'cheap-name.com', price: '50' },
    ]);
    expect(atom.ok).toBe(false);
  });

  it('holds a Dynadot listing pending until Dynadot verifies the name', async () => {
    const [r] = await writeMarketListings('demo-dynadot', [
      { name: 'held-elsewhere.com', price: '2500' },
    ]);
    expect(r).toMatchObject({
      ok: true,
      pending: true,
      saved: { status: 'pending', extra: { held: 'elsewhere' } },
    });
    // A new price while it waits is still pending, not an error.
    const [again] = await writeMarketListings('demo-dynadot', [
      { name: 'held-elsewhere.com', price: '2000' },
    ]);
    expect(again).toMatchObject({ ok: true, pending: true });
    const checked = await verifyMarketDns('demo-dynadot', 'held-elsewhere.com');
    expect(checked.saved).toMatchObject({ status: 'active', price: '2000' });
  });
});
