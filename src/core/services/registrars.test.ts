import { configureStore, hydrateStores } from '../storage/namespace';
import { MemoryDocStore } from '../storage/doc-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Boundary mocks ───────────────────────────────────────────────────────────
// registrars.ts sits on top of registrar-client, the on-disk cache, credentials,
// registrar-state, pricing, and node:dns. Mock all of them so the module's own
// logic (cache assembly/overlay, registrar resolution, last-good-on-error sync,
// cache patching) runs offline and deterministically.

// A faithful in-memory reimplementation of ./cache's contract.
interface Entry {
  data: unknown;
  fetchedAt: number;
}
const store: Record<string, Record<string, Entry>> = {
  portfolio: {},
  detail: {},
};
const readEntry = (ns: string, key: string) => store[ns][key] ?? null;
const readAll = (ns: string) => store[ns];
const writeEntry = (ns: string, key: string, data: unknown) => {
  const entry = { data, fetchedAt: Date.now() };
  store[ns][key] = entry;
  return entry;
};
const patchEntryData = (
  ns: string,
  key: string,
  update: (d: unknown) => unknown,
) => {
  const entry = store[ns][key];
  if (!entry) return;
  store[ns][key] = { ...entry, data: update(entry.data) };
};
const clearEntry = (ns: string, key: string) => {
  delete store[ns][key];
};
vi.mock('./cache', () => ({
  readEntry: (ns: string, key: string) => readEntry(ns, key),
  readAll: (ns: string) => readAll(ns),
  writeEntry: (ns: string, key: string, data: unknown) =>
    writeEntry(ns, key, data),
  patchEntryData: (ns: string, key: string, u: (d: unknown) => unknown) =>
    patchEntryData(ns, key, u),
  clearEntry: (ns: string, key: string) => clearEntry(ns, key),
  isStale: () => false,
}));

// Shared, scriptable client methods (the same fn refs land on every built client).
const clientMethods = {
  setAutoRenew: vi.fn(),
  lockDomain: vi.fn(),
  unlockDomain: vi.fn(),
  setPrivacy: vi.fn(),
  updateNameservers: vi.fn(),
  renewDomain: vi.fn(),
  registerDomain: vi.fn(),
  getDomain: vi.fn(),
  getNameservers: vi.fn(),
  getPricing: vi.fn(),
  checkAvailability: vi.fn(),
};
const listPortfolio = vi.fn();
vi.mock('@aoxborrow/registrar-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@aoxborrow/registrar-client')>();
  class RegistrarClient {
    constructor() {
      Object.assign(this, clientMethods);
    }
  }
  return {
    ...actual,
    RegistrarClient,
    createRegistrar: vi.fn(() => ({})),
    listPortfolio: (...a: unknown[]) => listPortfolio(...a),
    registrars: {
      dynadot: {
        displayName: 'Dynadot',
        features: [],
        configFields: [{ name: 'apiKey', required: true }],
      },
      porkbun: {
        displayName: 'Porkbun',
        features: [],
        configFields: [{ name: 'apiKey', required: true }],
      },
      cloudflare: {
        displayName: 'Cloudflare',
        features: [],
        configFields: [{ name: 'apiKey', required: true }],
      },
      godaddy: {
        displayName: 'GoDaddy',
        features: [],
        configFields: [{ name: 'apiToken', required: true }],
      },
      namecheap: {
        displayName: 'Namecheap',
        features: [],
        configFields: [{ name: 'apiKey', required: true }],
      },
    },
  };
});

const storedCredentials: Record<string, Record<string, string>> = {};
vi.mock('./credentials', () => ({
  getStoredCredentials: (name: string) => storedCredentials[name] ?? {},
  setStoredCredentials: vi.fn(),
}));

const enabled: Record<string, boolean> = {};
vi.mock('./registrar-state', () => ({
  isRegistrarEnabled: (name: string) => enabled[name] ?? true,
  setRegistrarEnabled: (name: string, v: boolean) => {
    enabled[name] = v;
  },
}));

const setTldRate = vi.fn();
const resolvePricing = vi.fn();
vi.mock('./pricing', () => ({
  usesPerNameQuote: () => false,
  tldOf: (d: string) => d.slice(d.indexOf('.') + 1),
  normalizeTld: (t: string) => t.trim().replace(/^\.+/, '').toLowerCase(),
  setTldRate: (...a: unknown[]) => setTldRate(...a),
  resolvePricing: (...a: unknown[]) => resolvePricing(...a),
}));

const resolveNs = vi.fn<(d: string) => Promise<string[]>>();
vi.mock('../dns', () => ({
  resolveNameservers: (d: string) => resolveNs(d),
}));

