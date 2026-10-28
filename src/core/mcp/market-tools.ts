import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toAscii } from '../../shared/domain-name';
import {
  activeMarketAccounts,
  marketAccount,
  marketAccountViews,
  marketAdapter,
} from '../services/markets/accounts';
import { marketInfo } from '../services/markets/registry';
import {
  deleteMarketListings,
  listingAccount,
  pushAskingPrices,
  relistMarketListings,
  sendSaleMessage,
  setMarketListingDefaults,
  setSaleAuthCode,
  writeMarketListings,
} from '../services/markets/writes';
import type {
  MarketListing,
  MarketListingChange,
  MarketSale,
  MarketWriteResult,
} from '../../shared/markets';
import {
  marketAccountStats,
  marketListings,
  marketSales,
  syncMarketAccount,
  syncMarkets,
} from '../services/markets/sync';

// The read-only market tools (docs/markets.md, "MCP"). They read what market
// sync stored, except domain_stats_get and market_settings_get, which ask the
// market. Written for every market: one a market can't support says so.

function json(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

const MAX_LIMIT = 500;

const accountId = z
  .string()
  .max(64)
  .optional()
  .describe(
    'A market account id from market_list. Defaults to every enabled account.',
  );
const marketId = z
  .enum(['afternic', 'atom', 'sedo'])
  .optional()
  .describe('Only this market.');
const limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`Rows to return (default 50, max ${MAX_LIMIT}).`);
const offset = z.number().int().min(0).optional().describe('Rows to skip.');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

/** Sums decimal amounts in cents, per currency, so totals stay exact. */
function totals(
  sales: MarketSale[],
  field: 'price' | 'commission' | 'net',
): Record<string, string> {
  const cents: Record<string, number> = {};
  for (const s of sales) {
    const value = s[field];
    if (!value) continue;
    cents[s.currency] =
      (cents[s.currency] ?? 0) + Math.round(Number(value) * 100);
  }
  return Object.fromEntries(
    Object.entries(cents).map(([c, n]) => [c, (n / 100).toFixed(2)]),
  );
}

/** The market accounts an account filter means: one, or every enabled one. */
function accountIds(id?: string): Set<string> {
  if (id) return new Set([marketAccount(id).id]);
  return new Set(activeMarketAccounts().map((a) => a.id));
}

