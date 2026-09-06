import { describe, expect, it } from 'vitest';
import { MemoryDocStore } from './doc-store';
import { EncryptedDocStore, aesGcmCipher, type Cipher } from './encrypted';

const key = () => crypto.getRandomValues(new Uint8Array(32));

describe('aesGcmCipher', () => {
  it('round-trips and uses a fresh IV per seal', async () => {
    const c = await aesGcmCipher(key());
    const a = await c.seal('hello');
    const b = await c.seal('hello');
    expect(a).not.toBe(b);
    expect(await c.open(a)).toBe('hello');
    expect(await c.open(b)).toBe('hello');
  });

  it('rejects a wrong key and a tampered ciphertext', async () => {
    const c1 = await aesGcmCipher(key());
    const c2 = await aesGcmCipher(key());
    const sealed = await c1.seal('secret');
    await expect(c2.open(sealed)).rejects.toThrow();
    const bytes = Uint8Array.from(atob(sealed), (ch) => ch.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(c1.open(tampered)).rejects.toThrow();
  });

  it('requires a 32-byte key', async () => {
    await expect(aesGcmCipher(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });
});

describe('EncryptedDocStore', () => {
  it('stores ciphertext in the inner store and opens it on read', async () => {
    const inner = new MemoryDocStore();
    const store = new EncryptedDocStore(inner, await aesGcmCipher(key()));
    await store.put('creds', 'dynadot', { apiKey: 'k1' });

    const raw = (await inner.get('creds', 'dynadot')) as Record<
      string,
      unknown
    >;
    expect(raw.__sealed).toBe(1);
    expect(raw.alg).toBe('aes-gcm');
    expect(JSON.stringify(raw)).not.toContain('k1');

    expect(await store.get('creds', 'dynadot')).toEqual({ apiKey: 'k1' });
    expect(await store.list('creds')).toEqual({ dynadot: { apiKey: 'k1' } });
  });

  it('seals only the chosen namespaces', async () => {
    const inner = new MemoryDocStore();
    const store = new EncryptedDocStore(
      inner,
      await aesGcmCipher(key()),
      new Set(['creds']),
    );
    await store.put('creds', 'a', 'secret');
    await store.put('settings', 'a', 'plain');
    expect(await inner.get('settings', 'a')).toBe('plain');
    expect(((await inner.get('creds', 'a')) as { __sealed: 1 }).__sealed).toBe(
      1,
    );
    expect(await store.get('creds', 'a')).toBe('secret');
  });

  it('passes a legacy unsealed value through on read', async () => {
    const inner = new MemoryDocStore();
    await inner.put('creds', 'old', { apiKey: 'legacy' });
    const store = new EncryptedDocStore(inner, await aesGcmCipher(key()));
    expect(await store.get('creds', 'old')).toEqual({ apiKey: 'legacy' });
  });

  it('propagates a cipher failure from put', async () => {
    const refusing: Cipher = {
      alg: 'none',
      seal: async () => {
        throw new Error('no keyring');
      },
      open: async (s) => s,
    };
    const store = new EncryptedDocStore(new MemoryDocStore(), refusing);
    await expect(store.put('creds', 'x', {})).rejects.toThrow('no keyring');
  });
});
