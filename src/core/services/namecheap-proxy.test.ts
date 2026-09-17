import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@aoxborrow/registrar-client';
import {
  configureNamecheapProxyTransport,
  createProxiedNamecheap,
  type NamecheapProxyFetch,
} from './namecheap-proxy';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { MemoryDocStore } from '../storage/doc-store';
import { aesGcmCipher, EncryptedDocStore } from '../storage/encrypted';
import { exportBundle, importBundle } from '../storage/bundle';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import { listAccounts } from './accounts';
import {
  getProxyProfile,
  getProxySettings,
  listProxyProfiles,
  migrateLegacyProxies,
  removeProxyProfile,
  saveProxyProfile,
  testProxy,
} from './proxies';
import {
  connectRegistrarAccount,
  getRegistrarClient,
  getRegistrarMetadata,
  getMergedPortfolio,
  resetRegistrarClients,
  saveRegistrarCredentials,
  syncRegistrar,
} from './registrars';

const credentials = {
  username: 'test-user',
  apiKey: 'api-secret',
  clientIp: '9.9.9.9',
};
const proxy = {
  url: 'https://proxy-user:proxy-secret@8.8.8.8:8080/',
  ip: '8.8.4.4',
};
const configured = { ...credentials, proxyUrl: proxy.url, proxyIp: proxy.ip };
const xml =
  '<ApiResponse Status="OK"><CommandResponse><DomainGetListResult><Domain ID="1" Name="example.test" Created="01/01/2020" Expires="01/01/2030" /></DomainGetListResult><Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging></CommandResponse></ApiResponse>';
