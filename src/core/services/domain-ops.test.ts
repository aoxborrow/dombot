import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AbortError,
  NotImplementedError,
  OutcomeUnknownError,
  RateLimitError,
  type OperationResult,
} from '@aoxborrow/registrar-client';
import type { DomainEvent } from '../../shared/domain-events';
import type { DomainOp, DomainTarget } from '../../shared/ipc';
import type { ConfirmedRenewal } from './domain-history';

// ── Mock the registrar boundary and the window broadcast ─────────────────────
// applyDomainOp only touches these two modules; mocking them keeps Electron and
// the network out of the test entirely. The error classes above are the real
// ones so classify() sees the types it checks with instanceof.

const getRegistrarFeatures = vi.fn<(name: string) => readonly string[]>();
const setAutoRenewCached = vi.fn();
const setPrivacyCached = vi.fn();
const setLockCached = vi.fn();
const setNameserversCached = vi.fn();
const renewDomainCached = vi.fn();
const getAuthCode = vi.fn();
const getTransferOut = vi.fn();
const approveTransferOut = vi.fn();
const getDomainForwarding = vi.fn();
const setDomainForwarding = vi.fn();
const getEmailForwarding = vi.fn();
const setEmailForwarding = vi.fn();
const getCachedPortfolio = vi.fn<() => { domains: unknown[] } | null>();
const getCachedDomainDetail = vi.fn<() => Record<string, unknown> | null>(
  () => null,
);
const getDomainDetail = vi.fn();
const patchCachedDomain = vi.fn();
const getRegistrarClient = vi.fn((name: string) => {
  void name;
  return {
    provider: { getAuthCode, getTransferOut, approveTransferOut },
    getDomainForwarding,
    setDomainForwarding,
    getEmailForwarding,
    setEmailForwarding,
  };
});

vi.mock('./registrars', () => ({
  resolveDomainAccount: (registrar: string, _domain: string, id?: string) => ({
    registrar,
    id: id ?? registrar,
    label: 'Default',
  }),
  getRegistrarFeatures: (name: string) => getRegistrarFeatures(name),
  getRegistrarClient: (name: string) => getRegistrarClient(name),
  setAutoRenewCached: (...a: unknown[]) => setAutoRenewCached(...a),
  setPrivacyCached: (...a: unknown[]) => setPrivacyCached(...a),
  setLockCached: (...a: unknown[]) => setLockCached(...a),
  setNameserversCached: (...a: unknown[]) => setNameserversCached(...a),
  renewDomainCached: (...a: unknown[]) => renewDomainCached(...a),
  getCachedPortfolio: () => getCachedPortfolio(),
  getCachedDomainDetail: () => getCachedDomainDetail(),
  getDomainDetail: (...a: unknown[]) => getDomainDetail(...a),
  patchCachedDomain: (...a: unknown[]) => patchCachedDomain(...a),
}));

const broadcastPortfolioChanged = vi.fn();
vi.mock('../events', () => ({
  broadcastPortfolioChanged: () => broadcastPortfolioChanged(),
}));

const recordRenewals = vi.fn();
vi.mock('./domain-history', () => ({
  recordRenewals: (...a: unknown[]) => recordRenewals(...a),
}));

// The event log: what applyDomainOp saves, captured instead of stored.
const putEvents = vi.fn<(events: DomainEvent[]) => void>();
vi.mock('./domain-events', () => ({
  newEvent: (fields: object, now: number) => ({
    ...fields,
    id: `e${now}`,
    createdAt: now,
    updatedAt: null,
  }),
  putEvents: (events: DomainEvent[]) => putEvents(events),
}));

// Imported after the mocks are registered.
import { applyDomainOp, getTransferOut as readTransferOut } from './domain-ops';

// dynadot has no entry in KNOWN_GAPS, so with a full feature list nothing is
// gated up front — every op reaches the dispatcher.
const ALL_FEATURES = [
  'getAuthCode',
  'setDomainForwarding',
  'setEmailForwarding',
  'getTransferOut',
  'approveTransferOut',
];
const target: DomainTarget = {
  registrar: 'dynadot',
  accountId: 'dynadot',
  domainName: 'example.com',
};

