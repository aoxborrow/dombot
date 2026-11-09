import { userAgentHeaders } from '../../app-info';
import { assertDomainName, toUnicode } from '../../../shared/domain-name';
import {
  RateLimiter,
  realClock,
  sharedLimiter,
  type Clock,
} from '../rate-limit';
import { SpaceshipError, codeForStatus } from './errors';
import type {
  SellerHubListing,
  SellerHubListingInput,
  SellerHubSale,
  SellerHubVerificationOption,
} from './types';
import {
  SPACESHIP_BASE_URL,
  asciiName,
  messageOf,
  money,
  pageOf,
  readListing,
  readSale,
  readVerificationOptions,
} from './wire';

// A client for Spaceship SellerHub (docs/sellerhub-api.md), on the same API,
// host and key as registrar-client's Spaceship provider; SellerHub calls
// need the key's `sellerhub:read` and `sellerhub:write` scopes. One method
// per operation.
//
// - Every request carries `X-API-Key` and `X-API-Secret`.
// - Failures come as real HTTP statuses with a problem+json body; a key
//   without SellerHub's scopes gets 403 (`SCOPE`).
// - Limits are per user and per operation: 300 in 300 seconds for most,
//   10 a minute for the verification records. The client paces itself at
//   60 a minute per key, shared by every client on it.
// - Writes go once and are never retried, not even on a network error,
//   since Spaceship may have applied them.

/** Items per page: the most Spaceship takes. */
export const PAGE_SIZE = 100;
/** Requests a minute per key: 300 in 300 seconds for most operations. */
export const REQUESTS_PER_MINUTE = 60;

/** How long to hold off after a 429 without a Retry-After. */
const RATE_LIMIT_PAUSE_MS = 60_000;
/** A call slower than this is logged (by endpoint only). */
const SLOW_CALL_MS = 5_000;
/** A walk stops here whatever Spaceship says. */
const MAX_PAGES = 1_000;

export interface SpaceshipCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface SellerHubClientOptions extends SpaceshipCredentials {
  /** Defaults to global fetch; pass one to route through a proxy. */
  fetch?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
  /** Shares pacing with every client on the same key (the registrar account). */
  limiterKey?: string;
  limiter?: RateLimiter;
  clock?: Clock;
  /** Retries for a read that hit a rate limit, 5xx or network error. */
  maxRetries?: number;
  timeoutMs?: number;
}

