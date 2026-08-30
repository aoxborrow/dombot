import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { McpClient, McpPendingApproval } from '../../shared/ipc';

// A minimal, single-user OAuth 2.1 authorization server for the local MCP
// endpoint. Clients self-register (dynamic registration); the human approves
// each new connection in the dombot window; the issued access token is persisted
// so a paired client stays paired across restarts.

const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
// Access tokens are long-lived, but the bearer middleware requires an explicit
// expiry, so we set a far-future one.
const TOKEN_TTL_SEC = 365 * 24 * 60 * 60;

interface StoredAuthCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
}

interface PendingApproval {
  id: string;
  clientId: string;
  clientName: string;
  displayCode: string;
  params: AuthorizationParams;
  status: 'pending' | 'approved' | 'denied';
  redirect?: string;
  createdAt: number;
}

const clients = new Map<string, OAuthClientInformationFull>();
const authCodes = new Map<string, StoredAuthCode>();
const grantedTokens = new Map<string, AuthInfo>();
const pending = new Map<string, PendingApproval>();

// Notifies the app (window) that the pending-approval set changed.
let approvalListener: (() => void) | null = null;
export function setApprovalListener(cb: (() => void) | null): void {
  approvalListener = cb;
}
function notifyChange(): void {
  approvalListener?.();
}

// ── token persistence ──────────────────────────────────────────────────────

function tokensFile(): string {
  return path.join(app.getPath('userData'), 'mcp-tokens.json');
}

export function loadGrantedTokens(): void {
  try {
    const arr = JSON.parse(fs.readFileSync(tokensFile(), 'utf8')) as AuthInfo[];
    for (const info of arr) grantedTokens.set(info.token, info);
  } catch {
    // no tokens file yet — nothing to load
  }
}

function saveGrantedTokens(): void {
  try {
    fs.writeFileSync(
      tokensFile(),
      JSON.stringify([...grantedTokens.values()], null, 2),
    );
  } catch (err) {
    console.error('[mcp] failed to persist tokens', err);
  }
}

// ── clients store (dynamic registration) ────────────────────────────────────

const clientsStore: OAuthRegisteredClientsStore = {
  getClient: (id) => clients.get(id),
  registerClient: (client) => {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    clients.set(full.client_id, full);
    return full;
  },
};

// ── approval flow (resolved from the app window) ─────────────────────────────

function displayCode(): string {
  const raw = randomBytes(4).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function pruneStale(): void {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.createdAt > PENDING_TTL_MS) pending.delete(id);
  }
}

/** Pending approvals awaiting a decision, for display in the app window. */
export function listPendingApprovals(): McpPendingApproval[] {
  return [...pending.values()]
    .filter((p) => p.status === 'pending')
    .map((p) => ({
      id: p.id,
      clientName: p.clientName,
      code: p.displayCode,
      createdAt: p.createdAt,
    }));
}

/** Status of a pending authorization, polled by the browser waiting page. */
export function getApprovalStatus(id: string): {
  status: PendingApproval['status'] | 'unknown';
  redirect?: string;
} {
  const p = pending.get(id);
  if (!p) return { status: 'unknown' };
  return { status: p.status, redirect: p.redirect };
}

/**
 * Records the user's decision: on approval mints a one-time auth code and builds
 * the redirect back to the client; on denial builds an error redirect. The
 * browser waiting page picks up the redirect via getApprovalStatus().
 */
