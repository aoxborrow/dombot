import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { z } from 'zod';
import { getSettings } from '../services/settings';
import {
  authenticateClient,
  createPendingApproval,
  exchangeAuthorizationCode,
  getApprovalStatus,
  getClient,
  OAuthGrantError,
  registerClient,
  resolvePending,
  revokeToken,
  verifyAccessToken,
  type PendingApproval,
} from './oauth';
import { registerTools } from './tools';

// The MCP endpoint and its OAuth 2.1 authorization server as Hono routes,
// shared by both hosts: the desktop serves them on loopback through
// @hono/node-server, the Worker mounts them on the public origin. Everything is
// stateless per request — the transport runs in stateless mode and the OAuth
// state is in the store (./oauth.ts) — so it doesn't matter which isolate a
// request lands on.
//
// The issuer is whatever origin the request arrived on: 127.0.0.1:<port> on
// the desktop, the deployment's public URL on the web.

export interface McpRouteOptions {
  /** Reported to clients as the server version. */
  version: string;
  /**
   * Bearer tokens a host accepts without the approval flow (the desktop's
   * stdio shim, a dev token from the environment). Checked before the store.
   */
  verifyStaticToken?: (token: string) => AuthInfo | null;
  /** Dev/testing: skip the human step and redirect straight back. */
  autoApprove?: boolean;
}

const MCP_PATH = '/mcp';

/** The paths a front gate (Cloudflare Access) must exclude for MCP to work. */
export const MCP_PUBLIC_PATHS = [
  MCP_PATH,
  '/authorize',
  '/token',
  '/register',
  '/revoke',
  '/oauth/status',
  '/.well-known/*',
];

export function createMcpRoutes(options: McpRouteOptions): Hono {
  const app = new Hono();

  // Middleware is scoped to the MCP paths: a host mounts this router at its
  // root, and nothing else on that origin should pick up CORS headers or the
  // disabled-404.
  const gate = [
    cors({
      origin: '*',
      exposeHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
      allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Protocol-Version'],
    }),
    // The whole surface goes away when the setting is off (Settings → MCP).
    async (c: Context, next: () => Promise<void>) => {
      if (!getSettings().mcpEnabled) {
        return c.json({ error: 'MCP server is disabled' }, 404);
      }
      c.header('Cache-Control', 'no-store');
      await next();
    },
  ];
  for (const path of MCP_PUBLIC_PATHS) app.use(path, ...gate);

  // ── discovery (RFC 8414 / RFC 9728) ──────────────────────────────────────
  const asMetadata = (c: Context) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin + '/',
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      revocation_endpoint: `${origin}/revoke`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      revocation_endpoint_auth_methods_supported: ['client_secret_post'],
      grant_types_supported: ['authorization_code'],
      scopes_supported: ['portfolio'],
    });
  };
  const rsMetadata = (c: Context) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      resource: origin + MCP_PATH,
      authorization_servers: [origin + '/'],
      scopes_supported: ['portfolio'],
      resource_name: 'DomBot',
    });
  };
  // Clients probe both the plain and the path-suffixed forms.
  app.get('/.well-known/oauth-authorization-server', asMetadata);
  app.get('/.well-known/oauth-authorization-server' + MCP_PATH, asMetadata);
  app.get('/.well-known/oauth-protected-resource', rsMetadata);
  app.get('/.well-known/oauth-protected-resource' + MCP_PATH, rsMetadata);

  // ── dynamic client registration (RFC 7591) ───────────────────────────────
  app.post('/register', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) {
      return oauthError(c, 'invalid_client_metadata', parsed.error.message);
    }
    return c.json(registerClient(parsed.data), 201);
  });

  // ── authorization ────────────────────────────────────────────────────────
  const authorize = async (c: Context) => {
    const q = c.req.method === 'POST' ? await formBody(c) : c.req.query();
    // Phase 1: client + redirect_uri. Errors here can't be redirected.
    const client = q.client_id ? getClient(q.client_id) : undefined;
    if (!client) return oauthError(c, 'invalid_client', 'Invalid client_id');
    let redirectUri = q.redirect_uri;
    if (redirectUri !== undefined) {
      if (
        !client.redirect_uris.some((r) => redirectUriMatches(redirectUri!, r))
      )
        return oauthError(c, 'invalid_request', 'Unregistered redirect_uri');
    } else if (client.redirect_uris.length === 1) {
      redirectUri = client.redirect_uris[0];
    } else {
      return oauthError(
        c,
        'invalid_request',
        'redirect_uri must be specified when client has multiple registered URIs',
      );
    }
    // Phase 2: the rest. Errors go back to the client via the redirect.
    const parsed = AuthorizeParams.safeParse(q);
    if (!parsed.success) {
      return c.redirect(
        errorRedirect(
          redirectUri,
          'invalid_request',
          parsed.error.message,
          q.state,
        ),
        302,
      );
    }
    const p = createPendingApproval(client, {
      state: parsed.data.state,
      scopes: parsed.data.scope ? parsed.data.scope.split(' ') : [],
      redirectUri,
      codeChallenge: parsed.data.code_challenge,
      resource: parsed.data.resource,
    });
    if (options.autoApprove) {
      const redirect = resolvePending(p.id, true);
      if (redirect) return c.redirect(redirect, 302);
    }
    return c.html(waitingPage(p));
  };
  app.get('/authorize', authorize);
  app.post('/authorize', authorize);

  // The waiting page polls this until the user decides in the app.
  app.get('/oauth/status', (c) =>
    c.json(getApprovalStatus(c.req.query('id') ?? '')),
  );

  // ── token exchange ───────────────────────────────────────────────────────
  app.post('/token', async (c) => {
    const body = await formBody(c);
    const client = authenticateClient(body.client_id ?? '', body.client_secret);
    if (!client) return oauthError(c, 'invalid_client', 'Invalid client');
    if (body.grant_type !== 'authorization_code') {
      return oauthError(
        c,
        'unsupported_grant_type',
        'The grant type is not supported by this authorization server.',
      );
    }
    if (!body.code || !body.code_verifier) {
      return oauthError(
        c,
        'invalid_request',
        'code and code_verifier required',
      );
    }
    try {
      const tokens = await exchangeAuthorizationCode(
        client,
        body.code,
        body.code_verifier,
        body.redirect_uri,
      );
      return c.json(tokens);
    } catch (err) {
      if (err instanceof OAuthGrantError)
        return oauthError(c, err.code, err.message);
      throw err;
    }
  });

  // ── revocation (RFC 7009) ────────────────────────────────────────────────
  app.post('/revoke', async (c) => {
    const body = await formBody(c);
    const client = authenticateClient(body.client_id ?? '', body.client_secret);
    if (!client) return oauthError(c, 'invalid_client', 'Invalid client');
    if (!body.token) return oauthError(c, 'invalid_request', 'token required');
    await revokeToken(client, body.token);
    return c.json({});
  });

  // ── the MCP endpoint ─────────────────────────────────────────────────────
  app.on(['POST', 'GET', 'DELETE'], MCP_PATH, async (c) => {
    const auth = await bearer(c, options);
    if (auth instanceof Response) return auth;
    // Stateless: a fresh server + transport per request, no session ids. The
    // tools read the (hydrated) store, so nothing needs to persist between
    // requests, and any isolate can answer any call.
    const server = new McpServer({ name: 'DomBot', version: options.version });
    registerTools(server);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, { authInfo: auth });
    } finally {
      await transport.close().catch(() => undefined);
    }
  });

  return app;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const AuthorizeParams = z.object({
  response_type: z.literal('code'),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal('S256'),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.string().url().optional(),
});

