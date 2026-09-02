import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc';
import { startMcpServer, stopMcpServer } from './mcp/server';
import { isStdioShimMode, runStdioShim } from './mcp/stdio';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
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
    registerIpcHandlers();
    createWindow();

    // Start the local MCP server unless explicitly disabled (DOMBOT_MCP_ENABLED=0).
    if (process.env.DOMBOT_MCP_ENABLED !== '0') {
      startMcpServer()
        .then((mcp) => console.log(`[mcp] listening on ${mcp.url}`))
        .catch((err) => console.error('[mcp] failed to start', err));
    }
  });

  app.on('will-quit', () => {
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
