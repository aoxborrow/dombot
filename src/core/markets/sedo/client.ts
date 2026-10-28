import { userAgentHeaders } from '../../app-info';
import { assertDomainName } from '../../../shared/domain-name';
import {
  RateLimiter,
  realClock,
  sharedLimiter,
  type Clock,
} from '../rate-limit';
import { SedoError, faultHint } from './errors';
import type {
  SedoCategory,
  SedoDomainStatus,
  SedoLanguage,
  SedoListing,
  SedoListingChange,
  SedoListingInput,
  SedoParkingStats,
  SedoPayment,
  SedoWriteResult,
} from './types';
import {
  SEDO_BASE_URL,
  amount,
  child,
  currencyFromCode,
  currencyToCode,
  encodeForm,
  flag,
  int,
  items,
  list,
  parseXml,
  readBatchResult,
  readListing,
  text,
  type FormValue,
  type ParsedResponse,
  type WireListing,
  type XmlNode,
} from './wire';

// A client for Sedo's Basic API (docs/sedo-api.md), over its plain-HTTP
// interface: every call a form POST to /api/v1/<Function> with
// `output_method=xml`, never GET, because the account password is a
// parameter and a query string ends up in logs.
//
// Reads were checked against a live account on 2026-10-28 (form POST, XML,
// faults, paging, name lookup, stats, payments, reference lists). Writes
// are still UNVERIFIED: built from the docs and their example XML. What's
// left to check is in docs/sedo-api.md, "Unverified".

/** Most names per write call (DomainInsert, DomainEdit, DomainDelete). */
export const WRITE_BATCH = 50;
/** Most results per DomainList page, and names per name filter. */
export const LIST_PAGE = 100;
/**
 * Requests a minute per account. UNVERIFIED: Sedo publishes no limit; one a
 * second is a guess to be revised once there are credentials.
 */
export const REQUESTS_PER_MINUTE = 60;

export interface SedoCredentials {
  partnerId: string;
  signKey: string;
  username: string;
  password: string;
}

export interface SedoClientOptions extends SedoCredentials {
  /** Defaults to global fetch; pass one to route through a proxy. */
  fetch?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
  limiter?: RateLimiter;
  clock?: Clock;
  /** Retries for a call Sedo says it's too busy for. Defaults to 3. */
  maxRetries?: number;
  timeoutMs?: number;
}

interface CallOptions {
  /** Partner pair only (public functions) or none (reference lists). */
  auth?: 'account' | 'partner' | 'none';
  /** Also retry network and 5xx failures (reads only). */
  idempotent?: boolean;
}

function chunks<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Sedo's "no price" is 0; it takes amounts with a dot and no grouping. */
function priceParam(value: string | null | undefined): string {
  if (value == null || value === '') return '0';
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`Not a price Sedo takes: ${value}`);
  }
  return value;
}

function toListing(wire: WireListing): SedoListing {
  return {
    name: wire.domain,
    categories: wire.category,
    forSale: wire.forsale,
    price: wire.price,
    minPrice: wire.minprice,
    fixedPrice: wire.fixedprice,
    currency: wire.currency,
    language: wire.domainlanguage,
    insertedAt: wire.inserted ?? null,
    earningsTotal: wire.earningscomplete ?? null,
    keywords: wire.keywords ?? null,
  };
}

function entry(input: SedoListingInput): Record<string, FormValue> {
  return {
    domain: assertDomainName(input.name),
    category: input.categories?.length ? input.categories : undefined,
    forsale: input.forSale ? 1 : 0,
    price: priceParam(input.price),
    minprice: priceParam(input.minPrice),
    fixedprice: input.fixedPrice ? 1 : 0,
    currency: currencyToCode(input.currency),
    domainlanguage: input.language ?? undefined,
  };
}

function toWriteResult(r: {
  domain: string;
  status: string;
  message: string;
}): SedoWriteResult {
  const ok = r.status.trim().toLowerCase() === 'ok';
  return {
    name: r.domain,
    ok,
    code: ok ? null : r.status || 'UNKNOWN',
    message: ok ? null : r.message || r.status,
  };
}

