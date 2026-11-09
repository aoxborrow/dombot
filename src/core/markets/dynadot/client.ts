import { userAgentHeaders } from '../../app-info';
import { assertDomainName } from '../../../shared/domain-name';
import {
  RateLimiter,
  pacedFetch,
  realClock,
  sharedLimiter,
  type Clock,
} from '../rate-limit';
import { DynadotError, codeForStatus, lockCode } from './errors';
import type {
  DynadotAccountDomain,
  DynadotAccountInfo,
  DynadotExternalDomain,
  DynadotListing,
  DynadotListingInput,
  DynadotVerification,
} from './types';
import {
  DYNADOT_BASE_URL,
  asciiName,
  cents,
  dataOf,
  envelopeCode,
  listingTypeParam,
  listOf,
  messageOf,
  pagingOf,
  readAccountDomain,
  readAccountInfo,
  readExternalDomain,
  readListing,
  readVerification,
} from './wire';

// A client for Dynadot's marketplace (docs/dynadot-marketplace-api.md), on
// the RESTful v2 API that registrar-client's Dynadot provider uses with the
// same key. One method per command.
//
// - Every request carries `Authorization: Bearer <key>` and an
//   `X-Signature`: the Base64 HMAC-SHA256, keyed by the secret, of
//   `key \n path?query \n \n body`, as registrar-client signs them.
// - Failures come as real HTTP statuses with an envelope saying why.
// - The limit is the account's (60 a minute on a Regular account, one
//   request at a time), shared with the registrar side, which runs its own
//   calls on the same key. The client paces itself under that.
// - Writes go once and are never retried, not even on a network error,
//   since Dynadot may have applied them.

/** Names per page of the account's domain list (observed to work). */
export const DOMAIN_PAGE = 200;
/** Names per page of the other-registrar list (Dynadot's default). */
export const EXTERNAL_PAGE = 100;
/**
 * Requests a minute. Regular accounts get 60 and one at a time; this stays
 * under it, leaving room for registrar calls on the same key.
 */
export const REQUESTS_PER_MINUTE = 50;
/**
 * The pacing for one Dynadot key, by its registrar account: the market
 * client and the registrar side's calls (registrar-client, through a paced
 * fetch) take from the same budget.
 */
export function dynadotLimiter(
  key: string,
  clock: Clock = realClock,
): RateLimiter {
  return sharedLimiter(
    `dynadot:${key}`,
    // One request in flight at a time, as a Regular account allows.
    () => new RateLimiter(clock, REQUESTS_PER_MINUTE, { serial: true }),
  );
}

/**
 * A fetch for the registrar side's calls on a Dynadot key (registrar-client
 * takes one): it waits its turn on the key's limiter, and a 429, as the
 * status or Dynadot's envelope code, pauses the limiter for the market
 * client too.
 */
export function dynadotPacedFetch(
  key: string,
  inner: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return pacedFetch(dynadotLimiter(key), inner, {
    pauseMs: RATE_LIMIT_PAUSE_MS,
    rateLimited: async (response) => {
      if (response.status === 429) return true;
      if (!response.ok) return false;
      try {
        return envelopeCode(JSON.parse(await response.clone().text())) === 429;
      } catch {
        return false;
      }
    },
  });
}

/** How long to hold off after a 429 that doesn't say: Dynadot's message says 60 seconds. */
const RATE_LIMIT_PAUSE_MS = 60_000;
/** A call slower than this is logged (by endpoint only). */
const SLOW_CALL_MS = 5_000;
/** A walk stops here whatever Dynadot says, in case it ignores `page`. */
const MAX_PAGES = 500;

