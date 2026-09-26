import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../shared/domain-events';
import { alertStatus, bellBadge, reviewQueues } from './activity';

const event = (patch: Partial<DomainEvent>): DomainEvent => ({
  id: 'E1',
  domain: 'a.com',
  type: 'removed',
  source: 'sync',
  date: '2026-09-25',
  createdAt: 1,
  updatedAt: null,
  ...patch,
});

describe('alertStatus', () => {
  it('is open until answered or dismissed', () => {
    expect(alertStatus(event({}), undefined)).toEqual({
      text: 'Needs review',
      open: true,
      undo: null,
    });
  });

  it('offers Undo only for what you did', () => {
    const sold = event({ id: 'E2', type: 'sold', source: 'user' });
    expect(alertStatus(event({}), sold)).toMatchObject({
      text: 'Sold',
      undo: 'answer',
    });
    expect(
      alertStatus(event({ dismissed: true, updatedAt: 5 }), undefined),
    ).toMatchObject({ text: 'Dismissed', undo: 'dismissal' });
    // Closed by sync on its own: nothing to undo.
    const back = event({ id: 'E3', type: 'added', resolves: 'E1' });
    expect(alertStatus(event({}), back)).toMatchObject({
      text: 'Came back',
      undo: null,
    });
    expect(
      alertStatus(event({ type: 'added', dismissed: true }), undefined),
    ).toMatchObject({ text: 'Came back', undo: null });
    expect(alertStatus(event({ dismissed: true }), undefined)).toMatchObject({
      text: 'Already labeled',
      undo: null,
    });
  });

  it('is not an alert for other events', () => {
    expect(alertStatus(event({ type: 'moved' }), undefined)).toBeNull();
  });
});

describe('reviewQueues', () => {
  it('puts departures ahead of arrivals, newest first, open alerts only', () => {
    const events = [
      event({ id: 'E1', domain: 'a.com' }),
      event({ id: 'E2', domain: 'b.com', type: 'added' }),
      event({ id: 'E3', domain: 'c.com', type: 'added' }),
      event({ id: 'E4', domain: 'd.com', dismissed: true }),
      event({ id: 'E5', domain: 'e.com' }),
      event({ id: 'E6', domain: 'e.com', type: 'sold', resolves: 'E5' }),
    ];
    const { departures, arrivals } = reviewQueues(events);
    expect(departures.map((e) => e.id)).toEqual(['E1']);
    expect(arrivals.map((e) => e.id)).toEqual(['E3', 'E2']);
  });
});

describe('bellBadge', () => {
  it('takes the color of the most urgent item; arrivals alone stay quiet', () => {
    expect(bellBadge(0, 0, 0)).toBeNull();
    expect(bellBadge(0, 0, 4)).toEqual({ count: 4, tone: 'quiet' });
    expect(bellBadge(0, 1, 4)).toEqual({ count: 5, tone: 'review' });
    expect(bellBadge(1, 1, 4)).toEqual({ count: 6, tone: 'error' });
  });
});
