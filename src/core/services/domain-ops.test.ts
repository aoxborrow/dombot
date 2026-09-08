import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AbortError,
  NotImplementedError,
  RateLimitError,
  type OperationResult,
} from '@aoxborrow/registrar-client';
import type { DomainOp, DomainTarget } from '../../shared/ipc';

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
const getDomainForwarding = vi.fn();
const setDomainForwarding = vi.fn();
const getEmailForwarding = vi.fn();
const setEmailForwarding = vi.fn();
const getRegistrarClient = vi.fn((name: string) => {
  void name;
  return {
    provider: { getAuthCode },
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
}));

const broadcastPortfolioChanged = vi.fn();
vi.mock('../events', () => ({
  broadcastPortfolioChanged: () => broadcastPortfolioChanged(),
}));

// Imported after the mocks are registered.
import { applyDomainOp } from './domain-ops';

// dynadot has no entry in KNOWN_GAPS, so with a full feature list nothing is
// gated up front — every op reaches the dispatcher.
const ALL_FEATURES = [
  'getAuthCode',
  'setDomainForwarding',
  'setEmailForwarding',
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
    provider: { getAuthCode },
    getDomainForwarding,
    setDomainForwarding,
    getEmailForwarding,
    setEmailForwarding,
  });
});

describe('applyDomainOp — up-front capability gate', () => {
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
  it('passes retries:0 and returns the patch from renewDomainCached', async () => {
    const patch = { expirationDate: new Date('2027-01-01') };
    renewDomainCached.mockResolvedValue({ result: ok('Renewed'), patch });
    const r = await applyDomainOp(target, { kind: 'renew', years: 2 });

    expect(r.status).toBe('ok');
    expect(r.patch).toEqual(patch);
    expect(renewDomainCached).toHaveBeenCalledWith(
      'dynadot',
      'example.com',
      2,
      {
        signal: undefined,
        retries: 0,
      },
      'dynadot',
    );
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
