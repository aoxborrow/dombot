import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import { needsReviewIds } from './review';
import { isOpenAlert, resolvedIds } from './sync-diff';

const event = (id: string, patch: Partial<DomainEvent>): DomainEvent => ({
  id,
  domain: 'a.com',
  type: 'removed',
  source: 'sync',
  date: '2026-09-25',
  createdAt: 1,
  updatedAt: null,
  accountId: 'dynadot',
  ...patch,
});

/** Dismissed by you: Dismiss stamps `updatedAt`. */
const dismissedByYou = { dismissed: true, updatedAt: 2 };

const ids = (events: DomainEvent[]) => [...needsReviewIds(events)].sort();

describe('needsReviewIds', () => {
  it('lists every new alert', () => {
    expect(
      ids([
        event('E1', {}),
        event('E2', { domain: 'b.com', type: 'added' }),
        event('E3', { domain: 'c.com', type: 'moved' }),
      ]),
    ).toEqual(['E1', 'E2']);
  });

  it('keeps alerts you dismissed without recording the money', () => {
    expect(
      ids([
        event('E1', dismissedByYou),
        event('E2', { domain: 'b.com', type: 'added', ...dismissedByYou }),
      ]),
    ).toEqual(['E1', 'E2']);
  });

  it('leaves out what its writer closed: dismissed with no updatedAt', () => {
    // An import of a name already past expiry writes its arrival dismissed.
    expect(
      ids([event('E1', { type: 'added', source: 'import', dismissed: true })]),
    ).toEqual([]);
  });

  it('leaves out answered alerts and the answers', () => {
    const events = [
      event('E1', {}),
      event('E2', { type: 'sold', source: 'user', resolves: 'E1' }),
      event('E3', { domain: 'b.com' }),
      // Back in the account it left: sync closes the departure.
      event('E4', {
        domain: 'b.com',
        type: 'added',
        resolves: 'E3',
        dismissed: true,
      }),
    ];
    expect(ids(events)).toEqual([]);
  });

  it('leaves out lapses and drops', () => {
    expect(
      ids([
        event('E1', { expires: '2026-09-01', ...dismissedByYou }),
        event('E2', { domain: 'b.com', dropped: true }),
      ]),
    ).toEqual([]);
  });

  it('answers a departure with a sale since the name last arrived', () => {
    const sold = [
      event('E1', { type: 'added' }),
      event('E2', { type: 'sold', source: 'user' }),
      event('E3', dismissedByYou),
    ];
    expect(needsReviewIds(sold).has('E3')).toBe(false);
    // A sale before it came back belongs to the last holding.
    const resold = [
      event('E1', { type: 'sold', source: 'user' }),
      event('E2', { type: 'added', ...dismissedByYou }),
      event('E3', dismissedByYou),
    ];
    expect(needsReviewIds(resold).has('E3')).toBe(true);
  });

  it('answers an arrival with what you paid since the name last left', () => {
    // Recorded on the Domains page: no `resolves`, but it counts.
    const paid = [
      event('E1', { type: 'added', ...dismissedByYou }),
      event('E2', { type: 'purchased', source: 'user', amount: '900' }),
    ];
    expect(ids(paid)).toEqual([]);
    const registered = [
      event('E1', { type: 'registered', source: 'user' }),
      event('E2', { type: 'added', ...dismissedByYou }),
    ];
    expect(ids(registered)).toEqual([]);
    // A purchase before it left is the last holding's.
    const back = [
      event('E1', { type: 'purchased', source: 'user', amount: '900' }),
      event('E2', { expires: '2026-01-01', dismissed: true }),
      event('E3', { type: 'added', ...dismissedByYou }),
    ];
    expect(ids(back)).toEqual(['E3']);
  });

  it('keeps a new arrival even with a purchase on record', () => {
    // Still unread, so still highlighted and counted until you dismiss it.
    expect(
      ids([
        event('E1', { type: 'purchased', source: 'user' }),
        event('E2', { type: 'added' }),
      ]),
    ).toEqual(['E2']);
  });
});

describe('isOpenAlert', () => {
  it('treats a dropped departure as dismissed', () => {
    const none = new Set<string>();
    expect(isOpenAlert(event('E1', {}), none)).toBe(true);
    expect(isOpenAlert(event('E1', { dropped: true }), none)).toBe(false);
    const events = [event('E1', {})];
    expect(isOpenAlert(events[0], resolvedIds(events))).toBe(true);
  });
});
