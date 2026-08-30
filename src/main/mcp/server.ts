import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { app } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools';
import type { McpInfo } from '../../shared/ipc';

// Live sessions, keyed by the MCP session id issued at initialize. Each holds a
// transport bound to one client connection.
const transports = new Map<string, StreamableHTTPServerTransport>();

let httpServer: http.Server | null = null;
let info: McpInfo | null = null;

/** Current server status, or a stopped placeholder if it never started. */
export function getMcpInfo(): McpInfo {
  return info ?? { running: false, url: '', token: '' };
}

/** Builds a fresh MCP server instance with the portfolio tools registered. */
function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'dombot', version: app.getVersion() });
  registerTools(server);
  return server;
}

/**
 * Starts the local MCP server on loopback with a single bearer token
 * (one authorization → full access). Idempotent: repeat calls return the
 * existing info. Port/token can be pinned via DOMBOT_MCP_PORT / DOMBOT_MCP_TOKEN.
 */
export async function startMcpServer(): Promise<McpInfo> {
  if (info?.running) return info;

  const host = '127.0.0.1';
  const port = Number(process.env.DOMBOT_MCP_PORT) || 4123;
  const token = process.env.DOMBOT_MCP_TOKEN || randomBytes(24).toString('hex');

  httpServer = http.createServer((req, res) => {
    handleRequest(req, res, token).catch((err) => {
      console.error('[mcp] request error', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject);
    // Loopback only — never expose registrar control beyond this machine.
    httpServer!.listen(port, host, () => resolve());
  });

  info = { running: true, url: `http://${host}:${port}/mcp`, token };
  return info;
}

/** Stops the server and tears down any live sessions. */
export async function stopMcpServer(): Promise<void> {
  for (const transport of transports.values()) {
    await transport.close();
  }
  transports.clear();
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = null;
  }
  info = null;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/mcp') {
    sendError(res, 404, -32601, 'Not found');
    return;
  }

  // Single authorization: every request must carry the bearer token.
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, 401, -32001, 'Unauthorized');
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    const body = await readJson(req);
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(body)) {
        sendError(res, 400, -32000, 'No valid session; send initialize first.');
        return;
      }
      // New client: create a session on initialize.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await createMcpServer().connect(transport);
    }

    await transport.handleRequest(req, res, body);
    return;
  }

  // GET (SSE stream) and DELETE (end session) operate on an existing session.
  if (req.method === 'GET' || req.method === 'DELETE') {
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      sendError(res, 400, -32000, 'Unknown or missing session id.');
      return;
    }
    await transport.handleRequest(req, res);
    return;
  }

  res.setHeader('Allow', 'POST, GET, DELETE');
  sendError(res, 405, -32000, 'Method not allowed');
}

function sendError(
  res: http.ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
  );
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}
