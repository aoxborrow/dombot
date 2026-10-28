import type { RegistrarName } from '@aoxborrow/registrar-client';
import { toAscii } from '../../../shared/domain-name';
import type {
  MarketListing,
  MarketListingChange,
  MarketWriteResult,
} from '../../../shared/markets';
import type {
  AccountSettingsInput,
  RelistMode,
} from '../../markets/afternic/types';
import { broadcastPortfolioChanged } from '../../events';
import { applyDomainOp } from '../domain-ops';
import { getListPrices } from '../list-prices';
import { findRegistrarsForDomain, resolveDomainAccount } from '../registrars';
import { activeMarketAccounts, marketAccount, marketAdapter } from './accounts';
import type { AnyMarketAdapter } from './registry';
import {
  dropMarketListings,
  marketListing,
  marketListings,
  marketSale,
  putMarketListings,
} from './sync';

// Writes to market accounts (docs/markets.md): list, reprice, delist and
// relist names, push DomBot's asking prices, and the sale actions. Each runs
// in the market's own batch size and stores what the market saved, so the
// Domains table shows the result without waiting for a sync.
//
// Afternic takes 500 names a call, so a 10,000-name push is 20 calls and runs
// here directly. A market that writes one name per call (Atom) runs large
// writes through DomBot's bulk runner (bulk-jobs.ts, "Market jobs"), which
// calls these one name at a time with `silent` and `skipUnchanged`.

export interface WriteOptions {
  /** Don't tell open windows; the bulk runner tells them once at the end. */
  silent?: boolean;
  /** Skip a name whose synced listing already has every value asked for. */
  skipUnchanged?: boolean;
}

function failed(
  name: string,
  code: string,
  message: string,
): MarketWriteResult {
  return {
    name,
    ok: false,
    pending: false,
    saved: null,
    adjusted: [],
    error: { code, message },
  };
}

function enabledAdapter(accountId: string): AnyMarketAdapter {
  const account = marketAccount(accountId);
  if (!account.enabled) {
    throw new Error(`The ${account.label} account is disabled.`);
  }
  return marketAdapter(accountId);
}

/** Runs `write` over `items` in the market's batch size, collecting results. */
async function inBatches<T>(
  adapter: AnyMarketAdapter,
  items: readonly T[],
  write: (batch: T[]) => Promise<MarketWriteResult[]>,
): Promise<MarketWriteResult[]> {
  const size = Math.max(1, adapter.capabilities.writeBatch);
  const out: MarketWriteResult[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await write(items.slice(i, i + size))));
  }
  return out;
}

/**
 * List or update names on a market account. Each change sets only the fields
 * it gives; a name that isn't listed yet is listed.
 */
export async function writeMarketListings(
  accountId: string,
  changes: readonly MarketListingChange[],
  options: WriteOptions = {},
): Promise<MarketWriteResult[]> {
  const adapter = enabledAdapter(accountId);
  const skipped = new Map<string, MarketWriteResult>();
  const toSend = options.skipUnchanged
    ? changes.filter((c) => {
        const cached = marketListing(accountId, toAscii(c.name));
        if (!cached || !matches(c, cached)) return true;
        skipped.set(cached.name, {
          name: cached.name,
          ok: true,
          pending: false,
          saved: cached,
          adjusted: [],
          error: null,
          unchanged: true,
        });
        return false;
      })
    : changes;
  const written = await inBatches(adapter, toSend, (batch) =>
    adapter.writeListings(batch),
  );
  putMarketListings(
    accountId,
    written.flatMap((r) => (r.ok && r.saved ? [r.saved] : [])),
  );
  if (!options.silent) broadcastPortfolioChanged();
  if (!skipped.size) return written;
  const byName = new Map(written.map((r) => [r.name, r]));
  return changes.map((c) => {
    const name = toAscii(c.name);
    return (
      skipped.get(name) ??
      byName.get(name) ??
      failed(name, 'NO_RESULT', 'The market returned no result for this name.')
    );
  });
}