const ok = (message = ''): OperationResult => ({ success: true, message });
const fail = (message = ''): OperationResult => ({ success: false, message });

beforeEach(() => {
  vi.clearAllMocks();
  getRegistrarFeatures.mockReturnValue(ALL_FEATURES);
  // Re-establish the client shape after clearAllMocks reset the factory.
  getRegistrarClient.mockReturnValue({
    provider: { getAuthCode, getTransferOut, approveTransferOut },
    getDomainForwarding,
    setDomainForwarding,
    getEmailForwarding,
    setEmailForwarding,
  });
});

describe('applyDomainOp — up-front capability gate', () => {
  it('blocks 101domain auto-renew before reaching the registrar', async () => {
    const r = await applyDomainOp(
      { registrar: '101domain', domainName: 'example.com' },
      { kind: 'autoRenew', enabled: true },
    );
    expect(r.status).toBe('unsupported');
    expect(setAutoRenewCached).not.toHaveBeenCalled();
  });
  it('keeps active nameservers unchanged when the registry accepted a pending change', async () => {
    setNameserversCached.mockResolvedValue({
      success: true,
      pending: true,
      message: 'Pending registry processing',
    });
    const r = await applyDomainOp(
      { registrar: '101domain', domainName: 'example.com' },
      { kind: 'nameservers', nameservers: ['ns1.new.net', 'ns2.new.net'] },
    );
    expect(r.status).toBe('ok');
    expect(r.message).toContain('Pending');
    expect(r.patch).toBeUndefined();
  });
  it('returns unsupported and makes no network call when the registrar lacks the feature', async () => {
    getRegistrarFeatures.mockReturnValue([]); // no getAuthCode
    const r = await applyDomainOp(target, { kind: 'authCode' });

    expect(r.status).toBe('unsupported');
    expect(r.message).toMatch(/doesn.t offer auth code/i);
    expect(getAuthCode).not.toHaveBeenCalled();
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });

  it('returns unsupported for a known core gap (Porkbun lock)', async () => {
    const r = await applyDomainOp(
      { registrar: 'porkbun', domainName: 'example.com' },
      { kind: 'lock', locked: true },
    );
    expect(r.status).toBe('unsupported');
    expect(setLockCached).not.toHaveBeenCalled();
  });
});

describe('applyDomainOp — happy paths and patches', () => {
  it('autoRenew: ok with {autoRenew} patch and a broadcast', async () => {
    setAutoRenewCached.mockResolvedValue(ok('Auto-renew enabled'));
    const r = await applyDomainOp(target, { kind: 'autoRenew', enabled: true });

    expect(r.status).toBe('ok');
    expect(r.message).toBe('Auto-renew enabled');
    expect(r.patch).toEqual({ autoRenew: true });
    expect(setAutoRenewCached).toHaveBeenCalledWith(
      'dynadot',
      'example.com',
      true,
      { signal: undefined },
      'dynadot',
    );
    expect(broadcastPortfolioChanged).toHaveBeenCalledTimes(1);
  });

  it('privacy: ok with {privacy} patch', async () => {
    setPrivacyCached.mockResolvedValue(ok());
    const r = await applyDomainOp(target, { kind: 'privacy', enabled: false });
    expect(r.status).toBe('ok');
    expect(r.patch).toEqual({ privacy: false });
  });

  it('lock: ok with {locked} patch', async () => {
    setLockCached.mockResolvedValue(ok());
    const r = await applyDomainOp(target, { kind: 'lock', locked: true });
    expect(r.status).toBe('ok');
    expect(r.patch).toEqual({ locked: true });
  });

  it('nameservers: ok with {nameservers} patch', async () => {
    setNameserversCached.mockResolvedValue(ok());
    const ns = ['ns1.example.net', 'ns2.example.net'];
    const r = await applyDomainOp(target, {
      kind: 'nameservers',
      nameservers: ns,
    });
    expect(r.status).toBe('ok');
    expect(r.patch).toEqual({ nameservers: ns });
  });

  it('falls back to opSummary when the provider message is empty', async () => {
    setAutoRenewCached.mockResolvedValue(ok(''));
    const r = await applyDomainOp(target, {
      kind: 'autoRenew',
      enabled: false,
    });
    expect(r.message).toBe('Auto-renew disabled');
  });
});

