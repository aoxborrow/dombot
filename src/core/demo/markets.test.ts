import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  it('lists the names priced in DomBot: half on all three, most on Afternic', () => {
    expect(
      marketAccountViews()
        .map((a) => a.market)
        .sort(),
    ).toEqual(['afternic', 'atom', 'sedo']);
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
    expect(sales.filter((s) => s.action === 'auth_code')).toHaveLength(1);
    expect(sales.filter((s) => s.status === 'cancelled')).toHaveLength(1);
  });

  it('sends the waiting sale its auth code from the registrar', async () => {
    const waiting = marketSales().find((s) => s.action === 'auth_code')!;
    await expect(
      setSaleAuthCode(waiting.accountId, waiting.id),
    ).resolves.toEqual({ name: waiting.name, fetched: true });
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
});
