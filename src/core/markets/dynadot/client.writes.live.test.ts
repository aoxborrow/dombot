import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDynadotAdapter,
  type DynadotAdapter,
} from '../../services/markets/dynadot';

// Live write round trips (`DYNADOT_LIVE_WRITES=1 npm run test:live`), through
// the adapter, on test names only. Off unless DYNADOT_LIVE_WRITES=1, so a
// plain `npm run test:live` stays read-only.
//
// - DYNADOT_TEST_EXTERNAL_DOMAIN: a name held at another registrar
//   (domanio.com, at 101domain), on the account's other-registrar list and
//   verified (its TXT record holds the account's Open Marketplace Key).
//   Listed at a price nobody pays, then delisted.
// - DYNADOT_TEST_DOMAIN: a name in the account, picked with the user
//   (testbot.io). Not listed: listed at a price nobody pays, then delisted.
//   Listed already (a live listing): never delisted, and only if it's Buy
//   Now alone, whose whole state DomBot can send back; rewritten at its
//   price, moved up $1, and put back, whatever happens. DomBot unlocks the
//   name for each write and locks it again; with the account lock on,
//   Dynadot refuses, nothing changes, and the test ends there.

const apiKey = process.env.DYNADOT_API_KEY;
const apiSecret = process.env.DYNADOT_API_SECRET;
const writes = process.env.DYNADOT_LIVE_WRITES === '1';
const EXTERNAL = process.env.DYNADOT_TEST_EXTERNAL_DOMAIN?.trim().toLowerCase();
const HELD = process.env.DYNADOT_TEST_DOMAIN?.trim().toLowerCase();
/** No one pays this. */
const PRICE = '999999';

describe.skipIf(!(apiKey && apiSecret && writes))(
  'Dynadot marketplace (live writes, test names)',
  () => {
    let adapter: DynadotAdapter;
    beforeAll(() => {
      adapter = createDynadotAdapter('live', { apiKey, apiSecret });
    });

    it.skipIf(!EXTERNAL)(
      'lists, reprices with offers, and delists a verified name held elsewhere',
      async () => {
        const name = EXTERNAL ?? '';
        const [listed] = await adapter.writeListings([{ name, price: PRICE }]);
        expect(listed.error).toBeNull();
        expect(listed.adjusted).toEqual([]);
        const [read] = await adapter.getListings([name]);
        // The other-registrar list has the seller's price (the listing read
        // adds Dynadot's transfer fee).
        expect(read).toMatchObject({
          price: PRICE,
          status: 'active',
          buyNow: true,
          extra: { held: 'elsewhere', offers: false },
        });

        // Offers on: Dynadot needs the minimum with them.
        const [offers] = await adapter.writeListings([
          { name, price: '999998', minOffer: '999990' },
        ]);
        expect(offers.error).toBeNull();
        expect((await adapter.getListings([name]))[0]).toMatchObject({
          price: '999998',
          extra: { offers: true },
        });
        // And without it, with none in DomBot either, DomBot refuses.
        const [refused] = await adapter.writeListings([
          { name, price: '999997' },
        ]);
        expect(refused.error?.code).toBe('UNSUPPORTED');

        const [delisted] = await adapter.deleteListings([name]);
        expect(delisted.ok).toBe(true);
        expect(await adapter.getListings([name])).toEqual([]);
      },
    );

    it.skipIf(!HELD)(
      'writes a name in the account and leaves it as it was',
      async () => {
        const name = HELD ?? '';
        const [before] = await adapter.getListings([name]);
        if (before) {
          // Buy Now alone: a Make Offer minimum can't be read, so couldn't
          // be put back. Nothing is written if this fails.
          expect(before.extra).toMatchObject({
            held: 'dynadot',
            offers: false,
            pendingSale: false,
          });
          const price = before.price ?? '';
          expect(price).toMatch(/^\d+(\.\d+)?$/);
          try {
            // The same price: nothing a buyer would see changes.
            const [same] = await adapter.writeListings([{ name, price }]);
            if (same.error?.code === 'ACCOUNT_LOCKED') {
              console.warn(`[dynadot live] ${same.error.message}`);
              return;
            }
            expect(same.error).toBeNull();
            expect(same.adjusted).toEqual([]);
            expect(same.saved).toMatchObject({
              price,
              buyNow: true,
              extra: { offers: false },
            });
            const bumped = String(Number(price) + 1);
            const [up] = await adapter.writeListings([{ name, price: bumped }]);
            expect(up.error).toBeNull();
            expect((await adapter.getListings([name]))[0]?.price).toBe(bumped);
          } finally {
            await adapter.writeListings([{ name, price }]);
          }
          expect((await adapter.getListings([name]))[0]).toMatchObject({
            price,
            buyNow: true,
            status: 'active',
          });
          return;
        }
        const [listed] = await adapter.writeListings([{ name, price: PRICE }]);
        expect(listed.error).toBeNull();
        expect(listed.saved).toMatchObject({
          price: PRICE,
          buyNow: true,
          extra: { held: 'dynadot', offers: false },
        });
        const [delisted] = await adapter.deleteListings([name]);
        expect(delisted.ok).toBe(true);
        expect(await adapter.getListings([name])).toEqual([]);
      },
    );
  },
);
