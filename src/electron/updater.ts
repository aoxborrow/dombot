import { app, autoUpdater } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UpdaterState } from '../shared/ipc';

// Update-on-click for the desktop app, with Electron's built-in autoUpdater
// (Squirrel.Mac / Squirrel.Windows) fed by update.electronjs.org, which serves
// this public repository's GitHub releases. Nothing happens in the background:
// the release feed (src/core/services/releases.ts) is what notices a newer
// version, and only the user's "Update" click downloads it. Once downloaded,
// "Restart to update" swaps it in.
//
// The release workflow attaches what the feed needs: the macOS .zip builds
// (named DomBot-darwin-<arch>-<version>.zip) and Squirrel's RELEASES file and
// .nupkg for Windows. Linux packages have no updater; they keep the plain
// download link.

// DOMBOT_UPDATE_FEED_URL points a packaged build at another feed (a local
// server returning Squirrel's JSON), to rehearse an update before a release.
const FEED =
  process.env.DOMBOT_UPDATE_FEED_URL ||
  `https://update.electronjs.org/aoxborrow/dombot/${process.platform}-${process.arch}/${app.getVersion()}`;

let state: Omit<UpdaterState, 'supported' | 'unsupportedReason'> = {
  status: 'idle',
  error: null,
};
let wired = false;
let pending: ((s: UpdaterState) => void)[] = [];

/** Why this build can't update itself: null when it can, '' for a dev
 *  build (not worth a message), else a sentence for the user. */
function unsupportedReason(): string | null {
  if (!app.isPackaged) return '';
  if (process.platform === 'darwin') {
    // Squirrel.Mac replaces the .app where it is; run from the disk image or a
    // quarantined location, that fails.
    return app.isInApplicationsFolder()
      ? null
      : 'Move DomBot to your Applications folder to update it in place.';
  }
  if (process.platform === 'win32') {
    // Squirrel.Windows installs keep Update.exe one level above the app.
    return existsSync(join(dirname(process.execPath), '..', 'Update.exe'))
      ? null
      : 'This copy wasn’t installed with the DomBot installer.';
  }
  return 'Linux packages update through a new download.';
}

function settle(next: Partial<typeof state>): void {
  state = { ...state, ...next };
  if (state.status === 'downloading') return;
  const waiting = pending;
  pending = [];
  for (const resolve of waiting) resolve(getUpdaterState());
}

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.setFeedURL({ url: FEED });
  autoUpdater.on('update-downloaded', () =>
    settle({ status: 'ready', error: null }),
  );
  autoUpdater.on('update-not-available', () =>
    settle({
      status: 'error',
      error: 'No newer build is published for this platform yet.',
    }),
  );
  autoUpdater.on('error', (err) =>
    settle({ status: 'error', error: err?.message || String(err) }),
  );
}

export function getUpdaterState(): UpdaterState {
  const reason = unsupportedReason();
  return {
    ...state,
    supported: reason === null,
    unsupportedReason: reason || null,
  };
}

/** Downloads the newest release; resolves when it's ready to install (or
 *  failed). A second call while downloading waits on the same download. */
export function downloadUpdate(): Promise<UpdaterState> {
  const current = getUpdaterState();
  if (!current.supported || state.status === 'ready')
    return Promise.resolve(current);
  const done = new Promise<UpdaterState>((resolve) => pending.push(resolve));
  if (state.status !== 'downloading') {
    wire();
    state = { ...state, status: 'downloading', error: null };
    // Squirrel checks the feed and, when there's an update, downloads it;
    // the events above report the outcome.
    autoUpdater.checkForUpdates();
  }
  return done;
}

/** Quits and relaunches into the downloaded version. */
export function installUpdate(): void {
  if (state.status !== 'ready') throw new Error('No update is ready yet.');
  autoUpdater.quitAndInstall();
}
