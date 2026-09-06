import { describe, expect, it } from 'vitest';
import {
  SealError,
  isSealedBundle,
  openBundle,
  sealBundle,
} from './bundle-seal';

const PLAIN = JSON.stringify({
  format: 'dombot-data',
  version: 1,
  exportedAt: '2026-09-06T00:00:00.000Z',
  namespaces: { credentials: { godaddy: { apiKey: 'k', apiSecret: 's' } } },
});

describe('bundle sealing', () => {
  it('seals, keeps the header, and opens with the right passphrase', async () => {
    const sealed = await sealBundle(PLAIN, 'hunter2');
    expect(sealed).not.toContain('apiKey');
    expect(JSON.parse(sealed)).toMatchObject({
      format: 'dombot-data',
      version: 1,
      exportedAt: '2026-09-06T00:00:00.000Z',
      encrypted: { kdf: 'PBKDF2-SHA256', alg: 'AES-256-GCM' },
    });
    expect(isSealedBundle(sealed)).toBe(true);
    expect(isSealedBundle(PLAIN)).toBe(false);
    expect(isSealedBundle('nope')).toBe(false);
    expect(await openBundle(sealed, 'hunter2')).toBe(PLAIN);
  });

  it('refuses the wrong passphrase, none, and non-sealed input', async () => {
    const sealed = await sealBundle(PLAIN, 'hunter2');
    await expect(openBundle(sealed, 'nope')).rejects.toThrow(
      /Wrong passphrase/,
    );
    await expect(openBundle(sealed, '')).rejects.toThrow(
      /needs its passphrase/,
    );
    await expect(openBundle(PLAIN, 'x')).rejects.toBeInstanceOf(SealError);
    await expect(openBundle('not json', 'x')).rejects.toThrow(/invalid JSON/);
    const tampered = JSON.parse(sealed) as { encrypted: { alg: string } };
    tampered.encrypted.alg = 'ROT13';
    await expect(
      openBundle(JSON.stringify(tampered), 'hunter2'),
    ).rejects.toThrow(/Unsupported/);
  });
});
