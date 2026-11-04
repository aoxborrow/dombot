import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { CREDENTIALS_NAMESPACE } from '../core/storage/names';
import { scrubDiagnostic } from '../core/services/stored-secrets';
import { teeConsoleToFile, type LogFile } from './log-file';

const SECRET = 'FAKE_LOG_SECRET_789';

let dir: string;
let target: Console;
let log: LogFile | null = null;

function fakeConsole(): Console {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Console;
}

function read(name = 'main.log'): string {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dombot-log-'));
  target = fakeConsole();
  const disk = new MemoryDocStore();
  await disk.put(CREDENTIALS_NAMESPACE, 'acct-1', { apiKey: SECRET });
  configureStore(disk);
  await hydrateStores();
});

afterEach(() => {
  log?.restore();
  log = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('teeConsoleToFile', () => {
  it('keeps stored credentials and URL queries out of the file', () => {
    const original = target.error;
    log = teeConsoleToFile({ dir, scrub: scrubDiagnostic, target });
    const error = new Error(
      `Unauthorized for key ${SECRET} at https://api.example.com/v1/domains?api_token=QUERY_TOKEN`,
    );
    target.error('[registrars] namesilo "Main" sync failed:', error);
    target.warn(`retrying with ${encodeURIComponent(SECRET)}`);

    const text = read();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('QUERY_TOKEN');
    expect(text).toContain('https://api.example.com/v1/domains');
    expect(text).toContain('[redacted]');
    // The console still gets the call as it was.
    expect(original).toHaveBeenCalledWith(
      '[registrars] namesilo "Main" sync failed:',
      error,
    );
  });

  it('writes a timestamp and level, then the message and its stack', () => {
    log = teeConsoleToFile({ dir, scrub: (t) => t, target });
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ETIMEDOUT'), { name: 'Error' }),
    });
    target.log('[auto-sync] portfolio refreshed');
    target.error('[markets] failed', error);

    const lines = read().trimEnd().split('\n');
    expect(lines[0]).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z INFO \[auto-sync\] portfolio refreshed$/,
    );
    expect(lines[1]).toMatch(
      /Z ERROR \[markets\] failed TypeError: fetch failed$/,
    );
    expect(lines.slice(2).every((l) => l.startsWith('    '))).toBe(true);
    expect(lines.some((l) => /^ {4}at /.test(l))).toBe(true);
    expect(lines.at(-1)).toBe('    Caused by Error: connect ETIMEDOUT');
  });

  it('rotates past the size limit, keeping one older file', () => {
    log = teeConsoleToFile({ dir, scrub: (t) => t, target, maxBytes: 200 });
    for (let i = 0; i < 6; i++) target.warn(`line ${i} ${'x'.repeat(40)}`);

    expect(fs.existsSync(path.join(dir, 'main.old.log'))).toBe(true);
    expect(fs.statSync(path.join(dir, 'main.log')).size).toBeLessThanOrEqual(
      200,
    );
    expect(read()).toContain('line 5');
    expect(read('main.old.log')).not.toContain('line 5');
  });

  it('stays under the limit when the old file cannot be replaced', () => {
    // A non-empty directory in main.old.log's place makes every rename fail,
    // as another program holding the file open does on Windows.
    fs.mkdirSync(path.join(dir, 'main.old.log'));
    fs.writeFileSync(path.join(dir, 'main.old.log', 'keep'), '');
    log = teeConsoleToFile({ dir, scrub: (t) => t, target, maxBytes: 200 });
    for (let i = 0; i < 12; i++) target.warn(`line ${i} ${'x'.repeat(40)}`);

    expect(fs.statSync(path.join(dir, 'main.log')).size).toBeLessThanOrEqual(
      200,
    );
    expect(read()).toContain('line 11');
  });

  it('survives a scrubber that logs, and puts the console back', () => {
    const original = target.error;
    log = teeConsoleToFile({
      dir,
      scrub: (t) => {
        target.error('scrubbing');
        return t;
      },
      target,
    });
    target.error('once');
    expect(read().match(/ERROR/g)).toHaveLength(1);
    log.restore();
    expect(target.error).toBe(original);
  });
});
