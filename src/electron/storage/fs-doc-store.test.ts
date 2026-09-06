import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsDocStore } from './fs-doc-store';
import { migrateLegacyCredentials } from './migrate';
import { MemoryDocStore } from '../../core/storage/doc-store';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dombot-fs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FsDocStore', () => {
  it('keeps one {key: value} JSON file per namespace', async () => {
    const store = new FsDocStore(dir);
    await store.put('settings', 'autoSyncIntervalMinutes', 60);
    await store.put('settings', 'recentNameservers', [['ns1.x', 'ns2.x']]);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'),
    );
    expect(onDisk).toEqual({
      autoSyncIntervalMinutes: 60,
      recentNameservers: [['ns1.x', 'ns2.x']],
    });
    expect(await store.get('settings', 'autoSyncIntervalMinutes')).toBe(60);
    expect(await store.list('settings')).toEqual(onDisk);

    await store.delete('settings', 'recentNameservers');
    expect(await store.list('settings')).toEqual({
      autoSyncIntervalMinutes: 60,
    });
    await store.clear('settings');
    expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(false);
    expect(await store.list('settings')).toEqual({});
  });

  it('reads the pre-DocStore files unchanged', async () => {
    // Exactly what the old modules wrote.
    fs.writeFileSync(
      path.join(dir, 'folders.json'),
      JSON.stringify({
        folders: [{ id: 'f1', name: 'Keep' }],
        assignments: { 'dynadot:a.com': 'f1' },
      }),
    );
    fs.writeFileSync(
      path.join(dir, 'cache-portfolio.json'),
      JSON.stringify({ dynadot: { data: { domains: [] }, fetchedAt: 1 } }),
    );
    fs.writeFileSync(
      path.join(dir, 'registrar-state.json'),
      JSON.stringify({ disabled: ['gandi'] }),
    );
    const store = new FsDocStore(dir);
    expect(await store.get('folders', 'folders')).toEqual([
      { id: 'f1', name: 'Keep' },
    ]);
    expect(await store.get('folders', 'assignments')).toEqual({
      'dynadot:a.com': 'f1',
    });
    expect(await store.get('cache-portfolio', 'dynadot')).toEqual({
      data: { domains: [] },
      fetchedAt: 1,
    });
    expect(await store.get('registrar-state', 'disabled')).toEqual(['gandi']);
  });

  it('treats a missing or corrupt file as empty', async () => {
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const store = new FsDocStore(dir);
    expect(await store.list('bad')).toEqual({});
    expect(await store.list('missing')).toEqual({});
  });

  it('writes files owner-only and leaves no temp file behind', async () => {
    const store = new FsDocStore(dir);
    await store.put('creds', 'k', 'v');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(dir, 'creds.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    expect(fs.readdirSync(dir)).toEqual(['creds.json']);
  });
});

describe('migrateLegacyCredentials', () => {
  const noDecrypt = { decrypt: () => null };

  it('is a no-op without a legacy file', async () => {
    const store = new MemoryDocStore();
    expect(await migrateLegacyCredentials(dir, store, noDecrypt)).toBe(true);
    expect(await store.list('credentials')).toEqual({});
  });

  it('imports a plaintext legacy blob and renames it', async () => {
    const legacy = path.join(dir, 'credentials.dat');
    fs.writeFileSync(
      legacy,
      JSON.stringify({ dynadot: { apiKey: 'k' }, empty: {} }),
    );
    const store = new MemoryDocStore();
    expect(await migrateLegacyCredentials(dir, store, noDecrypt)).toBe(true);
    expect(await store.list('credentials')).toEqual({
      dynadot: { apiKey: 'k' },
    });
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(`${legacy}.pre-v1.bak`)).toBe(true);
  });

  it('decrypts an encrypted legacy blob through the reader', async () => {
    const legacy = path.join(dir, 'credentials.dat');
    fs.writeFileSync(legacy, Buffer.from([0x01, 0x02, 0xff]));
    const store = new MemoryDocStore();
    const reader = {
      decrypt: (b: Buffer) =>
        b[0] === 0x01 ? JSON.stringify({ gandi: { token: 't' } }) : null,
    };
    expect(await migrateLegacyCredentials(dir, store, reader)).toBe(true);
    expect(await store.get('credentials', 'gandi')).toEqual({ token: 't' });
  });

  it('leaves an unreadable blob in place to retry later', async () => {
    const legacy = path.join(dir, 'credentials.dat');
    fs.writeFileSync(legacy, Buffer.from([0x00, 0xff]));
    const store = new MemoryDocStore();
    expect(await migrateLegacyCredentials(dir, store, noDecrypt)).toBe(false);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(await store.list('credentials')).toEqual({});
  });
});
