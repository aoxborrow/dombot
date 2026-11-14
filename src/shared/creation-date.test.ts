import { describe, expect, it } from 'vitest';
import { mergeDomainDetail, qualifyCreationDate } from './creation-date';
const now = Date.parse('2026-11-09T12:00:00Z');
const createdDate = new Date('2025-12-28T00:00:00Z');
const expirationDate = new Date('2027-12-28T00:00:00Z');
const valid = { createdDate, expirationDate };
describe('registrar creation dates', () => {
  it('keeps multi-year registrations and future expiry/renewal', () => {
    expect(
      qualifyCreationDate({ ...valid, renewalDate: expirationDate }, now),
    ).toEqual({ ...valid, renewalDate: expirationDate });
  });
  it.each([
    [new Date('2026-12-28T00:00:00Z'), 'future'],
    [new Date(NaN), 'invalid'],
    [new Date('2026-01-01T00:00:00Z'), 'after-expiration'],
  ] as const)(
    'suppresses an impossible creation date with reason %s',
    (value, issue) => {
      const row = {
        createdDate: value,
        expirationDate:
          issue === 'after-expiration'
            ? new Date('2025-01-01T00:00:00Z')
            : expirationDate,
      };
      expect(qualifyCreationDate(row, now)).toMatchObject({
        createdDate: null,
        createdDateIssue: issue,
        expirationDate: row.expirationDate,
      });
      expect(row.createdDate).toBe(value);
    },
  );
  it('allows date-only timezone ambiguity at midnight, with a bounded cutoff', () => {
    expect(
      qualifyCreationDate({ createdDate: new Date(now + 86400000) }, now)
        .createdDate,
    ).not.toBeNull();
    expect(
      qualifyCreationDate({ createdDate: new Date(now + 86400001) }, now)
        .createdDate,
    ).toBeNull();
  });
  it('does not reinterpret imported user dates', () => {
    const row = {
      source: 'imported' as const,
      createdDate: new Date('2027-01-01'),
    };
    expect(qualifyCreationDate(row, now)).toBe(row);
  });
  it.each([{}, { createdDate: null }, { createdDate: new Date('2026-12-28') }])(
    'keeps valid inventory when detail omits or invalidates creation',
    (detail) => {
      expect(mergeDomainDetail(valid, detail, now).createdDate).toEqual(
        createdDate,
      );
    },
  );
  it('keeps unknown with a reason when both sources are invalid', () => {
    const bad = { createdDate: new Date('2026-12-28'), expirationDate };
    expect(mergeDomainDetail(bad, bad, now)).toMatchObject({
      createdDate: null,
      createdDateIssue: 'future',
    });
  });
  it('qualifies the final combination and keeps other detail fields', () => {
    expect(
      mergeDomainDetail(
        valid,
        { expirationDate: new Date('2024-01-01'), locked: true },
        now,
      ),
    ).toMatchObject({
      createdDate: null,
      createdDateIssue: 'after-expiration',
      locked: true,
    });
  });
  it('clears an old issue when a valid provider correction arrives', () => {
    expect(
      mergeDomainDetail(
        { createdDate: null, createdDateIssue: 'future' },
        valid,
        now,
      ),
    ).not.toHaveProperty('createdDateIssue');
  });
});

it('retains verified registry creation independently of a conflicting registrar expiry', () => {
  const createdDate = new Date('2025-12-28T21:22:06Z');
  expect(
    qualifyCreationDate(
      {
        createdDate,
        expirationDate: new Date('2024-01-01'),
        createdDateSource: {
          kind: 'registry-rdap',
          url: 'https://registry.example/domain/two-year.ai',
          checkedAt: '2026-11-09T12:00:00Z',
        },
      },
      Date.parse('2026-11-09T12:00:00Z'),
    ).createdDate,
  ).toEqual(createdDate);
});
