import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import type { Domain, RegistrarMeta } from './ipc';
import {
  IMPORTED_ARCHIVE_DAYS,
  archiveRows,
  ownershipByDomain,
  removalExpiry,
  standingOf,
} from './ownership';

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

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const inDays = (days: number) => new Date(NOW + days * DAY);
const row = (patch: Partial<Domain> = {}): Domain => ({
  registrar: 'dynadot',
  domainName: 'a.com',
  status: 'active',
  createdDate: null,
  expirationDate: inDays(200),
  renewalDate: null,
  autoRenew: true,
  locked: false,
  privacy: false,
  nameservers: [],
  syncedAt: new Date(NOW),
  deleted: false,
  source: 'registrar',
  ...patch,
});

describe('ownershipByDomain', () => {
  it('keeps a sale through a move and a purchase', () => {
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
    expect(owner(events)).toEqual({
      sale: sold,
      removal: null,
      lastAccountId: 'porkbun',
    });
  });

  it('forgets the sale and the removal when the name arrives again', () => {
    const events = [
      event({ type: 'sold', source: 'user' }),
      event({ type: 'removed' }),
      event({ type: 'added' }),
    ];
    expect(owner(events)).toMatchObject({ sale: null, removal: null });
  });

  it('holds a removal until a move finds the name in another account', () => {
    const removed = event({ type: 'removed' });
    expect(owner([removed])?.removal).toBe(removed);
    expect(
      owner([
        removed,
        event({
          type: 'moved',
          fromAccountId: 'dynadot',
          toAccountId: 'porkbun',
        }),
      ])?.removal,
    ).toBeNull();
  });
});

describe('standingOf', () => {
  it('keeps every name an account holds in Owned', () => {
    const o = owner([event({ type: 'sold', source: 'user' })]);
    expect(standingOf(row(), o, false, NOW)).toEqual({
      archived: false,
      label: null,
      salePending: true,
      expiring: false,
    });
  });

  it('shows Expiring for auto-renew off within 30 days only', () => {
    const at = (days: number, autoRenew = false) =>
      standingOf(row({ expirationDate: inDays(days), autoRenew }), undefined)
        .expiring;
    expect(at(10)).toBe(true);
    expect(at(29)).toBe(true);
    expect(at(90)).toBe(false);
    expect(at(10, true)).toBe(false);
    // Past expiry is the registrar's Expired / Grace / Redemption instead.
    expect(at(-3)).toBe(false);
    expect(
      standingOf(
        row({
          source: 'imported',
          expirationDate: inDays(10),
          autoRenew: false,
          autoRenewUnknown: true,
        }),
        undefined,
        undefined,
        NOW,
      ).expiring,
    ).toBe(false);
  });

  describe('a name that left your accounts', () => {
    const departed = row({ departed: true, expirationDate: null });
    const label = (events: DomainEvent[], registered?: boolean) =>
      standingOf(departed, owner(events), registered, NOW).label;

    it('is Sold when a sale is recorded, before or after it left', () => {
      expect(
        label([
          event({ type: 'sold', source: 'user' }),
          event({ type: 'removed' }),
        ]),
      ).toBe('sold');
      expect(
        label([
          event({ type: 'removed' }),
          event({ type: 'sold', source: 'user' }),
        ]),
      ).toBe('sold');
    });

    it('is Deleted when the lookup says nobody holds it', () => {
      expect(label([event({ type: 'removed' })], false)).toBe('deleted');
      expect(label([event({ type: 'removed' })], true)).toBe('removed');
    });

    it('is Expired when it left after its expiry, Removed before', () => {
      expect(
        label([
          event({ type: 'removed', date: '2026-10-20', expires: '2026-10-01' }),
        ]),
      ).toBe('expired');
      expect(label([event({ type: 'removed', date: '2026-10-20' })])).toBe(
        'removed',
      );
    });
  });

  describe('an imported name', () => {
    const imported = (days: number) =>
      row({ source: 'imported', expirationDate: inDays(days) });

    it('moves to Archive as Sold with a sale', () => {
      expect(
        standingOf(
          imported(200),
          owner([event({ type: 'sold', source: 'user' })]),
          undefined,
          NOW,
        ),
      ).toMatchObject({ archived: true, label: 'sold' });
    });

    it(`stays in Owned until ${IMPORTED_ARCHIVE_DAYS} days past expiry`, () => {
      expect(
        standingOf(imported(-30), undefined, undefined, NOW).archived,
      ).toBe(false);
      expect(
        standingOf(imported(-IMPORTED_ARCHIVE_DAYS), undefined, undefined, NOW)
          .archived,
      ).toBe(false);
      expect(
        standingOf(
          imported(-IMPORTED_ARCHIVE_DAYS - 2),
          undefined,
          undefined,
          NOW,
        ),
      ).toMatchObject({ archived: true, label: 'expired' });
    });

    it('is Deleted sooner when the lookup says nobody holds it', () => {
      expect(standingOf(imported(-30), undefined, false, NOW)).toMatchObject({
        archived: true,
        label: 'deleted',
      });
    });
  });
});

describe('removalExpiry', () => {
  it('records the last expiry only once it has passed', () => {
    expect(removalExpiry('2026-01-01', NOW)).toEqual({ expires: '2026-01-01' });
    expect(removalExpiry('2027-01-01', NOW)).toEqual({});
    expect(removalExpiry(undefined, NOW)).toEqual({});
  });
});

describe('archiveRows', () => {
  const held = { domainName: 'held.com' } as Domain;
  const registrars = [
    { name: 'porkbun', accountId: 'pb-1', accountLabel: 'Selling' },
  ] as RegistrarMeta[];

  it('adds names that left your accounts, at their last account', () => {
    const events = [
      event({ domain: 'held.com', type: 'sold', source: 'user' }),
      event({ domain: 'gone.com', accountId: 'pb-1' }),
      event({
        domain: 'gone.com',
        type: 'removed',
        accountId: 'pb-1',
        expires: '2026-09-01',
      }),
      event({ domain: 'kept.com' }),
    ];
    const rows = archiveRows(ownershipByDomain(events), [held], registrars);
    expect(rows).toEqual([
      expect.objectContaining({
        domainName: 'gone.com',
        registrar: 'porkbun',
        accountId: 'pb-1',
        accountLabel: 'Selling',
        expirationDate: new Date('2026-09-01T00:00:00Z'),
        departed: true,
      }),
    ]);
  });
});
