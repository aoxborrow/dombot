import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../shared/domain-events';
import {
  alertStatus,
  eventAccounts,
  eventDay,
  eventDetails,
  withinDays,
} from './activity';

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

describe('event helpers', () => {
  it('dates an event by its day, or the day it was recorded', () => {
    expect(eventDay(event({ date: '2026-01-02' }))).toBe('2026-01-02');
    expect(
      eventDay(event({ date: null, createdAt: Date.UTC(2026, 0, 5, 12) })),
    ).toBe('2026-01-05');
  });

  it('keeps events inside the window', () => {
    const now = Date.UTC(2026, 8, 26, 12);
    expect(withinDays(event({ date: '2026-09-20' }), 7, now)).toBe(true);
    expect(withinDays(event({ date: '2026-09-01' }), 7, now)).toBe(false);
  });

  it('names every account and the details', () => {
    expect(
      eventAccounts(
        event({
          type: 'moved',
          accountId: null,
          fromAccountId: 'a',
          toAccountId: 'b',
        }),
      ),
    ).toEqual(['a', 'b']);
    expect(
      eventDetails(
        event({ type: 'renewed', amount: '10.00', currency: 'USD', years: 2 }),
        'us',
        'USD',
      ),
    ).toBe('$10.00 · 2 yr');
    expect(eventDetails(event({}), 'us', 'USD')).toBeNull();
  });
});