import { NotImplementedError } from '@aoxborrow/registrar-client';
import {
  findRegistrarsForDomain,
  getRegistrationQuote,
  getCachedPortfolio,
  getDomainDetail,
  getMergedPortfolio,
  getPortfolio,
  getRenewalPriceLive,
  registerDomainCached,
  renewDomainCached,
  setAutoRenewCached,
  setLockCached,
  setNameserversCached,
  setPrivacyCached,
  syncRegistrar,
} from './registrars';
import type { Domain } from '@aoxborrow/registrar-client';

function domain(
  partial: Partial<Domain> & { domainName: string; registrar: string },
): Domain {
  return {
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
    ...partial,
  } as Domain;
}

// Seed a registrar's cached portfolio slice directly.
function seedSlice(
  name: string,
  domains: Domain[],
  opts: { lastSyncedAt?: number | null; lastError?: string | null } = {},
) {
  store.portfolio[name] = {
    data: {
      domains,
      lastSyncedAt: 'lastSyncedAt' in opts ? opts.lastSyncedAt : Date.now(),
      lastError: opts.lastError ?? null,
    },
    fetchedAt: Date.now(),
  };
}

beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  vi.clearAllMocks();
  store.portfolio = {};
  store.detail = {};
  for (const k of Object.keys(storedCredentials)) delete storedCredentials[k];
  for (const k of Object.keys(enabled)) delete enabled[k];
  // dynadot + porkbun configured; cloudflare not.
  storedCredentials.dynadot = { apiKey: 'x' };
  storedCredentials.porkbun = { apiKey: 'y' };
  listPortfolio.mockResolvedValue({ domains: [], errors: [] });
  resolveNs.mockResolvedValue([]);
});

describe('findRegistrarsForDomain', () => {
  it('finds the single holding registrar, case-insensitively', () => {
    seedSlice('dynadot', [
      domain({ domainName: 'Example.com', registrar: 'dynadot' }),
    ]);
    expect(findRegistrarsForDomain('example.COM')).toEqual(['dynadot']);
  });

  it('returns empty when the domain is not cached', () => {
    seedSlice('dynadot', [
      domain({ domainName: 'a.com', registrar: 'dynadot' }),
    ]);
    expect(findRegistrarsForDomain('ghost.com')).toEqual([]);
  });

  it('returns multiple when a stale cache lists it twice', () => {
    seedSlice('dynadot', [
      domain({ domainName: 'dup.com', registrar: 'dynadot' }),
    ]);
    seedSlice('porkbun', [
      domain({ domainName: 'dup.com', registrar: 'porkbun' }),
    ]);
    expect(findRegistrarsForDomain('dup.com').sort()).toEqual([
      'dynadot',
      'porkbun',
    ]);
  });
});

describe('getCachedPortfolio / assemblePortfolio', () => {
  it('is null when nothing has ever synced', () => {
    expect(getCachedPortfolio()).toBeNull();
  });

  it('aggregates active registrars, taking the max fetchedAt', () => {
    seedSlice(
      'dynadot',
      [domain({ domainName: 'a.com', registrar: 'dynadot' })],
      {
        lastSyncedAt: 1000,
      },
    );
    seedSlice(
      'porkbun',
      [domain({ domainName: 'b.com', registrar: 'porkbun' })],
      {
        lastSyncedAt: 2000,
      },
    );
    const p = getCachedPortfolio()!;
    expect(p.domains.map((d) => d.domainName).sort()).toEqual([
      'a.com',
      'b.com',
    ]);
    expect(p.registrars.sort()).toEqual(['dynadot', 'porkbun']);
    expect(p.fetchedAt).toBe(2000);
    expect(p.registrarLabels.dynadot).toBe('Dynadot');
  });

  it('records an error-only registrar in errors but not in registrars', () => {
    seedSlice(
      'dynadot',
      [domain({ domainName: 'a.com', registrar: 'dynadot' })],
      {
        lastSyncedAt: 1000,
      },
    );
    // porkbun errored and never synced: domains empty, lastSyncedAt null, lastError set.
    seedSlice('porkbun', [], { lastSyncedAt: null, lastError: 'boom' });
    const p = getCachedPortfolio()!;
    expect(p.registrars).toEqual(['dynadot']);
    expect(p.errors).toEqual([
      {
        registrar: 'porkbun',
        accountId: 'porkbun',
        accountLabel: 'Default',
        message: 'boom',
      },
    ]);
  });
});