export function registerMarketTools(server: McpServer): void {
  server.registerTool(
    'market_list',
    {
      title: 'List market accounts',
      description:
        'List every connected marketplace account (Afternic, …) with its `accountId`, `market`, `label`, whether it is `configured` and `enabled`, its last `sync` (when, listing and sale counts, any error), and what its market supports (`capabilities`). No secrets. Start here before the other market_* tools.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json({
        accounts: marketAccountViews().map((a) => ({
          accountId: a.id,
          market: a.market,
          label: a.label,
          configured: a.configured,
          enabled: a.enabled,
          sync: a.sync,
          capabilities: marketInfo(a.market).capabilities,
        })),
      }),
  );

  server.registerTool(
    'market_sync',
    {
      title: 'Sync market accounts',
      description:
        'Re-read listings, sales and account stats from one market account (`accountId`) or every enabled one, and store them for market_listings, market_sales and market_stats_get. A live network pass; reads only, changes nothing on the market. Completed sales become `sold` events in domain history. Returns each account’s sync result.',
      inputSchema: { accountId },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId: id }) => {
      if (id) await syncMarketAccount(marketAccount(id).id);
      else await syncMarkets();
      return json({
        accounts: marketAccountViews().map((a) => ({
          accountId: a.id,
          market: a.market,
          label: a.label,
          sync: a.sync,
        })),
      });
    },
  );

  server.registerTool(
    'market_listings',
    {
      title: 'Query market listings',
      description:
        'List and filter your listings on marketplaces, as last synced (run market_sync to refresh). Each row is one name on one market: `status` (active, pending, inactive, rejected, on_hold, sold), `statusRaw` (the market’s word), `forSale`, `price` (with `buyNow`: buyers can pay it outright), `minOffer`, `floor`, `currency`, `leaseToOwn`, and `extra` with the market’s own fields (Afternic: lander, Fast Transfer, registrar, offer count, GoDaddy search counts for Domain Pro members). Prices are decimal strings. Returns { total, rows }; page with `limit`/`offset`.',
      inputSchema: {
        market: marketId,
        accountId,
        status: z
          .array(
            z.enum([
              'active',
              'pending',
              'inactive',
              'rejected',
              'on_hold',
              'sold',
              'unknown',
            ]),
          )
          .max(7)
          .optional()
          .describe('Only these statuses.'),
        forSale: z.boolean().optional(),
        nameContains: z.string().max(253).optional(),
        tld: z.string().max(63).optional(),
        priceMin: z.number().min(0).optional(),
        priceMax: z.number().min(0).optional(),
        sort: z
          .enum(['name', 'price', 'status', 'listedAt', 'searches30'])
          .optional()
          .describe('Default name.'),
        order: z.enum(['asc', 'desc']).optional(),
        limit,
        offset,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const ids = accountIds(args.accountId);
      const tld = args.tld?.replace(/^\./, '').toLowerCase();
      const q = args.nameContains?.toLowerCase();
      const rows = marketListings().filter((l) => {
        if (!ids.has(l.accountId)) return false;
        if (args.market && l.market !== args.market) return false;
        if (args.status && !args.status.includes(l.status)) return false;
        if (args.forSale !== undefined && l.forSale !== args.forSale)
          return false;
        if (q && !l.name.includes(q)) return false;
        if (tld && !l.name.endsWith(`.${tld}`)) return false;
        const price = l.price == null ? null : Number(l.price);
        if (args.priceMin !== undefined && (price ?? -1) < args.priceMin)
          return false;
        if (args.priceMax !== undefined && (price ?? Infinity) > args.priceMax)
          return false;
        return true;
      });
      const key = (l: MarketListing): string | number | null => {
        switch (args.sort) {
          case 'price':
            return l.price == null ? null : Number(l.price);
          case 'status':
            return l.status;
          case 'listedAt':
            return l.listedAt;
          case 'searches30':
            return l.extra.searches?.total.days30 ?? null;
          default:
            return l.name;
        }
      };
      const dir = args.order === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === y) return a.name.localeCompare(b.name);
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : 1) * dir;
      });
      const start = args.offset ?? 0;
      return json({
        total: rows.length,
        rows: rows.slice(start, start + (args.limit ?? 50)),
      });
    },
  );

  server.registerTool(
    'domain_listing_get',
    {
      title: 'Get a domain’s listings',
      description:
        'The listings for one domain on every connected market (or one, with `market`), as last synced: status, prices, lander and the market’s own fields. Returns { domain, listings }; an empty list means it isn’t listed on any connected market.',
      inputSchema: {
        domain: z.string().min(1).max(253).describe('The domain name.'),
        market: marketId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domain, market }) => {
      const name = toAscii(domain);
      return json({
        domain: name,
        listings: marketListings().filter(
          (l) => l.name === name && (!market || l.market === market),
        ),
      });
    },
  );

  server.registerTool(
    'market_sales',
    {
      title: 'Query market sales',
      description:
        'Sales recorded from marketplaces, newest first, as last synced: `soldOn`, `status` (completed, in_progress, cancelled), `kind` (buy_now, lease, offer), `price`, `commission`, `net`, `currency`, lease `installments`, `paidOutOn`, and `action` (what the seller must do next: auth_code, transfer, payee_details). Never includes transfer auth codes. Returns { total, totals, rows }: `totals` sums price, commission and net per currency over every match, not just the page.',
      inputSchema: {
        market: marketId,
        accountId,
        from: day.describe('Sold on or after (YYYY-MM-DD).'),
        to: day.describe('Sold on or before (YYYY-MM-DD).'),
        status: z
          .enum(['completed', 'in_progress', 'cancelled', 'unknown'])
          .optional(),
        kind: z.enum(['buy_now', 'offer', 'lease', 'unknown']).optional(),
        nameContains: z.string().max(253).optional(),
        limit,
        offset,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const ids = args.accountId
        ? new Set([marketAccount(args.accountId).id])
        : null;
      const q = args.nameContains?.toLowerCase();
      const rows = marketSales().filter((s) => {
        if (ids && !ids.has(s.accountId)) return false;
        if (args.market && s.market !== args.market) return false;
        if (args.status && s.status !== args.status) return false;
        if (args.kind && s.kind !== args.kind) return false;
        if (q && !s.name.includes(q)) return false;
        if (args.from && (!s.soldOn || s.soldOn < args.from)) return false;
        if (args.to && (!s.soldOn || s.soldOn > args.to)) return false;
        return true;
      });
      const start = args.offset ?? 0;
      return json({
        total: rows.length,
        totals: {
          price: totals(rows, 'price'),
          commission: totals(rows, 'commission'),
          net: totals(rows, 'net'),
        },
        rows: rows.slice(start, start + (args.limit ?? 50)),
      });
    },
  );

  server.registerTool(
    'market_stats_get',
    {
      title: 'Get market account stats',
      description:
        'Daily traffic for a market account, as stored by sync (up to a year): `views` and `leads` on Afternic, and whatever else the market reports. With `days`, only the most recent that many. Returns { accountId, days, totals }. Markets without account-level stats say so.',
      inputSchema: {
        accountId: z.string().max(64).describe('From market_list.'),
        days: z.number().int().min(1).max(365).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId: id, days }) => {
      const account = marketAccount(id);
      if (!marketInfo(account.market).capabilities.accountStats) {
        throw new Error(
          `Account-level stats are not supported for ${account.market}.`,
        );
      }
      const rows = marketAccountStats(account.id).slice(-(days ?? 365));
      const sum = (f: 'views' | 'leads') =>
        rows.reduce((n, d) => n + (d[f] ?? 0), 0);
      return json({
        accountId: account.id,
        days: rows,
        totals: { views: sum('views'), leads: sum('leads') },
      });
    },
  );

  server.registerTool(
    'domain_stats_get',
    {
      title: 'Get a domain’s market stats',
      description:
        'Daily views and leads for one listed domain, read live from the market that lists it (one API call per account). Pass `accountId` when the name is listed in more than one account. Returns { domain, accounts: [{ accountId, days, totals }] }.',
      inputSchema: {
        domain: z.string().min(1).max(253),
        accountId,
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe('Default 30.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domain, accountId: id, days }) => {
      const name = toAscii(domain);
      const ids = id
        ? [marketAccount(id).id]
        : [
            ...new Set(
              marketListings()
                .filter((l) => l.name === name)
                .map((l) => l.accountId),
            ),
          ];
      if (!ids.length) {
        throw new Error(
          `${name} isn't listed on any connected market account (as of the last market_sync).`,
        );
      }
      const accounts = [];
      for (const accountId of ids) {
        const adapter = marketAdapter(accountId);
        if (!adapter.domainStats) {
          throw new Error(
            `Per-domain stats are not supported for ${adapter.market}.`,
          );
        }
        const rows = await adapter.domainStats(name, days ?? 30);
        accounts.push({
          accountId,
          days: rows,
          totals: {
            views: rows.reduce((n, d) => n + (d.views ?? 0), 0),
            leads: rows.reduce((n, d) => n + (d.leads ?? 0), 0),
          },
        });
      }
      return json({ domain: name, accounts });
    },
  );

  server.registerTool(
    'market_settings_get',
    {
      title: 'Get listing defaults',
      description:
        'A market account’s defaults for new listings, read live (Afternic: lander type, intake style, which lander options show, lease-to-own and its maximum payments). Markets without account settings say so.',
      inputSchema: {
        accountId: z.string().max(64).describe('From market_list.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId: id }) => {
      const adapter = marketAdapter(id);
      if (!adapter.getListingDefaults) {
        throw new Error(
          `Listing defaults are not supported for ${adapter.market}.`,
        );
      }
      return json(await adapter.getListingDefaults());
    },
  );

  registerMarketWriteTools(server);
}

// ── Writes ───────────────────────────────────────────────────────────────────

const money = z
  .union([z.string().regex(/^\d+(\.\d+)?$/), z.number().min(0)])
  .transform((v) => String(v));

const changeShape = {
  price: money
    .nullable()
    .optional()
    .describe(
      'The listed price (BIN on Afternic); null clears it, leaving offers only.',
    ),
  minOffer: money
    .optional()
    .describe('Lowest offer that starts a negotiation.'),
  floor: money
    .nullable()
    .optional()
    .describe('Lowest price the market may accept for you; null clears it.'),
  currency: z.string().length(3).optional().describe('Default USD.'),
  forSale: z
    .boolean()
    .optional()
    .describe('false hides the listing from buyers.'),
  leaseToOwn: z
    .object({
      enabled: z.boolean(),
      maxPayments: z.number().int().min(2).max(60).optional(),
    })
    .optional()
    .describe(
      'Afternic caps payments by price without saying so; results report it.',
    ),
  afternic: z
    .object({
      landingPage: z.enum(['PARKING_TYPE', 'SALES_TYPE']).optional(),
      intakeStyle: z.enum(['BUYNOW', 'PRICE_FORM', 'CUSTOM_LANDER']).optional(),
      showLanderBuynowOption: z.boolean().optional(),
      showLanderMakeOfferOption: z.boolean().optional(),
      showLanderLeaseToOwnOption: z.boolean().optional(),
      featured: z.boolean().optional(),
    })
    .optional()
    .describe('Afternic’s own listing settings: what the name’s page shows.'),
};

type ChangeArgs = {
  price?: string | number | null;
  minOffer?: string | number;
  floor?: string | number | null;
  currency?: string;
  forSale?: boolean;
  leaseToOwn?: { enabled: boolean; maxPayments?: number };
  afternic?: Omit<NonNullable<MarketListingChange['extra']>, 'market'>;
};

/** An amount as a decimal string, whether it came as a number or not. */
const amount = <T extends string | number | null | undefined>(v: T) =>
  (typeof v === 'number' ? String(v) : v) as Exclude<T, number> | string;

function toChange(name: string, c: ChangeArgs): MarketListingChange {
  return {
    name,
    ...(c.price !== undefined ? { price: amount(c.price) } : {}),
    ...(c.minOffer !== undefined ? { minOffer: amount(c.minOffer) } : {}),
    ...(c.floor !== undefined ? { floor: amount(c.floor) } : {}),
    ...(c.currency !== undefined
      ? {
          currency: c.currency.toUpperCase() as MarketListingChange['currency'],
        }
      : {}),
    ...(c.forSale !== undefined ? { forSale: c.forSale } : {}),
    ...(c.leaseToOwn ? { leaseToOwn: c.leaseToOwn } : {}),
    ...(c.afternic ? { extra: { market: 'afternic', ...c.afternic } } : {}),
  };
}

/** Counts plus every result, so a caller sees what failed and why. */
function summary(results: MarketWriteResult[]) {
  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    adjusted: results.filter((r) => r.adjusted.length).length,
    results,
  };
}

const names = z
  .array(z.string().min(1).max(253))
  .min(1)
  .max(20000)
  .describe('Domain names.');
const requiredAccount = z.string().max(64).describe('From market_list.');

export function registerMarketWriteTools(server: McpServer): void {
  server.registerTool(
    'domain_listing_set',
    {
      title: 'List or update a domain on a market',
      description:
        'List one domain on a market account, or change its listing. Only the fields given change; a name that isn’t listed yet is listed. `accountId` can be left out when the name is listed in one account, or there is only one market account. With `fromAskingPrice: true`, the price, minimum offer and floor come from the asking price set in DomBot (domain_asking_price_set) instead. Returns the result with the listing as saved, and `adjusted`: fields the market saved differently from what was asked (Afternic silently caps lease-to-own payments by price). A new Afternic listing stays pending until Afternic can verify ownership (Afternic nameservers).',
      inputSchema: {
        domain: z.string().min(1).max(253),
        accountId,
        fromAskingPrice: z.boolean().optional(),
        ...changeShape,
      },
    },
    async ({ domain, accountId: id, fromAskingPrice, ...change }) => {
      const account = listingAccount(domain, id);
      const [result] = fromAskingPrice
        ? await pushAskingPrices(account, [domain])
        : await writeMarketListings(account, [
            toChange(toAscii(domain), change as ChangeArgs),
          ]);
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed.');
      return json({ accountId: account, ...result });
    },
  );

  server.registerTool(
    'domain_listing_delete',
    {
      title: 'Delist a domain from a market',
      description:
        'Take one domain’s listing down from a market account. The name stays in your registrar account. A name that wasn’t listed counts as delisted.',
      inputSchema: { domain: z.string().min(1).max(253), accountId },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ domain, accountId: id }) => {
      const account = listingAccount(domain, id);
      const [result] = await deleteMarketListings(account, [toAscii(domain)]);
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed.');
      return json({ accountId: account, ...result });
    },
  );

  server.registerTool(
    'market_listings_set',
    {
      title: 'List or update many domains',
      description:
        'List or update any number of names on one market account, in the market’s batch size (500 a call on Afternic). Either pass `changes` (each a `name` plus the fields to set, as domain_listing_set), or `domains` with `fromAskingPrice: true` to make the market match the asking prices set in DomBot: names without one, or priced in a currency the market doesn’t take, fail without being sent. Returns { ok, failed, adjusted, results } with one result per name.',
      inputSchema: {
        accountId: requiredAccount,
        changes: z
          .array(z.object({ name: z.string().min(1).max(253), ...changeShape }))
          .max(20000)
          .optional(),
        domains: names.optional(),
        fromAskingPrice: z.boolean().optional(),
      },
    },
    async ({ accountId: id, changes, domains, fromAskingPrice }) => {
      if (fromAskingPrice) {
        if (!domains?.length)
          throw new Error('Pass `domains` with fromAskingPrice.');
        return json(summary(await pushAskingPrices(id, domains)));
      }
      if (!changes?.length) {
        throw new Error(
          'Pass `changes`, or `domains` with fromAskingPrice: true.',
        );
      }
      return json(
        summary(
          await writeMarketListings(
            id,
            changes.map(({ name, ...c }) =>
              toChange(toAscii(name), c as ChangeArgs),
            ),
          ),
        ),
      );
    },
  );

  server.registerTool(
    'market_listings_delete',
    {
      title: 'Delist many domains',
      description:
        'Take any number of names’ listings down from one market account. The names stay in your registrar accounts. Returns { ok, failed, results }.',
      inputSchema: { accountId: requiredAccount, domains: names },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ accountId: id, domains }) =>
      json(summary(await deleteMarketListings(id, domains.map(toAscii)))),
  );

  server.registerTool(
    'market_listings_relist',
    {
      title: 'Relist domains',
      description:
        'Ask the market to run its listing checks again for listings that are inactive, rejected or stuck pending. `mode`: RESYNC re-checks a listing; REACTIVATE brings back an inactive one. Returns { ok, failed, results }; statuses are read back afterwards.',
      inputSchema: {
        accountId: requiredAccount,
        domains: names,
        mode: z.enum(['RESYNC', 'REACTIVATE']).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ accountId: id, domains, mode }) =>
      json(summary(await relistMarketListings(id, domains.map(toAscii), mode))),
  );

  server.registerTool(
    'market_sale_auth_code_set',
    {
      title: 'Send a sale its auth code',
      description:
        'Give a market sale the transfer auth code it is waiting for (market_sales rows with `action: "auth_code"`), or correct one sent before. Leave `authCode` out and DomBot gets it from the registrar account that holds the name, as domain_auth_code_get, and sends that. The code is never returned or stored.',
      inputSchema: {
        accountId: requiredAccount,
        saleId: z
          .string()
          .min(1)
          .max(100)
          .describe('The sale’s `id` from market_sales.'),
        authCode: z.string().max(200).optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ accountId: id, saleId, authCode }) => {
      const result = await setSaleAuthCode(id, saleId, authCode);
      return json({
        saleId,
        domain: result.name,
        sent: true,
        fetchedFromRegistrar: result.fetched,
      });
    },
  );

  server.registerTool(
    'market_sale_message_send',
    {
      title: 'Message about a sale',
      description:
        'Send a message to the people handling a sale at the market (Afternic’s transaction assurance agents), up to 1,000 characters. It reaches a person: send it only when the user has asked for it, with the words they approved.',
      inputSchema: {
        accountId: requiredAccount,
        saleId: z.string().min(1).max(100),
        message: z.string().min(1).max(1000),
      },
    },
    async ({ accountId: id, saleId, message }) => {
      await sendSaleMessage(id, saleId, message);
      return json({ saleId, sent: true });
    },
  );

  server.registerTool(
    'market_settings_set',
    {
      title: 'Set listing defaults',
      description:
        'Change a market account’s defaults for listings created from now on (Afternic: lander type and style, which lander options show, lease-to-own and its maximum payments). Only the fields given change; existing listings keep theirs.',
      inputSchema: {
        accountId: requiredAccount,
        landingPage: z.enum(['PARKING_TYPE', 'SALES_TYPE']).optional(),
        intakeStyle: z
          .enum(['BUYNOW', 'PRICE_FORM', 'CUSTOM_LANDER'])
          .optional(),
        leasingEnabled: z.boolean().optional(),
        maxLeasePeriod: z.number().int().min(2).max(60).optional(),
        showLanderBuynowOption: z.boolean().optional(),
        showLanderMakeOfferOption: z.boolean().optional(),
        showLanderLeaseToOwnOption: z.boolean().optional(),
      },
      annotations: { idempotentHint: true },
    },
    async ({ accountId: id, ...settings }) => {
      await setMarketListingDefaults(id, settings);
      return json({ accountId: id, saved: settings });
    },
  );
}