/**
 * Whether a synced listing already has every value a change asks for. Only
 * the shared fields and the market's own settings that a listing carries
 * are compared; anything else counts as a change.
 */
export function matches(
  change: MarketListingChange,
  listing: MarketListing,
): boolean {
  const same = (asked: unknown, has: unknown) =>
    asked === undefined || (asked ?? null) === (has ?? null);
  const amount = (v: string | null | undefined) =>
    v == null ? v : String(Number(v));
  if (
    !same(amount(change.price), amount(listing.price)) ||
    !same(amount(change.minOffer), amount(listing.minOffer)) ||
    !same(amount(change.floor), amount(listing.floor)) ||
    !same(change.buyNow, listing.buyNow) ||
    !same(change.forSale, listing.forSale) ||
    !same(change.currency, listing.currency) ||
    !same(change.displayName, listing.displayName) ||
    change.leaseToOwn !== undefined
  ) {
    return false;
  }
  const extra = change.extra;
  if (!extra) return true;
  if (extra.market !== listing.extra.market) return false;
  if (extra.market === 'atom' && listing.extra.market === 'atom') {
    return (
      same(extra.tier, listing.tier) &&
      same(extra.category, listing.extra.category) &&
      same(extra.description?.trim(), listing.extra.description)
    );
  }
  // Other markets' settings aren't all on the listing: always send.
  return false;
}

/**
 * Make a market's prices match DomBot's asking prices for these names:
 * BIN price, minimum offer and floor. A name without an asking price, or
 * priced in a currency the market doesn't take, fails without being sent.
 * A minimum offer DomBot doesn't have leaves the market's alone, since
 * Afternic always keeps one.
 */
export async function pushAskingPrices(
  accountId: string,
  names: readonly string[],
  options: WriteOptions = {},
): Promise<MarketWriteResult[]> {
  const adapter = enabledAdapter(accountId);
  const prices = getListPrices();
  const currencies = adapter.capabilities.currencies;
  const changes: MarketListingChange[] = [];
  const skipped = new Map<string, MarketWriteResult>();
  for (const raw of names) {
    const name = toAscii(raw);
    const price = prices[name];
    if (!price || (!price.amount && !price.minOffer)) {
      skipped.set(
        name,
        failed(
          name,
          'NO_PRICE',
          'No asking price in DomBot. Set a BIN price or minimum offer first.',
        ),
      );
    } else if (!currencies.includes(price.currency as never)) {
      skipped.set(
        name,
        failed(
          name,
          'CURRENCY',
          `${adapter.market} prices are in ${currencies.join(', ')}; this one is in ${price.currency}.`,
        ),
      );
    } else {
      changes.push({
        name,
        price: price.amount,
        ...(price.minOffer ? { minOffer: price.minOffer } : {}),
        floor: adapter.capabilities.floor ? (price.floor ?? null) : undefined,
        currency: price.currency as MarketListingChange['currency'],
      });
    }
  }
  // Listings stuck before the push get their checks re-run after it.
  const stuck = stuckListings(
    accountId,
    changes.map((c) => c.name),
  );
  const written = changes.length
    ? await writeMarketListings(accountId, changes, options)
    : [];
  if (stuck.size && adapter.capabilities.relist && adapter.relist) {
    await relistAfterPush(accountId, adapter, written, stuck);
  }
  const byName = new Map(written.map((r) => [r.name, r]));
  return names.map((raw) => {
    const name = toAscii(raw);
    return (
      skipped.get(name) ??
      byName.get(name) ??
      failed(name, 'NO_RESULT', 'The market returned no result for this name.')
    );
  });
}

/** Delist names. A name that wasn't listed counts as delisted. */
export async function deleteMarketListings(
  accountId: string,
  names: readonly string[],
  options: Pick<WriteOptions, 'silent'> = {},
): Promise<MarketWriteResult[]> {
  const adapter = enabledAdapter(accountId);
  const results = await inBatches(adapter, names, (batch) =>
    adapter.deleteListings(batch),
  );
  dropMarketListings(
    accountId,
    results.filter((r) => r.ok).map((r) => r.name),
  );
  if (!options.silent) broadcastPortfolioChanged();
  return results;
}