describe('getMergedPortfolio', () => {
  it('overlays cached detail onto the portfolio row', () => {
    seedSlice('dynadot', [
      domain({
        domainName: 'a.com',
        registrar: 'dynadot',
        nameservers: ['old.ns'],
      }),
    ]);
    store.detail['dynadot:a.com'] = {
      data: { nameservers: ['new.ns'], privacy: true },
      fetchedAt: Date.now(),
    };
    const merged = getMergedPortfolio();
    expect(merged.domains[0].nameservers).toEqual(['new.ns']);
    expect(merged.domains[0].privacy).toBe(true);
  });

  it('leaves rows without detail untouched', () => {
    seedSlice('dynadot', [
      domain({ domainName: 'a.com', registrar: 'dynadot' }),
    ]);
    expect(getMergedPortfolio().domains[0].nameservers).toEqual([]);
  });

  it('returns an empty shape when nothing is cached', () => {
    expect(getMergedPortfolio()).toEqual({
      domains: [],
      fetchedAt: null,
      registrars: [],
      errors: [],
    });
  });
});

describe('syncRegistrarInto — last-good on error (via getPortfolio)', () => {
  it('replaces the slice and clears the error on success', async () => {
    seedSlice('dynadot', [], { lastSyncedAt: 1, lastError: 'old' });
    listPortfolio.mockImplementation(async (clients: unknown[]) => {
      void clients;
      return {
        domains: [domain({ domainName: 'fresh.com', registrar: 'dynadot' })],
        errors: [],
      };
    });
    // Only sync dynadot: disable porkbun so it's skipped.
    enabled.porkbun = false;

    const p = await getPortfolio(true);
    expect(p.domains.map((d) => d.domainName)).toEqual(['fresh.com']);
    expect(p.errors).toEqual([]);
    expect(
      (store.portfolio.dynadot.data as { lastError: string | null }).lastError,
    ).toBeNull();
  });

  it('keeps last-good domains and lastSyncedAt when the list reports an error', async () => {
    seedSlice(
      'dynadot',
      [domain({ domainName: 'kept.com', registrar: 'dynadot' })],
      {
        lastSyncedAt: 4242,
      },
    );
    enabled.porkbun = false;
    listPortfolio.mockResolvedValue({
      domains: [],
      errors: [{ error: new Error('rate limited') }],
    });

    const p = await getPortfolio(true);
    expect(p.domains.map((d) => d.domainName)).toEqual(['kept.com']);
    const slice = store.portfolio.dynadot.data as {
      domains: Domain[];
      lastSyncedAt: number | null;
      lastError: string | null;
    };
    expect(slice.lastSyncedAt).toBe(4242);
    expect(slice.lastError).toBe('rate limited');
    expect(p.errors).toEqual([
      {
        registrar: 'dynadot',
        accountId: 'dynadot',
        accountLabel: 'Default',
        message: 'rate limited',
      },
    ]);
  });

  it('keeps last-good domains when listPortfolio throws', async () => {
    seedSlice(
      'dynadot',
      [domain({ domainName: 'kept.com', registrar: 'dynadot' })],
      {
        lastSyncedAt: 99,
      },
    );
    enabled.porkbun = false;
    listPortfolio.mockRejectedValue(new Error('network down'));

    const p = await getPortfolio(true);
    expect(p.domains.map((d) => d.domainName)).toEqual(['kept.com']);
    expect(
      (store.portfolio.dynadot.data as { lastError: string | null }).lastError,
    ).toBe('network down');
  });
});

describe('syncRegistrar — cache lifecycle', () => {
  it('clears a registrar that is no longer configured', async () => {
    seedSlice('cloudflare', [
      domain({ domainName: 'c.com', registrar: 'cloudflare' }),
    ]);
    // cloudflare has no stored credentials → not configured.
    await syncRegistrar('cloudflare');
    expect(store.portfolio.cloudflare).toBeUndefined();
  });

  it('keeps a configured-but-disabled account’s cached slice', async () => {
    seedSlice('dynadot', [
      domain({ domainName: 'a.com', registrar: 'dynadot' }),
    ]);
    // Disabling keeps credentials and cache; syncing a disabled account must
    // not fetch and must not wipe the last-good slice.
    enabled.dynadot = false;
    await syncRegistrar('dynadot');
    expect(listPortfolio).not.toHaveBeenCalled();
    expect(store.portfolio.dynadot).toBeDefined();
  });
});

