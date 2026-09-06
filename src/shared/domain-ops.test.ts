import { describe, it, expect } from 'vitest';

import {
  friendlyError,
  isApiUnsupportedMessage,
  opSummary,
  unsupportedReason,
} from './domain-ops';
import type { DomainOp, RegistrarName } from './ipc';

// A provider with every extended feature, and one with none.
const ALL = [
  'getAuthCode',
  'setDomainForwarding',
  'setEmailForwarding',
  'getDomainForwarding',
  'getEmailForwarding',
];
const NONE: string[] = [];

const ops: Record<string, DomainOp> = {
  autoOn: { kind: 'autoRenew', enabled: true },
  privacyOn: { kind: 'privacy', enabled: true },
  privacyOff: { kind: 'privacy', enabled: false },
  lock: { kind: 'lock', locked: true },
  ns: { kind: 'nameservers', nameservers: ['ns1.example.net'] },
  url: { kind: 'urlForwarding', forwards: [] },
  email: { kind: 'emailForwarding', forwards: [] },
  auth: { kind: 'authCode' },
  renew: { kind: 'renew', years: 1 },
};

describe('unsupportedReason', () => {
  it('allows every op on a fully-featured registrar with no known gaps', () => {
    for (const op of Object.values(ops)) {
      expect(unsupportedReason('dynadot', ALL, op)).toBeNull();
    }
  });

  it('gates extended-feature ops on the feature list', () => {
    expect(unsupportedReason('namecheap', NONE, ops.auth)).toMatch(/auth code/);
    expect(unsupportedReason('namecheap', NONE, ops.url)).toMatch(
      /URL forwarding/,
    );
    expect(unsupportedReason('namecheap', NONE, ops.email)).toMatch(
      /email forwarding/,
    );
    // Core ops don't need any extended feature.
    expect(unsupportedReason('namecheap', NONE, ops.autoOn)).toBeNull();
    expect(unsupportedReason('namecheap', NONE, ops.renew)).toBeNull();
  });

  it('knows Cloudflare has no post-registration update for four core ops', () => {
    for (const op of [ops.autoOn, ops.lock, ops.ns, ops.renew]) {
      expect(unsupportedReason('cloudflare', ALL, op)).toMatch(/Cloudflare/);
    }
    expect(unsupportedReason('cloudflare', ALL, ops.privacyOn)).toBeNull();
    expect(unsupportedReason('cloudflare', ALL, ops.url)).toBeNull();
  });

  it('knows Porkbun can’t change lock or privacy', () => {
    expect(unsupportedReason('porkbun', ALL, ops.lock)).toMatch(/Porkbun/);
    expect(unsupportedReason('porkbun', ALL, ops.privacyOff)).toMatch(
      /Porkbun/,
    );
    expect(unsupportedReason('porkbun', ALL, ops.autoOn)).toBeNull();
  });

  it('lets GoDaddy disable privacy but not enable it, and blocks forwarding', () => {
    expect(unsupportedReason('godaddy', ALL, ops.privacyOn)).toMatch(/GoDaddy/);
    expect(unsupportedReason('godaddy', ALL, ops.privacyOff)).toBeNull();
    expect(unsupportedReason('godaddy', ALL, ops.url)).toMatch(/customer ID/);
    expect(unsupportedReason('godaddy', ALL, ops.auth)).toBeNull();
  });

  it('checks the feature list before the gap map', () => {
    // GoDaddy without getAuthCode in its list → the feature reason wins.
    expect(unsupportedReason('godaddy', NONE, ops.auth)).toMatch(/auth code/);
  });

  it('has no gaps for registrars not in the map', () => {
    const rest: RegistrarName[] = [
      'gandi',
      'namebright',
      'namesilo',
      'spaceship',
    ];
    for (const r of rest) {
      for (const op of Object.values(ops)) {
        expect(unsupportedReason(r, ALL, op)).toBeNull();
      }
    }
  });
});

describe('opSummary', () => {
  it('phrases each op in the past tense', () => {
    expect(opSummary(ops.autoOn)).toBe('Auto-renew enabled');
    expect(opSummary(ops.privacyOff)).toBe('WHOIS privacy disabled');
    expect(opSummary(ops.lock)).toBe('Locked');
    expect(opSummary({ kind: 'lock', locked: false })).toBe('Unlocked');
    expect(opSummary(ops.ns)).toBe('Nameservers updated');
    expect(opSummary(ops.url)).toBe('URL forwarding cleared');
    expect(opSummary(ops.renew)).toBe('Renewed for 1 year');
    expect(opSummary({ kind: 'renew', years: 3 })).toBe('Renewed for 3 years');
  });
});

describe('friendlyError', () => {
  const wrapped = (body: string) =>
    `Request to 'https://api.example.com/x' failed with 400 Bad Request: ${body}`;

  it('digs the description out of a nested JSON error body', () => {
    expect(
      friendlyError(
        wrapped(
          '{"code":400,"message":"Bad Request","error":{"description":"This TLD isn\'t supported via the API."}}',
        ),
      ),
    ).toBe("This TLD isn't supported via the API.");
  });

  it('falls back to a top-level message', () => {
    expect(friendlyError(wrapped('{"message":"Domain not found"}'))).toBe(
      'Domain not found',
    );
  });

  it('returns a non-JSON body as-is', () => {
    expect(friendlyError(wrapped('Forbidden for this account'))).toBe(
      'Forbidden for this account',
    );
  });

  it('leaves messages that are not HTTP wrappers untouched', () => {
    expect(friendlyError('namecheap: example.com has no WhoisGuard')).toBe(
      'namecheap: example.com has no WhoisGuard',
    );
  });
});

describe('isApiUnsupportedMessage', () => {
  it('recognizes the registrar wording', () => {
    expect(
      isApiUnsupportedMessage("This TLD isn't supported via the API."),
    ).toBe(true);
    expect(isApiUnsupportedMessage('renewals are not yet in the API')).toBe(
      false,
    );
    expect(isApiUnsupportedMessage('Domain not found')).toBe(false);
  });
});
