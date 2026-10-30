import { describe, expect, it } from 'vitest';
import { changeEvent } from './domain-changes';
import { cleanEvent } from './domain-events';

describe('changed events in a data bundle', () => {
  const event = changeEvent(
    'Example.com',
    { setting: 'nameservers', before: ['ns1.a.net'], after: ['ns1.b.net'] },
    'agent',
    { accountId: 'dynadot' },
    Date.parse('2026-10-29T12:00:00Z'),
  );

  it('keeps a well-formed one as it is', () => {
    expect(event).toMatchObject({
      domain: 'example.com',
      type: 'changed',
      source: 'agent',
      accountId: 'dynadot',
    });
    expect(cleanEvent(event.id, event)).toEqual(event);
  });

  it('drops one without its setting or new value, or with a malformed one', () => {
    const without = (key: string) => {
      const copy: Record<string, unknown> = { ...event };
      delete copy[key];
      return copy;
    };
    expect(cleanEvent(event.id, without('setting'))).toBeNull();
    expect(cleanEvent(event.id, without('after'))).toBeNull();
    expect(cleanEvent(event.id, { ...event, setting: 'color' })).toBeNull();
    expect(cleanEvent(event.id, { ...event, before: [1, 2] })).toBeNull();
    expect(cleanEvent(event.id, { ...event, after: 'on' })).toBeNull();
  });
});
