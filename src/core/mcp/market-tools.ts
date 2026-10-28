import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toAscii } from '../../shared/domain-name';
import type { MarketListing, MarketSale } from '../../shared/markets';
import {
  activeMarketAccounts,
  marketAccount,
  marketAccountViews,
  marketAdapter,
} from '../services/markets/accounts';
import { marketInfo } from '../services/markets/registry';
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
}
