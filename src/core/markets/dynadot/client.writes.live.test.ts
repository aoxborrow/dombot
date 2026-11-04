import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDynadotAdapter,
  type DynadotAdapter,
} from '../../services/markets/dynadot';

// Live write round trips (`DYNADOT_LIVE_WRITES=1 npm run test:live`), through
// the adapter, on test names only, each listed at a price nobody pays and
// delisted at the end. Off unless DYNADOT_LIVE_WRITES=1, so a plain
// `npm run test:live` stays read-only.
//
// - DYNADOT_TEST_EXTERNAL_DOMAIN: a name held at another registrar
//   (domanio.com, at 101domain), on the account's other-registrar list and
//   verified (its TXT record holds the account's Open Marketplace Key).
// - DYNADOT_TEST_DOMAIN: a name in the account that isn't listed, picked with
//   the user. Skipped when it's listed already, so a real listing is never
//   touched.

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
      'lists, reprices and delists a verified name held elsewhere',
      async () => {
        const name = EXTERNAL ?? '';
        const [listed] = await adapter.writeListings([{ name, price: PRICE }]);
        expect(listed.error).toBeNull();
        expect(listed.saved?.extra).toMatchObject({ held: 'elsewhere' });
        const [read] = await adapter.getListings([name]);
        expect(read?.price).toBe(PRICE);
        expect(read?.status).toBe('active');

        const [repriced] = await adapter.writeListings([
          { name, price: '999998' },
        ]);
        expect(repriced.error).toBeNull();
        expect((await adapter.getListings([name]))[0]?.price).toBe('999998');

        const [delisted] = await adapter.deleteListings([name]);
        expect(delisted.ok).toBe(true);
        expect(await adapter.getListings([name])).toEqual([]);
      },
    );

    it.skipIf(!HELD)(
      'lists and delists an unlisted name in the account',
      async () => {
        const name = HELD ?? '';
        if ((await adapter.getListings([name])).length) {
          console.warn(`[dynadot live] ${name} is listed already: skipped`);
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