export interface DynadotCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface DynadotClientOptions extends DynadotCredentials {
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

function isNotFound(error: unknown): boolean {
  return error instanceof DynadotError && error.code === 'NOT_FOUND';
}

/** Base64 of the HMAC-SHA256 of `message` keyed by `key`. Web Crypto, so it
 *  runs in Electron and the Worker alike. */
async function hmacBase64(key: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  let binary = '';
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class DynadotClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly signingKey: Promise<CryptoKey>;
  private readonly userAgent: Record<string, string>;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: DynadotClientOptions) {
    if (!options.apiKey?.trim()) throw new Error('Dynadot needs an API key.');
    if (!options.apiSecret?.trim()) {
      throw new Error('Dynadot needs an API secret.');
    }
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = (options.baseUrl ?? DYNADOT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey.trim();
    this.signingKey = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(options.apiSecret.trim()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    this.userAgent = options.userAgent
      ? { 'user-agent': options.userAgent }
      : userAgentHeaders();
    this.clock = options.clock ?? realClock;
    this.limiter =
      options.limiter ??
      dynadotLimiter(options.limiterKey ?? this.apiKey.slice(0, 8), this.clock);
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // Account

  async accountInfo(): Promise<DynadotAccountInfo> {
    return readAccountInfo(
      dataOf(await this.call('/restful/v2/accounts/info')),
    );
  }

  /**
   * Every name in the account and whether Dynadot marks it for sale.
   * `complete` is false when the pages didn't add up to Dynadot's total.
   */
  async accountDomains(): Promise<{
    domains: DynadotAccountDomain[];
    complete: boolean;
  }> {
    const walk = await this.walk(DOMAIN_PAGE, async (page) => {
      const data = dataOf(
        await this.call(
          `/restful/v2/domains?page_size=${DOMAIN_PAGE}&page=${page}`,
        ),
      );
      return {
        items: listOf(data, 'domain_info_list').flatMap(
          (i) => readAccountDomain(i) ?? [],
        ),
        ...pagingOf(data),
      };
    });
    return { domains: walk.items, complete: walk.complete };
  }

  // Listings of names in the account

  /**
   * One name's listing, priced in `currency` (Dynadot converts); null when
   * it has none. Dynadot refuses the read without a currency.
   */
  async getListing(
    name: string,
    currency = 'usd',
  ): Promise<DynadotListing | null> {
    const domain = assertDomainName(name);
    try {
      const data = dataOf(
        await this.call(
          `/restful/v2/aftermarket/listings/${encodeURIComponent(domain)}?currency=${encodeURIComponent(currency.toLowerCase())}`,
        ),
      );
      return readListing(data?.listing_item ?? data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Whether the account holds the name: `domain_info` answers 404 if not. */
  async holds(name: string): Promise<boolean> {
    const domain = assertDomainName(name);
    try {
      await this.call(`/restful/v2/domains/${encodeURIComponent(domain)}`);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * List, reprice or delist a name in the account (`set_for_sale`). The
   * live path is `aftermarkets/…/for_sales` (the singular one answers
   * "not recognized", observed). `listing_type` is required even to delist,
   * and so is a non-empty `description` for a name in the account (left out
   * or empty, it's refused; a space passes, observed). DomBot doesn't manage
   * descriptions, so it sends a space, which replaces the one on Dynadot.
   * Dynadot refuses the write while the name is locked (409 "Domain is
   * locked", `DOMAIN_LOCKED`) or the account is (400 "Please unlock your
   * account firstly", `ACCOUNT_LOCKED`), observed.
   */
  async setForSale(name: string, input: DynadotListingInput): Promise<void> {
    const domain = assertDomainName(name);
    await this.write(
      'PUT',
      `/restful/v2/aftermarkets/domains/${encodeURIComponent(domain)}/for_sales`,
      {
        for_sale_type: input.forSale ? 'marketplace' : 'not_for_sale',
        listing_type: listingTypeParam(input.listingType),
        description: input.description ?? ' ',
        ...(input.forSale && {
          currency: input.currency.toLowerCase(),
          ...(input.price !== null && { price: input.price }),
          ...(input.minOffer !== null && {
            minimum_offer_price: input.minOffer,
          }),
        }),
      },
    );
  }

  /** Lock or unlock a name in the account (as registrar-client does). */
  async setLock(name: string, locked: boolean): Promise<void> {
    const domain = assertDomainName(name);
    await this.write(
      'PUT',
      `/restful/v2/domains/${encodeURIComponent(domain)}/domain_lock`,
      { lock: locked },
    );
  }

  // Names held at other registrars

  /** Add names to the other-registrar list, the first step to listing them. */
  async addExternal(names: readonly string[]): Promise<void> {
    await this.write(
      'POST',
      '/restful/v2/aftermarket/other_registrar/domains',
      {
        domain_name_list: names.map((n) => assertDomainName(n)),
      },
    );
  }

  /**
   * Ask Dynadot to check names' verification now. Names it doesn't find
   * verified, or that aren't on the list, come back in `failed`.
   */
  async verifyExternal(
    names: readonly string[],
  ): Promise<{ verified: string[]; failed: string[] }> {
    const data = dataOf(
      await this.write(
        'POST',
        '/restful/v2/aftermarket/other_registrar/verify',
        {
          domain_name_list: names.map((n) => assertDomainName(n)),
        },
      ),
    );
    // Punycode, as DomBot keys names, so an IDN Dynadot verified matches.
    const namesIn = (key: string) =>
      listOf(data, key).flatMap((n) => asciiName(n) ?? []);
    return {
      verified: namesIn('success_list'),
      failed: namesIn('failed_list'),
    };
  }

  /**
   * List, reprice or delist a name held elsewhere. Prices go in cents.
   * Dynadot refuses one it hasn't verified (409 "This domain is not
   * verified", observed).
   */
  async listExternal(name: string, input: DynadotListingInput): Promise<void> {
    const domain = assertDomainName(name);
    await this.write(
      'POST',
      `/restful/v2/aftermarket/${encodeURIComponent(domain)}/listing_other_registrar_domain`,
      input.forSale
        ? {
            for_sale_type: 'marketplace',
            listing_type: listingTypeParam(input.listingType),
            currency: input.currency.toLowerCase(),
            ...(input.price !== null && {
              buy_now_price: cents(input.price),
            }),
            ...(input.minOffer !== null && {
              minimum_offer_price: cents(input.minOffer),
            }),
            ...(input.description !== undefined && {
              description: input.description,
            }),
          }
        : { for_sale_type: 'not_for_sale' },
    );
  }

  /** Every name added to the account's other-registrar list. */
  async externalDomains(): Promise<{
    domains: DynadotExternalDomain[];
    complete: boolean;
  }> {
    const walk = await this.walk(EXTERNAL_PAGE, async (page) => {
      const data = dataOf(
        await this.call(
          `/restful/v2/aftermarket/other_registrar/domains?page_size=${EXTERNAL_PAGE}&page=${page}`,
        ),
      );
      return {
        items: listOf(data, 'domain_info_list').flatMap(
          (i) => readExternalDomain(i) ?? [],
        ),
        ...pagingOf(data),
      };
    });
    return { domains: walk.items, complete: walk.complete };
  }

  /**
   * How to verify a name on the other-registrar list (the account's key,
   * and the TXT, nameservers and CNAME built from it); null for a name
   * that isn't on it. Never asks for a new key.
   */
  async verification(name: string): Promise<DynadotVerification | null> {
    const domain = assertDomainName(name);
    try {
      const data = dataOf(
        await this.call(
          `/restful/v2/aftermarket/other_registrar/${encodeURIComponent(domain)}/verification`,
        ),
      );
      return readVerification(data, domain);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  // Transport

  /**
   * Reads every page. Stops on a short page or Dynadot's `has_next_page`,
   * and says `complete: false` when Dynadot repeated a page or the total
   * didn't match.
   */
  private async walk<T extends { name: string }>(
    pageSize: number,
    read: (page: number) => Promise<{
      items: T[];
      total: number | null;
      hasNext: boolean | null;
    }>,
  ): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    let previousFirst: string | null = null;
    let total: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const p = await read(page);
      total = p.total ?? total;
      if (!p.items.length) break;
      // Dynadot ignoring `page` would send page 1 forever.
      const first = p.items[0].name;
      if (first === previousFirst) return { items, complete: false };
      previousFirst = first;
      items.push(...p.items);
      // Dynadot's `has_next_page` decides where it sends one; a short page
      // only where it doesn't (it may cap the page size).
      if (p.hasNext === false) break;
      if (p.hasNext === null && p.items.length < pageSize) break;
      if (page === MAX_PAGES) return { items, complete: false };
    }
    return { items, complete: total === null || total === items.length };
  }

  /** A request with side effects: sent once, never retried. */
  private write(
    method: 'POST' | 'PUT' | 'DELETE',
    pathAndQuery: string,
    body?: unknown,
  ): Promise<unknown> {
    return this.send(method, pathAndQuery, body);
  }

  /** A GET, retried with backoff when it's worth it. */
  private async call(pathAndQuery: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send('GET', pathAndQuery);
      } catch (error) {
        const retry =
          error instanceof DynadotError &&
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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pathAndQuery: string,
    body?: unknown,
  ): Promise<unknown> {
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const signature = await hmacBase64(
      await this.signingKey,
      `${this.apiKey}\n${pathAndQuery}\n\n${bodyText}`,
    );
    const endpoint = pathAndQuery.split('?')[0];
    // The answer is read inside the turn: the key's next request, the
    // registrar side's included, waits for this one to finish.
    const { response, raw, started } = await this.limiter.run(async () => {
      const started = this.clock.now();
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
          method,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
            'x-signature': signature,
            ...this.userAgent,
          },
          ...(body === undefined ? {} : { body: bodyText }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        if (timedOut) {
          console.warn(`[dynadot] ${method} ${endpoint} timed out`);
        }
        throw new DynadotError(
          timedOut ? 'TIMEOUT' : 'NETWORK',
          timedOut
            ? 'Dynadot did not respond in time.'
            : 'Could not reach Dynadot.',
          0,
        );
      }
      return { response, raw: await response.text(), started };
    });
    const took = this.clock.now() - started;
    if (took > SLOW_CALL_MS) {
      console.warn(
        `[dynadot] ${method} ${endpoint} took ${Math.round(took / 1000)}s`,
      );
    }
    let parsed: unknown = undefined;
    try {
      parsed = raw.trim() ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    // The envelope's code mirrors the status; trust whichever says failure.
    const code = envelopeCode(parsed);
    const status = !response.ok ? response.status : (code ?? response.status);
    if (status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      this.limiter.pause(
        retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_PAUSE_MS,
      );
    }
    if (status < 200 || status >= 300) {
      const message = messageOf(parsed) ?? `Dynadot answered HTTP ${status}.`;
      throw new DynadotError(
        lockCode(message) ?? codeForStatus(status),
        message,
        status,
      );
    }
    if (parsed === undefined) {
      throw new DynadotError(
        'BAD_RESPONSE',
        'Dynadot sent an answer DomBot could not read.',
        response.status,
      );
    }
    return parsed;
  }
}
