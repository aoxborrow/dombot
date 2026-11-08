import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../../storage/namespace';
import { createAccount } from '../accounts';
import { removeRegistrarAccount } from '../registrars';
import { getStoredCredentials, setStoredCredentials } from '../credentials';
import {
  connectMarketAccount,
  getMarketCredentials,
  marketAccountViews,
  marketAdapter,
  removeMarketAccount,
  saveMarketCredentials,
} from './accounts';
import {
  configureMarketFactory,
  marketCatalog,
  type Credentials,
} from './registry';

// Registrar-backed market accounts (Dynadot): no credentials of their own,
// the registrar account's key at call time.

const built: { market: string; credentials: Credentials }[] = [];

beforeEach(async () => {
  await flushWrites().catch(() => {});
  configureStore(new MemoryDocStore());
  await hydrateStores();
  built.length = 0;
  configureMarketFactory((market, accountId, credentials) => {
    built.push({ market, credentials });
    return {
      market,
      accountId,
      capabilities: {} as never,
      test: async () => ({ listings: null, notes: [] }),
      allListings: async () => ({ listings: [], complete: true }),
      getListings: async () => [],
      writeListings: async () => [],
      deleteListings: async () => [],
    };
  });
});

describe('a market on a registrar’s key', () => {
  it('uses the registrar account’s key and keeps none of its own', async () => {
    const reg = await createAccount('dynadot', 'Company');
    await setStoredCredentials(reg.id, { apiKey: 'k1', apiSecret: 's1' });
    const view = await connectMarketAccount(
      'dynadot',
      { ignored: 'x' },
      undefined,
      'mkt',
      reg.id,
    );
    expect(view).toMatchObject({
      market: 'dynadot',
      registrarAccountId: reg.id,
      configured: true,
    });
    expect(built.at(-1)?.credentials).toEqual({
      apiKey: 'k1',
      apiSecret: 's1',
    });
    // Nothing of the key is handed out through the market account.
    expect(getMarketCredentials('mkt')).toEqual({});
    await expect(
      saveMarketCredentials('mkt', { apiKey: 'k2' }),
    ).rejects.toThrow(/Settings → Registrars/);

    // Rotating the key on the registrar account reaches the market at once.
    await setStoredCredentials(reg.id, { apiKey: 'k3', apiSecret: 's3' });
    marketAdapter('mkt');
    expect(built.at(-1)?.credentials).toEqual({
      apiKey: 'k3',
      apiSecret: 's3',
    });

    // Removing the market account leaves the registrar's key alone.
    await removeMarketAccount('mkt');
    expect(marketAccountViews()).toEqual([]);
    expect(getStoredCredentials(reg.id)).toEqual({
      apiKey: 'k3',
      apiSecret: 's3',
    });
  });

  it('needs a registrar account, and one of the right registrar', async () => {
    await expect(connectMarketAccount('dynadot', {})).rejects.toThrow(
      /Choose the Dynadot registrar account/,
    );
    const other = await createAccount('namecheap', 'Other');
    await expect(
      connectMarketAccount('dynadot', {}, undefined, undefined, other.id),
    ).rejects.toThrow(/isn’t a Dynadot registrar account/);
  });

  it('takes each registrar account once', async () => {
    const reg = await createAccount('dynadot', 'Company');
    await setStoredCredentials(reg.id, { apiKey: 'k', apiSecret: 's' });
    await connectMarketAccount('dynadot', {}, undefined, 'one', reg.id);
    await expect(
      connectMarketAccount('dynadot', {}, undefined, 'two', reg.id),
    ).rejects.toThrow(/already uses that registrar account/);
  });

  it('goes with its registrar account when that’s removed', async () => {
    const reg = await createAccount('dynadot', 'Company');
    const other = await createAccount('dynadot', 'Other');
    await setStoredCredentials(reg.id, { apiKey: 'k', apiSecret: 's' });
    await setStoredCredentials(other.id, { apiKey: 'k2', apiSecret: 's2' });
    await connectMarketAccount('dynadot', {}, 'Mine', 'mkt', reg.id);
    await connectMarketAccount('dynadot', {}, 'Theirs', 'mkt2', other.id);
    await removeRegistrarAccount(reg.id);
    expect(marketAccountViews().map((a) => a.id)).toEqual(['mkt2']);
  });

  it('isn’t configured while its registrar account has no key', async () => {
    const reg = await createAccount('dynadot', 'Empty');
    await setStoredCredentials(reg.id, { apiKey: 'k', apiSecret: 's' });
    await connectMarketAccount('dynadot', {}, undefined, 'mkt', reg.id);
    await setStoredCredentials(reg.id, {});
    expect(marketAccountViews()[0].configured).toBe(false);
  });
});

describe('order', () => {
  it('lists markets and accounts alphabetically, wherever they show', async () => {
    expect(marketCatalog().map((m) => m.name)).toEqual(
      [...marketCatalog().map((m) => m.name)].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    for (const [id, label] of [
      ['z', 'Zeta'],
      ['a', 'alpha'],
    ]) {
      const reg = await createAccount('dynadot', label);
      await setStoredCredentials(reg.id, { apiKey: 'k', apiSecret: 's' });
      await connectMarketAccount('dynadot', {}, label, id, reg.id);
    }
    expect(marketAccountViews().map((a) => a.label)).toEqual(['alpha', 'Zeta']);
  });
});