/** The pacing for one Spaceship key, by its registrar account. */
export function spaceshipLimiter(
  key: string,
  clock: Clock = realClock,
): RateLimiter {
  return sharedLimiter(
    `spaceship:${key}`,
    () => new RateLimiter(clock, REQUESTS_PER_MINUTE),
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof SpaceshipError && error.code === 'NOT_FOUND';
}

/** The body for a create or an update, in Spaceship's shapes. */
function bodyOf(input: SellerHubListingInput): Record<string, unknown> {
  return {
    ...(input.displayName !== undefined && { displayName: input.displayName }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.binPriceEnabled !== undefined && {
      binPriceEnabled: input.binPriceEnabled,
    }),
    ...(input.binPrice !== undefined && { binPrice: money(input.binPrice) }),
    ...(input.minPriceEnabled !== undefined && {
      minPriceEnabled: input.minPriceEnabled,
    }),
    ...(input.minPrice !== undefined && { minPrice: money(input.minPrice) }),
  };
}

export class SellerHubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly userAgent: Record<string, string>;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: SellerHubClientOptions) {
    if (!options.apiKey?.trim()) throw new Error('Spaceship needs an API key.');
    if (!options.apiSecret?.trim()) {
      throw new Error('Spaceship needs an API secret.');
    }
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = (options.baseUrl ?? SPACESHIP_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey.trim();
    this.apiSecret = options.apiSecret.trim();
    this.userAgent = options.userAgent
      ? { 'user-agent': options.userAgent }
      : userAgentHeaders();
    this.clock = options.clock ?? realClock;
    this.limiter =
      options.limiter ??
      spaceshipLimiter(
        options.limiterKey ?? this.apiKey.slice(0, 8),
        this.clock,
      );
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // Listings

  /** One page of listings, and how many there are in all. */
  async listingsPage(
    skip = 0,
    take = PAGE_SIZE,
  ): Promise<{ listings: SellerHubListing[]; total: number | null }> {
    const page = pageOf(
      await this.call(`/v1/sellerhub/domains?take=${take}&skip=${skip}`),
    );
    return {
      listings: page.items.flatMap((i) => readListing(i) ?? []),
      total: page.total,
    };
  }

  /**
   * Every listing, whatever its status. `complete` is false when the pages
   * didn't add up to Spaceship's total.
   */
  async allListings(): Promise<{
    listings: SellerHubListing[];
    complete: boolean;
  }> {
    const walk = await this.walk((skip) =>
      this.listingsPage(skip).then((p) => ({
        items: p.listings,
        total: p.total,
      })),
    );
    return { listings: walk.items, complete: walk.complete };
  }

  /** One listing; null when the name isn't in SellerHub. */
  async getListing(name: string): Promise<SellerHubListing | null> {
    const domain = assertDomainName(name);
    try {
      return readListing(
        await this.call(`/v1/sellerhub/domains/${encodeURIComponent(domain)}`),
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Add a name to SellerHub (in Unicode, as Spaceship takes it). */
  async createListing(
    name: string,
    input: SellerHubListingInput,
  ): Promise<SellerHubListing | null> {
    const domain = assertDomainName(name);
    return readListing(
      await this.write('POST', '/v1/sellerhub/domains', {
        name: toUnicode(domain),
        ...bodyOf(input),
      }),
    );
  }

  /** Change a listing: only the fields given. */
  async updateListing(
    name: string,
    input: SellerHubListingInput,
  ): Promise<SellerHubListing | null> {
    const domain = assertDomainName(name);
    return readListing(
      await this.write(
        'PATCH',
        `/v1/sellerhub/domains/${encodeURIComponent(domain)}`,
        bodyOf(input),
      ),
    );
  }

  /** Take a name out of SellerHub; a name that isn't there counts as done. */
  async deleteListing(name: string): Promise<void> {
    const domain = assertDomainName(name);
    try {
      await this.write(
        'DELETE',
        `/v1/sellerhub/domains/${encodeURIComponent(domain)}`,
      );
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  // Sales

  /**
   * Sold names, from `from` (inclusive) to `to` (exclusive), both full ISO
   * 8601 times; every sale when neither is given. Follows the cursor to
   * the end.
   */
  async soldDomains(
    range: { from?: string; to?: string } = {},
  ): Promise<SellerHubSale[]> {
    const sales: SellerHubSale[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ take: String(PAGE_SIZE) });
      if (cursor) query.set('cursor', cursor);
      if (range.from) query.set('saleDateTimeFrom', range.from);
      if (range.to) query.set('saleDateTimeTo', range.to);
      const p = pageOf(
        await this.call(`/v1/sellerhub/domains/reports/sold?${query}`),
      );
      sales.push(...p.items.flatMap((i) => readSale(i) ?? []));
      // A cursor seen before would loop forever.
      if (!p.cursor || seen.has(p.cursor)) break;
      seen.add(p.cursor);
      cursor = p.cursor;
    }
    return sales;
  }

  // Ownership verification

  /**
   * The account's verification options: one set of records for every name
   * held outside the account. Limited to 10 calls a minute.
   */
  async verificationRecords(): Promise<SellerHubVerificationOption[]> {
    return readVerificationOptions(
      await this.call('/v1/sellerhub/verification-records'),
    );
  }

  // The registrar side, same key

  /**
   * Every name the Spaceship account holds, from the registrar's domain
   * list: which listed names need no ownership verification.
   */
  async accountDomainNames(): Promise<{ names: string[]; complete: boolean }> {
    const walk = await this.walk(async (skip) => {
      const page = pageOf(
        await this.call(`/v1/domains?take=${PAGE_SIZE}&skip=${skip}`),
      );
      return {
        items: page.items.flatMap((d) => {
          const name =
            d && typeof d === 'object'
              ? asciiName((d as { name?: unknown }).name)
              : null;
          return name ? [{ name }] : [];
        }),
        total: page.total,
      };
    });
    return { names: walk.items.map((i) => i.name), complete: walk.complete };
  }

  // Transport

  /**
   * Reads every take/skip page. Stops on a short page or at the total, and
   * says `complete: false` when Spaceship repeated a page or the total
   * didn't match.
   */
  private async walk<T extends { name: string }>(
    read: (skip: number) => Promise<{ items: T[]; total: number | null }>,
  ): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    let total: number | null = null;
    let previousFirst: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const p = await read(items.length);
      total = p.total ?? total;
      if (!p.items.length) break;
      const first = p.items[0].name;
      if (first === previousFirst) return { items, complete: false };
      previousFirst = first;
      items.push(...p.items);
      if (p.items.length < PAGE_SIZE) break;
      if (total !== null && items.length >= total) break;
      if (page === MAX_PAGES - 1) return { items, complete: false };
    }
    return { items, complete: total === null || total === items.length };
  }

  /** A request with side effects: sent once, never retried. */
  private write(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    return this.send(method, path, body);
  }

  /** A GET, retried with backoff when it's worth it. */
  private async call(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send('GET', path);
      } catch (error) {
        const retry =
          error instanceof SpaceshipError &&
          error.retryable &&
          attempt < this.maxRetries;
        if (!retry) throw error;
        // A 429 already paused the limiter; the next take() waits it out.
        if (error.code !== 'RATE_LIMITED') {
          await this.clock.sleep(2000 * 2 ** attempt);
        }
      }
    }
  }