describe('applyDomainOp — silent suppresses the broadcast', () => {
  it('does not broadcast when opts.silent is set', async () => {
    setAutoRenewCached.mockResolvedValue(ok());
    const r = await applyDomainOp(
      target,
      { kind: 'autoRenew', enabled: true },
      { silent: true },
    );
    expect(r.status).toBe('ok');
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });

  it('never broadcasts on a non-ok result', async () => {
    setAutoRenewCached.mockResolvedValue(fail('nope'));
    await applyDomainOp(target, { kind: 'autoRenew', enabled: true });
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });
});

describe('applyDomainOp — soft failures', () => {
  it('maps success:false to failed with the provider message and no patch', async () => {
    setPrivacyCached.mockResolvedValue(fail('Registrar rejected it'));
    const r = await applyDomainOp(target, { kind: 'privacy', enabled: true });
    expect(r.status).toBe('failed');
    expect(r.message).toBe('Registrar rejected it');
    expect(r.patch).toBeUndefined();
  });

  it('falls back to "<summary> failed" when the failure message is empty', async () => {
    setLockCached.mockResolvedValue(fail(''));
    const r = await applyDomainOp(target, { kind: 'lock', locked: false });
    expect(r.message).toBe('Unlocked failed');
  });
});

describe('applyDomainOp — thrown error classification', () => {
  it('NotImplementedError → unsupported', async () => {
    setNameserversCached.mockRejectedValue(new NotImplementedError('nope'));
    const r = await applyDomainOp(target, {
      kind: 'nameservers',
      nameservers: ['a'],
    });
    expect(r.status).toBe('unsupported');
    expect(r.message).toBe('nope');
  });

  it('RateLimitError → rate-limited', async () => {
    setAutoRenewCached.mockRejectedValue(new RateLimitError('slow down'));
    const r = await applyDomainOp(target, { kind: 'autoRenew', enabled: true });
    expect(r.status).toBe('rate-limited');
  });

  it('AbortError → cancelled', async () => {
    setPrivacyCached.mockRejectedValue(new AbortError('aborted'));
    const r = await applyDomainOp(target, { kind: 'privacy', enabled: true });
    expect(r.status).toBe('cancelled');
  });

  it('any other error → failed, with the error message', async () => {
    setLockCached.mockRejectedValue(new Error('boom'));
    const r = await applyDomainOp(target, { kind: 'lock', locked: true });
    expect(r.status).toBe('failed');
    expect(r.message).toBe('boom');
  });

  it('non-Error throw → failed, stringified', async () => {
    setLockCached.mockRejectedValue('string failure');
    const r = await applyDomainOp(target, { kind: 'lock', locked: true });
    expect(r.status).toBe('failed');
    expect(r.message).toBe('string failure');
  });
});

