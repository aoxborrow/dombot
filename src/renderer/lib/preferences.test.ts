import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferences } from './preferences';

describe('parsePreferences', () => {
  it('returns the defaults for missing or corrupt storage', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{nope')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('"a string"')).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid values', () => {
    const stored = {
      pageSize: 250,
      sortKey: 'expirationDate',
      sortDir: 'desc',
      density: 'compact',
    };
    expect(parsePreferences(JSON.stringify(stored))).toEqual({
      ...stored,
      columnLayouts: {},
    });
  });

  it('falls back per field, keeping the valid ones', () => {
    const stored = { pageSize: 7, sortKey: 'renewal', sortDir: 'sideways' };
    expect(parsePreferences(JSON.stringify(stored))).toEqual({
      pageSize: DEFAULT_PREFERENCES.pageSize,
      sortKey: 'renewal',
      sortDir: DEFAULT_PREFERENCES.sortDir,
      density: DEFAULT_PREFERENCES.density,
      columnLayouts: {},
    });
  });

  it('keeps column layouts shaped like one and drops the rest', () => {
    const layout = {
      order: ['domainName', 'registrar'],
      hidden: ['registrar'],
    };
    const stored = {
      columnLayouts: {
        'domains.owned': layout,
        'domains.archive': { order: 'nope', hidden: [] },
        other: { order: [1], hidden: [] },
      },
    };
    expect(parsePreferences(JSON.stringify(stored)).columnLayouts).toEqual({
      'domains.owned': layout,
    });
    expect(
      parsePreferences(JSON.stringify({ columnLayouts: [layout] }))
        .columnLayouts,
    ).toEqual({});
  });

  it('carries a layout saved before Active was renamed Owned', () => {
    const layout = { order: ['domainName'], hidden: [] };
    const other = { order: ['domainName', 'registrar'], hidden: [] };
    expect(
      parsePreferences(
        JSON.stringify({ columnLayouts: { 'domains.active': layout } }),
      ).columnLayouts,
    ).toEqual({ 'domains.owned': layout });
    // A layout saved under the new name wins.
    expect(
      parsePreferences(
        JSON.stringify({
          columnLayouts: { 'domains.active': layout, 'domains.owned': other },
        }),
      ).columnLayouts,
    ).toEqual({ 'domains.owned': other });
  });
});