export class SedoClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly credentials: SedoCredentials;
  private readonly userAgent: Record<string, string>;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: SedoClientOptions) {
    for (const [key, label] of [
      ['partnerId', 'partner ID'],
      ['signKey', 'sign key'],
      ['username', 'username'],
      ['password', 'password'],
    ] as const) {
      if (!options[key]?.trim()) throw new Error(`Sedo needs a ${label}.`);
    }
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = (options.baseUrl ?? SEDO_BASE_URL).replace(/\/*$/, '/');
    this.credentials = {
      partnerId: options.partnerId.trim(),
      signKey: options.signKey.trim(),
      username: options.username.trim(),
      password: options.password,
    };
    this.userAgent = options.userAgent
      ? { 'user-agent': options.userAgent }
      : userAgentHeaders();
    this.clock = options.clock ?? realClock;
    this.limiter =
      options.limiter ??
      sharedLimiter(
        `sedo:${this.credentials.partnerId}:${this.credentials.username}`,
        () => new RateLimiter(this.clock, REQUESTS_PER_MINUTE),
      );
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // Account

  /** True when the four credentials name a Sedo customer (CheckMember). */
  async checkMember(): Promise<boolean> {
    const res = await this.call('CheckMember', {}, { idempotent: true });
    return flag(text(res.body.member));
  }

  // Listings

  /**
   * One page of the account's listings, by name (or insert date). With
   * `extended`, adds insert date, lifetime earnings and keywords.
   */
  async listListings(
    options: {
      startFrom?: number;
      results?: number;
      orderBy?: 'name' | 'inserted';
      names?: readonly string[];
      extended?: boolean;
    } = {},
  ): Promise<SedoListing[]> {
    const results = options.results ?? LIST_PAGE;
    if (results < 1 || results > LIST_PAGE) {
      throw new Error(`Sedo lists 1–${LIST_PAGE} names a page.`);
    }
    const res = await this.call(
      options.extended ? 'DomainListExtended' : 'DomainList',
      {
        startfrom: options.startFrom ?? 0,
        results,
        orderby: options.orderBy === 'inserted' ? 1 : 0,
        domain: options.names?.map(assertDomainName),
      },
      { idempotent: true },
    );
    return items(res).map((i) => toListing(readListing(i)));
  }

  /**
   * Every listing, a page of 100 at a time. Sedo returns no total, so the
   * walk ends at a short page. Its order isn't by name, but `startfrom` is a
   * plain 0-based offset into a stable order (checked live). UNVERIFIED:
   * that an empty account answers with an empty list rather than fault E15
   * ("There is no data for your request"); both are read as "no listings".
   */
  async allListings(extended = true): Promise<SedoListing[]> {
    const out: SedoListing[] = [];
    for (let startFrom = 0; ; startFrom += LIST_PAGE) {
      let page: SedoListing[];
      try {
        page = await this.listListings({ startFrom, extended });
      } catch (error) {
        if (error instanceof SedoError && error.code === 'E15') return out;
        throw error;
      }
      out.push(...page);
      if (page.length < LIST_PAGE) return out;
    }
  }

  /**
   * The listings for these names, 100 a call; unlisted names are left out.
   *
   * Sedo fails the whole call with E2104 ("does not belong to you") when any
   * one name isn't on the account (checked live, 2026-10-28), so a batch
   * that fails that way is split in halves until the unlisted names are
   * isolated: a few extra calls rather than one per name.
   */
  async getListings(
    names: readonly string[],
    extended = false,
  ): Promise<SedoListing[]> {
    const keys = [...new Set(names.map(assertDomainName))];
    const out: SedoListing[] = [];
    for (const batch of chunks(keys, LIST_PAGE)) {
      out.push(...(await this.listedAmong(batch, extended)));
    }
    return out;
  }

  private async listedAmong(
    names: string[],
    extended: boolean,
  ): Promise<SedoListing[]> {
    try {
      return await this.listListings({
        names,
        results: LIST_PAGE,
        extended,
      });
    } catch (error) {
      const notListed =
        error instanceof SedoError &&
        (error.code === 'E2104' || error.code === 'E15');
      if (!notListed) throw error;
      if (names.length === 1) return [];
      const half = Math.ceil(names.length / 2);
      return [
        ...(await this.listedAmong(names.slice(0, half), extended)),
        ...(await this.listedAmong(names.slice(half), extended)),
      ];
    }
  }

  /**
   * What Sedo shows publicly about any names (DomainStatus): on Sedo, for
   * sale, price, visitors per month. Needs only the partner pair.
   */
  async domainStatus(names: readonly string[]): Promise<SedoDomainStatus[]> {
    const keys = [...new Set(names.map(assertDomainName))];
    const out: SedoDomainStatus[] = [];
    for (const batch of chunks(keys, LIST_PAGE)) {
      const res = await this.call(
        'DomainStatus',
        { domainlist: batch },
        { auth: 'partner', idempotent: true },
      );
      for (const i of items(res)) {
        const currency = text(child(i, 'currency'));
        out.push({
          name: text(child(i, 'domain')).toLowerCase(),
          onSedo: text(child(i, 'domainstatus')).trim() === '1',
          forSale: flag(text(child(i, 'forsale'))),
          price: amount(text(child(i, 'price'))),
          currency: currency ? currencyFromCode(currency) : null,
          visitorsPerMonth: int(text(child(i, 'visitors'))),
        });
      }
    }
    return out;
  }

  // Parking statistics and payments

  /**
   * Daily parking statistics for the last 31 days (period 1), for one name or
   * the whole account. Period 1 with a `domain` gives that name's days
   * (checked live).
   */
  async dailyParkingStats(name?: string): Promise<SedoParkingStats[]> {
    return this.parkingStats({ period: 1, domain: name });
  }

  /** Monthly parking statistics for the last 12 months (period 3). */
  async monthlyParkingStats(name?: string): Promise<SedoParkingStats[]> {
    return this.parkingStats({ period: 3, domain: name });
  }

  /** Per-name totals for the last 31 days (period 4), every parked name. */
  async parkingStatsByDomain(): Promise<SedoParkingStats[]> {
    return this.parkingStats({ period: 4 });
  }

  private async parkingStats(params: {
    period: 1 | 3 | 4;
    domain?: string;
  }): Promise<SedoParkingStats[]> {
    const domain = params.domain ? assertDomainName(params.domain) : undefined;
    let res: ParsedResponse;
    try {
      res = await this.call(
        'DomainParkingFinalStatistics',
        // startfrom and results are only used for periods 0 and 2; the docs
        // say to send 0 otherwise.
        { domain, period: params.period, startfrom: 0, results: 0 },
        { idempotent: true },
      );
    } catch (error) {
      // E15 "no data", E2102 "no statistics for this date": no rows.
      if (
        error instanceof SedoError &&
        (error.code === 'E15' || error.code === 'E2102')
      ) {
        return [];
      }
      throw error;
    }
    return items(res).map((i) => {
      const rowName = text(child(i, 'domain')).toLowerCase();
      return {
        name: rowName || domain || null,
        date: text(child(i, 'date')).slice(0, 10),
        visitors: int(text(child(i, 'visitors'))),
        clicks: int(text(child(i, 'clicks'))),
        earnings: amount(text(child(i, 'earnings'))),
        // The docs' example says "Estimated"; anything else is read as final.
        final: !/estimat/i.test(text(child(i, 'payout_status'))),
      };
    });
  }

  /**
   * Parking payments for the month containing `month` (YYYY-MM-DD). A month
   * without payments is fault E2102 ("Statistics for this date do not
   * exist"), read as none (checked live). UNVERIFIED: the docs' table calls
   * the amount `earnings`, their example `payments`; either is read.
   */
  async parkingPayments(month: string): Promise<SedoPayment[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) {
      throw new Error(`Payments take a YYYY-MM-DD date, not ${month}.`);
    }
    let res: ParsedResponse;
    try {
      res = await this.call(
        'DomainParkingPayments',
        { date: month },
        { idempotent: true },
      );
    } catch (error) {
      if (
        error instanceof SedoError &&
        (error.code === 'E15' || error.code === 'E2102')
      ) {
        return [];
      }
      throw error;
    }
    return items(res).map((i) => ({
      month: text(child(i, 'date')).slice(0, 10),
      earnings: amount(
        text(child(i, 'payments')) || text(child(i, 'earnings')),
      ),
    }));
  }

  // Reference lists

  /** Sedo's listing categories, flattened, in `language` (en, de, es, fr). */
  async categories(language = 'en'): Promise<SedoCategory[]> {
    const res = await this.call(
      'DomainCategories',
      { language },
      { auth: 'none', idempotent: true },
    );
    const out: SedoCategory[] = [];
    const walk = (nodes: XmlNode[], parentId: number | null, depth: number) => {
      const next = depth === 0 ? 'subcategory1' : 'subcategory2';
      for (const node of nodes) {
        if (typeof node === 'string') continue;
        const id = int(String(node['@_id'] ?? ''));
        if (id == null) continue;
        out.push({ id, name: String(node['@_name'] ?? ''), parentId });
        if (depth < 2) walk(list(node[next]), id, depth + 1);
      }
    };
    walk(list(res.body.maincategory), null, 0);
    return out;
  }

  /** The name languages Sedo accepts, labelled in `language`. */
  async languages(language = 'en'): Promise<SedoLanguage[]> {
    const res = await this.call(
      'DomainLanguages',
      { lan: language },
      { auth: 'none', idempotent: true },
    );
    return list(res.body.language).flatMap((node) =>
      typeof node === 'string'
        ? []
        : [{ code: String(node['@_iso'] ?? ''), name: text(node) }],
    );
  }

  // Writes

  /**
   * List up to 50 names (DomainInsert). Sedo checks each before adding it,
   * so an `ok` result means accepted, not live; failed checks are emailed to
   * the account, not returned here.
   */
  async insertListings(
    inputs: readonly SedoListingInput[],
  ): Promise<SedoWriteResult[]> {
    return this.batchWrite('DomainInsert', inputs, (input) => {
      if (!input.language) {
        throw new Error('Sedo needs the name’s language to list it.');
      }
      return entry(input);
    });
  }

  /**
   * Replace up to 50 listings (DomainEdit). Every price field is required;
   * use `updateListings` to change some fields and keep the rest.
   */
  async editListings(
    inputs: readonly SedoListingInput[],
  ): Promise<SedoWriteResult[]> {
    return this.batchWrite('DomainEdit', inputs, entry);
  }

  /**
   * Change some fields of listed names, keeping the rest: reads the current
   * listings, merges, and edits in batches of 50. A name that isn't listed
   * fails with NOT_LISTED and isn't sent.
   */
  async updateListings(
    changes: readonly SedoListingChange[],
  ): Promise<SedoWriteResult[]> {
    const keys = changes.map((c) => assertDomainName(c.name));
    const current = new Map(
      (await this.getListings(keys)).map((l) => [l.name, l]),
    );
    const results = new Map<string, SedoWriteResult>();
    const inputs: SedoListingInput[] = [];
    changes.forEach((change, i) => {
      const name = keys[i];
      const now = current.get(name);
      if (!now) {
        results.set(name, {
          name,
          ok: false,
          code: 'NOT_LISTED',
          message: 'Not listed on this Sedo account.',
        });
        return;
      }
      inputs.push({
        name,
        categories: change.categories ?? now.categories,
        forSale: change.forSale ?? now.forSale,
        price: change.price !== undefined ? change.price : now.price,
        minPrice:
          change.minPrice !== undefined ? change.minPrice : now.minPrice,
        fixedPrice: change.fixedPrice ?? now.fixedPrice,
        currency: change.currency ?? now.currency,
        language: change.language ?? now.language,
      });
    });
    for (const r of await this.editListings(inputs)) results.set(r.name, r);
    return keys.map(
      (name) =>
        results.get(name) ?? {
          name,
          ok: false,
          code: 'NO_RESULT',
          message: 'Sedo returned no result for this name.',
        },
    );
  }

  /** Delist names, 50 a call (DomainDelete). */
  async deleteListings(names: readonly string[]): Promise<SedoWriteResult[]> {
    const keys = [...new Set(names.map(assertDomainName))];
    const out: SedoWriteResult[] = [];
    for (const batch of chunks(keys, WRITE_BATCH)) {
      const res = await this.call('DomainDelete', { domains: batch });
      out.push(...items(res).map((i) => toWriteResult(readBatchResult(i))));
    }
    return out;
  }

  private async batchWrite(
    fn: 'DomainInsert' | 'DomainEdit',
    inputs: readonly SedoListingInput[],
    toEntry: (input: SedoListingInput) => Record<string, FormValue>,
  ): Promise<SedoWriteResult[]> {
    const out: SedoWriteResult[] = [];
    for (const batch of chunks(inputs, WRITE_BATCH)) {
      // An entry Sedo would refuse fails here, without being sent.
      const entries: Record<string, FormValue>[] = [];
      for (const input of batch) {
        try {
          entries.push(toEntry(input));
        } catch (error) {
          out.push({
            name: input.name,
            ok: false,
            code: 'INVALID',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!entries.length) continue;
      const res = await this.call(fn, { domainentry: entries });
      out.push(...items(res).map((i) => toWriteResult(readBatchResult(i))));
    }
    return out;
  }

  // Transport

  private async call(
    fn: string,
    params: Record<string, FormValue>,
    options: CallOptions = {},
  ): Promise<ParsedResponse> {
    const auth = options.auth ?? 'account';
    const { partnerId, signKey, username, password } = this.credentials;
    const body = encodeForm({
      ...(auth !== 'none' ? { partnerid: partnerId, signkey: signKey } : {}),
      ...(auth === 'account' ? { username, password } : {}),
      output_method: 'xml',
      ...params,
    });
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(fn, body);
      } catch (error) {
        const retry =
          error instanceof SedoError &&
          error.retryable &&
          // A busy fault means Sedo didn't do it, so any call may go again;
          // a lost response might have been applied, so only reads do.
          (/^E\d+$/.test(error.code) || options.idempotent) &&
          attempt < this.maxRetries;
        if (!retry) throw error;
        await this.clock.sleep(2000 * 2 ** attempt);
      }
    }
  }

  private async send(fn: string, body: string): Promise<ParsedResponse> {
    await this.limiter.take();
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + fn, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/xml, text/xml',
          ...this.userAgent,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new SedoError(
        timedOut ? 'TIMEOUT' : 'NETWORK',
        timedOut ? 'Sedo did not respond in time.' : 'Could not reach Sedo.',
        0,
      );
    }
    const raw = await response.text();
    // A fault document wins over the status. Sedo sends faults with HTTP 200
    // (checked live), but a proxy or outage may not.
    let res: ParsedResponse | null = null;
    try {
      res = raw.trim() ? parseXml(raw) : null;
    } catch {
      res = null;
    }
    if (res?.root === 'SEDOFAULT') {
      const code = text(res.body.faultcode) || 'FAULT';
      const message = text(res.body.faultstring) || 'Sedo refused the request.';
      const hint = faultHint(code);
      throw new SedoError(
        code,
        hint ? `${message} ${hint}` : message,
        response.status,
      );
    }
    if (!response.ok) {
      throw new SedoError(
        `HTTP_${response.status}`,
        `Sedo answered HTTP ${response.status}.`,
        response.status,
      );
    }
    if (!res) {
      throw new SedoError(
        'BAD_RESPONSE',
        'Sedo sent a response that is not XML.',
        response.status,
      );
    }
    return res;
  }
}
