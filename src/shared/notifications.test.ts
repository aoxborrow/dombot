import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import {
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
