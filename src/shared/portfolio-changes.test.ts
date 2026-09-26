import { describe, expect, it } from 'vitest';
import {
  diffHoldings,
  type AccountHoldings,
  type PortfolioChange,
} from './portfolio-changes';

const NOW = '2026-09-22T12:00:00.000Z';

function account(
  accountId: string,
  names: string[],
  synced = true,
): AccountHoldings {
  return {
    accountId,
    registrar: accountId.startsWith('pork') ? 'porkbun' : 'dynadot',
    label: accountId,
    names,
    synced,
  };
}

function run(
  before: AccountHoldings[],
  after: AccountHoldings[],
  prior: PortfolioChange[] = [],
  baselined: string[] = [],
) {
  let n = 0;
  return diffHoldings(before, after, prior, baselined, NOW, () => `id-${++n}`);
}

describe('diffHoldings', () => {
  it('treats the first successful sync as a baseline', () => {
    const result = run([], [account('dynadot', ['a.com', 'b.com'])]);
    expect(result.changes).toEqual([]);
    expect(result.baselinedAccountIds).toEqual(['dynadot']);
  });

  it('does not baseline an account whose sync failed', () => {
    const result = run([], [account('dynadot', ['a.com'], false)]);
    expect(result.changes).toEqual([]);
    expect(result.baselinedAccountIds).toEqual([]);
  });

  it('alerts when a baselined account gains or loses a name', () => {
    const result = run(
      [account('dynadot', ['a.com', 'b.com'])],
      [account('dynadot', ['b.com', 'c.com'])],
      [],
      ['dynadot'],
    );
    expect(
      result.changes.map((change) => [change.kind, change.domainName]),
    ).toEqual([
      ['removed', 'a.com'],
      ['added', 'c.com'],
    ]);
    expect(result.changes.every((change) => !change.resolved)).toBe(true);
  });

  it('records one move when a name leaves one account and joins another', () => {
    const result = run(
      [account('dynadot', ['a.com']), account('porkbun', [])],
      [account('dynadot', []), account('porkbun', ['a.com'])],
      [],
      ['dynadot', 'porkbun'],
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      kind: 'moved',
      domainName: 'a.com',
      fromAccountId: 'dynadot',
      toAccountId: 'porkbun',
      resolved: false,
    });
  });

  it('turns an open removal plus a later arrival on another account into a move', () => {
    const first = run(
      [account('dynadot', ['a.com']), account('porkbun', [], false)],
      [account('dynadot', []), account('porkbun', [], false)],
      [],
      ['dynadot'],
    );
    const removal = first.changes[0];
    expect(removal.kind).toBe('removed');
    const second = run(
      [account('dynadot', []), account('porkbun', [])],
      [account('dynadot', [], false), account('porkbun', ['a.com'])],
      first.changes,
      first.baselinedAccountIds,
    );
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]).toMatchObject({
      id: removal.id,
      kind: 'moved',
      fromAccountId: 'dynadot',
      toAccountId: 'porkbun',
    });
  });

  it('keeps the departure and adds an arrival when the same account gets the name back', () => {
    const left = run(
      [account('dynadot', ['a.com'])],
      [account('dynadot', [])],
      [],
      ['dynadot'],
    );
    const back = run(
      [account('dynadot', [])],
      [account('dynadot', ['a.com'])],
      left.changes,
      left.baselinedAccountIds,
    );
    expect(
      back.changes.map((change) => [change.kind, change.resolution]),
    ).toEqual([
      ['removed', 'returned'],
      ['added', null],
    ]);
  });

  it('leaves other accounts alone when a new registrar syncs for the first time', () => {
    const result = run(
      [account('dynadot', ['a.com']), account('porkbun', [])],
      [account('dynadot', ['a.com'], false), account('porkbun', ['z.com'])],
      [],
      ['dynadot'],
    );
    expect(result.changes).toEqual([]);
    expect(result.baselinedAccountIds.sort()).toEqual(['dynadot', 'porkbun']);
  });
});
