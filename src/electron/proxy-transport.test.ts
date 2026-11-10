import { describe, expect, it } from 'vitest';
import { bodyBytes, framedHeaders } from './proxy-transport';

describe('framedHeaders', () => {
  it('frames a body with Content-Length, never chunked', async () => {
    const payload = await bodyBytes(JSON.stringify({ name: 'café' }));
    const headers = framedHeaders(
      { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      'POST',
      payload,
    );
    expect(headers['content-length']).toBe(String(payload!.byteLength));
    expect(payload!.byteLength).toBe(16); // é is two bytes
    expect(headers['transfer-encoding']).toBeUndefined();
    expect(headers['content-type']).toBe('application/json');
  });

  it('sends Content-Length 0 on a bodyless write and none on a read', () => {
    expect(framedHeaders({}, 'POST', undefined)['content-length']).toBe('0');
    expect(framedHeaders({}, 'DELETE', undefined)['content-length']).toBe(
      undefined,
    );
    expect(
      framedHeaders({ 'content-length': '9' }, 'GET', undefined)[
        'content-length'
      ],
    ).toBeUndefined();
  });
});

describe('bodyBytes', () => {
  it('reads every body form instead of dropping non-strings', async () => {
    expect(await bodyBytes(undefined)).toBeUndefined();
    expect((await bodyBytes('a=1'))!.toString()).toBe('a=1');
    expect((await bodyBytes(new URLSearchParams({ a: '1' })))!.toString()).toBe(
      'a=1',
    );
    expect((await bodyBytes(new TextEncoder().encode('xyz')))!.toString()).toBe(
      'xyz',
    );
  });
});
