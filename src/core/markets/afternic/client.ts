import { userAgentHeaders } from '../../app-info';
import { assertDomainName } from '../../../shared/domain-name';
import {
  priceFilter,
  toListing,
  toResults,
  toSale,
  toJob,
  toSettings,
  toStats,
  toWireFields,
  toWireSettings,
} from './convert';
import { AfternicError, errorFromResponse } from './errors';
import { parseJobResults, toJobCsv } from './jobs-csv';
import {
  limiterFor,
  realClock,
  type Clock,
  type RateLimiter,
} from './rate-limit';
import type {
  AccountSettingsInput,
  AfternicAccountSettings,
  AfternicJob,
  AfternicListing,
  AfternicSale,
  AllListingsResult,
  DailyStats,
  JobRowResult,
  JobRun,
  JobType,
  ListingFields,
  ListingInput,
  ListingResult,
  ListingsPage,
  ListListingsOptions,
  ListSalesOptions,
  RelistMode,
  RunJobOptions,
  SalesPage,
  StatsOptions,
} from './types';
import {
  DOMAIN_INCLUDES,
  type DomainInclude,
  type WireAccountSettings,
  type WireDomain,
  type WireDomainsList,
  type WireDomainsPage,
  type WireJob,
  type WireOperationsMap,
  type WireSale,
  type WireSalesPage,
  type WireStats,
} from './wire';

// A client for the Afternic Portfolio API (docs/afternic-api.md). One method
// per operation. Every request goes through the shared per-account rate
// limit. Reads, and writes that land the same however often they're sent
// (PATCH, upsert, delete, relist), retry on 429, 5xx and network failures;
// creating a listing and messaging a transaction agent never retry.

export const AFTERNIC_BASE_URL = 'https://api.afternic.com';

/** Longest message to a transaction agent. */
const MAX_MESSAGE = 1000;

/** Most names per `$each` call. */
export const BATCH_SIZE = 500;
/** Page size for walking every listing. */
const LISTINGS_PAGE = 500;
/** The live API rejects sales pages over 100, whatever the docs say. */
const SALES_PAGE = 100;
/** `allSales` default start: before Afternic existed, so it's everything. */
const ALL_SALES_FROM = '2000-01-01T00:00:00Z';

export interface AfternicClientOptions {
  apiKey: string;
  apiSecret: string;
  /** Defaults to global fetch; pass one to route through a proxy. */
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Defaults to DomBot's own; Afternic rejects requests without one. */
  userAgent?: string;
  /** Defaults to the limiter shared by every client for this key. */
  limiter?: RateLimiter;
  clock?: Clock;
  /** Retries for a retryable read, after the first try. Defaults to 3. */
  maxRetries?: number;
  /** Per-request timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** A CSV body, sent as text/csv instead of JSON. */
  csv?: string;
  /** Return the response as text instead of parsing JSON (job results). */
  text?: boolean;
  /** Safe to send again; false for writes. Defaults to GET only. */
  retry?: boolean;
}

