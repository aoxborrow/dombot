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
      vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]],
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
      registrar: 'Example Registrar',
      created: '2010-01-02T00:00:00Z',
      expires: '2027-01-02T00:00:00Z',
    });
    expect(rows['free-name.com']).toMatchObject({ registered: false });

    await lookupRegistrations(['held.com', 'free-name.com']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
