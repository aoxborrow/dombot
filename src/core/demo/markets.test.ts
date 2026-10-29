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
import { writeMarketListings } from '../services/markets/writes';
import { installDemo, uninstallDemo } from './index';

// The demo's markets through the real market services: accounts connect,
// sync fills listings and sales, and writes behave like each market.

beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  await installDemo({ size: 240 });
  await getPortfolio(true);
  await syncMarkets();
});
afterEach(() => uninstallDemo());

describe('demo markets', () => {
  it('connects Afternic, Sedo and Atom, each listing some names', () => {
    expect(
      marketAccountViews()
        .map((a) => a.market)
        .sort(),
    ).toEqual(['afternic', 'atom', 'sedo']);
    const by = (m: string) => marketListings().filter((l) => l.market === m);
    expect(by('afternic').length).toBeGreaterThan(by('sedo').length);
    expect(by('sedo').length).toBeGreaterThan(by('atom').length);
    expect(by('atom').length).toBeGreaterThan(0);
  });

  it('has sales over three years and one waiting on an auth code', () => {
    const sales = marketSales();
    expect(sales.filter((s) => s.status === 'completed').length).toBe(18);
    expect(sales.filter((s) => s.action === 'auth_code')).toHaveLength(1);
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