  private async send(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    await this.limiter.take();
    const started = this.clock.now();
    const endpoint = path.split('?')[0];
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined && { 'content-type': 'application/json' }),
          'x-api-key': this.apiKey,
          'x-api-secret': this.apiSecret,
          ...this.userAgent,
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      if (timedOut) console.warn(`[spaceship] ${method} ${endpoint} timed out`);
      throw new SpaceshipError(
        timedOut ? 'TIMEOUT' : 'NETWORK',
        timedOut
          ? 'Spaceship did not respond in time.'
          : 'Could not reach Spaceship.',
        0,
      );
    }
    const raw = await response.text();
    const took = this.clock.now() - started;
    if (took > SLOW_CALL_MS) {
      console.warn(
        `[spaceship] ${method} ${endpoint} took ${Math.round(took / 1000)}s`,
      );
    }
    let parsed: unknown = undefined;
    try {
      parsed = raw.trim() ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      this.limiter.pause(
        retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_PAUSE_MS,
      );
    }
    if (!response.ok) {
      const spaceshipCode = response.headers.get('spaceship-error-code');
      const code = codeForStatus(response.status);
      const message =
        code === 'SCOPE' && endpoint.startsWith('/v1/sellerhub')
          ? 'This Spaceship API key has no SellerHub access. In Spaceship’s API Manager, give it sellerhub:read, and sellerhub:write to list from DomBot.'
          : (messageOf(parsed) ??
            `Spaceship answered HTTP ${response.status}.`);
      throw new SpaceshipError(code, message, response.status, spaceshipCode);
    }
    // A delete answers 204 with nothing.
    if (parsed === undefined && response.status !== 204) {
      throw new SpaceshipError(
        'BAD_RESPONSE',
        'Spaceship sent an answer DomBot could not read.',
        response.status,
      );
    }
    return parsed ?? null;
  }
}
