import { describe, expect, it } from 'vitest';
import { nameserversFromDnsJson, resolveNameservers } from './dns';

const answer = (data: string[], type = 2) => ({
  Status: 0,
  Answer: data.map((d) => ({ type, data: d })),
});

describe('nameserversFromDnsJson', () => {
  it('lowercases, strips the trailing dot, and keeps only NS records', () => {
    expect(
      nameserversFromDnsJson({
        Status: 0,
        Answer: [
          { type: 2, data: 'NS1.Example.COM.' },
          { type: 2, data: 'ns2.example.com' },
          { type: 1, data: '1.2.3.4' },
        ],
      }),
    ).toEqual(['ns1.example.com', 'ns2.example.com']);
  });

  it('is empty for NXDOMAIN or a missing answer', () => {
    expect(nameserversFromDnsJson({ Status: 3 })).toEqual([]);
    expect(nameserversFromDnsJson({ Status: 0 })).toEqual([]);
  });
});

describe('resolveNameservers', () => {
  const respond = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response;

  it('asks Cloudflare first and returns its answer', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return respond(answer(['ns1.dyna-ns.net.']));
    }) as typeof fetch;
    expect(await resolveNameservers('example.com', fetchImpl)).toEqual([
      'ns1.dyna-ns.net',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('cloudflare-dns.com');
    expect(calls[0]).toContain('name=example.com&type=NS');
  });

  it('falls back to the next resolver on failure', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) throw new Error('timeout');
      return respond(answer(['a.ns.']));
    }) as typeof fetch;
    expect(await resolveNameservers('example.com', fetchImpl)).toEqual([
      'a.ns',
    ]);
    expect(n).toBe(2);
  });

  it('accepts a clean empty answer without retrying', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return respond({ Status: 3 });
    }) as typeof fetch;
    expect(await resolveNameservers('nope.invalid', fetchImpl)).toEqual([]);
    expect(n).toBe(1);
  });

  it('returns [] when every resolver fails', async () => {
    const fetchImpl = (async () => respond({}, false)) as typeof fetch;
    expect(await resolveNameservers('example.com', fetchImpl)).toEqual([]);
  });
});
