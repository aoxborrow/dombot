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
};
const listPortfolio = vi.fn();
vi.mock('@aoxborrow/registrar-client', () => {
  class RegistrarClient {
    constructor() {
      Object.assign(this, clientMethods);
    }
  }
  return {
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

vi.mock('./pricing', () => ({
  usesPerNameQuote: () => false,
  tldOf: (d: string) => d.slice(d.indexOf('.') + 1),
  resolvePricing: vi.fn(),
}));

const resolveNs = vi.fn<(d: string) => Promise<string[]>>();
vi.mock('../dns', () => ({
  resolveNameservers: (d: string) => resolveNs(d),
}));

import {
  findRegistrarsForDomain,
  getCachedPortfolio,
  getDomainDetail,
  getMergedPortfolio,
  getPortfolio,
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

describe('syncRegistrar — drops the slice when unconfigured/disabled', () => {
  it('clears a registrar that is no longer configured', async () => {
    seedSlice('cloudflare', [
      domain({ domainName: 'c.com', registrar: 'cloudflare' }),
    ]);
    // cloudflare has no stored credentials → not configured.
    await syncRegistrar('cloudflare');
    expect(store.portfolio.cloudflare).toBeUndefined();
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