describe('GoDaddy shopper renewal quotes on sync', () => {
  const gd = (domainName: string) =>
    domain({ domainName, registrar: 'godaddy' });
  const quotedNames = () =>
    clientMethods.getPricing.mock.calls.map(([name]) => name as string);

  beforeEach(() => {
    // GoDaddy alone, so the quote calls below belong to this account.
    delete storedCredentials.dynadot;
    delete storedCredentials.porkbun;
    storedCredentials.godaddy = { apiToken: 'pat' };
  });

  it('prices each TLD off a dummy name and quotes premiums per name', async () => {
    listPortfolio.mockResolvedValue({
      domains: [gd('404cosgrove.com'), gd('cheap.io'), gd('fancy.io')],
      errors: [],
    });
    clientMethods.checkAvailability.mockResolvedValue([
      { domainName: 'cheap.io', available: false, premium: false },
      { domainName: 'fancy.io', available: false, premium: true },
    ]);
    clientMethods.getPricing.mockImplementation(async (name: string) => {
      // A name you already own comes back with no prices at all — quoting one
      // is what left every .com on the bundled list rate.
      if (name === '404cosgrove.com') return { tld: 'com', currency: 'USD' };
      if (name === 'fancy.io')
        return { tld: 'io', currency: 'USD', renewal: 199 };
      return name.endsWith('.com')
        ? { tld: 'com', currency: 'USD', registration: 11.99, renewal: 8.99 }
        : { tld: 'io', currency: 'USD', registration: 44, renewal: 44 };
    });

    await getPortfolio(true);

    expect(setTldRate.mock.calls).toEqual([
      ['godaddy', 'com', 8.99, 'godaddy'],
      ['godaddy', 'io', 44, 'godaddy'],
    ]);
    // One .com quote, and it was a dummy rather than the owned name.
    expect(quotedNames()).not.toContain('404cosgrove.com');
    expect(quotedNames().filter((n) => n.endsWith('.com'))).toHaveLength(1);
    expect(store.detail['godaddy:fancy.io'].data).toEqual({
      renewalQuote: { renewal: 199, currency: 'USD' },
    });
    // Standard names ride the TLD rate; nothing per-name is stored for them.
    expect(store.detail['godaddy:cheap.io']).toBeUndefined();
  });

  it('reads a register-only quote as the renewal rate', async () => {
    listPortfolio.mockResolvedValue({ domains: [gd('a.com')], errors: [] });
    // v3 omits renewalPrice when it matches the register price.
    clientMethods.getPricing.mockResolvedValue({
      tld: 'com',
      currency: 'USD',
      registration: 21.99,
    });

    await getPortfolio(true);

    expect(setTldRate.mock.calls).toEqual([
      ['godaddy', 'com', 21.99, 'godaddy'],
    ]);
    // .com carries no premium names, so no availability check is needed.
    expect(clientMethods.checkAvailability).not.toHaveBeenCalled();
  });

  it('leaves a TLD unpriced when the quote carries no prices at all', async () => {
    listPortfolio.mockResolvedValue({ domains: [gd('a.com')], errors: [] });
    clientMethods.getPricing.mockResolvedValue({ tld: 'com', currency: 'USD' });

    await getPortfolio(true);

    expect(setTldRate).not.toHaveBeenCalled();
    // Two dummies plus the owned name before giving up on the TLD.
    expect(quotedNames()).toHaveLength(3);
    expect(quotedNames().at(-1)).toBe('a.com');
  });

  it('falls back to the owned name when the dummy quotes fail', async () => {
    listPortfolio.mockResolvedValue({ domains: [gd('a.com')], errors: [] });
    clientMethods.getPricing.mockImplementation(async (name: string) => {
      if (name === 'a.com')
        return { tld: 'com', currency: 'USD', renewal: 9.5 };
      throw new Error('rate limited');
    });

    await getPortfolio(true);

    expect(setTldRate.mock.calls).toEqual([['godaddy', 'com', 9.5, 'godaddy']]);
    expect(quotedNames().at(-1)).toBe('a.com');
  });

  it('stores no per-name quote when a premium name comes back priceless', async () => {
    listPortfolio.mockResolvedValue({
      domains: [gd('cheap.io'), gd('fancy.io')],
      errors: [],
    });
    clientMethods.checkAvailability.mockResolvedValue([
      { domainName: 'cheap.io', available: false, premium: false },
      { domainName: 'fancy.io', available: false, premium: true },
    ]);
    clientMethods.getPricing.mockImplementation(async (name: string) =>
      // The known gap: an owned premium name reports no prices, so it has to
      // ride the TLD rate rather than pin an empty entry over it.
      name === 'fancy.io'
        ? { tld: 'io', currency: 'USD' }
        : { tld: 'io', currency: 'USD', renewal: 44 },
    );

    await getPortfolio(true);

    expect(setTldRate.mock.calls).toEqual([['godaddy', 'io', 44, 'godaddy']]);
    expect(store.detail['godaddy:fancy.io']).toBeUndefined();
  });

  it('still samples one name per TLD when the availability check fails', async () => {
    listPortfolio.mockResolvedValue({
      domains: [gd('cheap.io'), gd('fancy.io')],
      errors: [],
    });
    clientMethods.checkAvailability.mockRejectedValue(new Error('429'));
    clientMethods.getPricing.mockResolvedValue({
      tld: 'io',
      currency: 'USD',
      renewal: 44,
    });

    await getPortfolio(true);

    // Unknown flags mean no per-name premium quotes, but the TLD still prices.
    expect(setTldRate.mock.calls).toEqual([['godaddy', 'io', 44, 'godaddy']]);
    expect(store.detail['godaddy:fancy.io']).toBeUndefined();
  });
});