const transport = vi.fn<NamecheapProxyFetch>();
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  resetRegistrarClients();
  transport.mockReset();
  configureNamecheapProxyTransport(transport);
});
afterEach(() => {
  configureNamecheapProxyTransport();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Namecheap proxy command transport', () => {
  it('rejects a private proxy endpoint and never forwards an off-origin request', async () => {
    expect(() =>
      createProxiedNamecheap(credentials, {
        ...proxy,
        url: 'http://127.0.0.1:8080',
      }),
    ).toThrow(/public/);
    const provider = createProxiedNamecheap(credentials, proxy);
    const http = (provider as unknown as { http: HttpClient }).http;
    await expect(
      http.requestText({
        path: 'https://elsewhere.example/xml.response',
        query: { ApiKey: 'api-secret' },
      }),
    ).rejects.toThrow(/restricted/);
    expect(transport).not.toHaveBeenCalled();
  });
  it('routes listing through the proxy with the correct ClientIp and preserves stored credentials', async () => {
    transport.mockResolvedValue(new Response(xml));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('direct fetch used');
      }),
    );
    const domains = await createProxiedNamecheap(
      credentials,
      proxy,
    ).listDomains();
    expect(domains.map((d) => d.domainName)).toEqual(['example.test']);
    const [selected, url, init] = transport.mock.calls[0];
    expect(selected).toEqual(proxy);
    const request = new URL(url);
    expect(request.origin + request.pathname).toBe(
      'https://api.namecheap.com/xml.response',
    );
    expect(request.searchParams.get('ClientIp')).toBe(proxy.ip);
    expect(request.searchParams.get('ApiKey')).toBe('api-secret');
    expect(init.redirect).toBe('manual');
    expect(credentials.clientIp).toBe('9.9.9.9');
  });
  it('retries a transient read at most twice', async () => {
    transport
      .mockResolvedValueOnce(new Response('private response', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(xml));
    await expect(
      createProxiedNamecheap(credentials, proxy).listDomains({
        backoff: 0,
        retries: 10,
      }),
    ).resolves.toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it.each(['http', 'network'])(
    'does not retry a renewal after a %s failure even though it uses GET',
    async (kind) => {
      if (kind === 'http')
        transport.mockResolvedValue(
          new Response('api-secret proxy-secret', { status: 500 }),
        );
      else transport.mockRejectedValue(new Error('api-secret proxy-secret'));
      await expect(
        createProxiedNamecheap(credentials, proxy).renewDomain(
          'example.test',
          1,
          { retries: 10, backoff: 0 },
        ),
      ).rejects.toThrow(/before retrying/);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0][2].method).toBe('GET');
    },
  );
  it.each([302, 401, 403, 407])(
    'fails closed for HTTP %s without leaking secrets or following redirects',
    async (status) => {
      transport.mockResolvedValue(
        new Response('api-secret proxy-secret upstream body', {
          status,
          headers: { location: 'https://other.example' },
        }),
      );
      const result = await createProxiedNamecheap(
        credentials,
        proxy,
      ).testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain(String(status));
      expect(result.message).not.toMatch(
        /api-secret|proxy-secret|upstream body|ApiKey=/,
      );
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('does not send an already-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createProxiedNamecheap(credentials, proxy).listDomains({
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('aborts a timed-out transport and does not expose its exception', async () => {
    vi.useFakeTimers();
    transport.mockImplementation(
      (_proxy, _url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new Error('proxy-secret')),
            { once: true },
          );
        }),
    );
    const pending = createProxiedNamecheap(credentials, proxy).listDomains({
      timeout: 10,
      retries: 0,
    });
    const assertion = expect(pending).rejects.toThrow(
      'Namecheap proxy request timed out.',
    );
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(transport.mock.calls[0][2].signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    'CERT_NAME_MISMATCH',
    'PROXY_AUTH_FAILED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('does not retry permanent transport failure %s', async (code) => {
    transport.mockRejectedValue(
      Object.assign(new Error('proxy-secret'), { code }),
    );
    const result = await createProxiedNamecheap(
      credentials,
      proxy,
    ).testConnection({ retries: 2, backoff: 0 });
    expect(result.success).toBe(false);
    expect(result.message).not.toContain('proxy-secret');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('reports XML API error codes without echoing the provider body', async () => {
    transport.mockResolvedValue(
      new Response(
        '<ApiResponse Status="ERROR"><Errors><Error Number="1011150">api-secret proxy-secret</Error></Errors></ApiResponse>',
      ),
    );
    const result = await createProxiedNamecheap(
      credentials,
      proxy,
    ).testConnection();
    expect(result).toMatchObject({
      success: false,
      message: 'Namecheap API rejected the request (code 1011150).',
    });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('never falls back to direct networking when the host transport is missing', () => {
    configureNamecheapProxyTransport();
    expect(() => createProxiedNamecheap(credentials, proxy)).toThrow(
      /unavailable/,
    );
  });
});

const profile = { url: proxy.url, egressIp: proxy.ip };
// An account with no address of its own: only the proxy makes it usable.
const proxyOnly = {
  username: credentials.username,
  apiKey: credentials.apiKey,
};
const namecheapMeta = () =>
  getRegistrarMetadata().find((r) => r.name === 'namecheap')!;

describe('central proxy settings', () => {
  it('validates before saving and refuses removal while an account depends on it', async () => {
    await expect(
      saveProxyProfile({ ...profile, egressIp: '127.0.0.1' }),
    ).rejects.toThrow(/public/);
    expect(getProxyProfile()).toBeNull();
    await saveProxyProfile(profile);
    expect(getProxySettings()).toEqual({ proxy: profile, users: [] });

    await saveRegistrarCredentials('namecheap', credentials, undefined, true);
    expect(getProxySettings().users).toEqual([
      { accountId: 'namecheap', registrar: 'namecheap', label: 'Default' },
    ]);
    await expect(removeProxyProfile()).rejects.toThrow(/still uses/);
    await saveRegistrarCredentials('namecheap', credentials, undefined, false);
    await removeProxyProfile();
    expect(getProxyProfile()).toBeNull();
  });

  it('cannot be switched on for an account before a proxy exists, and changes nothing when refused', async () => {
    await saveRegistrarCredentials('namecheap', credentials);
    await expect(
      saveRegistrarCredentials(
        'namecheap',
        { ...credentials, apiKey: 'changed' },
        undefined,
        true,
      ),
    ).rejects.toThrow(/Settings → Proxy/);
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
    expect(namecheapMeta().proxy).toBe(false);
  });

  it('never puts the proxy back into the credentials of an account', async () => {
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('namecheap', configured, undefined, true);
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
  });

  it('is offered only to registrars that can use it, and never silently goes direct', async () => {
    await saveProxyProfile(profile);
    await expect(
      saveRegistrarCredentials(
        'porkbun',
        { apiKey: 'k', secretApiKey: 's' },
        undefined,
        true,
      ),
    ).rejects.toThrow(/not available for Porkbun/);
    await expect(
      connectRegistrarAccount(
        'porkbun',
        { apiKey: 'k', secretApiKey: 's' },
        undefined,
        true,
      ),
    ).rejects.toThrow(/not available for Porkbun/);
  });

  it('reports the address seen through the proxy, falling back to a second service', async () => {
    transport.mockResolvedValueOnce(new Response('fl=1\nip=8.8.4.4\nts=1\n'));
    expect(await testProxy(profile)).toEqual({
      ip: '8.8.4.4',
      expected: '8.8.4.4',
      matches: true,
    });
    expect(transport.mock.calls[0][0]).toEqual(proxy);
    expect(new URL(transport.mock.calls[0][1]).hostname).toBe(
      'www.cloudflare.com',
    );

    transport.mockReset();
    transport
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce(Response.json({ ip: '1.2.3.4' }));
    expect(await testProxy(profile)).toMatchObject({
      ip: '1.2.3.4',
      matches: false,
    });
    expect(new URL(transport.mock.calls[1][1]).hostname).toBe('ipinfo.io');
  });

  it('tests unsaved values, rejects invalid ones without a request, and never echoes the password', async () => {
    await expect(
      testProxy({ url: 'http://10.0.0.1:8080', egressIp: proxy.ip }),
    ).rejects.toThrow(/public/);
    expect(transport).not.toHaveBeenCalled();
    transport.mockRejectedValue(
      new Error(`407 from ${proxy.url} for proxy-user:proxy-secret`),
    );
    const error = await testProxy(profile).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/Could not connect/);
    expect((error as Error).message).not.toMatch(/proxy-secret|proxy-user/);
    expect(getProxyProfile()).toBeNull();
  });
});

describe('account persistence and routing', () => {
  it('does not route other registrars through the proxy transport', async () => {
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('porkbun', {
      apiKey: 'test-key',
      secretApiKey: 'test-secret',
    });
    const native = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: 'SUCCESS' }));
    vi.stubGlobal('fetch', native);
    await getRegistrarClient('porkbun').testConnection();
    expect(native).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  });

  it('seals the proxy at rest and carries it, with the toggle of each account, through export and import', async () => {
    const disk = new MemoryDocStore();
    configureStore(
      new EncryptedDocStore(
        disk,
        await aesGcmCipher(crypto.getRandomValues(new Uint8Array(32))),
      ),
    );
    await hydrateStores();
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('namecheap', credentials, undefined, true);
    await flushWrites();
    expect(await disk.get('proxies', 'default')).toMatchObject({ __sealed: 1 });
    expect(JSON.stringify(await disk.list('proxies'))).not.toContain(
      'proxy-secret',
    );
    const bundle = exportBundle({ version: 'test', platform: 'web' });
    expect(JSON.parse(bundle).version).toBe(3);

    configureStore(new MemoryDocStore());
    await hydrateStores();
    await importBundle(bundle);
    await flushWrites();
    await hydrateStores();
    expect(getProxyProfile()).toMatchObject(profile);
    expect(namecheapMeta()).toMatchObject({ configured: true, proxy: true });
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
  });

  it('rejects a bundle with a private-range proxy or an account pointing at a missing one', async () => {
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('namecheap', credentials, undefined, true);
    const good = JSON.parse(exportBundle({ version: 'test', platform: 'web' }));

    const privateProxy = structuredClone(good);
    privateProxy.namespaces.proxies.default.url = 'http://127.0.0.1:8080';
    await expect(importBundle(JSON.stringify(privateProxy))).rejects.toThrow(
      /public/,
    );
    const mismatched = structuredClone(good);
    mismatched.namespaces.proxies.default.id = 'other';
    await expect(importBundle(JSON.stringify(mismatched))).rejects.toThrow(
      /Malformed/,
    );
    const dangling = structuredClone(good);
    delete dangling.namespaces.proxies;
    await expect(importBundle(JSON.stringify(dangling))).rejects.toThrow(
      /does not contain/,
    );
    // Legacy per-account fields are still validated on the way in.
    const legacy = structuredClone(good);
    legacy.namespaces.credentials.namecheap = {
      ...configured,
      proxyUrl: 'http://127.0.0.1:8080',
    };
    await expect(importBundle(JSON.stringify(legacy))).rejects.toThrow(
      /public/,
    );
    expect(getProxyProfile()).toMatchObject(profile);
  });

  it('supports a proxy-only account with no direct IP, and restores direct routing when switched off', async () => {
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('namecheap', proxyOnly, undefined, true);
    expect(namecheapMeta()).toMatchObject({ configured: true, proxy: true });
    // The proxy's address is supplied when the client is built, never stored
    // as though it were the user's own.
    expect(getStoredCredentials('namecheap').clientIp).toBeUndefined();
    transport.mockImplementation(() => Promise.resolve(new Response(xml)));
    const proxied = getRegistrarClient('namecheap');
    await proxied.listDomains();
    expect(
      new URL(transport.mock.calls[0][1]).searchParams.get('ClientIp'),
    ).toBe(proxy.ip);

    // Off without a direct IP: the account is incomplete, not silently direct.
    await saveRegistrarCredentials('namecheap', proxyOnly, undefined, false);
    expect(namecheapMeta()).toMatchObject({ configured: false, proxy: false });

    await saveRegistrarCredentials('namecheap', credentials, undefined, false);
    const direct = getRegistrarClient('namecheap');
    expect(direct).not.toBe(proxied);
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response(xml));
    vi.stubGlobal('fetch', native);
    transport.mockClear();
    await direct.testConnection();
    expect(native).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rebuilds a proxied client when the proxy itself changes', async () => {
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('namecheap', credentials, undefined, true);
    const before = getRegistrarClient('namecheap');
    expect(getRegistrarClient('namecheap')).toBe(before);
    await saveProxyProfile({ ...profile, egressIp: '8.8.8.8' });
    expect(getRegistrarClient('namecheap')).not.toBe(before);
  });

  it('connects a new account through the proxy and records the toggle', async () => {
    await saveProxyProfile(profile);
    transport.mockImplementation(() => Promise.resolve(new Response(xml)));
    const account = await connectRegistrarAccount(
      'namecheap',
      proxyOnly,
      'Agency',
      true,
    );
    expect(account.proxyId).toBe('default');
    expect(transport).toHaveBeenCalled();
    expect(getStoredCredentials(account.id)).toEqual(proxyOnly);
    await expect(
      connectRegistrarAccount('namecheap', proxyOnly, 'Direct', false),
    ).rejects.toThrow(/Client IP is required/);
  });

  it('keeps the proxy password out of sync errors', async () => {
    await saveProxyProfile(profile);
    await saveRegistrarCredentials('namecheap', credentials, undefined, true);
    transport.mockRejectedValue(
      new Error(`tunnel to ${proxy.url} failed for proxy-secret`),
    );
    await syncRegistrar('namecheap');
    const text = JSON.stringify(getMergedPortfolio().errors);
    expect(text).not.toContain('proxy-secret');
    expect(getMergedPortfolio().errors).toHaveLength(1);
  });
});

