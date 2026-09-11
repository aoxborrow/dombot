import { describe, expect, it } from 'vitest';
import {
  isPublicIpv4,
  namecheapCredentials,
  parseNamecheapProxy,
} from './namecheap-proxy';

const values = {
  username: 'account',
  apiKey: 'api-secret',
  clientIp: '9.9.9.9',
  proxyUrl: 'http://proxy-user:proxy-secret@8.8.8.8:8080',
  proxyIp: '8.8.4.4',
};

describe('Namecheap proxy configuration', () => {
  it('is optional and preserves the direct IP when proxy settings are removed', () => {
    expect(parseNamecheapProxy({})).toBeNull();
    expect(namecheapCredentials(values, false)).toEqual({
      username: 'account',
      apiKey: 'api-secret',
      clientIp: '9.9.9.9',
    });
    expect(values.proxyUrl).toContain('proxy-secret');
    expect(namecheapCredentials(values, true)).toEqual(values);
  });
  it('normalizes a proxy independently of its outgoing IP', () => {
    expect(parseNamecheapProxy(values)).toEqual({
      url: values.proxyUrl + '/',
      ip: '8.8.4.4',
    });
    expect(
      parseNamecheapProxy({
        proxyUrl: 'http://8.8.8.8:8080',
        proxyIp: '8.8.4.4',
      }),
    ).not.toBeNull();
  });
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '192.0.2.1',
    '256.1.1.1',
    '1.2.3',
    '1.02.3.4',
  ])('rejects non-public/malformed IP %s', (ip) => {
    expect(isPublicIpv4(ip)).toBe(false);
    expect(() => parseNamecheapProxy({ ...values, proxyIp: ip })).toThrow();
  });
  it.each([
    'http://localhost:8080',
    'http://proxy.example:8080',
    'http://2130706433:8080',
    'http://0x7f000001:8080',
    'http://[::1]:8080',
    'socks5://8.8.8.8:8080',
    'https://8.8.8.8:8080',
    'http://8.8.8.8/path',
    'http://8.8.8.8?secret=x',
    'http://8.8.8.8#x',
    'http://8.8.8.8:0',
    'http://user@8.8.8.8:8080',
    'http://u:bad%0d%0a@8.8.8.8:8080',
  ])(
    'rejects unsupported proxy URL without echoing credentials',
    (proxyUrl) => {
      try {
        parseNamecheapProxy({ ...values, proxyUrl });
        throw new Error('accepted');
      } catch (error) {
        expect((error as Error).message).not.toMatch(
          /accepted|proxy-secret|bad%0d|secret=x/,
        );
      }
    },
  );
  it('rejects incomplete enablement', () => {
    expect(() => namecheapCredentials({}, true)).toThrow(/both/);
    expect(() => parseNamecheapProxy({ proxyUrl: values.proxyUrl })).toThrow(
      /both/,
    );
    expect(() => parseNamecheapProxy({ proxyIp: values.proxyIp })).toThrow(
      /both/,
    );
  });
});
