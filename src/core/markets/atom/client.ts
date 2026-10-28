import { userAgentHeaders } from '../../app-info';
import { assertDomainName } from '../../../shared/domain-name';
import {
  RateLimiter,
  realClock,
  sharedLimiter,
  type Clock,
} from '../rate-limit';
import { AtomError } from './errors';
import type {
  AtomAnalytics,
  AtomAppraisal,
  AtomCategory,
  AtomCreatableType,
  AtomGradeResult,
  AtomListing,
  AtomListingType,
  AtomPage,
  AtomSale,
  AtomWriteAck,
} from './types';
import {
  ATOM_BASE_URL,
  failureOf,
  itemsOf,
  messageOf,
  pageOf,
  readAnalytics,
  readAppraisal,
  readCategory,
  readGrade,
  readListing,
  readSale,
  recordOf,
  str,
} from './wire';

// A client for Atom's seller API (docs/atom-api.md), plus its appraisal
// call, which takes a seller token. One method per operation.
//
// Three things shape everything here:
// - The token and user id go in the query string of every call, Atom's only
//   option. So no request URL is ever logged or put in an error, and
//   AtomError scrubs anything that looks like a token parameter.
// - Atom answers failures with HTTP 200 and a message, so every body is read
//   and judged by wire.ts's `failureOf`, whatever the status.
// - Writes are GETs with side effects. They go once and are never retried,
//   not even on a network error, since Atom may have applied them.
//
// Not built, on purpose: boost (spends AI credits) and Premium listings
// (spend a credit and go to review). Submit those on atom.com.
//
// UNVERIFIED: no authenticated call has been made (no API key yet). Built
// from Atom's OpenAPI specs and help center (2026-10-28). docs/atom-api.md,
// "Unverified", lists what to check first.

/** Listings and sales per page. UNVERIFIED: Atom's maximum. */
export const LIST_PAGE = 100;
/** Names per grading upload, to keep the URL short. UNVERIFIED: Atom's cap. */
export const GRADE_BATCH = 100;
/** Longest description sent; it travels in the URL. */
export const MAX_DESCRIPTION = 2000;
/**
 * Requests a minute per account. UNVERIFIED: Atom publishes no limit; one a
 * second is a guess to revise once there are 429s to learn from.
 */
export const REQUESTS_PER_MINUTE = 60;
/** The tiers Atom's list filter takes; walked one at a time to tag each row. */
const LIST_TYPES = ['premium', 'standard', 'geo'] as const;
/** A walk stops here whatever Atom says, in case it ignores `page`. */
const MAX_PAGES = 1000;

export interface AtomCredentials {
  apiToken: string;
  userId: string;
}

export interface AtomClientOptions extends AtomCredentials {
  /** Defaults to global fetch; pass one to route through a proxy. */
  fetch?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
  limiter?: RateLimiter;
  clock?: Clock;
  /** Retries for a read that hit a rate limit, 5xx or network error. */
  maxRetries?: number;
  timeoutMs?: number;
}

type Params = Record<string, string | number | undefined>;

interface CallOptions {
  method?: 'GET' | 'POST';
  /** Has side effects: sent once, never retried. */
  write?: boolean;
}