describe('applyDomainOp — renew', () => {
  it('leaves retrying to registrar-client and returns the patch from renewDomainCached', async () => {
    const patch = { expirationDate: new Date('2027-01-01') };
    renewDomainCached.mockResolvedValue({ result: ok('Renewed'), patch });
    const r = await applyDomainOp(target, { kind: 'renew', years: 2 });

    expect(r.status).toBe('ok');
    expect(r.patch).toEqual(patch);
    expect(renewDomainCached).toHaveBeenCalledWith(
      'dynadot',
      'example.com',
      2,
      { signal: undefined },
      'dynadot',
    );
    expect(recordRenewals).toHaveBeenCalledWith(
      [
        {
          domainName: 'example.com',
          accountId: 'dynadot',
          years: 2,
          charge: null,
        },
      ],
      'user',
    );
  });

  it('records what the registrar charged, when it says', async () => {
    renewDomainCached.mockResolvedValue({
      result: { ...ok('Renewed'), charge: { amount: 12.5, currency: 'usd' } },
      patch: {},
    });
    await applyDomainOp(target, { kind: 'renew', years: 1 });
    expect(recordRenewals.mock.calls[0][0][0]).toMatchObject({
      charge: { amount: '12.50', currency: 'USD' },
    });
  });

  it('ignores a malformed charge rather than storing a guess', async () => {
    renewDomainCached.mockResolvedValue({
      result: { ...ok('Renewed'), charge: { amount: '-3', currency: 'USD' } },
      patch: {},
    });
    await applyDomainOp(target, { kind: 'renew', years: 1 });
    expect(recordRenewals.mock.calls[0][0][0].charge).toBeNull();
  });

  it('collects renewals for the bulk runner instead of recording each', async () => {
    renewDomainCached.mockResolvedValue({ result: ok('Renewed'), patch: {} });
    const renewals: ConfirmedRenewal[] = [];
    await applyDomainOp(target, { kind: 'renew', years: 1 }, { renewals });
    expect(renewals).toHaveLength(1);
    expect(recordRenewals).not.toHaveBeenCalled();
  });

  it('soft-fails without applying the patch', async () => {
    renewDomainCached.mockResolvedValue({
      result: fail('Payment declined'),
      patch: {},
    });
    const r = await applyDomainOp(target, { kind: 'renew', years: 1 });
    expect(r.status).toBe('failed');
    expect(r.message).toBe('Payment declined');
    expect(r.patch).toBeUndefined();
    expect(recordRenewals).not.toHaveBeenCalled();
  });
});

describe('applyDomainOp — forwarding skipIfExisting and templating', () => {
  it('skips when URL rules already exist and does not call the setter', async () => {
    getDomainForwarding.mockResolvedValue([
      { host: '@', url: 'x', type: 'permanent' },
    ]);
    const r = await applyDomainOp(target, {
      kind: 'urlForwarding',
      forwards: [{ host: '@', url: 'https://a', type: 'permanent' }],
      skipIfExisting: true,
    });
    expect(r.status).toBe('skipped');
    expect(r.message).toMatch(/Already has 1 URL forwarding rule\b/);
    expect(setDomainForwarding).not.toHaveBeenCalled();
  });

  it('expands {domain} per target in the URL when no rules exist', async () => {
    getDomainForwarding.mockResolvedValue([]);
    setDomainForwarding.mockResolvedValue(ok());
    const r = await applyDomainOp(target, {
      kind: 'urlForwarding',
      forwards: [
        { host: '@', url: 'https://{domain}/landing', type: 'permanent' },
      ],
      skipIfExisting: true,
    });
    expect(r.status).toBe('ok');
    expect(setDomainForwarding).toHaveBeenCalledWith(
      'example.com',
      [{ host: '@', url: 'https://example.com/landing', type: 'permanent' }],
      { signal: undefined },
    );
  });

  it('expands {domain} per target in the email forwardTo', async () => {
    getEmailForwarding.mockResolvedValue([]);
    setEmailForwarding.mockResolvedValue(ok());
    await applyDomainOp(target, {
      kind: 'emailForwarding',
      forwards: [{ alias: 'hi', forwardTo: 'owner@{domain}' }],
    });
    expect(setEmailForwarding).toHaveBeenCalledWith(
      'example.com',
      [{ alias: 'hi', forwardTo: 'owner@example.com' }],
      { signal: undefined },
    );
  });

  it('pluralizes the skip message correctly', async () => {
    getEmailForwarding.mockResolvedValue([{}, {}]);
    const r = await applyDomainOp(target, {
      kind: 'emailForwarding',
      forwards: [],
      skipIfExisting: true,
    });
    expect(r.message).toMatch(/Already has 2 email forwarding rules\b/);
  });
});