describe('migration from per-account proxy fields', () => {
  it('lifts the proxy of a Namecheap account into the default profile, once', async () => {
    await setStoredCredentials('namecheap', configured);
    expect(await migrateLegacyProxies()).toBe(1);
    expect(getProxyProfile()).toMatchObject(profile);
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
    expect(namecheapMeta()).toMatchObject({ configured: true, proxy: true });
    expect(await migrateLegacyProxies()).toBe(0);
    expect(listProxyProfiles()).toHaveLength(1);
  });

  it('drops a Client IP that was only ever the address of the proxy', async () => {
    await setStoredCredentials('namecheap', {
      ...configured,
      clientIp: proxy.ip,
    });
    await migrateLegacyProxies();
    expect(getStoredCredentials('namecheap').clientIp).toBeUndefined();
    expect(namecheapMeta().configured).toBe(true);
  });

  it('shares one profile between accounts with the same proxy and keeps a different one working', async () => {
    await setStoredCredentials('namecheap', configured);
    transport.mockImplementation(() => Promise.resolve(new Response(xml)));
    // The two extra accounts connect directly; never reach the real API.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(xml))),
    );
    await migrateLegacyProxies();
    const same = await connectRegistrarAccount(
      'namecheap',
      { ...credentials, username: 'second' },
      'Second',
    );
    const other = await connectRegistrarAccount(
      'namecheap',
      { ...credentials, username: 'third' },
      'Third',
    );
    await setStoredCredentials(same.id, {
      ...getStoredCredentials(same.id),
      proxyUrl: proxy.url,
      proxyIp: proxy.ip,
    });
    await setStoredCredentials(other.id, {
      ...getStoredCredentials(other.id),
      proxyUrl: 'http://9.9.9.9:3128',
      proxyIp: '9.9.9.10',
    });
    expect(await migrateLegacyProxies()).toBe(2);
    const byId = Object.fromEntries(listAccounts().map((a) => [a.id, a]));
    expect(byId[same.id].proxyId).toBe('default');
    expect(byId[other.id].proxyId).not.toBe('default');
    expect(listProxyProfiles()).toHaveLength(2);
    expect(getProxySettings().proxy).toEqual(profile);
    resetRegistrarClients();
    transport.mockClear();
    await getRegistrarClient('namecheap', other.id).listDomains();
    expect(transport.mock.calls[0][0]).toEqual({
      url: 'http://9.9.9.9:3128/',
      ip: '9.9.9.10',
    });
  });

  it('drops an invalid stored proxy instead of failing startup', async () => {
    await setStoredCredentials('namecheap', {
      ...configured,
      proxyUrl: 'http://127.0.0.1:8080',
    });
    expect(await migrateLegacyProxies()).toBe(1);
    expect(getProxyProfile()).toBeNull();
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
    expect(namecheapMeta().proxy).toBe(false);
  });

  it('migrates a version 2 bundle on import', async () => {
    await setStoredCredentials('namecheap', credentials);
    const bundle = JSON.parse(
      exportBundle({ version: 'test', platform: 'web' }),
    );
    bundle.version = 2;
    bundle.namespaces.credentials.namecheap = configured;
    await importBundle(JSON.stringify(bundle));
    expect(getProxyProfile()).toMatchObject(profile);
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
    expect(namecheapMeta().proxy).toBe(true);
  });
});
