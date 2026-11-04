import { beforeAll, describe, expect, it } from 'vitest';
import { createDynadotAdapter } from '../../services/markets/dynadot';
import { DynadotClient } from './client';
import { DynadotError } from './errors';

// Dynadot's marketplace, read-only (`npm run test:live`). Skips unless
// DYNADOT_API_KEY and DYNADOT_API_SECRET are set (the registrar's key; the
// marketplace uses the same one). Nothing is written. First run 2026-11-04
// (docs/dynadot-marketplace-api.md). Names and prices aren't printed.

const apiKey = process.env.DYNADOT_API_KEY;
const apiSecret = process.env.DYNADOT_API_SECRET;

describe.skipIf(!apiKey || !apiSecret)(
  'Dynadot marketplace (live, read-only)',
  () => {
    let dynadot: DynadotClient;
    beforeAll(() => {
      dynadot = new DynadotClient({
        apiKey: apiKey ?? '',
        apiSecret: apiSecret ?? '',
        userAgent: 'DomBot-live-tests/1.0',
      });
    });

    it('rejects a wrong secret without echoing the key', async () => {
      const wrong = new DynadotClient({
        apiKey: apiKey ?? '',
        apiSecret: 'not-the-secret',
        userAgent: 'DomBot-live-tests/1.0',
      });
      const error = await wrong.accountInfo().catch((e) => e);
      expect(error).toBeInstanceOf(DynadotError);
      expect(String(error.message)).not.toContain(apiKey);
    });

    it('reads the price level', async () => {
      const info = await dynadot.accountInfo();
      expect(info.priceLevel).toMatch(/account/i);
    });

    it('reads every listing through the adapter, both kinds', async () => {
      const adapter = createDynadotAdapter('live', {
        apiKey,
        apiSecret,
      });
      const read = await adapter.allListings();
      expect(read.complete).toBe(true);
      for (const l of read.listings) {
        expect(l.market).toBe('dynadot');
        expect(['active', 'pending', 'on_hold']).toContain(l.status);
        if (l.extra.market !== 'dynadot') throw new Error('extra');
        if (l.extra.held === 'dynadot') {
          // Every name in the account Dynadot marks for sale has a price.
          expect(l.price).toMatch(/^\d+(\.\d+)?$/);
        }
      }
      // Only shapes, never names or prices.
      const kinds = read.listings.map((l) =>
        l.extra.market === 'dynadot' ? l.extra.held : '',
      );
      console.info(
        `[dynadot live] ${kinds.filter((k) => k === 'dynadot').length} in the account, ${kinds.filter((k) => k === 'elsewhere').length} held elsewhere`,
      );
    });

    it('reads the Open Marketplace Key once a name is on the list', async () => {
      const list = await dynadot.externalDomains();
      const key = await createDynadotAdapter('live', {
        apiKey,
        apiSecret,
      }).verificationId();
      if (list.domains.length) expect(key).toMatch(/^[0-9a-f]{32}$/);
      else expect(key).toBeNull();
    });
  },
);
