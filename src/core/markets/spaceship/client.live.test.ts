import { beforeAll, describe, expect, it } from 'vitest';
import { SellerHubClient } from './client';
import { SpaceshipError } from './errors';

// SellerHub, read-only (`npm run test:live`). Skips unless SPACESHIP_API_KEY
// and SPACESHIP_API_SECRET are set (the registrar key, with SellerHub's
// scopes). Nothing here prints the account's names or prices.

const apiKey = process.env.SPACESHIP_API_KEY;
const apiSecret = process.env.SPACESHIP_API_SECRET;

describe.skipIf(!apiKey || !apiSecret)(
  'SellerHub client (live, read-only)',
  () => {
    // Built in beforeAll: a suite that skips still runs this body.
    let hub: SellerHubClient;
    beforeAll(() => {
      hub = new SellerHubClient({
        apiKey: apiKey ?? '',
        apiSecret: apiSecret ?? '',
        userAgent: 'DomBot-live-tests/1.0',
      });
    });

    it('refuses a wrong key without echoing it', async () => {
      const wrong = new SellerHubClient({
        apiKey: 'not-a-key',
        apiSecret: 'not-a-secret',
        userAgent: 'DomBot-live-tests/1.0',
        maxRetries: 0,
      });
      const error = await wrong.listingsPage(0, 1).catch((e) => e);
      expect(error).toBeInstanceOf(SpaceshipError);
      expect(['AUTH', 'SCOPE']).toContain(error.code);
      expect(String(error.message)).not.toContain('not-a-secret');
    });

    it('reads a page of listings with a total', async () => {
      const { listings, total } = await hub.listingsPage(0, 5);
      expect(typeof total).toBe('number');
      for (const l of listings) {
        expect(l.name).toMatch(/\./);
        // A status DomBot doesn't know would show up here.
        expect(l.status).not.toBeNull();
      }
    });

    it('walks every listing without repeats', async () => {
      const { listings, complete } = await hub.allListings();
      expect(complete).toBe(true);
      expect(new Set(listings.map((l) => l.name)).size).toBe(listings.length);
    });

    it('reads one listing', async () => {
      const { listings } = await hub.listingsPage(0, 1);
      if (!listings[0]) return;
      const one = await hub.getListing(listings[0].name);
      expect(one?.name).toBe(listings[0].name);
    });

    it('answers null for a name that isn’t listed', async () => {
      expect(await hub.getListing('dombot-not-listed-4f7c2a.com')).toBeNull();
    });

    it('reads the sold report', async () => {
      for (const s of await hub.soldDomains()) {
        expect(s.name).toMatch(/\./);
        expect(s.currency).toBe('USD');
      }
    });

    it('reads one TXT verification record at the apex', async () => {
      const options = await hub.verificationRecords();
      const txt = options.find(
        (o) => o.records.length === 1 && o.records[0].type === 'TXT',
      );
      expect(txt?.records[0].name).toBe('@');
      expect(txt?.records[0].value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('reads the account’s own names', async () => {
      const { names, complete } = await hub.accountDomainNames();
      expect(complete).toBe(true);
      for (const n of names) expect(n).toMatch(/\./);
    });
  },
);