type Form = Partial<Record<string, string>>;

/** Form-encoded or JSON body → flat string map. */
async function formBody(c: Context): Promise<Form> {
  const type = c.req.header('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const json = (await c.req.json()) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(json).map(([k, v]) => [k, String(v)]),
      );
    }
    const parsed = await c.req.parseBody();
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)]),
    );
  } catch {
    return {};
  }
}

function oauthError(
  c: Context,
  error: string,
  description: string,
  status: 400 | 401 = 400,
) {
  return c.json({ error, error_description: description }, status);
}

function errorRedirect(
  redirectUri: string,
  error: string,
  description: string,
  state?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.href;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * RFC 8252 §7.3: a loopback redirect may use any port (native clients take an
 * ephemeral one); everything else must match exactly.
 */
export function redirectUriMatches(
  requested: string,
  registered: string,
): boolean {
  if (requested === registered) return true;
  let req: URL, reg: URL;
  try {
    req = new URL(requested);
    reg = new URL(registered);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(req.hostname) || !LOOPBACK_HOSTS.has(reg.hostname))
    return false;
  return (
    req.protocol === reg.protocol &&
    req.hostname === reg.hostname &&
    req.pathname === reg.pathname &&
    req.search === reg.search
  );
}

/** Bearer check for the MCP endpoint: static tokens first, then the store. */
async function bearer(
  c: Context,
  options: McpRouteOptions,
): Promise<AuthInfo | Response> {
  const header = c.req.header('authorization') ?? '';
  const [type, token] = header.split(' ');
  const fail = (description: string) => {
    const origin = new URL(c.req.url).origin;
    c.header(
      'WWW-Authenticate',
      `Bearer error="invalid_token", error_description="${description}", ` +
        `resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`,
    );
    return oauthError(c, 'invalid_token', description, 401);
  };
  if (!header) return fail('Missing Authorization header');
  if (type.toLowerCase() !== 'bearer' || !token) {
    return fail("Invalid Authorization header format, expected 'Bearer TOKEN'");
  }
  const info =
    options.verifyStaticToken?.(token) ?? (await verifyAccessToken(token));
  if (!info) return fail('Invalid or expired token');
  return info;
}

// ── browser waiting page ─────────────────────────────────────────────────────

function waitingPage(req: PendingApproval): string {
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]!,
    );
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connecting · DomBot</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#020617;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:32px;max-width:420px;width:90%;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{color:#94a3b8;font-size:14px;line-height:1.5}
  .code{font-family:ui-monospace,monospace;letter-spacing:3px;font-size:22px;color:#a5b4fc;margin:16px 0}
  .spin{margin-top:16px;width:22px;height:22px;border:3px solid #1e293b;border-top-color:#6366f1;border-radius:50%;display:inline-block;animation:s 0.8s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  .err{color:#f87171}
</style></head>
<body>
  <div class="card">
    <h1>Approve this connection in DomBot</h1>
    <p>Open DomBot and confirm this code matches:</p>
    <div class="code">${esc(req.displayCode)}</div>
    <div class="spin" id="spin"></div>
    <p id="status">Waiting for approval…</p>
  </div>
  <script>
    const id = ${JSON.stringify(req.id)};
    async function poll() {
      try {
        const r = await fetch('/oauth/status?id=' + encodeURIComponent(id));
        const s = await r.json();
        if (s.status === 'approved' && s.redirect) { location.href = s.redirect; return; }
        if (s.status === 'denied' && s.redirect) { location.href = s.redirect; return; }
        if (s.status === 'unknown') { fail('This request expired. Reconnect to try again.'); return; }
      } catch { /* keep polling */ }
      setTimeout(poll, 1000);
    }
    function fail(msg){ document.getElementById('spin').style.display='none'; const el=document.getElementById('status'); el.textContent=msg; el.className='err'; }
    poll();
  </script>
</body></html>`;
}
