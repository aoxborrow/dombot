import { describe, expect, it } from 'vitest';
import {
  changeText,
  importedAutoRenewChange,
  opChange,
} from './domain-changes';

describe('opChange', () => {
  it('says what an on/off op changed, with the old value when known', () => {
    expect(
      opChange({ kind: 'autoRenew', enabled: false }, 'a.com', {
        autoRenew: true,
      }),
    ).toEqual({ setting: 'autoRenew', before: true, after: false });
    expect(opChange({ kind: 'lock', locked: true }, 'a.com', {})).toEqual({
      setting: 'lock',
      after: true,
    });
  });

  it('is null when the known value is already the new one', () => {
    expect(
      opChange({ kind: 'privacy', enabled: true }, 'a.com', { privacy: true }),
    ).toBeNull();
    expect(
      opChange(
        { kind: 'nameservers', nameservers: ['NS2.x.net.', 'ns1.x.net'] },
        'a.com',
        { nameservers: ['ns1.x.net', 'ns2.x.net'] },
      ),
    ).toBeNull();
  });

  it('stores nameservers trimmed, lowercase, without the root dot', () => {
    expect(
      opChange(
        { kind: 'nameservers', nameservers: [' NS1.New.net. '] },
        'a.com',
        { nameservers: ['ns1.old.net'] },
      ),
    ).toEqual({
      setting: 'nameservers',
      before: ['ns1.old.net'],
      after: ['ns1.new.net'],
    });
  });

  it('records forwarding cleared as an empty list', () => {
    expect(
      opChange({ kind: 'emailForwarding', forwards: [] }, 'a.com', {}),
    ).toEqual({ setting: 'emailForwarding', after: [] });
  });

  it('has nothing to say for a renewal or an auth code', () => {
    expect(opChange({ kind: 'renew', years: 1 }, 'a.com', {})).toBeNull();
    expect(opChange({ kind: 'authCode' }, 'a.com', {})).toBeNull();
  });
});

describe('importedAutoRenewChange', () => {
  it('records on and off, not a value cleared or left as it was', () => {
    expect(importedAutoRenewChange(null, true)).toEqual({
      setting: 'autoRenew',
      after: true,
    });
    expect(importedAutoRenewChange(true, false)).toEqual({
      setting: 'autoRenew',
      before: true,
      after: false,
    });
    expect(importedAutoRenewChange(true, null)).toBeNull();
    expect(importedAutoRenewChange(false, false)).toBeNull();
  });
});

describe('changeText', () => {
  it('says the setting, then old → new', () => {
    expect(
      changeText({ setting: 'autoRenew', before: true, after: false }),
    ).toBe('Auto-renew: on → off');
    expect(
      changeText({
        setting: 'nameservers',
        before: ['ns1.a.net', 'ns2.a.net'],
        after: ['ns1.b.net'],
      }),
    ).toBe('Nameservers: ns1.a.net, ns2.a.net → ns1.b.net');
  });

  it('says just the new value when the old one is unknown', () => {
    expect(changeText({ setting: 'lock', after: true })).toBe('Lock: on');
    expect(changeText({ setting: 'urlForwarding', after: [] })).toBe(
      'URL forwarding: none',
    );
  });

  it('counts DNS records rather than listing a zone', () => {
    expect(
      changeText({ setting: 'dns', after: ['A @ 1.2.3.4', 'TXT @ x'] }),
    ).toBe('DNS: 2 records');
  });

  it('is null for an event that changed no setting', () => {
    expect(changeText({})).toBeNull();
  });
});
