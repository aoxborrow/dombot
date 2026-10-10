import { describe, it, expect } from 'vitest';
import {
  calendarDay,
  dateRangeSummary,
  matchesDateRange,
  utcDay,
  yearBounds,
  yearPreset,
} from './date-range';

describe('calendarDay', () => {
  it('keeps a YYYY-MM-DD day and rejects anything else', () => {
    expect(calendarDay('2026-01-01')).toBe('2026-01-01');
    expect(calendarDay('')).toBeNull();
    expect(calendarDay(null)).toBeNull();
    expect(calendarDay(undefined)).toBeNull();
    expect(calendarDay('2026-1-1')).toBeNull();
    expect(calendarDay('01/01/2026')).toBeNull();
  });
});

describe('utcDay', () => {
  it('uses the UTC day the table prints', () => {
    expect(utcDay(new Date('2026-01-15T00:00:00.000Z'))).toBe('2026-01-15');
    expect(utcDay('2026-01-15T23:30:00.000Z')).toBe('2026-01-15');
    expect(utcDay(null)).toBeNull();
    expect(utcDay(undefined)).toBeNull();
    expect(utcDay('')).toBeNull();
    expect(utcDay(new Date('not a date'))).toBeNull();
  });
});

describe('dateRangeSummary', () => {
  it('reads as on-or-after, on-or-before, a span, or one day', () => {
    expect(dateRangeSummary('', '')).toBeNull();
    expect(dateRangeSummary('nope', '')).toBeNull();
    expect(dateRangeSummary('2026-01-01', '')).toBe('≥ 2026-01-01');
    expect(dateRangeSummary('', '2026-12-31')).toBe('≤ 2026-12-31');
    expect(dateRangeSummary('2026-01-01', '2026-12-31')).toBe(
      '2026-01-01→2026-12-31',
    );
    expect(dateRangeSummary('2026-03-15', '2026-03-15')).toBe('= 2026-03-15');
    expect(dateRangeSummary('2026-01-01', 'nope')).toBe('≥ 2026-01-01');
  });
});

describe('matchesDateRange', () => {
  it('matches every row, including a blank date, when the filter is empty', () => {
    expect(matchesDateRange('2026-06-01', '', '')).toBe(true);
    expect(matchesDateRange(null, '', '')).toBe(true);
    expect(matchesDateRange(undefined, 'nope', '')).toBe(true);
  });

  it('keeps the ends of a span and drops a blank date', () => {
    expect(matchesDateRange('2026-01-01', '2026-01-01', '')).toBe(true);
    expect(matchesDateRange('2025-12-31', '2026-01-01', '')).toBe(false);
    expect(matchesDateRange('2026-12-31', '', '2026-12-31')).toBe(true);
    expect(matchesDateRange('2027-01-01', '', '2026-12-31')).toBe(false);
    expect(matchesDateRange('2026-01-01', '2026-01-01', '2026-12-31')).toBe(
      true,
    );
    expect(matchesDateRange('2026-12-31', '2026-01-01', '2026-12-31')).toBe(
      true,
    );
    expect(matchesDateRange('2026-06-15', '2026-06-15', '2026-06-15')).toBe(
      true,
    );
    expect(matchesDateRange('2026-06-16', '2026-06-15', '2026-06-15')).toBe(
      false,
    );
    expect(matchesDateRange(null, '2026-01-01', '')).toBe(false);
    expect(matchesDateRange('', '2026-01-01', '')).toBe(false);
    expect(matchesDateRange('not-a-date', '2026-01-01', '')).toBe(false);
  });

  it('matches nothing when From is after To', () => {
    expect(matchesDateRange('2026-06-01', '2026-12-31', '2026-01-01')).toBe(
      false,
    );
  });
});

describe('year presets', () => {
  const today = new Date(2026, 9, 9);

  it('spans the whole calendar year', () => {
    expect(yearBounds(2026)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(yearBounds(2025)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('matches This year and Last year only when both ends are that year', () => {
    expect(yearPreset('2026-01-01', '2026-12-31', today)).toBe('this');
    expect(yearPreset('2025-01-01', '2025-12-31', today)).toBe('last');
    expect(yearPreset('2026-01-01', '', today)).toBeNull();
    expect(yearPreset('2026-01-01', '2026-10-09', today)).toBeNull();
    expect(yearPreset('2024-01-01', '2024-12-31', today)).toBeNull();
  });
});