describe('Namecheap account TLD rates on sync', () => {
  const nc = (domainName: string) =>
    domain({ domainName, registrar: 'namecheap' });
  const tldOfName = (name: string) => name.slice(name.indexOf('.') + 1);
  const pricedTlds = () =>
    clientMethods.getPricing.mock.calls.map(([name]) =>
      tldOfName(name as string),
    );

  beforeEach(() => {
    delete storedCredentials.dynadot;
    delete storedCredentials.porkbun;
    storedCredentials.namecheap = { apiKey: 'k' };
    clientMethods.checkAvailability.mockResolvedValue([]);
  });

  it('stores the account renewal price once per distinct TLD', async () => {
    listPortfolio.mockResolvedValue({
      domains: [nc('a.com'), nc('b.com'), nc('c.io')],
      errors: [],
    });
    clientMethods.getPricing.mockImplementation(async (name: string) => {
      const tld = tldOfName(name);
      return tld === 'com'
        ? { tld, currency: 'USD', registration: 11.28, renewal: 13.98 }
        : { tld, currency: 'USD', registration: 34.98, renewal: 52.98 };
    });

    await getPortfolio(true);

    expect(pricedTlds()).toEqual(['com', 'io']);
    expect(setTldRate.mock.calls).toEqual([
      ['namecheap', 'com', 13.98, 'namecheap'],
      ['namecheap', 'io', 52.98, 'namecheap'],
    ]);
    // A TLD rate only — nothing per-name lands in the detail cache.
    expect(store.detail).toEqual({});
  });

  it('prices a multi-part TLD as a whole', async () => {
    listPortfolio.mockResolvedValue({ domains: [nc('a.br.com')], errors: [] });
    clientMethods.getPricing.mockResolvedValue({
      tld: 'br.com',
      currency: 'USD',
      renewal: 44.98,
    });

    await getPortfolio(true);

    // The client keeps what follows the first dot, so this is quoted as br.com.
    expect(clientMethods.getPricing).toHaveBeenCalledWith('example.br.com');
    expect(setTldRate.mock.calls).toEqual([
      ['namecheap', 'br.com', 44.98, 'namecheap'],
    ]);
  });

  it('keeps the existing rate for a TLD that comes back unpriced', async () => {
    listPortfolio.mockResolvedValue({
      domains: [nc('a.com'), nc('b.io'), nc('c.eu')],
      errors: [],
    });
    clientMethods.getPricing.mockImplementation(async (name: string) => {
      const tld = tldOfName(name);
      if (tld === 'com') return { tld, currency: 'USD' };
      if (tld === 'io') return { tld, currency: 'EUR', renewal: 40 };
      return { tld, currency: 'USD', renewal: 8.98 };
    });

    await getPortfolio(true);

    expect(setTldRate.mock.calls).toEqual([
      ['namecheap', 'eu', 8.98, 'namecheap'],
    ]);
  });

  it('stops pricing after the first failed call', async () => {
    listPortfolio.mockResolvedValue({
      domains: [nc('a.com'), nc('b.io'), nc('c.eu')],
      errors: [],
    });
    clientMethods.getPricing.mockImplementation(async (name: string) => {
      const tld = tldOfName(name);
      if (tld === 'io') throw new Error('Too many requests');
      return { tld, currency: 'USD', renewal: 13.98 };
    });

    await getPortfolio(true);

    expect(pricedTlds()).toEqual(['com', 'io']);
    expect(setTldRate.mock.calls).toEqual([
      ['namecheap', 'com', 13.98, 'namecheap'],
    ]);
  });
});

