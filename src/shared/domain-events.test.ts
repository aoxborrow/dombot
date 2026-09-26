import { describe, expect, it } from 'vitest';
import {
  DomainEventSource,
  DomainEventType,
  isDomainEventSource,
  isDomainEventType,
  newEventId,
} from './domain-events';

describe('domain events', () => {
  it('makes ULIDs that sort by time and never repeat', () => {
    const early = newEventId(Date.UTC(2020, 0, 1));
    const late = newEventId(Date.UTC(2026, 8, 25));
    expect(early).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(early < late).toBe(true);
    const ids = Array.from({ length: 1000 }, () => newEventId(0));
    expect(new Set(ids).size).toBe(1000);
    // Made in the same millisecond, they still sort in the order made.
    expect([...ids].sort()).toEqual(ids);
    // A clock that steps back never produces an earlier id.
    expect(newEventId(-5) > ids[ids.length - 1]).toBe(true);
  });

  it('recognizes only the defined types and sources', () => {
    expect(Object.values(DomainEventType).every(isDomainEventType)).toBe(true);
    expect(Object.values(DomainEventSource).every(isDomainEventSource)).toBe(
      true,
    );
    expect(isDomainEventType('transferred')).toBe(false);
    expect(isDomainEventSource('robot')).toBe(false);
  });
});
