import type {
  MarketAccount,
  MarketAccountView,
  MarketId,
  MarketSyncState,
} from '../../../shared/markets';
import { parseVerificationId } from '../../../shared/market-verification';
import {
  MARKET_ACCOUNTS_NAMESPACE,
  MARKET_CREDENTIALS_NAMESPACE,
  MARKET_LAST_SYNC_NAMESPACE,
} from '../../storage/names';
import { Namespace } from '../../storage/namespace';
import { accountById } from '../accounts';
import { getStoredCredentials } from '../credentials';
import { accountProxyRoute } from '../proxies';
import { sendThroughProxy } from '../proxy-transport';
import { serialByKey } from '../serial-by-key';
import {
  buildAdapter,
  isMarketId,
  marketInfo,
  type AdapterContext,
  type AnyMarketAdapter,
  type Credentials,
} from './registry';

// Market accounts (Settings → Markets, docs/markets.md): one record per
// connected account, its credentials in their own namespace, which hosts
// seal like registrar credentials, and what its last sync found. A market
// that runs on a registrar's API (Dynadot) keeps no credentials: its account
// names a registrar account and calls with that account's key and proxy.

const accounts = new Namespace<MarketAccount>(MARKET_ACCOUNTS_NAMESPACE);
const credentials = new Namespace<Credentials>(MARKET_CREDENTIALS_NAMESPACE);
const lastSync = new Namespace<MarketSyncState>(MARKET_LAST_SYNC_NAMESPACE);
const saveInOrder = serialByKey();

/** Hooks other market services register to drop an account's data. */
const onRemove: ((accountId: string) => void)[] = [];
export function onMarketAccountRemoved(fn: (accountId: string) => void) {
  onRemove.push(fn);
}

/** A market's name for sorting; one DomBot no longer supports by its id. */
const marketName = (market: MarketId) =>
  isMarketId(market) ? marketInfo(market).name : market;

/**
 * Every account, in the order DomBot shows markets everywhere: by market
 * name, then account name, then when it was added.
 */
export function listMarketAccounts(): MarketAccount[] {
  return Object.values(accounts.all()).sort(
    (a, b) =>
      marketName(a.market).localeCompare(marketName(b.market)) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
      a.createdAt - b.createdAt,
  );
}

/** The credentials an account calls with: its own, or its registrar account's. */
function credentialsOf(account: MarketAccount): Credentials {
  return account.registrarAccountId
    ? getStoredCredentials(account.registrarAccountId)
    : (credentials.get(account.id) ?? {});
}

function hasCredentials(account: MarketAccount): boolean {
  return Object.keys(credentialsOf(account)).length > 0;
}

/**
 * How a registrar-backed account's calls go out: through its registrar
 * account's proxy when that has one, never direct from an address the
 * registrar hasn't whitelisted.
 */
function contextOf(account: MarketAccount): AdapterContext {
  const id = account.registrarAccountId;
  if (!id) return {};
  let registrar;
  try {
    registrar = accountById(id);
  } catch {
    throw new Error(
      `The ${marketInfo(account.market).name} registrar account this uses is gone. Remove this market account, or add that registrar account again.`,
    );
  }
  const route = accountProxyRoute(registrar);
  return {
    registrarAccountId: id,
    ...(route && {
      fetch: (input, init) =>
        sendThroughProxy(
          route,
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          init ?? {},
        ),
    }),
  };
}

export function marketAccountViews(): MarketAccountView[] {
  return listMarketAccounts().map((a) => ({
    ...a,
    configured: hasCredentials(a),
    sync: lastSync.get(a.id) ?? null,
  }));
}

export function marketAccount(id: string): MarketAccount {
  const account = accounts.get(id);
  if (!account)
    throw new Error('No such market account. Check Settings → Markets.');
  return account;
}

/** Enabled accounts with credentials: the ones sync and MCP use. */
export function activeMarketAccounts(): MarketAccount[] {
  return listMarketAccounts().filter((a) => a.enabled && hasCredentials(a));
}

/** An account's own credentials, for its card; none for a registrar-backed one. */
export function getMarketCredentials(id: string): Credentials {
  const account = marketAccount(id);
  return account.registrarAccountId ? {} : (credentials.get(id) ?? {});
}

/** Every value saved for every market account, for scrubbing diagnostics
 *  (see stored-secrets.ts). Empty until storage is hydrated. */
export function marketCredentialValues(): string[] {
  if (!credentials.loaded) return [];
  return Object.values(credentials.all()).flatMap((creds) =>
    Object.values(creds).filter((v): v is string => typeof v === 'string'),
  );
}

export function getMarketSyncState(id: string): MarketSyncState | null {
  return lastSync.get(id) ?? null;
}

export function setMarketSyncState(id: string, state: MarketSyncState): void {
  void lastSync.set(id, state);
}

