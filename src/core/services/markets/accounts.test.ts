import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../../storage/namespace';
import { createAccount } from '../accounts';
import { removeRegistrarAccount } from '../registrars';
import {
  getProxySettings,
  removeProxyProfile,
  saveProxyProfile,
} from '../proxies';
import { getStoredCredentials, setStoredCredentials } from '../credentials';
import {
  connectMarketAccount,
  getMarketCredentials,
  linkMarketAccount,
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

describe('a registrar’s market on its own key', () => {
  const own = { apiKey: 'own-k', apiSecret: 'own-s' };

  it('connects with no registrar account and keeps its key', async () => {
    const view = await connectMarketAccount('spaceship', own, undefined, 'mkt');
    expect(view).toMatchObject({ configured: true });
    expect(view.registrarAccountId).toBeUndefined();
    expect(view.keyRegistrarAccountId).toBeNull();
    expect(built.at(-1)?.credentials).toEqual(own);
    expect(getMarketCredentials('mkt')).toEqual(own);
  });

  it('finds a registrar account on the same key, whichever came first', async () => {
    await connectMarketAccount('dynadot', own, undefined, 'mkt');
    const reg = await createAccount('dynadot', 'Company');
    await setStoredCredentials(reg.id, own);
    const view = marketAccountViews().find((a) => a.id === 'mkt');
    expect(view?.keyRegistrarAccountId).toBe(reg.id);
  });

  it('moves between a registrar’s key and its own', async () => {
    const reg = await createAccount('dynadot', 'Company');
    await setStoredCredentials(reg.id, { apiKey: 'k', apiSecret: 's' });
    await connectMarketAccount('dynadot', {}, undefined, 'mkt', reg.id);

    await saveMarketCredentials('mkt', own);
    expect(marketAccountViews()[0].registrarAccountId).toBeUndefined();
    expect(getMarketCredentials('mkt')).toEqual(own);

    await linkMarketAccount('mkt', reg.id);
    expect(marketAccountViews()[0].registrarAccountId).toBe(reg.id);
    expect(getMarketCredentials('mkt')).toEqual({});
    expect(built.at(-1)?.credentials).toEqual({ apiKey: 'k', apiSecret: 's' });
  });

  it('stays when a registrar account on the same key is removed', async () => {
    const reg = await createAccount('dynadot', 'Company');
    await setStoredCredentials(reg.id, own);
    await connectMarketAccount('dynadot', own, undefined, 'mkt');
    await removeRegistrarAccount(reg.id);
    expect(marketAccountViews().map((a) => a.id)).toEqual(['mkt']);
  });

  it('needs a key or a registrar account', async () => {
    await expect(connectMarketAccount('spaceship', {})).rejects.toThrow(
      /or enter a separate key/,
    );
    await expect(
      connectMarketAccount('spaceship', { apiKey: 'k' }),
    ).rejects.toThrow(/API Secret is required/);
  });

  it('won’t use the proxy before one is set up', async () => {
    await expect(
      connectMarketAccount(
        'sedo',
        {
          partnerId: 'p',
          signKey: 's',
          username: 'u',
          password: 'x',
        },
        undefined,
        'mkt',
        null,
        true,
      ),
    ).rejects.toThrow(/no proxy is configured/);
    expect(marketAccountViews()).toEqual([]);
  });

  it('lists as a proxy user and goes direct when the proxy is removed', async () => {
    await saveProxyProfile({
      url: 'https://u:p@8.8.8.8:8080',
      egressIp: '8.8.4.4',
    });
    await connectMarketAccount('spaceship', own, 'Mine', 'mkt', null, true);
    expect(getProxySettings().marketUsers).toEqual([
      { accountId: 'mkt', market: 'spaceship', label: 'Mine' },
    ]);
    await removeProxyProfile();
    expect(marketAccountViews()[0].proxyId).toBeNull();
    expect(getProxySettings().marketUsers).toEqual([]);
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
