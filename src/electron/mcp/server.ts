import type { Server } from 'node:http';
import { app } from 'electron';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createMcpRoutes } from '../../core/mcp/routes';
import { getStdioToken, writeStdioConfig } from './stdio-config';
import { stdioCommand } from './stdio';
import type { McpInfo } from '../../shared/ipc';

// The desktop host's MCP server: the shared Hono routes (src/core/mcp/routes.ts)
// served on loopback. Auth is OAuth 2.1 — clients register dynamically and the
// human approves each new connection in the DomBot window — plus two static
// tokens: the stdio shim's per-install token, and DOMBOT_MCP_TOKEN for
// dev/testing.

let httpServer: Server | null = null;
let info: McpInfo | null = null;

/** Current server status, or a stopped placeholder if it never started. */
export function getMcpInfo(): McpInfo {
  return info ?? { running: false, url: '', stdioCommand: '', stdioArgs: [] };
}

const TOKEN_TTL_SEC = 365 * 24 * 60 * 60;

/** Tokens the desktop accepts without the approval flow. */
function verifyStaticToken(token: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  // Dev/testing escape hatch: a static token via env.
  const staticToken = process.env.DOMBOT_MCP_TOKEN;
  if (staticToken && token === staticToken) {
    return { token, clientId: 'static', scopes: [], expiresAt };
  }
  // The stdio shim (`DomBot --mcp-stdio`) authenticates with a per-install
  // token from userData — same user, same machine, so no approval prompt.
  const stdioToken = getStdioToken();
  if (stdioToken && token === stdioToken) {
    return {
      token,
      clientId: 'stdio',
      scopes: ['portfolio'],
      expiresAt,
      extra: { clientName: 'Local stdio' },
    };
  }
  return null;
}

/**
 * Starts the local MCP server on loopback. Idempotent. Port pinnable via
 * DOMBOT_MCP_PORT.
 */
export async function startMcpServer(): Promise<McpInfo> {
  if (info?.running) return info;

  const host = '127.0.0.1';
  const port = Number(process.env.DOMBOT_MCP_PORT) || 4123;
  const mcpUrl = new URL('/mcp', `http://${host}:${port}`);

  const hono = new Hono();
  hono.route(
    '/',
    createMcpRoutes({
      version: app.getVersion(),
      verifyStaticToken,
      autoApprove: process.env.DOMBOT_MCP_AUTOAPPROVE === '1',
    }),
  );

  await new Promise<void>((resolve, reject) => {
    // Loopback only — never expose registrar control beyond this machine.
    const server = serve({ fetch: hono.fetch, port, hostname: host }, () =>
      resolve(),
    ) as Server;
    server.once('error', reject);
    httpServer = server;
  });

  // Tell stdio shims where we are (and mint their token on first run).
  writeStdioConfig(mcpUrl.href);

  const stdio = stdioCommand();
  info = {
    running: true,
    url: mcpUrl.href,
    stdioCommand: stdio.command,
    stdioArgs: stdio.args,
  };
  return info;
}

/** Stops the server. Requests are stateless, so there's nothing else to tear down. */
export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  info = null;
}
