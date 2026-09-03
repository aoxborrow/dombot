import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc';
import { startMcpServer, stopMcpServer } from './mcp/server';
import { isStdioShimMode, runStdioShim } from './mcp/stdio';
import { startAutoSync, stopAutoSync } from './services/auto-sync';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Whether the renderer is served from the Vite dev server (hot reload) rather
// than the packaged file:// bundle. Dev needs a looser CSP for HMR (inline
// scripts, eval for React Fast Refresh, a websocket back to the dev server);
// the shipped app gets the strict policy.
const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

/**
 * Content-Security-Policy for the renderer. The renderer makes no network
 * requests of its own — every registrar call goes out from the main process,
 * and the UI reaches main only through the typed preload bridge — so the
 * shipped policy keeps everything same-origin: no remote scripts, styles,
 * images, or connections can load, which is the point a security-conscious
 * user can verify. `style-src` allows inline styles because React/Radix set
 * them on elements; scripts stay strict `'self'` (the Vite module-preload
 * polyfill that would need an inline script is disabled in the renderer build).
 */
function contentSecurityPolicy(): string {
  const directives = isDev
    ? [
        "default-src 'self'",
        // Dev server injects inline scripts; React Fast Refresh uses eval.
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        // HMR websocket + dev-server fetches over http/ws to localhost.
        "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
      ]
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "frame-ancestors 'none'",
      ];
  return directives.join('; ');
}

/**
 * Renderer hardening applied once on startup:
 *  - Injects the CSP above on every response (covers the dev-server http
 *    responses and the packaged file:// bundle alike).
 *  - Blocks the renderer from navigating anywhere but its own app content, and
 *    routes any window.open / target=_blank to the user's real browser instead
 *    of opening an in-app window. A compromised renderer or dependency can't
 *    steer the app to an attacker page or pop up its own chrome.
 */
function hardenRenderer(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });
}

/** The origins the renderer is allowed to sit on: the dev server, or file://. */
function isAllowedNavigation(target: string): boolean {
  if (isDev && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return target.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  }
  return target.startsWith('file://');
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    // Paint the window with the app's dark background from the first frame so
    // there's no white flash before the renderer loads. The UI is forced to
    // dark (see renderer theme-provider), and this matches its `--background`
    // (oklch(0.145 0 0)). Also defer showing until the content is ready.
    backgroundColor: '#0a0a0a',
    show: false,
    // Hide the native File/Edit/View menu bar on Windows/Linux (Alt won't
    // reveal it — see removeMenu below). macOS keeps its standard app menu.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security defaults: keep the renderer isolated from Node and only let it
      // reach the main process through the typed preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Fully remove the menu on Windows/Linux so Alt can't toggle it back into
  // view. No-op on macOS, which uses the application menu bar instead.
  if (process.platform !== 'darwin') {
    mainWindow.removeMenu();
  }

  // Never open a second in-app window; send external links to the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Keep the renderer pinned to its own content — block any attempt to navigate
  // the window itself to another origin (open it externally if it's a web link).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Load the Vite dev server in development, or the built index.html in prod.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

/** The desktop app proper: window, IPC, and the embedded MCP server. */
function runApp(): void {
  app.on('ready', () => {
    // Populate the native "About DomBot" panel (the app menu on macOS, and the
    // GTK about dialog on Linux). `website` is honored on Linux only, so the URL
    // is also placed in `credits`, where it shows on macOS's panel too.
    app.setAboutPanelOptions({
      applicationName: 'DomBot',
      applicationVersion: app.getVersion(),
      website: 'https://dombot.ai',
      credits: 'https://dombot.ai',
    });

    hardenRenderer();
    registerIpcHandlers();
    createWindow();

    // Start the local MCP server unless explicitly disabled (DOMBOT_MCP_ENABLED=0).
    if (process.env.DOMBOT_MCP_ENABLED !== '0') {
      startMcpServer()
        .then((mcp) => console.log(`[mcp] listening on ${mcp.url}`))
        .catch((err) => console.error('[mcp] failed to start', err));
    }

    // Keep the cache the MCP tools serve warm without a manual Sync
    // (DOMBOT_SYNC_INTERVAL_MINUTES=0 disables).
    startAutoSync();
  });

  app.on('will-quit', () => {
    stopAutoSync();
    void stopMcpServer();
  });

  // Quit when all windows are closed, except on macOS.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On macOS re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

/**
 * `DomBot --mcp-stdio`: a headless stdio bridge to the app's MCP server, for
 * Claude Desktop and other stdio-only clients. No window, no Dock icon, no
 * server of its own — see mcp/stdio.ts.
 */
function runShim(): void {
  app.on('ready', () => {
    app.dock?.hide();
    runStdioShim().catch((err) => {
      console.error('[mcp-stdio] fatal:', err);
      app.exit(1);
    });
  });
}

if (isStdioShimMode()) {
  runShim();
} else {
  runApp();
}
