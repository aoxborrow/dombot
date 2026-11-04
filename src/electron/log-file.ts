import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatWithOptions } from 'node:util';

// The desktop app's log file (Help → Show Error Log): what the main process
// warns and errors about, plus its few console.log lines, appended to
// <logs>/main.log so a user can paste the last lines into a support email.
// Packaged, the app has no terminal, so this is the only place they land.
// Every entry goes through `scrub` first: the file outlives the moment, and
// must never hold a credential.

/** Rotate past this, keeping one older file. */
export const LOG_MAX_BYTES = 2 * 1024 * 1024;
/** Stack frames kept per error: enough to place it, short enough to paste. */
const MAX_FRAMES = 8;
const MAX_CAUSES = 3;

type Level = 'INFO' | 'WARN' | 'ERROR';
const TEED = [
  ['log', 'INFO'],
  ['info', 'INFO'],
  ['warn', 'WARN'],
  ['error', 'ERROR'],
] as const;

export interface LogFileOptions {
  /** The directory (`app.getPath('logs')`); created if missing. */
  dir: string;
  /** `main` writes main.log and rotates to main.old.log. */
  name?: string;
  maxBytes?: number;
  /** Runs over each entry before it's written. */
  scrub: (text: string) => string;
  /** The console to tee; the global one by default. */
  target?: Console;
}

export interface LogFile {
  readonly path: string;
  /** Puts the console back as it was. */
  restore(): void;
}

/**
 * Tees `console.log/info/warn/error` into an append-only file: each call
 * still prints as before, and also becomes one entry: an ISO timestamp, the
 * level and the message on one line, an error's stack frames indented below.
 */
export function teeConsoleToFile(options: LogFileOptions): LogFile {
  const { dir, name = 'main', maxBytes = LOG_MAX_BYTES, scrub } = options;
  const target = options.target ?? console;
  const file = path.join(dir, `${name}.log`);
  const older = path.join(dir, `${name}.old.log`);
  const originals = new Map(TEED.map(([m]) => [m, target[m]]));
  let size = 0;
  let reported = false;
  let writing = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    size = fs.statSync(file).size;
  } catch {
    // No file yet: the first write makes it.
  }

  /** Moves the file aside to `older`; returns the size left at `file`. */
  const rotate = (): number => {
    try {
      fs.renameSync(file, older);
      return 0;
    } catch (err) {
      // Gone already (the user deleted it): the next write starts a new one.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    }
    // It couldn't be moved (on Windows, another program holding either file
    // open): start it over rather than let it grow past the limit.
    try {
      fs.truncateSync(file, 0);
      return 0;
    } catch {
      // Neither worked: keep its real size, so the next write tries again.
    }
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  };

  const write = (level: Level, args: unknown[]) => {
    // Scrubbing reads storage; nothing it logs may come back here.
    if (writing) return;
    writing = true;
    try {
      const entry = `${new Date().toISOString()} ${level} ${scrubEntry(formatArgs(args), scrub)}\n`;
      const bytes = Buffer.byteLength(entry);
      if (size > 0 && size + bytes > maxBytes) size = rotate();
      fs.appendFileSync(file, entry);
      size += bytes;
    } catch (err) {
      // Never let logging break the caller. Say so once, on stderr only.
      if (!reported) {
        reported = true;
        originals.get('error')?.call(target, `[log] can't write ${file}`, err);
      }
    } finally {
      writing = false;
    }
  };

  for (const [method, level] of TEED) {
    const original = originals.get(method)!;
    target[method] = (...args: unknown[]) => {
      original.apply(target, args);
      write(level, args);
    };
  }

  return {
    path: file,
    restore() {
      for (const [method, original] of originals) target[method] = original;
    },
  };
}

/** The args as `console` would print them, but errors as `name: message`,
 *  their causes, and a few stack frames. */
export function formatArgs(args: unknown[]): string {
  return formatWithOptions(
    { colors: false, depth: 4, breakLength: Infinity },
    ...args.map((arg) => (arg instanceof Error ? formatError(arg) : arg)),
  );
}

function formatError(error: Error): string {
  const lines = [`${error.name}: ${error.message}`];
  // A registrar error's stack is just that line (protectRegistrar drops the
  // frames); others list frames after it.
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_FRAMES);
  for (const frame of frames) lines.push(`    ${frame.trim()}`);
  // fetch's "fetch failed" says why only in its cause.
  let cause: unknown = error.cause;
  for (let i = 0; cause != null && i < MAX_CAUSES; i++) {
    lines.push(
      cause instanceof Error
        ? `    Caused by ${cause.name}: ${cause.message}`
        : `    Caused by ${String(cause)}`,
    );
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join('\n');
}

/** Scrub, then shorten the home folder to ~ (it names the user). */
function scrubEntry(text: string, scrub: (text: string) => string): string {
  const safe = scrub(text);
  const home = os.homedir();
  return home ? safe.split(home + path.sep).join(`~${path.sep}`) : safe;
}
