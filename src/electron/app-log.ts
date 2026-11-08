import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { scrubDiagnostic } from '../core/services/stored-secrets';
import { teeConsoleToFile, type LogFile } from './log-file';

// The app's log file, at the OS's place for one: ~/Library/Logs/DomBot/main.log
// on macOS, %APPDATA%\DomBot\logs\main.log on Windows. Only the app proper
// writes it; the stdio MCP bridge (mcp/stdio.ts) is a separate process that
// logs to its client's stderr.

let log: LogFile | null = null;

const PLATFORM: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** Starts teeing the console into main.log. Call once, first thing. */
export function startAppLog(): void {
  if (log) return;
  try {
    log = teeConsoleToFile({
      dir: app.getPath('logs'),
      scrub: scrubDiagnostic,
    });
  } catch (err) {
    console.error('[log] no log file this run', err);
    return;
  }
  // Which build wrote what follows, for whoever reads the pasted lines.
  const os = PLATFORM[process.platform] ?? process.platform;
  console.log(
    `[app] DomBot ${app.getVersion()} started on ${os} ${process.getSystemVersion()} (${process.arch}), Electron ${process.versions.electron}`,
  );
}

/** Where the log file is, or null when it couldn't be started. */
export function appLogPath(): string | null {
  return log?.path ?? null;
}

/** Selects the log file in Finder / Explorer (its folder, if it's gone). */
export function showAppLog(): void {
  const file = appLogPath() ?? path.join(app.getPath('logs'), 'main.log');
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else void shell.openPath(path.dirname(file));
}