function cleanCredentials(market: MarketId, raw: Credentials): Credentials {
  const out: Credentials = {};
  for (const field of marketInfo(market).configFields) {
    const value = raw[field.name]?.trim();
    if (value) out[field.name] = value;
  }
  return out;
}

function cleanLabel(label: string | undefined, market: MarketId): string {
  const value = label?.trim() || marketInfo(market).name;
  if (value.length > 100) {
    throw new Error('Account name must contain at most 100 characters.');
  }
  return value;
}

/** The adapter for an account, from its stored credentials. */
export function marketAdapter(id: string): AnyMarketAdapter {
  const account = marketAccount(id);
  return buildAdapter(
    account.market,
    id,
    credentialsOf(account),
    contextOf(account),
  );
}

/**
 * Connect a market account: test the credentials first, so a typo never
 * leaves an account behind, then save. Sync is the caller's next step. A
 * market on a registrar's API takes the registrar account to use instead.
 */
export async function connectMarketAccount(
  market: MarketId,
  raw: Credentials,
  label?: string,
  /** A fixed id, for seeded data and tests. */
  id: string = crypto.randomUUID(),
  registrarAccountId?: string | null,
): Promise<MarketAccountView> {
  if (!isMarketId(market)) throw new Error('Unknown market.');
  const info = marketInfo(market);
  const name = cleanLabel(label, market);
  const account: MarketAccount = {
    id,
    market,
    label: name,
    enabled: true,
    createdAt: Date.now(),
  };
  let test;
  if (info.registrar) {
    if (!registrarAccountId) {
      throw new Error(
        `Choose the ${info.name} registrar account whose API key to use.`,
      );
    }
    if (accountById(registrarAccountId).registrar !== info.registrar) {
      throw new Error(`That isn’t a ${info.name} registrar account.`);
    }
    // Two would read the same listings twice.
    if (
      listMarketAccounts().some(
        (a) => a.registrarAccountId === registrarAccountId,
      )
    ) {
      throw new Error(
        `A ${info.name} market account already uses that registrar account.`,
      );
    }
    account.registrarAccountId = registrarAccountId;
    test = await buildAdapter(
      market,
      id,
      credentialsOf(account),
      contextOf(account),
    ).test();
    await accounts.set(id, account);
  } else {
    const clean = cleanCredentials(market, raw);
    test = await buildAdapter(market, id, clean).test();
    // Secrets first: a failed write never leaves an account without them.
    await saveInOrder(id, () => credentials.set(id, clean));
    await accounts.set(id, account);
  }
  setMarketSyncState(id, {
    at: Date.now(),
    lastError: null,
    listings: test.listings ?? 0,
    sales: 0,
    incomplete: false,
    notes: test.notes,
    status: test.status ?? [],
  });
  return marketAccountViews().find((a) => a.id === id)!;
}

/** Replace an account's credentials after testing them. */
export async function saveMarketCredentials(
  id: string,
  raw: Credentials,
): Promise<void> {
  const account = marketAccount(id);
  if (account.registrarAccountId) {
    throw new Error(
      'This account uses its registrar account’s API key. Change the key in Settings → Registrars.',
    );
  }
  const clean = cleanCredentials(account.market, raw);
  await buildAdapter(account.market, id, clean).test();
  await saveInOrder(id, () => credentials.set(id, clean));
}

export async function renameMarketAccount(
  id: string,
  label: string,
): Promise<void> {
  const account = marketAccount(id);
  await accounts.set(id, {
    ...account,
    label: cleanLabel(label, account.market),
  });
}

/**
 * Save an account's Ownership Verification ID, read out of the value pasted
 * (blank clears it). Throws, saying what to copy, when the value isn't the
 * market's.
 */
export async function setMarketVerification(
  id: string,
  pasted: string,
): Promise<void> {
  const account = marketAccount(id);
  const verificationId = parseVerificationId(
    account.market,
    pasted,
    marketInfo(account.market).name,
  );
  await accounts.set(id, {
    ...account,
    verificationId,
  });
}

export async function setMarketAccountEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  const account = marketAccount(id);
  if (account.enabled !== enabled) {
    await accounts.set(id, { ...account, enabled });
  }
}

/**
 * Remove the market accounts that use a registrar account's key, when that
 * registrar account is removed.
 */
export async function removeMarketAccountsOf(
  registrarAccountId: string,
): Promise<void> {
  for (const account of listMarketAccounts()) {
    if (account.registrarAccountId === registrarAccountId) {
      await removeMarketAccount(account.id);
    }
  }
}

/**
 * Remove an account, its credentials and its synced listings. Its sales and
 * the `sold` events they wrote stay: they're history, not the account's.
 */
export async function removeMarketAccount(id: string): Promise<void> {
  marketAccount(id);
  await saveInOrder(id, () => credentials.delete(id));
  await accounts.delete(id);
  await lastSync.delete(id);
  for (const fn of onRemove) fn(id);
}
