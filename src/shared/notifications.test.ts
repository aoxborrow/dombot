import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import type { MarketAccountView, MarketInfo } from './markets';
import {
  marketSyncFailures,
  notificationBadge,
  notifications,
  reviewPriority,
} from './notifications';
import { resolvedIds } from './sync-diff';

const event = (patch: Partial<DomainEvent>): DomainEvent => ({
  id: 'E1',
  domain: 'a.com',
  type: 'removed',
  source: 'sync',
  date: '2026-09-25',
  createdAt: 1,
  updatedAt: null,
  accountId: 'dynadot',
  ...patch,
});

describe('reviewPriority', () => {
  it('is high for a departure, low for an arrival, null otherwise', () => {
    const none = new Set<string>();
    expect(reviewPriority(event({}), none)).toBe('high');
    expect(reviewPriority(event({ type: 'added' }), none)).toBe('low');
    expect(reviewPriority(event({ type: 'moved' }), none)).toBeNull();
    expect(reviewPriority(event({ dismissed: true }), none)).toBeNull();
    const events = [
      event({}),
      event({ id: 'E2', type: 'sold', source: 'user', resolves: 'E1' }),
    ];
    expect(reviewPriority(events[0], resolvedIds(events))).toBeNull();
  });
});

describe('notifications', () => {
  it('lists errors, then departures, then arrivals, newest first', () => {
    const list = notifications(
      [
        event({ id: 'E1', domain: 'old-left.com', createdAt: 1 }),
        event({ id: 'E2', domain: 'new.com', type: 'added', createdAt: 5 }),
        event({ id: 'E3', domain: 'new-left.com', createdAt: 3 }),
        event({ id: 'E4', domain: 'moved.com', type: 'moved', createdAt: 9 }),
      ],
      [{ accountId: 'porkbun', account: 'Porkbun', message: 'Bad key' }],
    );
    expect(list.map((n) => [n.severity, n.domain ?? n.id])).toEqual([
      ['error', 'sync:porkbun'],
      ['high', 'new-left.com'],
      ['high', 'old-left.com'],
      ['low', 'new.com'],
    ]);
    expect(list[0]).toMatchObject({
      kind: 'sync-error',
      message: 'Porkbun: Bad key',
    });
  });

  it('puts the newest first when one sync made them all', () => {
    const list = notifications(
      [
        event({ id: 'E1', domain: 'first.com' }),
        event({ id: 'E2', domain: 'second.com' }),
      ],
      [],
    );
    expect(list.map((n) => n.domain)).toEqual(['second.com', 'first.com']);
  });
});

describe('marketSyncFailures', () => {
  const account = (patch: Partial<MarketAccountView>): MarketAccountView => ({
    id: 'm1',
    market: 'afternic',
    label: 'Afternic',
    enabled: true,
    configured: true,
    createdAt: 1,
    sync: null,
    ...patch,
  });
  const failed = (lastError: string) => ({
    at: 7,
    lastError,
    listings: 0,
    sales: 0,
    incomplete: false,
    notes: [],
  });
  const catalog = [{ id: 'afternic', name: 'Afternic' }] as MarketInfo[];

  it('lists enabled accounts whose sync failed, named as their cards are', () => {
    expect(
      marketSyncFailures(
        [
          account({ sync: failed('Afternic: Bad key') }),
          account({
            id: 'm2',
            label: 'Business',
            sync: failed('Business: Timed out'),
          }),
          account({ id: 'm3', enabled: false, sync: failed('x: y') }),
          account({ id: 'm4', configured: false, sync: failed('x: y') }),
          account({ id: 'm5' }),
        ],
        catalog,
      ),
    ).toEqual([
      { accountId: 'm1', account: 'Afternic', message: 'Bad key', at: 7 },
      {
        accountId: 'm2',
        account: 'Afternic · Business',
        message: 'Timed out',
        at: 7,
      },
    ]);
  });

  it('is empty before the accounts load', () => {
    expect(marketSyncFailures(null, catalog)).toEqual([]);
  });
});

describe('notificationBadge', () => {
  it('counts everything and takes the most severe', () => {
    const arrival = notifications([event({ type: 'added' })], []);
    expect(notificationBadge([])).toBeNull();
    expect(notificationBadge(arrival)).toEqual({ count: 1, severity: 'low' });
    const both = notifications(
      [event({ type: 'added' }), event({ id: 'E2' })],
      [],
    );
    expect(notificationBadge(both)).toEqual({ count: 2, severity: 'high' });
  });
});
