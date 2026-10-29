import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../../storage/doc-store';
import { configureStore, hydrateStores } from '../../storage/namespace';
import { setListPrices } from '../list-prices';
import { connectMarketAccount } from './accounts';
import { marketListings, syncMarketAccount } from './sync';
import { pushAskingPrices } from './writes';

// Push DomBot's asking price for the test listing to Afternic, set to what
// Afternic already has, so the round trip changes nothing
// (`AFTERNIC_LIVE_WRITES=1 npm run test:live`). Uses an in-memory store.

const apiKey = process.env.AFTERNIC_API_KEY;
const apiSecret = process.env.AFTERNIC_API_SECRET;
const writes = process.env.AFTERNIC_LIVE_WRITES === '1';
const TEST_NAME = process.env.AFTERNIC_TEST_DOMAIN ?? 'domanio.com';

describe.skipIf(!apiKey || !apiSecret || !writes)(
  `market writes (live, ${TEST_NAME})`,
  () => {
    let id: string;

    beforeAll(async () => {
      configureStore(new MemoryDocStore());
      await hydrateStores();
      id = (
        await connectMarketAccount('afternic', {
          apiKey: apiKey ?? '',
          apiSecret: apiSecret ?? '',
        })
      ).id;
      await syncMarketAccount(id);
    }, 120_000);

    it('pushes an asking price that matches, and nothing moves', async () => {
      const before = marketListings().find((l) => l.name === TEST_NAME);
      expect(before).toBeDefined();
      setListPrices([
        {
          domainName: TEST_NAME,
          amount: before!.price,
          minOffer: before!.minOffer,
          floor: before!.floor,
          currency: 'USD',
        },
      ]);
      const [result] = await pushAskingPrices(id, [TEST_NAME]);
      expect(result).toMatchObject({ name: TEST_NAME, ok: true, adjusted: [] });
      const after = marketListings().find((l) => l.name === TEST_NAME);
      expect([after?.price, after?.minOffer, after?.floor]).toEqual([
        before!.price,
        before!.minOffer,
        before!.floor,
      ]);
    });
  },
);
