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
import { accountById, isSavedAccount, listAccounts } from '../accounts';
import { getStoredCredentials } from '../credentials';
import { accountProxyRoute, setMarketProxyUsers } from '../proxies';
import { pinnedProxyFetch } from '../proxy-transport';
import { DEFAULT_PROXY_ID } from '../../../shared/proxy';
import { serialByKey } from '../serial-by-key';
import {
  buildAdapter,
  isMarketId,
  marketApiOrigin,
  marketInfo,
  type AdapterContext,
  type AnyMarketAdapter,
  type Credentials,
} from './registry';

// Market accounts (Settings → Markets, docs/markets.md): one record per
// connected account, its credentials in their own namespace, which hosts
// seal like registrar credentials, and what its last sync found. On a market
// that runs on a registrar's API (Dynadot, Spaceship) an account either names
// a registrar account and calls with that account's key and proxy, keeping no
// credentials, or has a key of its own like any other market's. Any account
// with its own key chooses its own proxy.

const accounts = new Namespace<MarketAccount>(MARKET_ACCOUNTS_NAMESPACE);
const credentials = new Namespace<Credentials>(MARKET_CREDENTIALS_NAMESPACE);
const lastSync = new Namespace<MarketSyncState>(MARKET_LAST_SYNC_NAMESPACE);
const saveInOrder = serialByKey();

// The fixed IP proxy page lists these, and removing the proxy turns it off
// for them (they go direct, as registrar accounts do).
setMarketProxyUsers({
  list: (proxyId) =>
    listMarketAccounts()
      .filter((a) => !a.registrarAccountId && a.proxyId === proxyId)
      .map((a) => ({ accountId: a.id, market: a.market, label: a.label })),
  clear: async (id) => {
    await accounts.set(id, { ...marketAccount(id), proxyId: null });
  },
});

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
 * The saved registrar account on the same key as this account's own. Its
 * registrar calls spend the same budget (docs/dynadot-marketplace-api.md,
 * "Credentials"), so the two have to share a limiter.
 */
function registrarOnSameKey(market: MarketId, own: Credentials): string | null {
  const registrar = marketInfo(market).registrar;
  if (!registrar || !own.apiKey) return null;
  return (
    listAccounts().find(
      (a) =>
        a.registrar === registrar &&
        isSavedAccount(a.id) &&
        getStoredCredentials(a.id).apiKey === own.apiKey,
    )?.id ?? null
  );
}

/**
 * How an account's calls go out: through its proxy when it uses one, its
 * registrar account's when it's linked to one, and never direct from an
 * address the market hasn't whitelisted.
 */
function contextOf(
  account: MarketAccount,
  own: Credentials = credentialsOf(account),
): AdapterContext {
  const id = account.registrarAccountId;
  let via: { proxyId?: string | null } = account;
  if (id) {
    try {
      via = accountById(id);
    } catch {
      throw new Error(
        `The ${marketInfo(account.market).name} registrar account this uses is gone. Remove this market account, add that registrar account again, or use a separate API key.`,
      );
    }
  }
  const route = accountProxyRoute(via);
  const limiterKey = id ?? registrarOnSameKey(account.market, own);
  return {
    ...(id && { registrarAccountId: id }),
    ...(limiterKey && { limiterKey }),
    ...(route && {
      fetch: pinnedProxyFetch(
        route,
        () => marketApiOrigin(account.market),
        marketInfo(account.market).name,
      ),
    }),
  };
}

export function marketAccountViews(): MarketAccountView[] {
  return listMarketAccounts().map((a) => ({
    ...a,
    configured: hasCredentials(a),
    keyRegistrarAccountId:
      a.registrarAccountId ?? registrarOnSameKey(a.market, credentialsOf(a)),
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

/** A registrar account this market account may use: the right kind, and free. */
function assertLinkable(
  account: MarketAccount,
  registrarAccountId: string,
): void {
  const info = marketInfo(account.market);
  if (accountById(registrarAccountId).registrar !== info.registrar) {
    throw new Error(`That isn’t a ${info.name} registrar account.`);
  }
  // Two would read the same listings twice.
  if (
    listMarketAccounts().some(
      (a) => a.id !== account.id && a.registrarAccountId === registrarAccountId,
    )
  ) {
    throw new Error(
      `A ${info.name} market account already uses that registrar account.`,
    );
  }
}

/**
 * Connect a market account: test the credentials first, so a typo never
 * leaves an account behind, then save. Sync is the caller's next step. A
 * market on a registrar's API can take a registrar account to use instead.
 */
export async function connectMarketAccount(
  market: MarketId,
  raw: Credentials,
  label?: string,
  /** A fixed id, for seeded data and tests. */
  id: string = crypto.randomUUID(),
  registrarAccountId?: string | null,
  useProxy = false,
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
  if (info.registrar && registrarAccountId) {
    assertLinkable(account, registrarAccountId);
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
    if (info.registrar && !Object.keys(clean).length) {
      throw new Error(
        `Choose the ${info.name} registrar account whose API key to use, or enter a separate key.`,
      );
    }
    if (useProxy) account.proxyId = DEFAULT_PROXY_ID;
    test = await buildAdapter(
      market,
      id,
      clean,
      contextOf(account, clean),
    ).test();
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

/**
 * Replace an account's own credentials after testing them, and its proxy
 * choice when `useProxy` is given. An account on a registrar's key moves to
 * this one.
 */
export async function saveMarketCredentials(
  id: string,
  raw: Credentials,
  useProxy?: boolean,
): Promise<void> {
  const current = marketAccount(id);
  const clean = cleanCredentials(current.market, raw);
  const { registrarAccountId, ...next } = current;
  if (useProxy !== undefined) {
    next.proxyId = useProxy ? DEFAULT_PROXY_ID : null;
  }
  await buildAdapter(current.market, id, clean, contextOf(next, clean)).test();
  await saveInOrder(id, () => credentials.set(id, clean));
  if (registrarAccountId || next.proxyId !== current.proxyId) {
    await accounts.set(id, next);
  }
}

/** Move an account onto a registrar account's key, after testing that key. */
export async function linkMarketAccount(
  id: string,
  registrarAccountId: string,
): Promise<void> {
  const current = marketAccount(id);
  if (!marketInfo(current.market).registrar) {
    throw new Error(
      `${marketInfo(current.market).name} doesn’t run on a registrar’s key.`,
    );
  }
  assertLinkable(current, registrarAccountId);
  const next: MarketAccount = { ...current, registrarAccountId, proxyId: null };
  await buildAdapter(
    current.market,
    id,
    credentialsOf(next),
    contextOf(next),
  ).test();
  await accounts.set(id, next);
  await saveInOrder(id, () => credentials.delete(id));
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
