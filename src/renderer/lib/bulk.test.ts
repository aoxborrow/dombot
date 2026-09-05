import { describe, it, expect } from 'vitest';

import {
  bucketSelection,
  bulkOpTitle,
  defaultFlagOp,
  resultsToCsv,
} from './bulk';
import type { BulkJob, Domain, RegistrarMeta } from '../../shared/ipc';

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

const meta = (name: RegistrarMeta['name'], features: string[] = []) =>
  ({
    name,
    displayName: name,
    supportsSandbox: false,
    configured: true,
    enabled: true,
    sync: { lastSyncedAt: null, lastError: null, domainCount: 0 },
    configFields: [],
    features,
  }) satisfies RegistrarMeta;

const registrars = [meta('dynadot', ['getAuthCode']), meta('cloudflare')];

describe('bucketSelection', () => {
  const a = domain({ domainName: 'a.com', autoRenew: true });
  const b = domain({ domainName: 'b.com', autoRenew: false });
  const c = domain({ domainName: 'c.com', registrar: 'cloudflare' });

  it('splits eligible, already-in-state, and unsupported', () => {
    const r = bucketSelection(
      [a, b, c],
      { kind: 'autoRenew', enabled: true },
      registrars,
      () => true,
    );
    expect(r.eligible.map((d) => d.domainName)).toEqual(['b.com']);
    expect(r.skipped.map((s) => s.domain.domainName)).toEqual(['a.com']);
    expect(r.unsupported[0].domain.domainName).toBe('c.com');
    expect(r.unsupported[0].reason).toMatch(/Cloudflare/);
  });

  it('only trusts privacy/lock from enriched rows', () => {
    const locked = domain({ domainName: 'l.com', locked: true });
    const enriched = bucketSelection(
      [locked],
      { kind: 'lock', locked: true },
      registrars,
      () => true,
    );
    expect(enriched.skipped).toHaveLength(1);
    const summaryOnly = bucketSelection(
      [locked],
      { kind: 'lock', locked: true },
      registrars,
      () => false,
    );
    expect(summaryOnly.eligible).toHaveLength(1);
  });

  it('treats everything as eligible until registrar metadata loads', () => {
    const r = bucketSelection([c], { kind: 'authCode' }, null, () => true);
    expect(r.eligible).toHaveLength(1);
  });
});

describe('bulkOpTitle', () => {
  it('names the op imperatively', () => {
    expect(bulkOpTitle({ kind: 'autoRenew', enabled: false })).toBe(
      'Disable auto-renew',
    );
    expect(bulkOpTitle({ kind: 'lock', locked: false })).toBe('Unlock');
    expect(bulkOpTitle({ kind: 'renew', years: 2 })).toBe('Renew for 2 years');
  });
});

describe('resultsToCsv', () => {
  it('writes one quoted row per result', () => {
    const job: BulkJob = {
      id: 'j',
      op: { kind: 'lock', locked: true },
      status: 'done',
      total: 2,
      results: [
        {
          target: { registrar: 'dynadot', domainName: 'a.com' },
          status: 'ok',
          message: 'Locked',
        },
        {
          target: { registrar: 'gandi', domainName: 'b.com' },
          status: 'failed',
          message: 'Bad, "quoted", reason',
        },
      ],
      counts: {
        ok: 1,
        failed: 1,
        unsupported: 0,
        skipped: 0,
        'rate-limited': 0,
        cancelled: 0,
      },
      startedAt: 0,
      finishedAt: 1,
    };
    expect(resultsToCsv(job)).toBe(
      [
        'Domain,Registrar,Status,Message',
        'a.com,dynadot,Done,Locked',
        'b.com,gandi,Failed,"Bad, ""quoted"", reason"',
      ].join('\r\n'),
    );
  });
});

describe('defaultFlagOp', () => {
  const on = domain({ domainName: 'on.com', autoRenew: true });
  const off = domain({ domainName: 'off.com', autoRenew: false });

  it('preselects the value that flips the majority', () => {
    expect(defaultFlagOp('autoRenew', [on, on, off])).toEqual({
      kind: 'autoRenew',
      enabled: false,
    });
    expect(defaultFlagOp('autoRenew', [on, off, off])).toEqual({
      kind: 'autoRenew',
      enabled: true,
    });
  });

  it('turns on for a tie and uses the lock field for locks', () => {
    expect(defaultFlagOp('autoRenew', [on, off])).toEqual({
      kind: 'autoRenew',
      enabled: true,
    });
    expect(
      defaultFlagOp('lock', [domain({ domainName: 'l.com', locked: true })]),
    ).toEqual({
      kind: 'lock',
      locked: false,
    });
  });
});