/** ISO 8601 to the second, the form the API's date filters take. */
function isoSeconds(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function iso(value: Date | string | undefined): string | undefined {
  return value == null ? undefined : isoSeconds(value);
}

function list(values: readonly string[] | undefined): string | undefined {
  return values?.length ? values.join(',') : undefined;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export class AfternicClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly userAgent: Record<string, string>;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: AfternicClientOptions) {
    if (!options.apiKey || !options.apiSecret) {
      throw new Error('Afternic needs both an API key and a secret.');
    }
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = (options.baseUrl ?? AFTERNIC_BASE_URL).replace(/\/+$/, '');
    this.auth = `sso-key ${options.apiKey}:${options.apiSecret}`;
    this.userAgent = options.userAgent
      ? { 'user-agent': options.userAgent }
      : userAgentHeaders();
    this.clock = options.clock ?? realClock;
    this.limiter = options.limiter ?? limiterFor(options.apiKey, this.clock);
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // Listings

  /** One page of listings. Every include is requested unless you say otherwise. */
  async listListings(options: ListListingsOptions = {}): Promise<ListingsPage> {
    const page = await this.request<WireDomainsPage>('GET', '/domains', {
      query: {
        includes: list(options.includes ?? DOMAIN_INCLUDES),
        limit: options.limit,
        offset: options.offset,
        order: options.order,
        listStatus: list(options.listStatus),
        buynowMin: priceFilter(options.buyNowMin),
        buynowMax: priceFilter(options.buyNowMax),
        floorMin: priceFilter(options.floorMin),
        floorMax: priceFilter(options.floorMax),
        minbidMin: priceFilter(options.minOfferMin),
        minbidMax: priceFilter(options.minOfferMax),
        leasing: options.leasing,
        hidden: options.hidden,
        listedAtStartDate: iso(options.listedFrom),
        listedAtEndDate: iso(options.listedTo),
      },
    });
    return {
      listings: (page?.domains ?? []).map(toListing),
      total: page?.pagination?.total ?? null,
    };
  }

  /**
   * Every listing matching the filters, walked in name order so pages don't
   * shift under us. Flags a total that changed mid-walk.
   */
  async allListings(
    options: Omit<ListListingsOptions, 'limit' | 'offset' | 'order'> = {},
  ): Promise<AllListingsResult> {
    const listings: AfternicListing[] = [];
    let firstTotal: number | null | undefined;
    let lastTotal: number | null = null;
    for (let offset = 0; ; offset += LISTINGS_PAGE) {
      const page = await this.listListings({
        ...options,
        order: 'NAME_ASC',
        limit: LISTINGS_PAGE,
        offset,
      });
      if (firstTotal === undefined) firstTotal = page.total;
      lastTotal = page.total;
      listings.push(...page.listings);
      const done =
        page.listings.length < LISTINGS_PAGE ||
        (page.total != null && listings.length >= page.total);
      if (done) break;
    }
    return { listings, changedDuringRead: firstTotal !== lastTotal };
  }

  /** One listing, or null when the name isn't in your Afternic portfolio. */
  async getListing(
    name: string,
    includes: readonly DomainInclude[] = DOMAIN_INCLUDES,
  ): Promise<AfternicListing | null> {
    const domain = assertDomainName(name);
    try {
      const wire = await this.request<WireDomain>('GET', `/domains/${domain}`, {
        query: { includes: list(includes) },
      });
      return wire ? toListing(wire) : null;
    } catch (error) {
      if (error instanceof AfternicError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * The listings for these names, in batches of 500. Names that aren't
   * listed are left out of the result.
   */
  async getListings(
    names: readonly string[],
    includes: readonly DomainInclude[] = DOMAIN_INCLUDES,
  ): Promise<AfternicListing[]> {
    const keys = [...new Set(names.map(assertDomainName))];
    const out: AfternicListing[] = [];
    for (const batch of chunks(keys, BATCH_SIZE)) {
      const result = await this.request<WireDomainsList>(
        'POST',
        '/domains/$each/get',
        {
          query: { includes: list(includes) },
          body: { names: batch },
          retry: true,
        },
      );
      out.push(...(result?.domains ?? []).map(toListing));
    }
    return out;
  }

  // Stats

  /** Daily views and leads for the whole account. */
  async getAccountStats(options: StatsOptions = {}): Promise<DailyStats[]> {
    return toStats(
      (await this.request<WireStats>('GET', '/stats', {
        query: this.statsQuery(options),
      })) ?? {},
    );
  }

  /** Daily views and leads for one listing. */
  async getDomainStats(
    name: string,
    options: StatsOptions = {},
  ): Promise<DailyStats[]> {
    const domain = assertDomainName(name);
    return toStats(
      (await this.request<WireStats>('GET', `/stats/${domain}`, {
        query: this.statsQuery(options),
      })) ?? {},
    );
  }

  /**
   * The API's `startDate` is the END of the window: it counts `days`
   * backwards from it (its docs say the opposite). Callers say what they
   * mean with `endDate`.
   */
  private statsQuery(options: StatsOptions): RequestOptions['query'] {
    const days = options.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`Stats cover 1–365 days, not ${days}.`);
    }
    return { days, startDate: iso(options.endDate) };
  }

  // Sales

  /** One page of sales. Without dates the API returns only the last month. */
  async listSales(options: ListSalesOptions = {}): Promise<SalesPage> {
    const page = await this.request<WireSalesPage>('GET', '/sales', {
      query: {
        soldAtStartDate: iso(options.from),
        soldAtEndDate: iso(options.to),
        status: options.status,
        keyword: options.keyword,
        order: options.order,
        limit: options.limit,
        offset: options.offset,
      },
    });
    return {
      sales: (page?.sales ?? []).map(toSale),
      total: page?.pagination?.total ?? null,
    };
  }

  /** Every sale in the range; all of them, ever, by default. Newest first. */
  async allSales(
    options: Omit<ListSalesOptions, 'limit' | 'offset' | 'order'> = {},
  ): Promise<AfternicSale[]> {
    const sales: AfternicSale[] = [];
    const range = {
      ...options,
      from: options.from ?? ALL_SALES_FROM,
      to: options.to ?? new Date(this.clock.now()),
    };
    for (let offset = 0; ; offset += SALES_PAGE) {
      const page = await this.listSales({
        ...range,
        order: 'SOLD_AT_DESC',
        limit: SALES_PAGE,
        offset,
      });
      sales.push(...page.sales);
      const done =
        page.sales.length < SALES_PAGE ||
        (page.total != null && sales.length >= page.total);
      if (done) return sales;
    }
  }

  /** One sale, or null when there's no such transaction. */
  async getSale(transactionId: string): Promise<AfternicSale | null> {
    try {
      const wire = await this.request<WireSale>(
        'GET',
        `/sales/${encodeURIComponent(transactionId)}`,
      );
      return wire ? toSale(wire) : null;
    } catch (error) {
      if (error instanceof AfternicError && error.status === 404) return null;
      throw error;
    }
  }

  // Account settings

  /** Defaults applied to new listings. */
  async getAccountSettings(): Promise<AfternicAccountSettings> {
    return toSettings(
      (await this.request<WireAccountSettings>('GET', '/accountSettings')) ??
        {},
    );
  }

  /** Change the defaults for listings created from now on. */
  async updateAccountSettings(settings: AccountSettingsInput): Promise<void> {
    await this.request('PATCH', '/accountSettings', {
      body: toWireSettings(settings),
      retry: true,
    });
  }

  // Listing writes

  /**
   * List a name. Fields left out take the account's listing defaults. Throws
   * `CONFLICT` (409) when it's already listed.
   */
  async createListing(input: ListingInput): Promise<AfternicListing> {
    const name = assertDomainName(input.name);
    const wire = await this.request<WireDomain>('POST', '/domains', {
      body: { name, ...toWireFields(input) },
    });
    return wire ? toListing(wire) : this.mustGetListing(name);
  }

  /**
   * Change some of a listing's settings and return it as saved. Fields left
   * out stay as they are.
   */
  async updateListing(
    name: string,
    fields: ListingFields,
  ): Promise<AfternicListing> {
    const domain = assertDomainName(name);
    const wire = await this.request<WireDomain>('PATCH', `/domains/${domain}`, {
      query: { resource: true },
      body: toWireFields(fields),
      retry: true,
    });
    // The API answers 204 even when asked for the resource: read it back.
    return wire?.name ? toListing(wire) : this.mustGetListing(domain);
  }

  /** Delist a name. False when it wasn't listed. */
  async deleteListing(name: string): Promise<boolean> {
    const domain = assertDomainName(name);
    try {
      await this.request('DELETE', `/domains/${domain}`, { retry: true });
      return true;
    } catch (error) {
      if (error instanceof AfternicError && error.status === 404) return false;
      throw error;
    }
  }

  /**
   * Create or update many listings, 500 per call. Each name's fields replace
   * only what's given, and a name that isn't listed yet is created.
   */
  async upsertListings(
    inputs: readonly ListingInput[],
  ): Promise<ListingResult[]> {
    // Validate every name and price before sending anything.
    const wire = new Map<string, object>();
    for (const input of inputs) {
      const name = assertDomainName(input.name);
      wire.set(name, { name, ...toWireFields(input) });
    }
    return this.eachBatch([...wire.keys()], (batch) =>
      this.request<WireOperationsMap>('POST', '/domains/$each/upsert', {
        body: { domains: batch.map((name) => wire.get(name)) },
        retry: true,
      }),
    );
  }

  /** Delist many names, 500 per call. */
  async deleteListings(names: readonly string[]): Promise<ListingResult[]> {
    return this.eachBatch(this.keys(names), (batch) =>
      this.request<WireOperationsMap>('POST', '/domains/$each/delete', {
        body: { names: batch },
        retry: true,
      }),
    );
  }

  /**
   * Re-run the listing process for many names, 500 per call: `RESYNC`
   * re-checks a listing, `REACTIVATE` brings back an inactive one.
   */
  async relistListings(
    names: readonly string[],
    mode?: RelistMode,
  ): Promise<ListingResult[]> {
    return this.eachBatch(this.keys(names), (batch) =>
      this.request<WireOperationsMap>('POST', '/domains/$each/relist', {
        body: { names: batch, ...(mode ? { mode } : {}) },
        retry: true,
      }),
    );
  }

  // Sale writes

  /** Give (or correct) the transfer code for a sale waiting on one. */
  async updateSale(
    transactionId: string,
    update: { authCode: string },
  ): Promise<void> {
    if (!update.authCode.trim()) throw new Error('The auth code is empty.');
    await this.request('PATCH', `/sales/${encodeURIComponent(transactionId)}`, {
      body: { authCode: update.authCode.trim() },
      retry: true,
    });
  }

  /** Message the transaction agent handling a sale. Reaches a person. */
  async sendSaleMessage(transactionId: string, message: string): Promise<void> {
    const text = message.trim();
    if (!text) throw new Error('The message is empty.');
    if (text.length > MAX_MESSAGE) {
      throw new Error(`Messages are limited to ${MAX_MESSAGE} characters.`);
    }
    await this.request(
      'POST',
      `/sales/${encodeURIComponent(transactionId)}/sendMessage`,
      { body: { message: text } },
    );
  }

  // Bulk jobs

  async listJobs(): Promise<AfternicJob[]> {
    const wire = await this.request<{ jobs?: WireJob[] }>('GET', '/jobs');
    return (wire?.jobs ?? []).map(toJob);
  }

  async getJob(jobId: string): Promise<AfternicJob> {
    const wire = await this.request<WireJob>(
      'GET',
      `/jobs/${encodeURIComponent(jobId)}`,
    );
    if (!wire) throw new Error(`Afternic sent no details for job ${jobId}.`);
    return toJob(wire);
  }

  /**
   * An empty job to upload a file to. At most 3 can wait in `CREATED`; past
   * that Afternic answers `TOO_MANY_JOBS`. `RECONCILE_JOB` is the template's
   * "Replace": it delists every name the file leaves out.
   */
  async createJob(type: JobType, description?: string): Promise<string> {
    const wire = await this.request<{ jobId: string }>('POST', '/jobs', {
      query: { type },
      body: description ? { description: description.slice(0, 255) } : {},
    });
    if (!wire?.jobId) throw new Error('Afternic sent no job id.');
    return wire.jobId;
  }

  /**
   * Send a job its file, which starts it. Not retried: a second upload of
   * the same file could run it twice.
   */
  async uploadJob(jobId: string, csv: string): Promise<void> {
    await this.request('POST', `/jobs/${encodeURIComponent(jobId)}/upload`, {
      csv,
    });
  }

  /** A finished job's per-row results. */
  async getJobResults(jobId: string): Promise<JobRowResult[]> {
    const text = await this.request<string>(
      'GET',
      `/jobs/${encodeURIComponent(jobId)}/results`,
      { text: true },
    );
    return parseJobResults(text ?? '');
  }

  /** Close a job that's done with, or cancel one that hasn't run. */
  async closeJob(jobId: string): Promise<void> {
    await this.setJobState(jobId, 'CLOSED');
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.setJobState(jobId, 'CANCELED');
  }

  private async setJobState(
    jobId: string,
    jobState: 'CLOSED' | 'CANCELED',
  ): Promise<void> {
    await this.request('PATCH', `/jobs/${encodeURIComponent(jobId)}`, {
      body: { jobState },
      retry: true,
    });
  }

  /**
   * Create or update listings with one bulk job: create it (or reuse one
   * waiting in `CREATED`), upload the file, wait for it, and read the
   * results. Same per-name results as `upsertListings`, so callers can use
   * either. Only `BULK_JOB`: a reconcile delists what the file leaves out,
   * so it's never run on a caller's behalf.
   */
  async runJob(
    inputs: readonly ListingInput[],
    options: RunJobOptions = {},
  ): Promise<JobRun> {
    const byName = new Map<string, ListingInput>();
    for (const input of inputs) {
      const name = assertDomainName(input.name);
      byName.set(name, { ...input, name });
    }
    if (!byName.size) throw new Error('A bulk job needs at least one listing.');
    const csv = toJobCsv([...byName.values()]);

    const jobId = await this.openJob('BULK_JOB', options.description);
    await this.uploadJob(jobId, csv);

    const pollMs = options.pollMs ?? 2000;
    const deadline = this.clock.now() + (options.timeoutMs ?? 30 * 60_000);
    let job = await this.getJob(jobId);
    while (!['COMPLETED', 'FAILED', 'CANCELED', 'CLOSED'].includes(job.state)) {
      options.onProgress?.(job);
      if (this.clock.now() >= deadline) {
        throw new AfternicError({
          status: 0,
          code: 'JOB_TIMEOUT',
          message: `Job ${jobId} is still ${job.state.toLowerCase()}; check on it later.`,
          requestId: '',
        });
      }
      await this.clock.sleep(pollMs);
      job = await this.getJob(jobId);
    }
    options.onProgress?.(job);
    if (job.state !== 'COMPLETED') {
      const reason = job.failedReason ?? job.state.toLowerCase();
      const error = { code: `JOB_${job.state}`, message: reason };
      return {
        job,
        results: [...byName.keys()].map((name) => ({
          name,
          ok: false,
          status: 0,
          listing: null,
          error,
        })),
      };
    }

    const rows = new Map(
      (await this.getJobResults(jobId)).map((row) => [row.name, row]),
    );
    return {
      job,
      results: [...byName.keys()].map((name) => {
        const row = rows.get(name);
        if (!row) {
          return {
            name,
            ok: false,
            status: 0,
            listing: null,
            error: {
              code: 'NO_RESULT',
              message: 'The job finished without a result for this name.',
            },
          };
        }
        return {
          name,
          ok: row.ok,
          status: row.ok ? 200 : 422,
          listing: null,
          error: row.ok
            ? null
            : {
                code: row.result || 'FAILED',
                message: row.error ?? row.result,
              },
        };
      }),
    };
  }

  /** A new job, or one already waiting in `CREATED` when at the limit. */
  private async openJob(type: JobType, description?: string): Promise<string> {
    try {
      return await this.createJob(type, description);
    } catch (error) {
      if (!(error instanceof AfternicError) || error.code !== 'TOO_MANY_JOBS') {
        throw error;
      }
      const waiting = (await this.listJobs()).find(
        (j) => j.type === type && j.state === 'CREATED',
      );
      if (!waiting) throw error;
      return waiting.jobId;
    }
  }

  // Helpers

  private keys(names: readonly string[]): string[] {
    return [...new Set(names.map(assertDomainName))];
  }

  private async mustGetListing(name: string): Promise<AfternicListing> {
    const listing = await this.getListing(name);
    if (!listing) {
      throw new AfternicError({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        message: `${name} was saved but Afternic can't find it now.`,
        requestId: '',
      });
    }
    return listing;
  }

  /**
   * Run a `$each` call per 500 names and merge the per-name results. A batch
   * that fails as a whole marks each of its names failed and the rest go on,
   * so one bad batch doesn't hide what the others did.
   */
  private async eachBatch(
    names: string[],
    call: (batch: string[]) => Promise<WireOperationsMap | null>,
  ): Promise<ListingResult[]> {
    const results: ListingResult[] = [];
    for (const batch of chunks(names, BATCH_SIZE)) {
      try {
        results.push(...toResults(batch, await call(batch)));
      } catch (error) {
        if (!(error instanceof AfternicError)) throw error;
        results.push(
          ...batch.map((name) => ({
            name,
            ok: false,
            status: error.status,
            listing: null,
            error: { code: error.code, message: error.message },
          })),
        );
      }
    }
    return results;
  }

  // Transport

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const url = new URL(`${this.baseUrl}/v3/aftermarket/customers/my${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const retry = options.retry ?? method === 'GET';
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send<T>(method, url, options);
      } catch (error) {
        if (
          !retry ||
          attempt >= this.maxRetries ||
          !(error instanceof AfternicError) ||
          !error.retryable
        ) {
          throw error;
        }
        if (error.status === 429) {
          // Everyone sharing this key waits, not just this request.
          this.limiter.pause((error.retryAfter ?? 60) * 1000);
        } else {
          await this.clock.sleep(1000 * 2 ** attempt);
        }
      }
    }
  }

  private async send<T>(
    method: string,
    url: URL,
    options: RequestOptions,
  ): Promise<T | null> {
    await this.limiter.take();
    const requestId = crypto.randomUUID();
    const { body, csv } = options;
    const contentType =
      csv !== undefined
        ? 'text/csv'
        : body !== undefined
          ? 'application/json'
          : undefined;
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: this.auth,
          accept: options.text ? '*/*' : 'application/json',
          'x-request-id': requestId,
          ...this.userAgent,
          ...(contentType ? { 'content-type': contentType } : {}),
        },
        body: csv ?? (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new AfternicError({
        status: 0,
        code: timedOut ? 'TIMEOUT' : 'NETWORK',
        message: timedOut
          ? 'Afternic did not respond in time.'
          : 'Could not reach Afternic.',
        requestId,
      });
    }
    const text = await response.text();
    if (!response.ok) {
      throw errorFromResponse(
        response.status,
        text,
        requestId,
        response.headers.get('retry-after'),
      );
    }
    if (options.text) return text as T;
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AfternicError({
        status: response.status,
        code: 'BAD_RESPONSE',
        message: 'Afternic sent a response that is not JSON.',
        requestId,
      });
    }
  }
}
