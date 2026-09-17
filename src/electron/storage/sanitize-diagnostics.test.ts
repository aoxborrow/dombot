import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { FsDocStore } from './fs-doc-store';
import { sanitizeStoredDiagnostics } from '../../core/storage/sanitize-diagnostics';

it('removes old plaintext diagnostic secrets without dropping cached domains', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dombot-sanitize-'));
  try {
    const store = new FsDocStore(dir);
    await store.put('credentials', 'namesilo', { apiKey: 'FAKE_OLD_SECRET' });
    await store.put('cache-portfolio', 'namesilo', {
      fetchedAt: 1,
      data: {
        domains: [{ domainName: 'example.com' }],
        lastError:
          "Request to 'https://api.example/list?key=FAKE_OLD_SECRET' failed",
      },
    });
    await store.put('bulk-jobs', 'job', {
      results: [{ message: 'Failed FAKE_OLD_SECRET' }],
    });
    await sanitizeStoredDiagnostics(store);
    const text = fs.readFileSync(
      path.join(dir, 'cache-portfolio.json'),
      'utf8',
    );
    expect(text).not.toContain('FAKE_OLD_SECRET');
    expect(text).toContain('example.com');
    expect(JSON.stringify(await store.list('bulk-jobs'))).not.toContain(
      'FAKE_OLD_SECRET',
    );
    expect(await store.get('credentials', 'namesilo')).toEqual({
      apiKey: 'FAKE_OLD_SECRET',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