describe('Namecheap premium renewal quotes on sync', () => {
  const nc = (domainName: string) =>
    domain({ domainName, registrar: 'namecheap' });
  const checkedNames = () =>
    clientMethods.checkAvailability.mock.calls.flatMap(
      ([names]) => names as string[],
    );

  beforeEach(() => {
    delete storedCredentials.dynadot;
    delete storedCredentials.porkbun;
    storedCredentials.namecheap = { apiKey: 'k' };
    clientMethods.getPricing.mockResolvedValue({
      tld: 'io',
      currency: 'USD',
      renewal: 52.98,
    });
  });

  it('stores the premium renewal price for premium names only', async () => {
    listPortfolio.mockResolvedValue({
      domains: [nc('plain.com'), nc('cheap.io'), nc('fancy.io')],
      errors: [],
    });
    clientMethods.checkAvailability.mockResolvedValue([
      { domainName: 'cheap.io', available: false, premium: false },
      {
        domainName: 'fancy.io',
        available: false,
        premium: true,
        price: 1500,
        renewalPrice: 1200,
      },
    ]);

    await getPortfolio(true);

    // .com carries no premium names, so only the .io names are checked.
    expect(checkedNames()).toEqual(['cheap.io', 'fancy.io']);
    expect(store.detail['namecheap:fancy.io'].data).toEqual({
      renewalQuote: { renewal: 1200, currency: 'USD' },
    });
    expect(store.detail['namecheap:cheap.io']).toBeUndefined();
  });

  it('checks 50 names per call', async () => {
    const names = Array.from({ length: 51 }, (_, i) => `n${i}.io`);
    listPortfolio.mockResolvedValue({ domains: names.map(nc), errors: [] });

    await getPortfolio(true);

    expect(
      clientMethods.checkAvailability.mock.calls.map(([n]) => n.length),
    ).toEqual([50, 1]);
  });

  it('drops a stored premium quote once the name checks as standard', async () => {
    listPortfolio.mockResolvedValue({ domains: [nc('was.io')], errors: [] });
    store.detail['namecheap:was.io'] = {
      data: {
        autoRenew: true,
        renewalQuote: { renewal: 900, currency: 'USD' },
      },
      fetchedAt: 123,
    };
    clientMethods.checkAvailability.mockResolvedValue([
      { domainName: 'was.io', available: false, premium: false },
    ]);

    await getPortfolio(true);

    // The detail stays, with its age, minus the quote.
    expect(store.detail['namecheap:was.io']).toEqual({
      data: { autoRenew: true },
      fetchedAt: 123,
    });
  });

  it('keeps stored quotes when the check fails', async () => {
    listPortfolio.mockResolvedValue({ domains: [nc('fancy.io')], errors: [] });
    const quote = { renewalQuote: { renewal: 1200, currency: 'USD' } };
    store.detail['namecheap:fancy.io'] = { data: quote, fetchedAt: 1 };
    clientMethods.checkAvailability.mockRejectedValue(new Error('rate limit'));

    await getPortfolio(true);

    expect(store.detail['namecheap:fancy.io'].data).toEqual(quote);
  });

  it('skips the premium check when the TLD pass fails', async () => {
    listPortfolio.mockResolvedValue({ domains: [nc('fancy.io')], errors: [] });
    clientMethods.getPricing.mockRejectedValue(new Error('rate limit'));

    await getPortfolio(true);

    expect(clientMethods.checkAvailability).not.toHaveBeenCalled();
  });

  it('serves the stored premium quote to a live price lookup', async () => {
    seedSlice('namecheap', [nc('fancy.io')]);
    const quote = { renewal: 1200, currency: 'USD' };
    store.detail['namecheap:fancy.io'] = {
      data: { renewalQuote: quote },
      fetchedAt: 1,
    };
    resolvePricing.mockReturnValue({ domain: 'fancy.io', source: 'api' });

    await getRenewalPriceLive('namecheap', 'fancy.io');

    expect(resolvePricing).toHaveBeenCalledWith(
      'namecheap',
      'fancy.io',
      quote,
      'namecheap',
    );
    expect(clientMethods.getPricing).not.toHaveBeenCalled();
  });
});

describe('getRegistrationQuote', () => {
  it('returns no fee when the registrar has no pricing API', async () => {
    clientMethods.getPricing.mockRejectedValue(
      new NotImplementedError('spaceship: getPricing is not available'),
    );
    await expect(
      getRegistrationQuote('dynadot', 'backyard.green'),
    ).resolves.toEqual({
      amount: null,
      currency: 'USD',
    });
  });

  it('returns the registration fee when the registrar quotes one', async () => {
    clientMethods.getPricing.mockResolvedValue({
      tld: 'green',
      currency: 'USD',
      registration: 4.5,
    });
    await expect(
      getRegistrationQuote('dynadot', 'backyard.green'),
    ).resolves.toEqual({
      amount: '4.50',
      currency: 'USD',
    });
  });
});