describe('applyDomainOp — authCode never persists', () => {
  it('returns the code in data with no patch', async () => {
    getAuthCode.mockResolvedValue('SECRET-EPP-123');
    const op: DomainOp = { kind: 'authCode' };
    const r = await applyDomainOp(target, op);

    expect(r.status).toBe('ok');
    expect(r.data).toEqual({ authCode: 'SECRET-EPP-123' });
    expect(r.patch).toBeUndefined();
  });

  it('calls no cache-writing function for an authCode op', async () => {
    getAuthCode.mockResolvedValue('SECRET');
    await applyDomainOp(target, { kind: 'authCode' });

    for (const writer of [
      setAutoRenewCached,
      setPrivacyCached,
      setLockCached,
      setNameserversCached,
      renewDomainCached,
    ]) {
      expect(writer).not.toHaveBeenCalled();
    }
  });
});

describe('applyDomainOp — a write whose outcome is unknown', () => {
  // registrar-client never re-sends such a write. Providers report it either by
  // throwing OutcomeUnknownError or by flagging the OperationResult.
  const folded: OperationResult = {
    success: false,
    outcome: 'unknown',
    message: 'may or may not have been applied',
  };
  const thrown = () =>
    new OutcomeUnknownError('may or may not have been applied', {
      feature: 'setAutoRenew',
    });

  beforeEach(() => {
    getCachedPortfolio.mockReturnValue({
      domains: [
        {
          registrar: 'dynadot',
          accountId: 'dynadot',
          domainName: 'example.com',
          expirationDate: new Date('2026-01-01'),
        },
      ],
    });
  });

  it.each([
    ['a flagged result', () => setAutoRenewCached.mockResolvedValue(folded)],
    ['a thrown error', () => setAutoRenewCached.mockRejectedValue(thrown())],
  ])(
    're-reads the domain and reports success when the change is there (%s)',
    async (_how, arrange) => {
      arrange();
      getDomainDetail.mockResolvedValue({ autoRenew: true });
      const r = await applyDomainOp(target, {
        kind: 'autoRenew',
        enabled: true,
      });
      expect(r.status).toBe('ok');
      expect(r.patch).toEqual({ autoRenew: true });
      expect(r.message).toMatch(/confirmed by re-reading/);
      expect(getDomainDetail).toHaveBeenCalledWith(
        'dynadot',
        'example.com',
        true,
        'dynadot',
      );
      expect(patchCachedDomain).toHaveBeenCalledWith(
        'dynadot',
        'example.com',
        { autoRenew: true },
        'dynadot',
      );
      expect(broadcastPortfolioChanged).toHaveBeenCalledOnce();
      expect(setAutoRenewCached).toHaveBeenCalledOnce();
    },
  );

  it('reports a harmless-to-repeat change that did not land as failed and safe to retry', async () => {
    setLockCached.mockResolvedValue(folded);
    getDomainDetail.mockResolvedValue({ locked: false });
    const r = await applyDomainOp(target, { kind: 'lock', locked: true });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/safe to try again/);
    expect(patchCachedDomain).not.toHaveBeenCalled();
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });

  it('compares nameservers as a set, ignoring case, order and a trailing dot', async () => {
    setNameserversCached.mockRejectedValue(thrown());
    getDomainDetail.mockResolvedValue({
      nameservers: ['NS2.Example.net.', 'ns1.example.net'],
    });
    const r = await applyDomainOp(target, {
      kind: 'nameservers',
      nameservers: ['ns1.example.net', 'ns2.example.net'],
    });
    expect(r.status).toBe('ok');
  });

  it('confirms a renewal only when the expiry date moved', async () => {
    renewDomainCached.mockResolvedValue({ result: folded, patch: {} });
    getDomainDetail.mockResolvedValue({
      expirationDate: new Date('2027-01-01'),
      status: 'active',
    });
    const r = await applyDomainOp(target, { kind: 'renew', years: 1 });
    expect(r.status).toBe('ok');
    expect(r.patch).toEqual({
      expirationDate: new Date('2027-01-01'),
      status: 'active',
    });
  });

  it('never calls an unmoved renewal safe to retry: it may still be processing', async () => {
    renewDomainCached.mockRejectedValue(thrown());
    getDomainDetail.mockResolvedValue({
      expirationDate: new Date('2026-01-01'),
    });
    const r = await applyDomainOp(target, { kind: 'renew', years: 1 });
    expect(r.status).toBe('unknown');
    expect(r.message).toMatch(/before renewing again/);
    expect(r.message).not.toMatch(/safe/i);
    expect(renewDomainCached).toHaveBeenCalledOnce();
    // Unknown writes nothing: sync records it once the expiry moves.
    expect(recordRenewals).not.toHaveBeenCalled();
  });

  it('stays unknown when the domain cannot be re-read or the field is missing', async () => {
    setPrivacyCached.mockResolvedValue(folded);
    getDomainDetail.mockRejectedValue(new Error('offline'));
    expect(
      (await applyDomainOp(target, { kind: 'privacy', enabled: true })).status,
    ).toBe('unknown');
    getDomainDetail.mockResolvedValue({});
    expect(
      (await applyDomainOp(target, { kind: 'privacy', enabled: true })).status,
    ).toBe('unknown');
    getDomainDetail.mockResolvedValue(null);
    const r = await applyDomainOp(target, { kind: 'privacy', enabled: true });
    expect(r.status).toBe('unknown');
    expect(r.message).toMatch(/Check the domain before trying again/);
  });

  it('does not re-read for forwarding, which has no cached field to check', async () => {
    getDomainForwarding.mockResolvedValue([]);
    setDomainForwarding.mockResolvedValue(folded);
    const r = await applyDomainOp(target, {
      kind: 'urlForwarding',
      forwards: [{ host: '@', url: 'https://example.org', type: 'permanent' }],
    } as DomainOp);
    expect(r.status).toBe('unknown');
    expect(getDomainDetail).not.toHaveBeenCalled();
  });

  it('treats a lost auth-code request as safe to repeat', async () => {
    getAuthCode.mockRejectedValue(thrown());
    const r = await applyDomainOp(target, { kind: 'authCode' });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/safe to try again/);
  });

  it('leaves an ordinary failure alone', async () => {
    setAutoRenewCached.mockResolvedValue(fail('Domain is locked'));
    const r = await applyDomainOp(target, { kind: 'autoRenew', enabled: true });
    expect(r).toMatchObject({ status: 'failed', message: 'Domain is locked' });
    expect(getDomainDetail).not.toHaveBeenCalled();
  });
});

