import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { registerTools } from './tools';
import { getApprovalStatus, loadGrantedTokens, oauthProvider } from './oauth';
import type { McpInfo } from '../../shared/ipc';

// Live sessions, keyed by the MCP session id issued at initialize.
const transports = new Map<string, StreamableHTTPServerTransport>();

let httpServer: Server | null = null;
let info: McpInfo | null = null;

/** Current server status, or a stopped placeholder if it never started. */
export function getMcpInfo(): McpInfo {
  return info ?? { running: false, url: '' };
}

/** Builds a fresh MCP server instance with the portfolio tools registered. */
function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'dombot', version: app.getVersion() });
  registerTools(server);
  return server;
}

/**
 * Starts the local MCP server on loopback. Auth is OAuth 2.1: clients register
 * dynamically and the human approves each new connection on dombot's approval
 * page. Idempotent. Port pinnable via DOMBOT_MCP_PORT.
 */
export async function startMcpServer(): Promise<McpInfo> {
  if (info?.running) return info;

  const host = '127.0.0.1';
  const port = Number(process.env.DOMBOT_MCP_PORT) || 4123;
  const baseUrl = new URL(`http://${host}:${port}`);
  const mcpUrl = new URL('/mcp', baseUrl);

  loadGrantedTokens();

  const expressApp = express();
  expressApp.use(cors({ exposedHeaders: ['Mcp-Session-Id'] }));

  // OAuth endpoints: /authorize, /token, /register, /revoke, /.well-known/*
  expressApp.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: baseUrl,
      scopesSupported: ['portfolio'],
      resourceName: 'dombot',
      resourceServerUrl: mcpUrl,
    }),
  );

  // The browser waiting page polls this until the user approves/denies in-app.
  expressApp.get('/oauth/status', (req: Request, res: Response) => {
    res.json(getApprovalStatus(String(req.query.id ?? '')));
  });

  // The MCP endpoint itself, protected by a valid bearer token.
  const bearer = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });
  expressApp.post('/mcp', bearer, express.json(), handleMcpPost);
  expressApp.get('/mcp', bearer, handleMcpGet);
  expressApp.delete('/mcp', bearer, handleMcpDelete);

  await new Promise<void>((resolve, reject) => {
    // Loopback only — never expose registrar control beyond this machine.
    httpServer = expressApp.listen(port, host, () => resolve());
    httpServer.once('error', reject);
  });

  info = { running: true, url: mcpUrl.href };
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

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (sessionId || !isInitializeRequest(req.body)) {
      res
        .status(400)
        .json(jsonRpcError('No valid session; send initialize first.'));
      return;
    }
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

  await transport.handleRequest(req, res, req.body);
}

async function handleMcpGet(req: Request, res: Response): Promise<void> {
  await handleSessionRequest(req, res);
}

async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  await handleSessionRequest(req, res);
}

async function handleSessionRequest(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json(jsonRpcError('Unknown or missing session id.'));
    return;
  }
  await transport.handleRequest(req, res);
}

function jsonRpcError(message: string) {
  return { jsonrpc: '2.0', error: { code: -32000, message }, id: null };
}
