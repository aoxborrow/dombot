import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  isInitializeRequest,
  isJSONRPCRequest,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import {
  readStdioConfig,
  stdioConfigPath,
  type StdioConfig,
} from './stdio-config';

// The stdio shim: `DomBot --mcp-stdio` runs this instead of the app. Clients
// that can only launch a command and talk over stdin/stdout (Claude Desktop,
// Cowork) spawn it; it bridges them to the HTTP MCP server inside the running
// app. It does no work of its own — no windows, no credentials, no cache — so
// there's one source of truth. If the app isn't running it launches it and
// waits; if the app restarts mid-conversation it re-initializes transparently.

export const STDIO_FLAG = '--mcp-stdio';

/** True when this process was started as the shim rather than the app. */
export function isStdioShimMode(argv: string[] = process.argv): boolean {
  return argv.includes(STDIO_FLAG);
}

const WAIT_FOR_SERVER_MS = 30_000;
const POLL_MS = 500;

/** Bridges stdin/stdout to the app's MCP endpoint until the client hangs up. */
export async function runStdioShim(): Promise<never> {
  // stdout is the JSON-RPC channel: everything we'd log goes to stderr.
  console.log =
    console.info =
    console.debug =
      (...args: unknown[]) => console.error(...args);

  const stdio = new StdioServerTransport();
  let http: StreamableHTTPClientTransport | null = null;
  // The client's initialize request, replayed if the app restarts.
  let initMessage: JSONRPCMessage | null = null;
  // Ids of replayed-initialize responses the client must not see twice.
  const swallow = new Set<string | number>();

  const connect = async (): Promise<StreamableHTTPClientTransport> => {
    const cfg = await waitForServer();
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } },
    });
    transport.onmessage = (msg) => {
      if ('id' in msg && msg.id !== undefined && swallow.delete(msg.id)) return;
      void stdio.send(msg);
    };
    transport.onerror = (err) =>
      console.error('[mcp-stdio] http:', err.message);
    await transport.start();
    return transport;
  };

  // Rebuilds the session after the app restarted (its sessions are in-memory).
  const reinitialize = async (): Promise<StreamableHTTPClientTransport> => {
    await http?.close().catch(() => undefined);
    const transport = await connect();
    http = transport;
    if (initMessage && isJSONRPCRequest(initMessage)) {
      swallow.add(initMessage.id);
      await transport.send(initMessage);
      await transport.send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
    }
    return transport;
  };

  stdio.onmessage = (msg) => {
    if (isInitializeRequest(msg)) initMessage = msg;
    void forward(msg);
  };

  const forward = async (msg: JSONRPCMessage): Promise<void> => {
    try {
      await (http ?? (http = await connect())).send(msg);
    } catch (err) {
      let failure: unknown = err;
      if (isSessionLost(err)) {
        try {
          await (await reinitialize()).send(msg);
          return;
        } catch (retryErr) {
          failure = retryErr;
        }
      }
      const message = describe(failure);
      console.error('[mcp-stdio]', message);
      if (isJSONRPCRequest(msg)) {
        await stdio.send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message },
        });
      }
    }
  };

  // The client hung up (or was killed): we're done.
  stdio.onclose = () => {
    void http?.close().catch(() => undefined);
    app.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => app.exit(0));
  }

  await stdio.start();
  return new Promise<never>(() => undefined);
}

/** A 404 from the server means our session id is unknown — the app restarted. */
function isSessionLost(err: unknown): boolean {
  return err instanceof StreamableHTTPError && err.code === 404;
}

function describe(err: unknown): string {
  if (err instanceof StreamableHTTPError && err.code === 401) {
    return 'DomBot rejected the stdio token. Restart DomBot and try again.';
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolves once the app's MCP server answers, launching the app if needed.
 * Any HTTP response counts (an unauthenticated GET is a 401) — we only need to
 * know the port is ours.
 */
async function waitForServer(): Promise<StdioConfig> {
  const deadline = Date.now() + WAIT_FOR_SERVER_MS;
  let launched = false;
  while (Date.now() < deadline) {
    const cfg = readStdioConfig();
    if (cfg && (await isReachable(cfg.url))) return cfg;
    if (!launched) {
      launchApp();
      launched = true;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `DomBot is not running (timed out waiting for its MCP server; looked for ${stdioConfigPath()}). Open DomBot and try again.`,
  );
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/** Starts the real app, detached, so it outlives this shim. */
function launchApp(): void {
  if (!app.isPackaged) {
    // Dev builds share the Electron binary with everything else — launching
    // process.execPath would start a bare Electron, not DomBot.
    console.error(
      '[mcp-stdio] DomBot is not running. Start it (npm start) — dev builds are not auto-launched.',
    );
    return;
  }
  console.error('[mcp-stdio] DomBot is not running; launching it.');
  if (process.platform === 'darwin') {
    // `open` launches the bundle the way the Finder would: proper activation,
    // and no inherited stdio from the MCP client.
    spawn('open', [macAppBundle() ?? process.execPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn(process.execPath, [], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** …/DomBot.app for a packaged macOS build, derived from the executable path. */
function macAppBundle(): string | null {
  let dir = path.dirname(process.execPath);
  for (let i = 0; i < 4; i++) {
    if (dir.endsWith('.app')) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * The command an MCP client should run to get a stdio server — shown in
 * Settings → MCP. Empty in dev (see launchApp). On Windows, Squirrel installs
 * a stub launcher one directory up that forwards to the current version, so
 * the path survives updates.
 */
export function stdioCommand(): string {
  if (!app.isPackaged) return '';
  if (process.platform === 'win32') {
    const stub = path.join(
      path.dirname(process.execPath),
      '..',
      path.basename(process.execPath),
    );
    if (fs.existsSync(stub)) return stub;
  }
  return process.execPath;
}
