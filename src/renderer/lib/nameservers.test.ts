import { describe, it, expect } from 'vitest';

import { nameserverGroup } from './nameservers';

describe('nameserverGroup', () => {
  it('groups a hostname by its registrable base domain', () => {
    expect(nameserverGroup('ns-220-a.gandi.net')).toEqual({
      key: 'gandi.net',
      label: 'gandi.net',
    });
  });

  it('resolves multi-part public suffixes', () => {
    expect(nameserverGroup('n.a.b.3.host.co.uk')).toEqual({
      key: 'host.co.uk',
      label: 'host.co.uk',
    });
  });

  it('trims and lowercases the input', () => {
    expect(nameserverGroup('  NS1.EXAMPLE.COM  ')).toEqual({
      key: 'example.com',
      label: 'example.com',
    });
  });

  it('splits Afternic nameservers into consecutive pairs', () => {
    expect(nameserverGroup('ns1.afternic.com')).toEqual({
      key: 'afternic.com#1',
      label: 'afternic.com (ns1/ns2)',
    });
    expect(nameserverGroup('ns2.afternic.com')).toEqual({
      key: 'afternic.com#1',
      label: 'afternic.com (ns1/ns2)',
    });
    expect(nameserverGroup('ns4.afternic.com')).toEqual({
      key: 'afternic.com#2',
      label: 'afternic.com (ns3/ns4)',
    });
  });

  it('falls back to the base domain when Afternic host lacks an nsN label', () => {
    expect(nameserverGroup('mail.afternic.com')).toEqual({
      key: 'afternic.com',
      label: 'afternic.com',
    });
  });

  it('returns null for empty or unparseable values', () => {
    expect(nameserverGroup('')).toBeNull();
    expect(nameserverGroup('   ')).toBeNull();
    expect(nameserverGroup('192.168.1.1')).toBeNull();
  });
});
