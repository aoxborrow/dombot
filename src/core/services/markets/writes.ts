import type { RegistrarName } from '@aoxborrow/registrar-client';
import { toAscii } from '../../../shared/domain-name';
import type {
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
// here directly. A market that writes one name per call (Atom) will need
// DomBot's bulk runner instead; that comes with it.

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
): Promise<MarketWriteResult[]> {
  const adapter = enabledAdapter(accountId);
  const results = await inBatches(adapter, changes, (batch) =>
    adapter.writeListings(batch),
  );
  putMarketListings(
    accountId,
    results.flatMap((r) => (r.ok && r.saved ? [r.saved] : [])),
  );
  broadcastPortfolioChanged();
  return results;
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
  const written = changes.length
    ? await writeMarketListings(accountId, changes)
    : [];
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
): Promise<MarketWriteResult[]> {
  const adapter = enabledAdapter(accountId);
  const results = await inBatches(adapter, names, (batch) =>
    adapter.deleteListings(batch),
  );
  dropMarketListings(
    accountId,
    results.filter((r) => r.ok).map((r) => r.name),
  );
  broadcastPortfolioChanged();
  return results;
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