export function resolvePending(id: string, approve: boolean): string | null {
  const p = pending.get(id);
  if (!p) return null;
  if (p.status !== 'pending') return p.redirect ?? null;

  const redirect = new URL(p.params.redirectUri);
  if (approve) {
    const code = randomBytes(24).toString('hex');
    authCodes.set(code, {
      clientId: p.clientId,
      codeChallenge: p.params.codeChallenge,
      redirectUri: p.params.redirectUri,
      scopes: p.params.scopes ?? [],
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    redirect.searchParams.set('code', code);
    p.status = 'approved';
  } else {
    redirect.searchParams.set('error', 'access_denied');
    p.status = 'denied';
  }
  if (p.params.state) redirect.searchParams.set('state', p.params.state);
  p.redirect = redirect.toString();
  notifyChange();
  return p.redirect;
}

// ── paired clients ───────────────────────────────────────────────────────────

/** Distinct paired clients (by client id), most recent first. */
export function listMcpClients(): McpClient[] {
  const byClient = new Map<string, McpClient>();
  for (const t of grantedTokens.values()) {
    const pairedAt = Number(t.extra?.pairedAt ?? 0);
    const existing = byClient.get(t.clientId);
    if (!existing || pairedAt > existing.pairedAt) {
      byClient.set(t.clientId, {
        clientId: t.clientId,
        clientName: String(t.extra?.clientName ?? t.clientId),
        pairedAt,
      });
    }
  }
  return [...byClient.values()].sort((a, b) => b.pairedAt - a.pairedAt);
}

/** Revokes every token issued to a client, un-pairing it. */
export function revokeMcpClient(clientId: string): void {
  for (const [token, info] of grantedTokens) {
    if (info.clientId === clientId) grantedTokens.delete(token);
  }
  saveGrantedTokens();
}

// ── provider ──────────────────────────────────────────────────────────────

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client, params, res) {
    pruneStale();
    const id = randomUUID();
    const clientName = client.client_name ?? client.client_id;
    pending.set(id, {
      id,
      clientId: client.client_id,
      clientName,
      displayCode: displayCode(),
      params,
      status: 'pending',
      createdAt: Date.now(),
    });
    notifyChange();

    // Dev/testing: skip the human step and redirect immediately.
    if (process.env.DOMBOT_MCP_AUTOAPPROVE === '1') {
      const redirect = resolvePending(id, true);
      if (redirect) res.redirect(redirect);
      return;
    }

    res.setHeader('content-type', 'text/html');
    res.send(waitingPage(id, pending.get(id)!));
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const rec = authCodes.get(authorizationCode);
    if (!rec || rec.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return rec.codeChallenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode) {
    const rec = authCodes.get(authorizationCode);
    if (
      !rec ||
      rec.clientId !== client.client_id ||
      rec.expiresAt < Date.now()
    ) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    authCodes.delete(authorizationCode);

    const accessToken = randomBytes(32).toString('hex');
    const info: AuthInfo = {
      token: accessToken,
      clientId: client.client_id,
      scopes: rec.scopes,
      expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
      extra: {
        clientName: client.client_name ?? client.client_id,
        pairedAt: Date.now(),
      },
    };
    grantedTokens.set(accessToken, info);
    saveGrantedTokens();

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: TOKEN_TTL_SEC,
      scope: rec.scopes.join(' ') || undefined,
    } satisfies OAuthTokens;
  },

  async exchangeRefreshToken() {
    throw new InvalidGrantError('Refresh tokens are not supported');
  },

  async verifyAccessToken(token) {
    // Dev/testing escape hatch: a static token via env.
    const staticToken = process.env.DOMBOT_MCP_TOKEN;
    if (staticToken && token === staticToken) {
      return {
        token,
        clientId: 'static',
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
      };
    }
    const info = grantedTokens.get(token);
    if (!info) throw new InvalidTokenError('Invalid or expired token');
    return info;
  },

  async revokeToken(_client, request) {
    grantedTokens.delete(request.token);
    saveGrantedTokens();
  },
};

// ── browser waiting page ─────────────────────────────────────────────────────

function waitingPage(id: string, req: PendingApproval): string {
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connecting · dombot</title>
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
    <h1>Approve this connection in dombot</h1>
    <p>Open the dombot app and confirm this code matches:</p>
    <div class="code">${esc(req.displayCode)}</div>
    <div class="spin" id="spin"></div>
    <p id="status">Waiting for approval…</p>
  </div>
  <script>
    const id = ${JSON.stringify(id)};
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
