import { toAscii } from './domain-name';

/** A name left an account, arrived, or moved between the user's own accounts. */
export type PortfolioChangeKind = 'added' | 'removed' | 'moved';

/**
 * How an alert was closed. `returned` is set when a name that had left comes
 * back to the same account before anyone files it as sold or dropped.
 */
export type PortfolioChangeResolution =
  'sold' | 'dropped' | 'archive' | 'dismissed' | 'returned';

/**
 * One row of portfolio history. Rows are never deleted.
 * A `moved` row keeps the account it left (`from*`) and the account it
 * joined (`to*`). After that alert is dismissed, no screen lists the move.
 */
export interface PortfolioChange {
  id: string;
  /** Registrar spelling, used in the folder key `${accountId}:${domainName}`. */
  domainName: string;
  kind: PortfolioChangeKind;
  /** When this sync noticed the change (ISO). */
  at: string;
  fromAccountId: string | null;
  fromRegistrar: string | null;
  fromLabel: string | null;
  toAccountId: string | null;
  toRegistrar: string | null;
  toLabel: string | null;
  resolved: boolean;
  resolution: PortfolioChangeResolution | null;
}

/** One account's domain names at one moment, plus whether this sync succeeded. */
export interface AccountHoldings {
  accountId: string;
  registrar: string;
  label: string;
  names: string[];
  synced: boolean;
}

interface IndexedAccount {
  accountId: string;
  registrar: string;
  label: string;
  names: Set<string>;
  display: Map<string, string>;
  synced: boolean;
}

function indexAccounts(rows: AccountHoldings[]): Map<string, IndexedAccount> {
  const map = new Map<string, IndexedAccount>();
  for (const row of rows) {
    const names = new Set<string>();
    const display = new Map<string, string>();
    for (const raw of row.names) {
      const key = toAscii(raw);
      if (!key) continue;
      names.add(key);
      if (!display.has(key)) display.set(key, raw.trim().replace(/\.$/, ''));
    }
    map.set(row.accountId, {
      accountId: row.accountId,
      registrar: row.registrar,
      label: row.label,
      names,
      display,
      synced: row.synced,
    });
  }
  return map;
}

function findOpen(
  changes: PortfolioChange[],
  name: string,
  kind: PortfolioChangeKind,
): PortfolioChange | undefined {
  return changes.find(
    (change) =>
      !change.resolved &&
      change.kind === kind &&
      toAscii(change.domainName) === name,
  );
}

function asAccount(
  id: string,
  registrar: string | null,
  label: string | null,
): IndexedAccount {
  return {
    accountId: id,
    registrar: registrar ?? '',
    label: label ?? '',
    names: new Set(),
    display: new Map(),
    synced: false,
  };
}

/**
 * Compare the portfolio before a sync to the portfolio after it.
 *
 * An account's first successful sync is a baseline: those names are not
 * alerts. Later syncs append a row per arrival, departure, or move. A name
 * that leaves one of the user's accounts and is held by another is one move,
 * not a sale plus a purchase. That move row is kept. The UI shows it only
 * while the alert is still open.
 */
