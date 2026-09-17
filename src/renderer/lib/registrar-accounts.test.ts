import { describe, expect, it } from 'vitest';
import type {
  Domain,
  RegistrarDefinition,
  RegistrarMeta,
  RegistrarName,
} from '../../shared/ipc';
import { accountCards, multiAccountRegistrars } from './registrar-accounts';

const provider = (name: RegistrarName): RegistrarDefinition => ({
  name,
  displayName: name,
  configFields: [],
  features: [],
  supportsSandbox: false,
});
const account = (
  name: RegistrarName,
  id: string = name,
  overrides: Partial<RegistrarMeta> = {},
): RegistrarMeta => ({
  ...provider(name),
  accountId: id,
  accountLabel: 'Default',
  saved: true,
  configured: true,
  enabled: true,
  sync: { lastSyncedAt: null, lastError: null, domainCount: 0 },
  ...overrides,
});
const catalog = [provider('dynadot'), provider('porkbun')];

describe('one card per account', () => {
  it('shows no cards for the placeholder accounts of unconfigured registrars', () => {
    const placeholders = catalog.map((p) =>
      account(p.name, p.name, { saved: false, configured: false }),
    );
    expect(accountCards(catalog, placeholders)).toEqual([]);
    expect(multiAccountRegistrars(placeholders).size).toBe(0);
  });

  it('gives each saved account its own card, with no siblings to number against', () => {
    const accounts = [account('dynadot', 'uuid-one'), account('porkbun')];
    const cards = accountCards(catalog, accounts);
    expect(cards.map((c) => c.account.accountId)).toEqual([
      'uuid-one',
      'porkbun',
    ]);
    expect(cards.every((c) => !c.hasSiblings)).toBe(true);
    expect(multiAccountRegistrars(accounts).size).toBe(0);
  });

  it('flags siblings only for registrars with several accounts', () => {
    const accounts = [
      account('dynadot', 'first', { accountLabel: 'Personal' }),
      account('dynadot', 'second', { accountLabel: 'Agency' }),
      account('porkbun'),
    ];
    const cards = accountCards(catalog, accounts);
    expect(cards.map((c) => [c.account.accountId, c.hasSiblings])).toEqual([
      ['second', true],
      ['first', true],
      ['porkbun', false],
    ]);
    expect([...multiAccountRegistrars(accounts)]).toEqual(['dynadot']);
  });

  it('sorts by registrar, then unnamed accounts by number, then nicknames by name, whatever the input order', () => {
    const accounts = [
      account('porkbun', 'p2', { accountLabel: 'zeta' }),
      account('dynadot', 'd3', { accountLabel: 'beta' }),
      account('dynadot', 'd10', { accountLabel: 'Account 10' }),
      account('porkbun', 'p1', { accountLabel: 'Alpha' }),
      account('dynadot', 'd2', { accountLabel: 'Account 2' }),
      account('dynadot', 'd1', { accountLabel: 'Default' }),
    ];
    const order = (list: RegistrarMeta[]) =>
      accountCards(catalog, list).map((c) => c.account.accountId);
    const expected = ['d1', 'd2', 'd10', 'd3', 'p1', 'p2'];
    expect(order(accounts)).toEqual(expected);
    expect(order([...accounts].reverse())).toEqual(expected);
  });

  it('keeps a disabled or credential-less saved account as a card', () => {
    const disabled = account('dynadot', 'off', { enabled: false });
    const incomplete = account('porkbun', 'half', { configured: false });
    expect(accountCards(catalog, [disabled, incomplete])).toHaveLength(2);
  });

  it('does not count the unused legacy placeholder as a sibling', () => {
    const accounts = [
      account('dynadot', 'dynadot', { saved: false, configured: false }),
      account('dynadot', 'new'),
    ];
    const cards = accountCards(catalog, accounts);
    expect(cards.map((c) => c.account.accountId)).toEqual(['new']);
    expect(cards[0].hasSiblings).toBe(false);
    expect(multiAccountRegistrars(accounts).size).toBe(0);
  });

  it('drops the account layer in Domains after a sibling is removed', () => {
    const a = account('dynadot', 'first');
    const b = account('dynadot', 'second', { enabled: false });
    expect(multiAccountRegistrars([a, b]).has('dynadot')).toBe(true);
    expect(multiAccountRegistrars([a]).size).toBe(0);
  });

  it('uses distinct cached identities during hydration, then honors current metadata after account removal', () => {
    const domains = [
      { registrar: 'dynadot', accountId: 'first' },
      { registrar: 'dynadot', accountId: 'first' },
      { registrar: 'dynadot', accountId: 'second' },
    ] as Domain[];
    expect(multiAccountRegistrars(null, domains).has('dynadot')).toBe(true);
    expect(
      multiAccountRegistrars([account('dynadot', 'first')], domains).size,
    ).toBe(0);
  });
});