describe('applyDomainOp — the history it writes', () => {
  const row = (fields: Record<string, unknown>) =>
    getCachedPortfolio.mockReturnValue({
      domains: [
        {
          registrar: 'dynadot',
          accountId: 'dynadot',
          domainName: 'example.com',
          autoRenew: true,
          privacy: false,
          locked: true,
          nameservers: ['ns1.old.net', 'ns2.old.net'],
          ...fields,
        },
      ],
    });
  const saved = () => putEvents.mock.calls.flatMap(([events]) => events);

  beforeEach(() => {
    getCachedPortfolio.mockReturnValue({ domains: [] });
    getCachedDomainDetail.mockReturnValue(null);
  });

  it('records a confirmed change with what the cache said before', async () => {
    row({});
    setAutoRenewCached.mockResolvedValue(ok());
    await applyDomainOp(target, { kind: 'autoRenew', enabled: false });
    expect(saved()).toEqual([
      expect.objectContaining({
        domain: 'example.com',
        type: 'changed',
        source: 'user',
        accountId: 'dynadot',
        setting: 'autoRenew',
        before: true,
        after: false,
      }),
    ]);
  });

  it('records who asked: an agent, or a bulk job collecting a slice', async () => {
    row({});
    setLockCached.mockResolvedValue(ok());
    await applyDomainOp(
      target,
      { kind: 'lock', locked: false },
      { source: 'agent' },
    );
    expect(saved()[0]).toMatchObject({ source: 'agent', setting: 'lock' });

    putEvents.mockClear();
    const changes: DomainEvent[] = [];
    await applyDomainOp(
      target,
      { kind: 'lock', locked: false },
      { source: 'bulk', changes },
    );
    expect(putEvents).not.toHaveBeenCalled();
    expect(changes).toEqual([
      expect.objectContaining({ source: 'bulk', before: true, after: false }),
    ]);
  });

  it('records nothing when the setting was already at the new value', async () => {
    row({});
    setAutoRenewCached.mockResolvedValue(ok());
    setNameserversCached.mockResolvedValue(ok());
    await applyDomainOp(target, { kind: 'autoRenew', enabled: true });
    // The same set, reordered and with a root dot.
    await applyDomainOp(target, {
      kind: 'nameservers',
      nameservers: ['NS2.old.net.', 'ns1.old.net'],
    });
    expect(putEvents).not.toHaveBeenCalled();
  });

  it('records nothing for a failure, a skip, or an outcome left unknown', async () => {
    row({});
    setAutoRenewCached.mockResolvedValue(fail('Domain is locked'));
    await applyDomainOp(target, { kind: 'autoRenew', enabled: false });
    getDomainForwarding.mockResolvedValue([
      { host: '@', url: 'x', type: 'permanent' },
    ]);
    await applyDomainOp(target, {
      kind: 'urlForwarding',
      forwards: [{ host: '@', url: 'https://a.com', type: 'permanent' }],
      skipIfExisting: true,
    });
    setDomainForwarding.mockRejectedValue(
      new OutcomeUnknownError('lost', { feature: 'setDomainForwarding' }),
    );
    await applyDomainOp(target, {
      kind: 'urlForwarding',
      forwards: [{ host: '@', url: 'https://a.com', type: 'permanent' }],
    });
    expect(putEvents).not.toHaveBeenCalled();
  });

  it('records a change the re-read confirmed', async () => {
    row({});
    setPrivacyCached.mockRejectedValue(
      new OutcomeUnknownError('lost', { feature: 'setPrivacy' }),
    );
    getDomainDetail.mockResolvedValue({ privacy: true });
    const r = await applyDomainOp(target, { kind: 'privacy', enabled: true });
    expect(r.status).toBe('ok');
    expect(saved()[0]).toMatchObject({
      setting: 'privacy',
      before: false,
      after: true,
    });
  });

  it('prefers the fetched detail, and leaves out what the list can’t vouch for', async () => {
    // A list without nameservers doesn't report privacy or lock reliably.
    row({ nameservers: [], privacy: true, autoRenew: false });
    setPrivacyCached.mockResolvedValue(ok());
    setNameserversCached.mockResolvedValue(ok());
    await applyDomainOp(target, { kind: 'privacy', enabled: false });
    expect(saved()[0]).not.toHaveProperty('before');

    putEvents.mockClear();
    getCachedDomainDetail.mockReturnValue({ nameservers: ['ns1.detail.net'] });
    await applyDomainOp(target, {
      kind: 'nameservers',
      nameservers: ['NS1.New.net'],
    });
    expect(saved()[0]).toMatchObject({
      before: ['ns1.detail.net'],
      after: ['ns1.new.net'],
    });
  });

  it('records forwarding as the rules set, with {domain} filled in', async () => {
    setDomainForwarding.mockResolvedValue(ok());
    setEmailForwarding.mockResolvedValue(ok());
    await applyDomainOp(target, {
      kind: 'urlForwarding',
      forwards: [
        { host: '@', url: 'https://{domain}.example', type: 'temporary' },
      ],
    });
    await applyDomainOp(target, {
      kind: 'emailForwarding',
      forwards: [{ alias: 'info', forwardTo: 'me+{domain}@example.net' }],
    });
    expect(saved().map((e) => [e.setting, e.before, e.after])).toEqual([
      [
        'urlForwarding',
        undefined,
        ['@ → https://example.com.example (temporary)'],
      ],
      ['emailForwarding', undefined, ['info → me+example.com@example.net']],
    ]);
  });

  it('records no change for a renewal or an auth code', async () => {
    renewDomainCached.mockResolvedValue({ result: ok('Renewed'), patch: {} });
    getAuthCode.mockResolvedValue('secret');
    await applyDomainOp(target, { kind: 'renew', years: 1 });
    await applyDomainOp(target, { kind: 'authCode' });
    expect(putEvents).not.toHaveBeenCalled();
  });

  it('still applies the write when the cache can’t be read', async () => {
    getCachedDomainDetail.mockImplementation(() => {
      throw new Error('corrupt');
    });
    setAutoRenewCached.mockResolvedValue(ok());
    const r = await applyDomainOp(target, {
      kind: 'autoRenew',
      enabled: false,
    });
    expect(r.status).toBe('ok');
    expect(saved()[0]).toMatchObject({ after: false });
    expect(saved()[0]).not.toHaveProperty('before');
  });
});