/** A whole number of dollars, as Atom takes prices and discounts. */
function dollars(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number of dollars.`);
  }
  return value;
}

function chunks<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function isNotFound(error: unknown): boolean {
  return error instanceof AtomError && error.code === 'NOT_FOUND';
}

export class AtomClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly credentials: AtomCredentials;
  private readonly userAgent: Record<string, string>;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: AtomClientOptions) {
    if (!options.apiToken?.trim()) throw new Error('Atom needs an API token.');
    if (!options.userId?.trim()) throw new Error('Atom needs a user id.');
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = (options.baseUrl ?? ATOM_BASE_URL).replace(/\/+$/, '');
    this.credentials = {
      apiToken: options.apiToken.trim(),
      userId: options.userId.trim(),
    };
    this.userAgent = options.userAgent
      ? { 'user-agent': options.userAgent }
      : userAgentHeaders();
    this.clock = options.clock ?? realClock;
    this.limiter =
      options.limiter ??
      sharedLimiter(
        `atom:${this.credentials.userId}`,
        () => new RateLimiter(this.clock, REQUESTS_PER_MINUTE),
      );
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // Listings

  /** One page of listings, of one tier or all. */
  async listListings(
    options: { type?: AtomListingType; page?: number; limit?: number } = {},
  ): Promise<AtomPage<AtomListing>> {
    const type = options.type ?? null;
    try {
      const body = await this.call('/domains', {
        type: type ?? undefined,
        page: options.page ?? 1,
        limit: options.limit ?? LIST_PAGE,
      });
      return pageOf(body, (i) => readListing(i, type));
    } catch (error) {
      // An empty tier may answer "no domains found".
      if (isNotFound(error)) {
        return { items: [], page: null, totalPages: null, total: 0 };
      }
      throw error;
    }
  }

  /**
   * Every listing, one tier at a time so each row knows its tier even if
   * Atom's records don't say. Plus listings come back under whichever tier
   * Atom files them (UNVERIFIED). `complete` is false when a walk ended
   * oddly: Atom repeated a page, or the count didn't match its total.
   */
  async allListings(): Promise<{ listings: AtomListing[]; complete: boolean }> {
    const byName = new Map<string, AtomListing>();
    let complete = true;
    for (const type of LIST_TYPES) {
      const walk = await this.walk((page) =>
        this.listListings({ type, page, limit: LIST_PAGE }),
      );
      complete &&= walk.complete;
      for (const l of walk.items)
        if (!byName.has(l.name)) byName.set(l.name, l);
    }
    return { listings: [...byName.values()], complete };
  }

  /** One listing's details; null when it isn't listed on this account. */
  async getListing(name: string): Promise<AtomListing | null> {
    const domain = assertDomainName(name);
    try {
      const body = await this.call('/domain-details', { domain_name: domain });
      return readListing(recordOf(body));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** The account's listings matching a category, keyword or type of name. */
  async searchListings(query: {
    category?: string;
    keyword?: string;
    nameType?: string;
  }): Promise<AtomListing[]> {
    try {
      const body = await this.call('/domains/search', {
        category: query.category,
        keyword: query.keyword,
        name_type: query.nameType,
      });
      return pageOf(body, (i) => readListing(i)).items;
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  /**
   * List a name as Standard or Plus. Standard goes live at once. Premium is
   * refused here: it spends an AI credit and goes to review, so it's done on
   * atom.com. UNVERIFIED: the spec's enum has only premium and standard; the
   * help center says the API adds Plus too.
   */
  async createListing(
    name: string,
    listing: { price: number; type?: AtomCreatableType },
  ): Promise<AtomWriteAck> {
    const type = listing.type ?? 'standard';
    if ((type as string) === 'premium') {
      throw new Error(
        'DomBot doesn’t add Premium listings; submit them on atom.com.',
      );
    }
    return this.write('/add-domain', {
      domain_name: assertDomainName(name),
      domain_type: type,
      price: dollars(listing.price, 'The price'),
    });
  }

  /** Delist a Standard or Plus listing. Premium needs a 7-day notice to Atom. */
  async deleteListing(name: string): Promise<AtomWriteAck> {
    return this.write('/remove-domain', {
      domain_name: assertDomainName(name),
    });
  }

  /** Premium prices must stay inside the account's membership-tier range. */
  async updatePrice(name: string, price: number): Promise<AtomWriteAck> {
    return this.write('/update-selling-price', {
      domain_name: assertDomainName(name),
      selling_price: dollars(price, 'The price'),
    });
  }

  /**
   * A discount, in whole dollars off the price, until Atom resets discounts
   * on Monday. UNVERIFIED: that the amount is dollars, not a percent, and
   * that 0 clears it.
   */
  async setDiscount(name: string, amount: number): Promise<AtomWriteAck> {
    return this.write('/add-discount', {
      domain_name: assertDomainName(name),
      discount: dollars(amount, 'The discount'),
    });
  }

  // Merchandising

  async listCategories(): Promise<AtomCategory[]> {
    return this.categoryList('/categories');
  }

  /** The industry categories `setPrimaryCategory` takes. */
  async listPrimaryCategories(): Promise<AtomCategory[]> {
    return this.categoryList('/primary-categories');
  }

  /** Replaces the name's primary category, by name. */
  async setPrimaryCategory(
    name: string,
    category: string,
  ): Promise<AtomWriteAck> {
    if (!category.trim()) throw new Error('Choose a category.');
    return this.write('/assign-primary-category', {
      domain_name: assertDomainName(name),
      category_name: category.trim(),
    });
  }

  /** A POST, but Atom still takes the text as a query parameter. */
  async setDescription(
    name: string,
    description: string,
  ): Promise<AtomWriteAck> {
    const text = description.trim();
    if (text.length > MAX_DESCRIPTION) {
      throw new Error(
        `Keep the description under ${MAX_DESCRIPTION} characters.`,
      );
    }
    return this.write(
      '/update-description',
      { domain_name: assertDomainName(name), domain_description: text },
      'POST',
    );
  }

  /** Ask Atom to check the name's nameservers or TXT record now. */
  async verifyDns(name: string): Promise<AtomWriteAck> {
    return this.write('/verify-dns', { domain_name: assertDomainName(name) });
  }

  // Sales and analytics

  async listSales(
    options: {
      type?: 'premium' | 'standard';
      page?: number;
      limit?: number;
    } = {},
  ): Promise<AtomPage<AtomSale>> {
    try {
      const body = await this.call('/all-sales', {
        domain_type: options.type,
        page: options.page ?? 1,
        limit: options.limit ?? LIST_PAGE,
      });
      return pageOf(body, readSale);
    } catch (error) {
      if (isNotFound(error)) {
        return { items: [], page: null, totalPages: null, total: 0 };
      }
      throw error;
    }
  }

  /** Every sale. Atom takes no date filter, so this is always all of them. */
  async allSales(): Promise<AtomSale[]> {
    const walk = await this.walk((page) =>
      this.listSales({ page, limit: LIST_PAGE }),
    );
    const byId = new Map(walk.items.map((s) => [s.id, s]));
    return [...byId.values()];
  }

  /** One name's counters (views, shortlists, trackers). */
  async getAnalytics(name: string): Promise<AtomAnalytics> {
    const domain = assertDomainName(name);
    const body = await this.call('/domain-analytics', { domain_name: domain });
    return readAnalytics(body, domain);
  }

  // Syndication

  /** Premium names Atom allows listing on other marketplaces too. */
  async listSyndicationAuthorized(
    options: { page?: number; limit?: number } = {},
  ): Promise<AtomPage<string>> {
    try {
      const body = await this.call('/syndication-authorized-domains', {
        page: options.page ?? 1,
        limit: options.limit ?? LIST_PAGE,
      });
      return pageOf(
        body,
        (i) => (typeof i === 'string' ? i : readListing(i)?.name) ?? null,
      );
    } catch (error) {
      if (isNotFound(error)) {
        return { items: [], page: null, totalPages: null, total: 0 };
      }
      throw error;
    }
  }

  async allSyndicationAuthorized(): Promise<string[]> {
    const walk = await this.walk((page) =>
      this.listSyndicationAuthorized({ page, limit: LIST_PAGE }),
    );
    return [...new Set(walk.items.map((n) => n.toLowerCase()))];
  }

  // Grading and appraisal

  /** Send names for Atom's AI grading, 100 a call; results come later. */
  async submitForGrading(names: readonly string[]): Promise<AtomWriteAck[]> {
    const keys = [...new Set(names.map(assertDomainName))];
    const out: AtomWriteAck[] = [];
    for (const batch of chunks(keys, GRADE_BATCH)) {
      out.push(
        await this.write(
          '/upload-grade-domains',
          { domains_data: batch.join(',') },
          'POST',
        ),
      );
    }
    return out;
  }

  async getGradingResults(
    options: { page?: number; size?: number; brandFitOnly?: boolean } = {},
  ): Promise<AtomPage<AtomGradeResult>> {
    try {
      const body = await this.call('/get-grade-domain-result', {
        page: options.page ?? 1,
        size: options.size ?? LIST_PAGE,
        brand_fit_only: options.brandFitOnly ? 1 : undefined,
      });
      return pageOf(body, readGrade);
    } catch (error) {
      if (isNotFound(error)) {
        return { items: [], page: null, totalPages: null, total: 0 };
      }
      throw error;
    }
  }

  /**
   * Atom's appraisal of any name. Capped per day (10 by default): past it,
   * throws AtomError DAILY_LIMIT with `dailyLimit` and `usedToday`.
   */
  async getAppraisal(name: string): Promise<AtomAppraisal> {
    const domain = assertDomainName(name);
    const body = await this.call('/domain-appraisal', { domain_name: domain });
    return readAppraisal(body, domain);
  }

  // Paging

  /** Walks pages from 1 until a short, empty or last page. */
  private async walk<T>(
    read: (page: number) => Promise<AtomPage<T>>,
  ): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    let previousFirst: string | null = null;
    let total: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const p = await read(page);
      total = p.total ?? total;
      if (!p.items.length) break;
      // Atom ignoring `page` would send page 1 forever.
      const first = JSON.stringify(p.items[0]);
      if (first === previousFirst) return { items, complete: false };
      previousFirst = first;
      items.push(...p.items);
      if (p.totalPages !== null && page >= p.totalPages) break;
      if (p.totalPages === null && p.items.length < LIST_PAGE) break;
      if (page === MAX_PAGES) return { items, complete: false };
    }
    return { items, complete: total === null || total === items.length };
  }

  private async categoryList(path: string): Promise<AtomCategory[]> {
    const body = await this.call(path, {});
    return itemsOf(body).flatMap((i) => readCategory(i) ?? []);
  }

  // Transport

  private async write(
    path: string,
    params: Params,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<AtomWriteAck> {
    const body = await this.call(path, params, { method, write: true });
    return { message: messageOf(body) ?? str(body) };
  }

  private async call(
    path: string,
    params: Params,
    options: CallOptions = {},
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(path, params, options.method ?? 'GET');
      } catch (error) {
        const retry =
          !options.write &&
          error instanceof AtomError &&
          error.retryable &&
          attempt < this.maxRetries;
        if (!retry) throw error;
        await this.clock.sleep(2000 * 2 ** attempt);
      }
    }
  }

  private async send(
    path: string,
    params: Params,
    method: 'GET' | 'POST',
  ): Promise<unknown> {
    const query = new URLSearchParams({
      api_token: this.credentials.apiToken,
      user_id: this.credentials.userId,
    });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) query.set(k, String(v));
    }
    await this.limiter.take();
    let response: Response;
    try {
      // The URL holds the token: it goes to fetch and nowhere else.
      response = await this.fetchImpl(`${this.baseUrl}${path}?${query}`, {
        method,
        headers: { accept: 'application/json', ...this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new AtomError(
        timedOut ? 'TIMEOUT' : 'NETWORK',
        timedOut ? 'Atom did not respond in time.' : 'Could not reach Atom.',
        0,
      );
    }
    const raw = await response.text();
    let body: unknown = undefined;
    try {
      body = raw.trim() ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryAfter > 0) this.limiter.pause(retryAfter * 1000);
      const said = failureOf(body);
      const daily = said?.code === 'DAILY_LIMIT' || said?.dailyLimit != null;
      throw new AtomError(
        daily ? 'DAILY_LIMIT' : 'RATE_LIMITED',
        said?.message ?? 'Atom’s rate limit was hit.',
        429,
        said ?? {},
      );
    }
    // A failure in the body wins over the status: Atom sends them as 200.
    const failure = failureOf(body);
    if (failure) {
      throw new AtomError(
        failure.code,
        failure.message,
        response.status,
        failure,
      );
    }
    if (!response.ok) {
      throw new AtomError(
        `HTTP_${response.status}`,
        `Atom answered HTTP ${response.status}.`,
        response.status,
      );
    }
    if (body === undefined) {
      throw new AtomError(
        'BAD_RESPONSE',
        'Atom sent a response that is not JSON.',
        response.status,
      );
    }
    return body;
  }
}
