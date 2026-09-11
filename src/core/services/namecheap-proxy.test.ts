import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@aoxborrow/registrar-client';
import {
  configureNamecheapProxyTransport,
  createProxiedNamecheap,
  type NamecheapProxyFetch,
} from './namecheap-proxy';
import { namecheapCredentials } from '../../shared/namecheap-proxy';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { MemoryDocStore } from '../storage/doc-store';
import { aesGcmCipher, EncryptedDocStore } from '../storage/encrypted';
import { exportBundle, importBundle } from '../storage/bundle';
import { getStoredCredentials } from './credentials';
import {
  getRegistrarClient,
  getRegistrarMetadata,
  resetRegistrarClients,
  saveRegistrarCredentials,
} from './registrars';

const credentials = {
  username: 'test-user',
  apiKey: 'api-secret',
  clientIp: '9.9.9.9',
};
const proxy = {
  url: 'http://proxy-user:proxy-secret@8.8.8.8:8080/',
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

describe('account persistence and routing', () => {
  it('does not route other registrars through the Namecheap transport', async () => {
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
  it('validates before changing saved credentials', async () => {
    await saveRegistrarCredentials('namecheap', credentials);
    await expect(
      saveRegistrarCredentials('namecheap', {
        ...configured,
        proxyIp: '127.0.0.1',
      }),
    ).rejects.toThrow(/public/);
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
    const bundle = JSON.parse(
      exportBundle({ version: 'test', platform: 'web' }),
    );
    bundle.namespaces.credentials.namecheap = {
      ...configured,
      proxyUrl: 'http://127.0.0.1:8080',
    };
    await expect(importBundle(JSON.stringify(bundle))).rejects.toThrow(
      /public/,
    );
    expect(getStoredCredentials('namecheap')).toEqual(credentials);
  });
  it('encrypts proxy settings and preserves them through export/import and hydration', async () => {
    const disk = new MemoryDocStore();
    configureStore(
      new EncryptedDocStore(
        disk,
        await aesGcmCipher(crypto.getRandomValues(new Uint8Array(32))),
      ),
    );
    await hydrateStores();
    await saveRegistrarCredentials('namecheap', configured);
    await flushWrites();
    expect(await disk.get('credentials', 'namecheap')).toMatchObject({
      __sealed: 1,
    });
    expect(JSON.stringify(await disk.list('credentials'))).not.toContain(
      'proxy-secret',
    );
    const bundle = exportBundle({ version: 'test', platform: 'web' });
    await importBundle(bundle);
    await flushWrites();
    await hydrateStores();
    expect(getStoredCredentials('namecheap')).toEqual(configured);
    expect(
      getRegistrarMetadata().find((r) => r.name === 'namecheap')?.configured,
    ).toBe(true);
  });
  it('supports a new proxied account without requiring a direct IP and restores direct routing when disabled', async () => {
    await saveRegistrarCredentials('namecheap', {
      ...configured,
      clientIp: '',
    });
    expect(
      getRegistrarMetadata().find((r) => r.name === 'namecheap')?.configured,
    ).toBe(true);
    const proxied = getRegistrarClient('namecheap');
    await saveRegistrarCredentials(
      'namecheap',
      namecheapCredentials(configured, false),
    );
    const direct = getRegistrarClient('namecheap');
    expect(direct).not.toBe(proxied);
    expect(getStoredCredentials('namecheap').clientIp).toBe('9.9.9.9');
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response(xml));
    vi.stubGlobal('fetch', native);
    await direct.testConnection();
    expect(native).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  });
});