describe('cache patching via setAutoRenewCached', () => {
  it('patches both caches on success', async () => {
    seedSlice('dynadot', [
      domain({ domainName: 'a.com', registrar: 'dynadot', autoRenew: false }),
    ]);
    store.detail['dynadot:a.com'] = {
      data: { autoRenew: false },
      fetchedAt: 111,
    };
    clientMethods.setAutoRenew.mockResolvedValue({
      success: true,
      message: 'ok',
    });

    const r = await setAutoRenewCached('dynadot', 'a.com', true);
    expect(r.success).toBe(true);
    expect(
      (store.portfolio.dynadot.data as { domains: Domain[] }).domains[0]
        .autoRenew,
    ).toBe(true);
    expect(
      (store.detail['dynadot:a.com'].data as Partial<Domain>).autoRenew,
    ).toBe(true);
    // patchEntryData preserves fetchedAt.
    expect(store.detail['dynadot:a.com'].fetchedAt).toBe(111);
  });

  it('does not patch on a soft failure', async () => {
    seedSlice('dynadot', [
      domain({ domainName: 'a.com', registrar: 'dynadot', autoRenew: false }),
    ]);
    clientMethods.setAutoRenew.mockResolvedValue({
      success: false,
      message: 'nope',
    });

    const r = await setAutoRenewCached('dynadot', 'a.com', true);
    expect(r.success).toBe(false);
    expect(
      (store.portfolio.dynadot.data as { domains: Domain[] }).domains[0]
        .autoRenew,
    ).toBe(false);
  });
});

const sliceDomain = (name = 'dynadot') =>
  (store.portfolio[name].data as { domains: Domain[] }).domains[0];

describe('setLockCached / setPrivacyCached / setNameserversCached', () => {
  beforeEach(() =>
    seedSlice('dynadot', [
      domain({ domainName: 'a.com', registrar: 'dynadot' }),
    ]),
  );

  it('lock calls lockDomain and patches on success', async () => {
    clientMethods.lockDomain.mockResolvedValue({ success: true, message: '' });
    await setLockCached('dynadot', 'a.com', true);
    expect(clientMethods.lockDomain).toHaveBeenCalled();
    expect(clientMethods.unlockDomain).not.toHaveBeenCalled();
    expect(sliceDomain().locked).toBe(true);
  });

  it('unlock calls unlockDomain', async () => {
    clientMethods.unlockDomain.mockResolvedValue({
      success: true,
      message: '',
    });
    await setLockCached('dynadot', 'a.com', false);
    expect(clientMethods.unlockDomain).toHaveBeenCalled();
    expect(sliceDomain().locked).toBe(false);
  });

  it('privacy patches on success', async () => {
    clientMethods.setPrivacy.mockResolvedValue({ success: true, message: '' });
    await setPrivacyCached('dynadot', 'a.com', true);
    expect(sliceDomain().privacy).toBe(true);
  });

  it('nameservers patches on success and not on failure', async () => {
    clientMethods.updateNameservers.mockResolvedValue({
      success: true,
      message: '',
    });
    await setNameserversCached('dynadot', 'a.com', ['ns1.x', 'ns2.x']);
    expect(sliceDomain().nameservers).toEqual(['ns1.x', 'ns2.x']);

    clientMethods.updateNameservers.mockResolvedValue({
      success: false,
      message: 'no',
    });
    await setNameserversCached('dynadot', 'a.com', ['ns3.x']);
    expect(sliceDomain().nameservers).toEqual(['ns1.x', 'ns2.x']); // unchanged
  });
});