describe('applyDomainOp — approveTransfer', () => {
  it('approves through the provider: no patch, no history', async () => {
    approveTransferOut.mockResolvedValue(
      ok('Transfer of example.com approved'),
    );
    const r = await applyDomainOp(target, { kind: 'approveTransfer' });
    expect(approveTransferOut).toHaveBeenCalledWith(
      'example.com',
      expect.anything(),
    );
    expect(r).toMatchObject({
      status: 'ok',
      message: 'Transfer of example.com approved',
    });
    expect(r.patch).toBeUndefined();
    expect(putEvents).not.toHaveBeenCalled();
    expect(broadcastPortfolioChanged).toHaveBeenCalled();
  });

  it('keeps the registrar’s refusal', async () => {
    approveTransferOut.mockResolvedValue(
      fail('No transfer-out of example.com to answer'),
    );
    const r = await applyDomainOp(target, { kind: 'approveTransfer' });
    expect(r).toMatchObject({
      status: 'failed',
      message: 'No transfer-out of example.com to answer',
    });
  });

  it('is unsupported, with no call, where the registrar can’t approve', async () => {
    getRegistrarFeatures.mockReturnValue(['getAuthCode']);
    const r = await applyDomainOp(target, { kind: 'approveTransfer' });
    expect(r.status).toBe('unsupported');
    expect(r.message).toMatch(/doesn.t offer transfer approval/i);
    expect(approveTransferOut).not.toHaveBeenCalled();
  });

  it('treats a lost approval as safe to repeat', async () => {
    approveTransferOut.mockRejectedValue(
      new OutcomeUnknownError('may or may not have been applied', {
        feature: 'approveTransferOut',
      }),
    );
    const r = await applyDomainOp(target, { kind: 'approveTransfer' });
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/safe to try again/);
    expect(getDomainDetail).not.toHaveBeenCalled();
  });
});

describe('getTransferOut', () => {
  it('reads the provider’s transfer-out with ISO dates', async () => {
    getTransferOut.mockResolvedValue({
      status: 'pending',
      rawStatus: 'Waiting For Approval',
      id: '423',
      requestedDate: new Date('2026-10-29T12:00:00Z'),
      expirationDate: new Date('2026-11-03T12:00:00Z'),
      completedDate: null,
    });
    expect(await readTransferOut(target)).toEqual({
      status: 'pending',
      rawStatus: 'Waiting For Approval',
      requestedAt: '2026-10-29T12:00:00.000Z',
      expiresAt: '2026-11-03T12:00:00.000Z',
      completedAt: null,
    });
    expect(getTransferOut).toHaveBeenCalledWith('example.com', {});
  });

  it('is null when the registrar has none', async () => {
    getTransferOut.mockResolvedValue(null);
    expect(await readTransferOut(target)).toBeNull();
  });

  it('throws, with no call, where the registrar can’t report one', async () => {
    getRegistrarFeatures.mockReturnValue(['getAuthCode']);
    await expect(readTransferOut(target)).rejects.toThrow(
      /doesn.t report transfers out/,
    );
    expect(getTransferOut).not.toHaveBeenCalled();
  });
});
