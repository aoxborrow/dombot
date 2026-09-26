import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../shared/domain-events';
import { alertStatus } from './activity';

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