const STUCK: ReadonlySet<string> = new Set(['inactive', 'rejected', 'pending']);

/** Names listed on the account whose listing is stuck, with that status. */
function stuckListings(
  accountId: string,
  names: readonly string[],
): Map<string, string> {
  const wanted = new Set(names);
  return new Map(
    marketListings()
      .filter(
        (l) =>
          l.accountId === accountId &&
          wanted.has(l.name) &&
          STUCK.has(l.status),
      )
      .map((l) => [l.name, l.status]),
  );
}

/**
 * After pushing prices, ask the market to re-run its checks on the names
 * that were stuck: reactivate the inactive ones, resync the rest. Each
 * result says how that went; a failed relist doesn't undo the prices.
 */
async function relistAfterPush(
  accountId: string,
  adapter: AnyMarketAdapter,
  written: MarketWriteResult[],
  stuck: Map<string, string>,
): Promise<void> {
  const relist = adapter.relist!.bind(adapter);
  const byMode = new Map<RelistMode, string[]>();
  for (const r of written) {
    const status = r.ok ? stuck.get(r.name) : undefined;
    if (!status) continue;
    const mode: RelistMode = status === 'inactive' ? 'REACTIVATE' : 'RESYNC';
    byMode.set(mode, [...(byMode.get(mode) ?? []), r.name]);
  }
  const outcome = new Map<string, MarketWriteResult['relisted']>();
  for (const [mode, names] of byMode) {
    try {
      for (const r of await inBatches(adapter, names, (b) => relist(b, mode))) {
        outcome.set(r.name, {
          ok: r.ok,
          message: r.ok ? null : (r.error?.message ?? 'The market refused it.'),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const name of names) outcome.set(name, { ok: false, message });
    }
  }
  for (const r of written) {
    const o = outcome.get(r.name);
    if (o) r.relisted = o;
  }
  // Statuses move after a relist: read those names back.
  const relisted = [...outcome].filter(([, o]) => o?.ok).map(([n]) => n);
  if (relisted.length) {
    const fresh = await adapter.getListings(relisted).catch(() => []);
    putMarketListings(accountId, fresh);
    for (const l of fresh) {
      const r = written.find((w) => w.name === l.name);
      if (r) {
        r.saved = l;
        r.pending = l.status === 'pending';
      }
    }
  }
}

/** Ask the market to re-run its listing checks (Afternic's relist). */
export async function relistMarketListings(
  accountId: string,
  names: readonly string[],
  mode?: RelistMode,
): Promise<MarketWriteResult[]> {
  const adapter = enabledAdapter(accountId);
  if (!adapter.capabilities.relist || !adapter.relist) {
    throw new Error(`Relisting is not supported for ${adapter.market}.`);
  }
  const relist = adapter.relist.bind(adapter);
  const results = await inBatches(adapter, names, (batch) =>
    relist(batch, mode),
  );
  // Statuses move after a relist: read the names back.
  const ok = results.filter((r) => r.ok).map((r) => r.name);
  if (ok.length) putMarketListings(accountId, await adapter.getListings(ok));
  broadcastPortfolioChanged();
  return results;
}

/** Change an account's defaults for new listings. */
export async function setMarketListingDefaults(
  accountId: string,
  settings: AccountSettingsInput,
): Promise<void> {
  const adapter = enabledAdapter(accountId);
  if (!adapter.capabilities.accountSettings || !adapter.setListingDefaults) {
    throw new Error(
      `Listing defaults are not supported for ${adapter.market}.`,
    );
  }
  await adapter.setListingDefaults(settings);
}

/** The registrar account that holds `name` now, per the cached portfolio. */
function registrarHolding(name: string): RegistrarName {
  const found = findRegistrarsForDomain(name);
  if (found.length === 1) return found[0];
  throw new Error(
    found.length === 0
      ? `None of your registrar accounts holds ${name}, so DomBot can't get its auth code. Enter it yourself.`
      : `${name} shows in more than one registrar account; sync, or enter the auth code yourself.`,
  );
}

/**
 * Give a sale its transfer auth code. Without one, DomBot asks the registrar
 * account that holds the name for it. The code is sent to the market and
 * never stored.
 */
export async function setSaleAuthCode(
  accountId: string,
  saleId: string,
  authCode?: string,
): Promise<{ name: string; fetched: boolean }> {
  const adapter = enabledAdapter(accountId);
  if (!adapter.capabilities.saleAuthCode || !adapter.setSaleAuthCode) {
    throw new Error(
      `Sending an auth code is not supported for ${adapter.market}.`,
    );
  }
  const sale = marketSale(accountId, saleId);
  if (!sale) throw new Error('No such sale. Run market sync first.');
  let code = authCode?.trim();
  const fetched = !code;
  if (!code) {
    const registrar = registrarHolding(sale.name);
    const account = resolveDomainAccount(registrar, sale.name);
    const result = await applyDomainOp(
      { registrar, domainName: sale.name, accountId: account.id },
      { kind: 'authCode' },
    );
    code = result.data?.authCode?.trim();
    if (result.status !== 'ok' || !code) {
      throw new Error(
        `Couldn't get the auth code for ${sale.name}: ${result.message}`,
      );
    }
  }
  await adapter.setSaleAuthCode(saleId, code);
  return { name: sale.name, fetched };
}

/** Message the people handling a sale at the market. Reaches a person. */
export async function sendSaleMessage(
  accountId: string,
  saleId: string,
  message: string,
): Promise<void> {
  const adapter = enabledAdapter(accountId);
  if (!adapter.capabilities.saleMessages || !adapter.sendSaleMessage) {
    throw new Error(`Sale messages are not supported for ${adapter.market}.`);
  }
  if (!marketSale(accountId, saleId)) {
    throw new Error('No such sale. Run market sync first.');
  }
  await adapter.sendSaleMessage(saleId, message);
}

/** The account a name is listed in, for single-name writes without one. */
export function listingAccount(name: string, accountId?: string): string {
  if (accountId) return marketAccount(accountId).id;
  const key = toAscii(name);
  const ids = [
    ...new Set(
      marketListings()
        .filter((l) => l.name === key)
        .map((l) => l.accountId),
    ),
  ];
  if (ids.length === 1) return ids[0];
  // Not listed anywhere yet: the one enabled account, if there's just one.
  const active = activeMarketAccounts();
  if (ids.length === 0 && active.length === 1) return active[0].id;
  throw new Error(
    ids.length === 0
      ? `${key} isn't listed on a connected market account; pass accountId to choose one.`
      : `${key} is listed in more than one market account; pass accountId.`,
  );
}

/**
 * Put a temporary discount on a listing (Atom: whole dollars off until
 * Monday); null clears it. Stores what the market saved.
 */
export async function setMarketDiscount(
  accountId: string,
  name: string,
  amount: string | null,
): Promise<MarketWriteResult> {
  const adapter = enabledAdapter(accountId);
  if (!adapter.capabilities.discount || !adapter.setDiscount) {
    throw new Error(`Discounts are not supported for ${adapter.market}.`);
  }
  const result = await adapter.setDiscount(toAscii(name), amount);
  if (result.ok && result.saved) putMarketListings(accountId, [result.saved]);
  broadcastPortfolioChanged();
  return result;
}

/** Ask the market to check a name's DNS now (Atom's verify). */
export async function verifyMarketDns(
  accountId: string,
  name: string,
): Promise<MarketWriteResult> {
  const adapter = enabledAdapter(accountId);
  if (!adapter.capabilities.verifyDns || !adapter.verifyDns) {
    throw new Error(`DNS verification is not supported for ${adapter.market}.`);
  }
  const result = await adapter.verifyDns(toAscii(name));
  if (result.ok && result.saved) putMarketListings(accountId, [result.saved]);
  broadcastPortfolioChanged();
  return result;
}
