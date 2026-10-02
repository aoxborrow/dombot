import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import { lookupRegistrations } from './registration-lookup';

const registered = {
  events: [
    { eventAction: 'registration', eventDate: '2010-01-02T00:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-01-02T00:00:00Z' },
  ],
  entities: [
    {
      roles: ['registrar'],
      publicIds: [{ type: 'IANA Registrar ID', identifier: '625' }],
      vcardArray: ['vcard', [['fn', {}, 'text', 'Name.com, Inc.']]],
    },
  ],
};

beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lookupRegistrations', () => {
  it('reads registrar and dates, and treats 404 as unregistered', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('free-name')) {
        return new Response('', { status: 404 });
      }
      return new Response(JSON.stringify(registered), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await lookupRegistrations(['Held.com', 'free-name.com']);
    expect(rows['held.com']).toMatchObject({
      registered: true,
      registrar: 'Name.com, Inc.',
      registrarIanaId: 625,
      registrarLabel: 'Name.com',
      mappedRegistrar: 'namecom',
      created: '2010-01-02T00:00:00Z',
      expires: '2027-01-02T00:00:00Z',
    });
    expect(rows['free-name.com']).toMatchObject({ registered: false });

    await lookupRegistrations(['held.com', 'free-name.com']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends a DomBot User-Agent', async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
        return new Response(JSON.stringify(registered), { status: 200 });
      }),
    );
    await lookupRegistrations(['ua.com']);
    expect(headers['user-agent']).toMatch(/^DomBot\//);
  });

  it('reads a nested reseller and shows it when mapped', async () => {
    const viaReseller = {
      ...registered,
      entities: [
        {
          roles: ['registrar'],
          publicIds: [{ type: 'IANA Registrar ID', identifier: '269' }],
          vcardArray: ['vcard', [['fn', {}, 'text', 'Key-Systems GmbH']]],
          entities: [
            {
              roles: ['reseller'],
              vcardArray: ['vcard', [['fn', {}, 'text', 'iwantmyname']]],
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify(viaReseller), { status: 200 }),
      ),
    );
    const rows = await lookupRegistrations(['resold.com']);
    expect(rows['resold.com']).toMatchObject({
      registrar: 'Key-Systems GmbH',
      registrarIanaId: 269,
      reseller: 'iwantmyname',
      registrarLabel: 'iwantmyname',
      mappedRegistrar: null,
    });
  });

  it('leaves a name out when the lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await lookupRegistrations(['a.com'])).toEqual({});
  });
});
