import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../shared/domain-events';
import { importedRows } from '../../shared/imported-domains';
import {
  alertDomain,
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

describe('alertDomain', () => {
  it("opens on an imported name's own row, and builds one for a departed name", () => {
    const imported = importedRows(
      {
        'hand.com': {
          registrar: 'gandi',
          createdDate: null,
          expirationDate: null,
          autoRenew: null,
          addedAt: 1,
          updatedAt: null,
        },
      },
      [],
    );
    const arrival = event({
      domain: 'hand.com',
      type: 'added',
      source: 'user',
      accountId: null,
    });
    expect(alertDomain(arrival, imported, null)).toMatchObject({
      domainName: 'hand.com',
      registrar: 'gandi',
      source: 'imported',
    });
    expect(
      alertDomain(event({ domain: 'gone.com' }), imported, null),
    ).toMatchObject({ source: 'registrar', departed: true });
  });
});
