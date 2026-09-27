import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import { ownershipByDomain } from './ownership';

let n = 0;
const event = (patch: Partial<DomainEvent>): DomainEvent => ({
  id: `E${++n}`.padStart(4, '0'),
  domain: 'a.com',
  type: 'added',
  source: 'sync',
  date: '2026-09-25',
  createdAt: n,
  updatedAt: null,
  accountId: 'dynadot',
  ...patch,
});
const owner = (events: DomainEvent[]) => ownershipByDomain(events).get('a.com');

describe('ownershipByDomain', () => {
  it('keeps a Sold name in Archive through a move and a purchase', () => {
    const sold = event({ type: 'sold', source: 'user' });
    const events = [
      sold,
      event({
        type: 'moved',
        fromAccountId: 'dynadot',
        toAccountId: 'porkbun',
      }),
      event({ type: 'purchased', source: 'import', accountId: null }),
    ];
    expect(owner(events)).toMatchObject({
      archived: true,
      label: 'sold',
      event: sold,
      lastAccountId: 'porkbun',
    });
  });

  it('brings a name back when it arrives in one of your accounts', () => {
    const events = [
      event({ type: 'dropped', source: 'user' }),
      event({ type: 'added' }),
    ];
    expect(owner(events)).toMatchObject({ archived: false, label: null });
  });
});
