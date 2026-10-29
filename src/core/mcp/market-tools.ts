import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { localDay } from '../../shared/domain-events';
import { toAscii } from '../../shared/domain-name';
import {
  salesByYear,
  salesTotal,
  sellThrough,
  trafficByMonth,
} from '../../shared/market-reports';
import { storedTraffic, trafficTotals } from '../services/markets/traffic';
import {
  activeMarketAccounts,
  marketAccount,
  marketAccountViews,
  marketAdapter,
} from '../services/markets/accounts';
import { marketInfo } from '../services/markets/registry';
import {
  advanceMarketBulk,
  cancelMarketBulk,
  startMarketBulk,
} from '../services/bulk-jobs';
import {
  deleteMarketListings,
  listingAccount,
  pushAskingPrices,
  relistMarketListings,
  sendSaleMessage,
  setMarketDiscount,
  setMarketListingDefaults,
  setSaleAuthCode,
  verifyMarketDns,
  writeMarketListings,
} from '../services/markets/writes';
import {
  searchesOf,
  type AfternicExtraChange,
  type AtomExtraChange,
  type MarketBulkJob,
  type MarketListing,
  type MarketListingChange,
  type MarketSale,
  type MarketWriteResult,
  type SedoExtraChange,
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
        'List every connected marketplace account (Afternic, Atom, Sedo) with its `accountId`, `market`, `label`, whether it is `configured` and `enabled`, its last `sync` (when, listing and sale counts, any error), and what its market supports (`capabilities`). No secrets. Start here before the other market_* tools.',
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
        'List and filter your listings on marketplaces, as last synced (run market_sync to refresh). Each row is one name on one market: `status` (active, pending, inactive, rejected, on_hold, sold), `statusRaw` (the market’s word), `forSale`, `price` (with `buyNow`: buyers can pay it outright), `minOffer`, `floor`, `currency`, `leaseToOwn`, and `extra` with the market’s own fields (Afternic: lander, Fast Transfer, registrar, offer count, GoDaddy search counts for Domain Pro members; Sedo: categories, language, lifetime parking earnings, parking keywords; Atom: category, description, and for Premium names whether Atom lets you list them elsewhere, plus `tier` and a `discount` that lasts until Monday; sold Atom names stay listed with status sold). Prices are decimal strings. Returns { total, rows }; page with `limit`/`offset`.',
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
            return searchesOf(l)?.total.days30 ?? null;
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
      const asked = args.accountId
        ? marketAccount(args.accountId).market
        : args.market;
      if (asked && !marketInfo(asked).capabilities.sales) {
        throw new Error(
          `Sales are not supported for ${asked}: its API has no sales. Record them with domain_sale_set.`,
        );
      }
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
        'Daily traffic for a market account, as stored by sync (up to a year): `views` and `leads` on Afternic; parking `views` (visitors), `clicks` and `earnings` on Sedo, which keeps only the last 31 days. With `days`, only the most recent that many. Returns { accountId, days, totals }. Markets without account-level stats say so.',
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
        'Daily views and leads for one listed domain, read live from the market that lists it (one API call per account). Markets that only report running totals (Atom) answer from what sync stored instead: the views each day added, worked out from those totals once sync has read them twice, plus the latest `counters` (views, shortlists, offers). Pass `accountId` when the name is listed in more than one account. Returns { domain, accounts: [{ accountId, days, totals, counters? }] }.',
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
        if (adapter.capabilities.domainStats === 'snapshot') {
          const kept = storedTraffic(accountId, name);
          const since = new Date(Date.now() - ((days ?? 30) - 1) * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const rows = Object.entries(kept?.days ?? {})
            .filter(([date]) => date >= since)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, [views]]) => ({ date, views, source: 'derived' }));
          accounts.push({
            accountId,
            days: rows,
            totals: {
              views: rows.reduce((n, d) => n + d.views, 0),
              leads: null,
            },
            counters: kept?.counters ?? null,
            fetchedAt: kept ? new Date(kept.fetchedAt).toISOString() : null,
          });
          continue;
        }
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

  server.registerTool(
    'market_categories_get',
    {
      title: 'Get listing categories',
      description:
        'The categories and name languages a market account’s listings can use, read live (Sedo: up to three category ids per name, and an ISO 639-1 language, both set through the `sedo` settings of domain_listing_set; Atom: primary categories, set by name through the `atom` settings, and no languages). Returns { categories: [{ id, name, parentId }], languages: [{ code, name }] }. Markets without categories say so.',
      inputSchema: {
        accountId: z.string().max(64).describe('From market_list.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId: id }) => {
      const adapter = marketAdapter(id);
      if (adapter.primaryCategories) {
        const categories = await adapter.primaryCategories();
        return json({
          categories: categories.map((c) => ({ ...c, parentId: null })),
          languages: [],
        });
      }
      if (!adapter.categories || !adapter.languages) {
        throw new Error(`Categories are not supported for ${adapter.market}.`);
      }
      return json({
        categories: await adapter.categories(),
        languages: await adapter.languages(),
      });
    },
  );

  server.registerTool(
    'market_payments_get',
    {
      title: 'Get parking payments',
      description:
        'Parking payouts a market account received for one month, read live (Sedo). `month` is any day in it, YYYY-MM-DD. Returns { accountId, payments: [{ month, earnings }] }; earnings are decimal strings. Markets without parking earnings say so.',
      inputSchema: {
        accountId: z.string().max(64).describe('From market_list.'),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('A day in the month, e.g. 2026-09-01.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId: id, month }) => {
      const adapter = marketAdapter(id);
      if (!adapter.capabilities.parkingEarnings || !adapter.parkingPayments) {
        throw new Error(
          `Parking payments are not supported for ${adapter.market}.`,
        );
      }
      return json({
        accountId: id,
        payments: await adapter.parkingPayments(month),
      });
    },
  );

  server.registerTool(
    'market_traffic',
    {
      title: 'Rank listings by traffic',
      description:
        'Each listed name’s views and leads over the last 30 or 365 days, as stored by market sync, ranked (by leads, then views, by default). Per-name traffic is fetched a slice of names per sync, so `coverage` says how many listings have it so far; domain_stats_get reads one name live. Returns { days, coverage: { withTraffic, listed }, total, rows: [{ domain, views, leads }] }.',
      inputSchema: {
        accountId,
        days: z
          .union([z.literal(30), z.literal(365)])
          .optional()
          .describe('Default 30.'),
        sort: z.enum(['leads', 'views']).optional(),
        minViews: z.number().int().min(0).optional(),
        limit,
        offset,
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const ids = accountIds(args.accountId);
      const days = args.days ?? 30;
      const totals = trafficTotals(ids, days);
      const listed = new Set(
        marketListings()
          .filter((l) => ids.has(l.accountId))
          .map((l) => l.name),
      );
      const rows = [...totals]
        .filter(
          ([name, t]) => listed.has(name) && t.views >= (args.minViews ?? 0),
        )
        .map(([domain, t]) => ({ domain, views: t.views, leads: t.leads }))
        .sort((a, b) =>
          args.sort === 'views'
            ? b.views - a.views || b.leads - a.leads
            : b.leads - a.leads ||
              b.views - a.views ||
              a.domain.localeCompare(b.domain),
        );
      const start = args.offset ?? 0;
      return json({
        days,
        coverage: { withTraffic: totals.size, listed: listed.size },
        total: rows.length,
        rows: rows.slice(start, start + (args.limit ?? 50)),
      });
    },
  );

  server.registerTool(
    'market_report_get',
    {
      title: 'Market report',
      description:
        'The Markets page’s report, across enabled market accounts: sales by year (completed sales: count, gross, commission, net, average; in-progress and cancelled counted beside), all-time totals, sell-through over the last 12 months (sales ÷ names listed now plus those sold), and account views and leads by month. USD amounts as decimal strings.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const ids = accountIds();
      const years = salesByYear(
        marketSales().filter((s) => ids.has(s.accountId)),
      );
      const listings = marketListings().filter((l) => ids.has(l.accountId));
      return json({
        salesByYear: years,
        salesTotal: salesTotal(years),
        sellThrough: sellThrough(
          marketSales().filter((s) => ids.has(s.accountId)),
          listings,
          localDay(),
        ),
        trafficByMonth: trafficByMonth(
          [...ids].flatMap((id) => marketAccountStats(id)),
        ),
      });
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
      'The Buy Now price; null clears it, leaving offers only (Sedo: at least 199 USD or EUR, or none).',
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
  sedo: z
    .object({
      categories: z
        .array(z.number().int().positive())
        .max(3)
        .optional()
        .describe('Up to three Sedo category ids (market_categories_get).'),
      language: z
        .string()
        .length(2)
        .optional()
        .describe('ISO 639-1 language of the name; Sedo defaults to en.'),
    })
    .optional()
    .describe('Sedo’s own listing fields.'),
  atom: z
    .object({
      tier: z
        .enum(['standard', 'plus'])
        .optional()
        .describe(
          'For a new listing: Standard (7.5% commission) or Plus (15%). DomBot never adds Premium; that is submitted on atom.com.',
        ),
      category: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('A primary category by name (market_categories_get).'),
      description: z.string().max(2000).optional(),
    })
    .optional()
    .describe(
      'Atom’s own listing fields. Atom has one price per name (no minimum offer or floor), at least $100, in whole dollars; `price: null` is Make an Offer. Category names containing “&” can only be set on atom.com.',
    ),
};

type ChangeArgs = {
  price?: string | number | null;
  minOffer?: string | number;
  floor?: string | number | null;
  currency?: string;
  forSale?: boolean;
  leaseToOwn?: { enabled: boolean; maxPayments?: number };
  afternic?: Omit<AfternicExtraChange, 'market'>;
  sedo?: Omit<SedoExtraChange, 'market'>;
  atom?: Omit<AtomExtraChange, 'market'>;
};

/** An amount as a decimal string, whether it came as a number or not. */
const amount = <T extends string | number | null | undefined>(v: T) =>
  (typeof v === 'number' ? String(v) : v) as Exclude<T, number> | string;

function toChange(name: string, c: ChangeArgs): MarketListingChange {
  if ([c.afternic, c.sedo, c.atom].filter(Boolean).length > 1) {
    throw new Error(
      'Give one market’s settings (`afternic`, `atom` or `sedo`).',
    );
  }
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
    ...(c.sedo ? { extra: { market: 'sedo', ...c.sedo } } : {}),
    ...(c.atom ? { extra: { market: 'atom', ...c.atom } } : {}),
  };
}

/**
 * More names than this on a market that writes one name per call (Atom) run
 * as a market bulk job, which the tool returns instead of waiting hours.
 */
const DIRECT_NAMES = 10;

/** Whether a write this big to this account should run as a market job. */
function asJob(accountId: string, count: number): boolean {
  return (
    marketAdapter(accountId).capabilities.writeBatch === 1 &&
    count > DIRECT_NAMES
  );
}

/** A market job for an MCP reply: counts, and the failures so far. */
function jobSummary(job: MarketBulkJob | null) {
  if (!job) return { job: null };
  const failures = job.results.filter(
    (r) => r.status !== 'ok' && r.status !== 'skipped',
  );
  return {
    job: {
      id: job.id,
      op: job.op.kind,
      status: job.status,
      total: job.total,
      done: job.results.length,
      counts: job.counts,
      startedAt: new Date(job.startedAt).toISOString(),
      finishedAt: job.finishedAt
        ? new Date(job.finishedAt).toISOString()
        : null,
      failures: failures.slice(0, 200),
      moreFailures: Math.max(0, failures.length - 200),
    },
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
        'List or update any number of names on one market account, in the market’s batch size (500 a call on Afternic). Atom writes one name a call, so more than 10 names there start a market bulk job instead (about a name a second, names already at the asked values skipped): the reply is { job } and market_job_get follows it. Either pass `changes` (each a `name` plus the fields to set, as domain_listing_set), or `domains` with `fromAskingPrice: true` to make the market match the asking prices set in DomBot: names without one, or priced in a currency the market doesn’t take, fail without being sent. Returns { ok, failed, adjusted, results } with one result per name.',
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
        if (asJob(id, domains.length)) {
          return json(
            jobSummary(
              startMarketBulk(
                domains.map((name) => ({ accountId: id, name })),
                { kind: 'pushAskingPrices' },
              ),
            ),
          );
        }
        return json(summary(await pushAskingPrices(id, domains)));
      }
      if (!changes?.length) {
        throw new Error(
          'Pass `changes`, or `domains` with fromAskingPrice: true.',
        );
      }
      if (asJob(id, changes.length)) {
        return json(
          jobSummary(
            startMarketBulk(
              changes.map(({ name, ...c }) => ({
                accountId: id,
                name,
                change: toChange(toAscii(name), c as ChangeArgs),
              })),
              { kind: 'write' },
            ),
          ),
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
        'Take any number of names’ listings down from one market account. The names stay in your registrar accounts. Returns { ok, failed, results }; on Atom, more than 10 names start a market bulk job and return { job } (see market_job_get). Atom can’t delist Premium names through its API.',
      inputSchema: { accountId: requiredAccount, domains: names },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ accountId: id, domains }) =>
      asJob(id, domains.length)
        ? json(
            jobSummary(
              startMarketBulk(
                domains.map((name) => ({ accountId: id, name })),
                { kind: 'delete' },
              ),
            ),
          )
        : json(summary(await deleteMarketListings(id, domains.map(toAscii)))),
  );

  server.registerTool(
    'market_job_get',
    {
      title: 'Follow a market bulk job',
      description:
        'The market bulk job started by market_listings_set or market_listings_delete (the latest one, running or finished): status, total, done, counts by outcome (ok, skipped: already as asked, failed, unsupported, rate-limited, cancelled) and the failures so far. Call it again until `status` is no longer running. On the self-hosted web app each call also runs the job for a few seconds.',
      inputSchema: {
        cancel: z
          .boolean()
          .optional()
          .describe('Stop the running job; names not yet sent are skipped.'),
      },
    },
    async ({ cancel }) => {
      if (cancel) cancelMarketBulk();
      return json(jobSummary(await advanceMarketBulk(20_000)));
    },
  );

  server.registerTool(
    'domain_listing_discount_set',
    {
      title: 'Discount a listing',
      description:
        'Put a temporary discount on one listing, in whole dollars off its price (Atom: at most 30% of the price, lasting until Atom resets discounts on Monday; Atom emails buyers tracking the price). `amount` null or 0 clears it. Returns the listing as saved. Markets without discounts say so.',
      inputSchema: {
        domain: z.string().min(1).max(253),
        accountId,
        amount: money.nullable().describe('Dollars off; null clears it.'),
      },
      annotations: { idempotentHint: true },
    },
    async ({ domain, accountId: id, amount: off }) => {
      const account = listingAccount(domain, id);
      const result = await setMarketDiscount(
        account,
        domain,
        off && Number(off) > 0 ? off : null,
      );
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed.');
      return json({ accountId: account, ...result });
    },
  );

  server.registerTool(
    'domain_listing_verify',
    {
      title: 'Verify a listing’s DNS',
      description:
        'Ask the market to check now that a name points at it (Atom: nameservers ns1/ns2.atom.com, required for Premium, or Atom’s TXT record), instead of waiting for its own check. Atom allows one check per account every 12 hours; sooner, it fails saying to try later. Returns the listing as read back afterwards; its status may take a while to change. Markets without this say so.',
      inputSchema: { domain: z.string().min(1).max(253), accountId },
      annotations: { idempotentHint: true },
    },
    async ({ domain, accountId: id }) => {
      const account = listingAccount(domain, id);
      const result = await verifyMarketDns(account, domain);
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed.');
      return json({ accountId: account, ...result });
    },
  );

  server.registerTool(
    'market_grading_submit',
    {
      title: 'Submit names for grading',
      description:
        'Send names to the market’s AI grading (Atom: brand fit and Premium fit), up to 20,000, 100 a call. Results come later: read them with market_grading_get. The names don’t have to be listed. Markets without grading say so.',
      inputSchema: { accountId: requiredAccount, domains: names },
    },
    async ({ accountId: id, domains }) => {
      const adapter = marketAdapter(id);
      if (!adapter.submitForGrading) {
        throw new Error(`Grading is not supported for ${adapter.market}.`);
      }
      return json(await adapter.submitForGrading(domains.map(toAscii)));
    },
  );

  server.registerTool(
    'market_grading_get',
    {
      title: 'Read grading results',
      description:
        'The market’s AI grading results, a page at a time (Atom: brandFit, premiumFit, status, submittedOn per name). With `brandFitOnly`, only names graded as a brand fit. Returns { results, total }. Markets without grading say so.',
      inputSchema: {
        accountId: requiredAccount,
        page: z.number().int().min(1).optional(),
        brandFitOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ accountId: id, page, brandFitOnly }) => {
      const adapter = marketAdapter(id);
      if (!adapter.gradingResults) {
        throw new Error(`Grading is not supported for ${adapter.market}.`);
      }
      return json(await adapter.gradingResults({ page, brandFitOnly }));
    },
  );

  server.registerTool(
    'domain_appraisal_get',
    {
      title: 'Appraise a domain',
      description:
        'A market’s appraisal of any name, listed or not (Atom: estimate in whole USD, a domain score, key signals, root words, how many of its other TLDs are taken, trademark conflicts). Atom allows 10 a day per account; past that it fails saying how many were used. `accountId` can be left out when only one account can appraise.',
      inputSchema: { domain: z.string().min(1).max(253), accountId },
      annotations: { readOnlyHint: true },
    },
    async ({ domain, accountId: id }) => {
      const ids = id
        ? [marketAccount(id).id]
        : activeMarketAccounts()
            .map((a) => a.id)
            .filter((a) => marketAdapter(a).appraisal);
      if (ids.length !== 1) {
        throw new Error(
          ids.length
            ? 'More than one market account can appraise; pass accountId.'
            : 'No connected market account can appraise names.',
        );
      }
      const adapter = marketAdapter(ids[0]);
      if (!adapter.appraisal) {
        throw new Error(`Appraisal is not supported for ${adapter.market}.`);
      }
      return json({ accountId: ids[0], ...(await adapter.appraisal(domain)) });
    },
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
