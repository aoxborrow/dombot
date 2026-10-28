import type {
  MarketAccount,
  MarketAccountView,
  MarketId,
  MarketSyncState,
} from '../../../shared/markets';
import {
  MARKET_ACCOUNTS_NAMESPACE,
  MARKET_CREDENTIALS_NAMESPACE,
  MARKET_LAST_SYNC_NAMESPACE,
} from '../../storage/names';
import { Namespace } from '../../storage/namespace';
import { serialByKey } from '../serial-by-key';
import {
  buildAdapter,
  isMarketId,
  marketInfo,
  type AnyMarketAdapter,
  type Credentials,
} from './registry';

// Market accounts (Settings → Markets, docs/markets.md): one record per
// connected account, its credentials in their own namespace, which hosts
// seal like registrar credentials, and what its last sync found.

const accounts = new Namespace<MarketAccount>(MARKET_ACCOUNTS_NAMESPACE);
const credentials = new Namespace<Credentials>(MARKET_CREDENTIALS_NAMESPACE);
const lastSync = new Namespace<MarketSyncState>(MARKET_LAST_SYNC_NAMESPACE);
const saveInOrder = serialByKey();

/** Hooks other market services register to drop an account's data. */
const onRemove: ((accountId: string) => void)[] = [];
export function onMarketAccountRemoved(fn: (accountId: string) => void) {
  onRemove.push(fn);
}

export function listMarketAccounts(): MarketAccount[] {
  return Object.values(accounts.all()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

export function marketAccountViews(): MarketAccountView[] {
  return listMarketAccounts().map((a) => ({
    ...a,
    configured: Object.keys(credentials.get(a.id) ?? {}).length > 0,
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
  return listMarketAccounts().filter(
    (a) => a.enabled && Object.keys(credentials.get(a.id) ?? {}).length > 0,
  );
}

export function getMarketCredentials(id: string): Credentials {
  marketAccount(id);
  return credentials.get(id) ?? {};
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
  return buildAdapter(account.market, id, credentials.get(id) ?? {});
}

/**
 * Connect a market account: test the credentials first, so a typo never
 * leaves an account behind, then save. Sync is the caller's next step.
 */
export async function connectMarketAccount(
  market: MarketId,
  raw: Credentials,
  label?: string,
  /** A fixed id, for seeded data and tests. */
  id: string = crypto.randomUUID(),
): Promise<MarketAccountView> {
  if (!isMarketId(market)) throw new Error('Unknown market.');
  const clean = cleanCredentials(market, raw);
  const name = cleanLabel(label, market);
  const test = await buildAdapter(market, id, clean).test();
  const account: MarketAccount = {
    id,
    market,
    label: name,
    enabled: true,
    createdAt: Date.now(),
  };
  // Secrets first: a failed write never leaves an account without them.
  await saveInOrder(id, () => credentials.set(id, clean));
  await accounts.set(id, account);
  setMarketSyncState(id, {
    at: Date.now(),
    lastError: null,
    listings: test.listings ?? 0,
    sales: 0,
    incomplete: false,
    notes: test.notes,
  });
  return marketAccountViews().find((a) => a.id === id)!;
}

/** Replace an account's credentials after testing them. */
export async function saveMarketCredentials(
  id: string,
  raw: Credentials,
): Promise<void> {
  const account = marketAccount(id);
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