export function diffHoldings(
  before: AccountHoldings[],
  after: AccountHoldings[],
  prior: PortfolioChange[],
  baselined: string[],
  now: string,
  newId: () => string,
): { changes: PortfolioChange[]; baselinedAccountIds: string[] } {
  const prev = indexAccounts(before);
  const next = indexAccounts(after);
  const changes = prior.map((change) => ({ ...change }));
  const base = new Set(baselined);

  const writeMove = (
    existing: PortfolioChange | undefined,
    from: IndexedAccount,
    to: IndexedAccount,
    display: string,
  ) => {
    const move: PortfolioChange = {
      id: existing?.id ?? newId(),
      domainName: existing?.domainName || display,
      kind: 'moved',
      at: now,
      fromAccountId: from.accountId,
      fromRegistrar: from.registrar,
      fromLabel: from.label,
      toAccountId: to.accountId,
      toRegistrar: to.registrar,
      toLabel: to.label,
      resolved: false,
      resolution: null,
    };
    if (existing) {
      const index = changes.findIndex((change) => change.id === existing.id);
      if (index >= 0) changes[index] = move;
    } else {
      changes.push(move);
    }
  };

  const lefts: { name: string; account: IndexedAccount; display: string }[] =
    [];
  const joins: { name: string; account: IndexedAccount; display: string }[] =
    [];

  for (const account of next.values()) {
    if (!account.synced) continue;
    if (!base.has(account.accountId)) {
      base.add(account.accountId);
      // Still no alerts for names this account already holds. If one of them
      // is an open departure from another account, that departure was a move.
      for (const name of account.names) {
        const openRemoval = findOpen(changes, name, 'removed');
        if (!openRemoval || openRemoval.fromAccountId === account.accountId) {
          continue;
        }
        const from = openRemoval.fromAccountId
          ? (prev.get(openRemoval.fromAccountId) ??
            asAccount(
              openRemoval.fromAccountId,
              openRemoval.fromRegistrar,
              openRemoval.fromLabel,
            ))
          : account;
        writeMove(
          openRemoval,
          from,
          account,
          account.display.get(name) ?? openRemoval.domainName,
        );
      }
      continue;
    }
    const was = prev.get(account.accountId)?.names ?? new Set<string>();
    for (const name of was) {
      if (account.names.has(name)) continue;
      lefts.push({
        name,
        account,
        display: prev.get(account.accountId)?.display.get(name) ?? name,
      });
    }
    for (const name of account.names) {
      if (was.has(name)) continue;
      joins.push({
        name,
        account,
        display: account.display.get(name) ?? name,
      });
    }
  }

  const joinsByName = new Map<string, (typeof joins)[number][]>();
  for (const join of joins) {
    const list = joinsByName.get(join.name) ?? [];
    list.push(join);
    joinsByName.set(join.name, list);
  }
  const consumedJoins = new Set<(typeof joins)[number]>();

  const holdersExcept = (name: string, accountId: string): IndexedAccount[] => {
    const found: IndexedAccount[] = [];
    for (const account of next.values()) {
      if (account.accountId === accountId) continue;
      if (account.names.has(name)) found.push(account);
    }
    return found;
  };

  const dismissOpen = (change: PortfolioChange | undefined) => {
    if (!change) return;
    const index = changes.findIndex((row) => row.id === change.id);
    if (index >= 0) {
      changes[index] = {
        ...changes[index],
        resolved: true,
        resolution: 'dismissed',
      };
    }
  };

  for (const left of lefts) {
    const joined = (joinsByName.get(left.name) ?? []).filter(
      (join) => !consumedJoins.has(join),
    );
    const elsewhere = holdersExcept(left.name, left.account.accountId);
    const openAdd = findOpen(changes, left.name, 'added');
    const openRemoval = findOpen(changes, left.name, 'removed');
    if (joined[0]) {
      consumedJoins.add(joined[0]);
      writeMove(
        openRemoval ?? openAdd,
        left.account,
        joined[0].account,
        left.display,
      );
      if (openRemoval && openAdd) dismissOpen(openAdd);
      continue;
    }
    if (elsewhere[0]) {
      writeMove(
        openRemoval ?? openAdd,
        left.account,
        elsewhere[0],
        left.display,
      );
      if (openRemoval && openAdd) dismissOpen(openAdd);
      continue;
    }
    if (
      openAdd?.toAccountId &&
      openAdd.toAccountId !== left.account.accountId &&
      next.get(openAdd.toAccountId)
    ) {
      writeMove(
        openAdd,
        left.account,
        next.get(openAdd.toAccountId)!,
        left.display,
      );
      continue;
    }
    if (openRemoval || findOpen(changes, left.name, 'moved')) continue;
    changes.push({
      id: newId(),
      domainName: left.display,
      kind: 'removed',
      at: now,
      fromAccountId: left.account.accountId,
      fromRegistrar: left.account.registrar,
      fromLabel: left.account.label,
      toAccountId: null,
      toRegistrar: null,
      toLabel: null,
      resolved: false,
      resolution: null,
    });
  }

  for (const join of joins) {
    if (consumedJoins.has(join)) continue;
    const openRemoval = findOpen(changes, join.name, 'removed');
    if (openRemoval) {
      if (openRemoval.fromAccountId === join.account.accountId) {
        const index = changes.findIndex((row) => row.id === openRemoval.id);
        if (index >= 0) {
          changes[index] = {
            ...changes[index],
            resolved: true,
            resolution: 'returned',
          };
        }
      } else {
        const from = openRemoval.fromAccountId
          ? (prev.get(openRemoval.fromAccountId) ??
            asAccount(
              openRemoval.fromAccountId,
              openRemoval.fromRegistrar,
              openRemoval.fromLabel,
            ))
          : join.account;
        writeMove(openRemoval, from, join.account, join.display);
        continue;
      }
    }
    if (
      findOpen(changes, join.name, 'added') ||
      findOpen(changes, join.name, 'moved')
    ) {
      continue;
    }
    changes.push({
      id: newId(),
      domainName: join.display,
      kind: 'added',
      at: now,
      fromAccountId: null,
      fromRegistrar: null,
      fromLabel: null,
      toAccountId: join.account.accountId,
      toRegistrar: join.account.registrar,
      toLabel: join.account.label,
      resolved: false,
      resolution: null,
    });
  }

  return { changes, baselinedAccountIds: [...base] };
}
