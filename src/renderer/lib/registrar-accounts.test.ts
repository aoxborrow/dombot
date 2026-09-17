import { describe, expect, it } from 'vitest';
import type {
  Domain,
  RegistrarDefinition,
  RegistrarMeta,
  RegistrarName,
} from '../../shared/ipc';
import {
  accountCards,
  isAutoLabel,
  multiAccountRegistrars,
  savedSiblings,
} from './registrar-accounts';

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

  it('gives each saved account its own card and hides the nickname of a lone account', () => {
    const accounts = [account('dynadot', 'uuid-one'), account('porkbun')];
    const cards = accountCards(catalog, accounts);
    expect(cards.map((c) => c.account.accountId)).toEqual([
      'uuid-one',
      'porkbun',
    ]);
    expect(cards.every((c) => !c.showLabel)).toBe(true);
    expect(multiAccountRegistrars(accounts).size).toBe(0);
  });

  it('shows nicknames only for registrars with sibling accounts', () => {
    const accounts = [
      account('dynadot', 'first', { accountLabel: 'Personal' }),
      account('dynadot', 'second', { accountLabel: 'Agency' }),
      account('porkbun'),
    ];
    const cards = accountCards(catalog, accounts);
    expect(cards.map((c) => [c.account.accountId, c.showLabel])).toEqual([
      ['second', true],
      ['first', true],
      ['porkbun', false],
    ]);
    expect([...multiAccountRegistrars(accounts)]).toEqual(['dynadot']);
  });

  it('sorts by registrar name, then nickname ignoring case, independent of input order', () => {
    const accounts = [
      account('porkbun', 'p2', { accountLabel: 'zeta' }),
      account('dynadot', 'd2', { accountLabel: 'beta' }),
      account('porkbun', 'p1', { accountLabel: 'Alpha' }),
      account('dynadot', 'd1', { accountLabel: 'Alpha' }),
    ];
    const order = (list: RegistrarMeta[]) =>
      accountCards(catalog, list).map((c) => c.account.accountId);
    expect(order(accounts)).toEqual(['d1', 'd2', 'p1', 'p2']);
    expect(order([...accounts].reverse())).toEqual(['d1', 'd2', 'p1', 'p2']);
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
    expect(savedSiblings(accounts, 'dynadot').map((a) => a.accountId)).toEqual([
      'new',
    ]);
    expect(accountCards(catalog, accounts)[0].showLabel).toBe(false);
    expect(multiAccountRegistrars(accounts).size).toBe(0);
  });

  it('recognizes the labels DomBot assigns itself', () => {
    for (const label of [
      'Default',
      'Main',
      'main',
      'Account 2',
      ' account 12 ',
    ])
      expect(isAutoLabel(label)).toBe(true);
    for (const label of ['Personal', 'Main agency', 'Account', 'Defaults'])
      expect(isAutoLabel(label)).toBe(false);
    expect(isAutoLabel(undefined)).toBe(true);
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
