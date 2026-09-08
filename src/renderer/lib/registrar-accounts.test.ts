import { describe, expect, it } from 'vitest';
import type {
  Domain,
  RegistrarDefinition,
  RegistrarMeta,
  RegistrarName,
} from '../../shared/ipc';
import { multiAccountRegistrars, registrarGroups } from './registrar-accounts';

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

describe('progressive registrar account UI', () => {
  it('keeps the original empty registrar cards, without offering another account', () => {
    const placeholders = catalog.map((p) =>
      account(p.name, p.name, { saved: false, configured: false }),
    );
    const groups = registrarGroups(catalog, placeholders);
    expect(groups).toHaveLength(2);
    expect(
      groups.every((g) => !g.canAddAccount && g.accounts.length === 0),
    ).toBe(true);
    expect(multiAccountRegistrars(placeholders).size).toBe(0);
  });

  it('shows Add another only after credentials are saved, not after a label-only record', () => {
    const incomplete = account('dynadot', 'second', { configured: false });
    expect(registrarGroups(catalog, [incomplete])[0].canAddAccount).toBe(false);
    const configured = { ...incomplete, configured: true };
    expect(registrarGroups(catalog, [configured])[0].canAddAccount).toBe(true);
    expect(registrarGroups(catalog, [configured])[1].canAddAccount).toBe(false);
  });

  it('does not add Account fields when each registrar holds one account, including migrated UUID accounts', () => {
    const accounts = [account('dynadot', 'uuid-one'), account('porkbun')];
    expect(multiAccountRegistrars(accounts).size).toBe(0);
    expect(
      registrarGroups(catalog, accounts).map((g) => g.accounts.length),
    ).toEqual([1, 1]);
  });

  it('layers three Dynadot accounts into one card and exposes account UI only for Dynadot', () => {
    const accounts = [
      account('dynadot', 'first'),
      account('dynadot', 'second'),
      account('dynadot', 'third'),
      account('porkbun'),
    ];
    expect(
      registrarGroups(catalog, accounts).map((g) =>
        g.accounts.map((a) => a.accountId),
      ),
    ).toEqual([['first', 'second', 'third'], ['porkbun']]);
    expect([...multiAccountRegistrars(accounts)]).toEqual(['dynadot']);
  });

  it('does not count the unused legacy placeholder as a second account', () => {
    expect(
      multiAccountRegistrars([
        account('dynadot', 'dynadot', { saved: false, configured: false }),
        account('dynadot', 'new'),
      ]).size,
    ).toBe(0);
  });

  it('keeps disabled accounts selectable, but removes the account layer after deletion', () => {
    const a = account('dynadot', 'first');
    const b = account('dynadot', 'second', { enabled: false });
    expect(multiAccountRegistrars([a, b]).has('dynadot')).toBe(true);
    expect(multiAccountRegistrars([a]).size).toBe(0);
    expect(registrarGroups(catalog, [a])[0].canAddAccount).toBe(true);
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
