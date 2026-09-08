import { describe, it, expect } from 'vitest';
import type {
  BulkJob,
  Domain,
  DomainOp,
  DomainOpResult,
} from '../../shared/ipc';
import {
  flagOf,
  flagOp,
  flagTarget,
  hasAuthCodes,
  isRetryable,
  isRiskyOp,
  resultsCsvFilename,
  resultsToCsv,
} from './bulk';

function domain(partial: Partial<Domain> & { domainName: string }): Domain {
  return {
    registrar: 'dynadot',
    status: 'active',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(0),
    deleted: false,
    ...partial,
  };
}

function job(op: DomainOp, results: DomainOpResult[]): BulkJob {
  return {
    id: 'j1',
    op,
    status: 'done',
    total: results.length,
    results,
    counts: {
      ok: 0,
      failed: 0,
      unsupported: 0,
      skipped: 0,
      'rate-limited': 0,
      cancelled: 0,
    },
    startedAt: Date.parse('2026-09-04T00:00:00Z'),
    finishedAt: Date.parse('2026-09-04T00:01:00Z'),
  };
}

const result = (
  domainName: string,
  extra: Partial<DomainOpResult> = {},
): DomainOpResult => ({
  target: { registrar: 'dynadot', domainName },
  status: 'ok',
  message: 'ok',
  ...extra,
});

describe('isRiskyOp', () => {
  it('is true for unlock, privacy-off, and renew', () => {
    expect(isRiskyOp({ kind: 'lock', locked: false })).toBe(true);
    expect(isRiskyOp({ kind: 'privacy', enabled: false })).toBe(true);
    expect(isRiskyOp({ kind: 'renew', years: 1 })).toBe(true);
  });

  it('is false for the safe direction and other ops', () => {
    expect(isRiskyOp({ kind: 'lock', locked: true })).toBe(false);
    expect(isRiskyOp({ kind: 'privacy', enabled: true })).toBe(false);
    expect(isRiskyOp({ kind: 'autoRenew', enabled: false })).toBe(false);
    expect(isRiskyOp({ kind: 'nameservers', nameservers: [] })).toBe(false);
  });
});

describe('isRetryable', () => {
  it('is true for failed, rate-limited, and cancelled', () => {
    for (const s of ['failed', 'rate-limited', 'cancelled'] as const) {
      expect(isRetryable(s)).toBe(true);
    }
  });
  it('is false for ok, skipped, and unsupported', () => {
    for (const s of ['ok', 'skipped', 'unsupported'] as const) {
      expect(isRetryable(s)).toBe(false);
    }
  });
});

describe('flag helpers', () => {
  it('flagOf reads the matching field', () => {
    const d = domain({
      domainName: 'a.com',
      autoRenew: true,
      privacy: false,
      locked: true,
    });
    expect(flagOf(d, 'autoRenew')).toBe(true);
    expect(flagOf(d, 'privacy')).toBe(false);
    expect(flagOf(d, 'lock')).toBe(true);
  });

  it('flagOp builds the right op shape per kind', () => {
    expect(flagOp('lock', true)).toEqual({ kind: 'lock', locked: true });
    expect(flagOp('autoRenew', false)).toEqual({
      kind: 'autoRenew',
      enabled: false,
    });
    expect(flagOp('privacy', true)).toEqual({ kind: 'privacy', enabled: true });
  });

  it('flagOp/flagTarget round-trip', () => {
    for (const kind of ['autoRenew', 'privacy', 'lock'] as const) {
      for (const on of [true, false]) {
        expect(flagTarget(flagOp(kind, on))).toBe(on);
      }
    }
  });

  it('flagTarget is null for a non-flag op', () => {
    expect(flagTarget({ kind: 'renew', years: 1 })).toBeNull();
    expect(flagTarget({ kind: 'nameservers', nameservers: [] })).toBeNull();
  });
});

describe('hasAuthCodes', () => {
  it('is true when any result carries an auth code', () => {
    const j = job({ kind: 'authCode' }, [
      result('a.com'),
      result('b.com', { data: { authCode: 'EPP-1' } }),
    ]);
    expect(hasAuthCodes(j)).toBe(true);
  });
  it('is false when no result carries one', () => {
    const j = job({ kind: 'authCode' }, [result('a.com')]);
    expect(hasAuthCodes(j)).toBe(false);
  });
});

describe('resultsToCsv', () => {
  it('omits the Auth code column when there are none', () => {
    const j = job({ kind: 'autoRenew', enabled: true }, [
      result('a.com', { status: 'ok', message: 'Auto-renew enabled' }),
    ]);
    const csv = resultsToCsv(j);
    const header = csv.split('\r\n')[0];
    expect(header).toBe('Domain,Registrar,Account ID,Status,Message');
    expect(header).not.toContain('Auth code');
  });

  it('adds the Auth code column and values when present', () => {
    const j = job({ kind: 'authCode' }, [
      result('a.com', { data: { authCode: 'EPP-1' } }),
      result('b.com'), // no code → blank cell
    ]);
    const lines = resultsToCsv(j).split('\r\n');
    expect(lines[0]).toBe(
      'Domain,Registrar,Account ID,Status,Message,Auth code',
    );
    expect(lines[1].endsWith(',EPP-1')).toBe(true);
    expect(lines[2].endsWith(',')).toBe(true); // blank auth-code cell
  });
});

describe('resultsCsvFilename', () => {
  it('is hyphenated, labeled by op, and dated from startedAt', () => {
    expect(
      resultsCsvFilename(job({ kind: 'autoRenew', enabled: true }, [])),
    ).toBe('dombot-bulk-auto-renew-2026-09-04.csv');
    expect(resultsCsvFilename(job({ kind: 'authCode' }, []))).toBe(
      'dombot-bulk-auth-code-2026-09-04.csv',
    );
  });
});
