import { describe, expect, it } from 'vitest';
import { localDay, type DomainEvent } from './domain-events';
import { ownershipByDomain } from './ownership';
import {
  diffSync,
  isOpenAlert,
  resolvedIds,
  type AccountHoldings,
} from './sync-diff';

const NOW = Date.UTC(2026, 8, 22, 12);

function account(
  accountId: string,
  names: string[],
  synced = true,
  known = true,
): AccountHoldings {
  return { accountId, names, synced, known };
}

let n = 0;
const newEvent = (
  fields: Omit<DomainEvent, 'id' | 'createdAt' | 'updatedAt'>,
  now: number,
): DomainEvent => ({
  ...fields,
  id: `E${String(++n).padStart(4, '0')}`,
  createdAt: now,
  updatedAt: null,
});

function run(
  before: AccountHoldings[],
  after: AccountHoldings[],
  events: DomainEvent[] = [],
  tracked: string[] = [],
) {
  return diffSync(before, after, events, new Set(tracked), NOW, newEvent);
}

const brief = (events: DomainEvent[]) =>
  events.map((e) => ({
    type: e.type,
    domain: e.domain,
    ...(e.accountId ? { accountId: e.accountId } : {}),
    ...(e.fromAccountId ? { from: e.fromAccountId, to: e.toAccountId } : {}),
    ...(e.resolves ? { resolves: e.resolves } : {}),
    ...(e.dismissed ? { dismissed: true } : {}),
  }));

describe('diffSync', () => {
  it('treats the first successful sync as a starting point', () => {
    const result = run([], [account('dynadot', ['a.com', 'b.com'])]);
    expect(result.events).toEqual([]);
    expect(result.newlyTracked).toEqual(['dynadot']);
  });

  it('does not start tracking an account whose sync failed', () => {
    const result = run([], [account('dynadot', ['a.com'], false)]);
    expect(result).toEqual({ events: [], newlyTracked: [] });
  });

  it('records a name leaving and a name arriving, dated by the sync', () => {
    const result = run(
      [account('dynadot', ['a.com', 'B.com'])],
      [account('dynadot', ['b.com', 'Münich.de'])],
      [],
      ['dynadot'],
    );
    expect(brief(result.events)).toEqual([
      { type: 'removed', domain: 'a.com', accountId: 'dynadot' },
      { type: 'added', domain: 'xn--mnich-kva.de', accountId: 'dynadot' },
    ]);
    expect(result.events.every((e) => e.source === 'sync')).toBe(true);
    expect(result.events[0].date).toBe(localDay(NOW));
  });

  it('records one move when a name leaves one account and joins another', () => {
    const result = run(
      [account('dynadot', ['a.com']), account('porkbun', [])],
      [account('dynadot', []), account('porkbun', ['a.com'])],
      [],
      ['dynadot', 'porkbun'],
    );
    expect(brief(result.events)).toEqual([
      { type: 'moved', domain: 'a.com', from: 'dynadot', to: 'porkbun' },
    ]);
  });

  it('closes an open departure when the name later turns up in another account', () => {
    const first = run(
      [account('dynadot', ['a.com']), account('porkbun', [], false)],
      [account('dynadot', []), account('porkbun', [], false)],
      [],
      ['dynadot'],
    );
    const removal = first.events[0];
    expect(removal.type).toBe('removed');
    const second = run(
      [account('dynadot', []), account('porkbun', [])],
      [account('dynadot', [], false), account('porkbun', ['a.com'])],
      first.events,
      ['dynadot', 'porkbun'],
    );
    expect(brief(second.events)).toEqual([
      {
        type: 'moved',
        domain: 'a.com',
        from: 'dynadot',
        to: 'porkbun',
        resolves: removal.id,
      },
    ]);
    const all = [...first.events, ...second.events];
    expect(isOpenAlert(removal, resolvedIds(all))).toBe(false);
  });

  it('closes a departure quietly when the name comes back to the same account', () => {
    const left = run(
      [account('dynadot', ['a.com'])],
      [account('dynadot', [])],
      [],
      ['dynadot'],
    );
    const back = run(
      [account('dynadot', [])],
      [account('dynadot', ['a.com'])],
      left.events,
      ['dynadot'],
    );
    expect(brief(back.events)).toEqual([
      {
        type: 'added',
        domain: 'a.com',
        accountId: 'dynadot',
        resolves: left.events[0].id,
        dismissed: true,
      },
    ]);
    const owned = ownershipByDomain([...left.events, ...back.events]);
    expect(owned.get('a.com')?.archived).toBe(false);
  });

  it('does not alert twice for a name that is already gone', () => {
    const left = run(
      [account('dynadot', ['a.com']), account('porkbun', ['a.com'])],
      [account('dynadot', []), account('porkbun', ['a.com'])],
      [],
      ['dynadot', 'porkbun'],
    );
    // Held elsewhere: a move, not a departure.
    expect(left.events.map((e) => e.type)).toEqual(['moved']);
  });

  it('records a departure after you marked the name as nothing to review', () => {
    const sold = newEvent(
      { domain: 'a.com', type: 'sold', source: 'user', date: '2026-09-01' },
      NOW,
    );
    const result = run(
      [account('dynadot', ['a.com'])],
      [account('dynadot', [])],
      [sold],
      ['dynadot'],
    );
    expect(brief(result.events)).toEqual([
      {
        type: 'removed',
        domain: 'a.com',
        accountId: 'dynadot',
        dismissed: true,
      },
    ]);
    // Still Sold, not "left".
    expect(
      ownershipByDomain([sold, ...result.events]).get('a.com'),
    ).toMatchObject({ archived: true, label: 'sold', event: sold });
  });

  it('starts over quietly when there is no record of the last sync', () => {
    const result = run(
      [account('dynadot', [], false, false)],
      [account('dynadot', ['a.com', 'b.com'])],
      [],
      ['dynadot'],
    );
    expect(result.events).toEqual([]);
  });

  it('leaves other accounts alone when a new registrar syncs for the first time', () => {
    const result = run(
      [account('dynadot', ['a.com']), account('porkbun', [], false, false)],
      [account('dynadot', ['a.com'], false), account('porkbun', ['z.com'])],
      [],
      ['dynadot'],
    );
    expect(result).toEqual({ events: [], newlyTracked: ['porkbun'] });
  });
});

describe('ownershipByDomain', () => {
  it('labels Archive by the latest disposition, and a return makes it owned', () => {
    const e = (id: string, type: DomainEvent['type'], extra = {}) =>
      ({
        id,
        domain: 'a.com',
        type,
        source: 'user',
        date: null,
        createdAt: 0,
        updatedAt: null,
        ...extra,
      }) as DomainEvent;
    const left = e('E1', 'removed', { source: 'sync', accountId: 'dyn' });
    expect(ownershipByDomain([left]).get('a.com')).toMatchObject({
      archived: true,
      label: 'left',
      lastAccountId: 'dyn',
    });
    const dropped = e('E2', 'dropped', { resolves: 'E1' });
    expect(ownershipByDomain([left, dropped]).get('a.com')?.label).toBe(
      'dropped',
    );
    const back = e('E3', 'added', { source: 'sync', accountId: 'pork' });
    expect(ownershipByDomain([left, dropped, back]).get('a.com')).toMatchObject(
      { archived: false, label: null, lastAccountId: 'pork' },
    );
  });
});