describe('renewDomainCached', () => {
  beforeEach(() =>
    seedSlice('dynadot', [
      domain({
        domainName: 'a.com',
        registrar: 'dynadot',
        expirationDate: new Date('2026-01-01'),
      }),
    ]),
  );

  it('re-fetches detail and returns + patches the fresh expiry on success', async () => {
    clientMethods.renewDomain.mockResolvedValue({
      success: true,
      message: 'Renewed',
    });
    // getDomainDetail(refresh:true) → client.getDomain returns the new record.
    clientMethods.getDomain.mockResolvedValue(
      domain({
        domainName: 'a.com',
        registrar: 'dynadot',
        expirationDate: new Date('2027-01-01'),
        status: 'active',
        nameservers: ['ns1.x'],
      }),
    );

    const { result, patch } = await renewDomainCached('dynadot', 'a.com', 1);
    expect(result.success).toBe(true);
    expect(patch.expirationDate).toEqual(new Date('2027-01-01'));
    // Portfolio slice patched with the new expiry too.
    expect(sliceDomain().expirationDate).toEqual(new Date('2027-01-01'));
  });

  it('returns an empty patch and swallows a re-fetch failure', async () => {
    clientMethods.renewDomain.mockResolvedValue({
      success: true,
      message: 'Renewed',
    });
    clientMethods.getDomain.mockRejectedValue(new Error('detail down'));
    clientMethods.getNameservers.mockRejectedValue(new Error('no ns'));

    const { result, patch } = await renewDomainCached('dynadot', 'a.com', 1);
    expect(result.success).toBe(true);
    expect(patch).toEqual({});
    // Original expiry untouched.
    expect(sliceDomain().expirationDate).toEqual(new Date('2026-01-01'));
  });

  it('does not re-fetch on a soft failure', async () => {
    clientMethods.renewDomain.mockResolvedValue({
      success: false,
      message: 'declined',
    });
    const { result, patch } = await renewDomainCached('dynadot', 'a.com', 1);
    expect(result.success).toBe(false);
    expect(patch).toEqual({});
    expect(clientMethods.getDomain).not.toHaveBeenCalled();
  });
});

describe('registerDomainCached', () => {
  it('syncs the registrar slice on success so the new name enters the cache', async () => {
    clientMethods.registerDomain.mockResolvedValue({
      success: true,
      message: 'Registered',
    });
    listPortfolio.mockResolvedValue({
      domains: [domain({ domainName: 'new.com', registrar: 'dynadot' })],
      errors: [],
    });

    const r = await registerDomainCached('dynadot', 'new.com', {} as never);
    expect(r.success).toBe(true);
    expect(listPortfolio).toHaveBeenCalledTimes(1);
    expect(
      (store.portfolio.dynadot.data as { domains: Domain[] }).domains[0]
        .domainName,
    ).toBe('new.com');
  });

  it('does not sync on a failed registration', async () => {
    clientMethods.registerDomain.mockResolvedValue({
      success: false,
      message: 'taken',
    });
    const r = await registerDomainCached('dynadot', 'new.com', {} as never);
    expect(r.success).toBe(false);
    expect(listPortfolio).not.toHaveBeenCalled();
  });
});

describe('getDomainDetail — nameserver resolution', () => {
  it('serves a fresh cached entry without a network call', async () => {
    store.detail['dynadot:a.com'] = {
      data: { nameservers: ['cached.ns'] },
      fetchedAt: Date.now(),
    };
    const detail = await getDomainDetail('dynadot', 'a.com');
    expect(detail).toEqual({
      nameservers: ['cached.ns'],
      registrar: 'dynadot',
      accountId: 'dynadot',
      accountLabel: 'Default',
    });
    expect(clientMethods.getDomain).not.toHaveBeenCalled();
  });

  it('falls back to the registrar nameserver endpoint when getDomain has none', async () => {
    clientMethods.getDomain.mockResolvedValue(
      domain({ domainName: 'a.com', registrar: 'dynadot', nameservers: [] }),
    );
    clientMethods.getNameservers.mockResolvedValue(['reg.ns1', 'reg.ns2']);
    const detail = await getDomainDetail('dynadot', 'a.com', true);
    expect(detail?.nameservers).toEqual(['reg.ns1', 'reg.ns2']);
  });

  // Normalization (case, trailing dot) is the DNS module's job — see
  // core/dns.test.ts. Here the resolver already returns clean names.
  it('falls back to a live DNS query', async () => {
    clientMethods.getDomain.mockResolvedValue(
      domain({ domainName: 'a.com', registrar: 'dynadot', nameservers: [] }),
    );
    clientMethods.getNameservers.mockResolvedValue([]);
    resolveNs.mockResolvedValue(['ns1.cloudflare.com', 'ns2.cloudflare.com']);
    const detail = await getDomainDetail('dynadot', 'a.com', true);
    expect(detail?.nameservers).toEqual([
      'ns1.cloudflare.com',
      'ns2.cloudflare.com',
    ]);
  });

  it('returns null when nothing resolves and there is no prior entry', async () => {
    clientMethods.getDomain.mockRejectedValue(new Error('no detail'));
    clientMethods.getNameservers.mockRejectedValue(new Error('no ns'));
    resolveNs.mockRejectedValue(new Error('nxdomain'));
    const detail = await getDomainDetail('dynadot', 'a.com', true);
    expect(detail).toBeNull();
  });
});
