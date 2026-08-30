import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Response } from 'express';
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

// A minimal, single-user OAuth 2.1 authorization server for the local MCP
// endpoint. Clients self-register (dynamic registration), the human approves
// each new connection on dombot's approval page, and the issued access token is
// persisted so a paired client stays paired across restarts.

const CODE_TTL_MS = 5 * 60 * 1000;
// Access tokens are long-lived (a paired client stays paired), but the bearer
// middleware requires an explicit expiry, so we set a far-future one.
const TOKEN_TTL_SEC = 365 * 24 * 60 * 60;

interface StoredAuthCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
}

interface PendingApproval {
  clientId: string;
  clientName: string;
  displayCode: string;
  params: AuthorizationParams;
}

const clients = new Map<string, OAuthClientInformationFull>();
const authCodes = new Map<string, StoredAuthCode>();
const grantedTokens = new Map<string, AuthInfo>();
const pending = new Map<string, PendingApproval>();

// ── token persistence ──────────────────────────────────────────────────────

function tokensFile(): string {
  return path.join(app.getPath('userData'), 'mcp-tokens.json');
}

/** Loads previously granted tokens so paired clients survive a restart. */
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

// ── approval flow ────────────────────────────────────────────────────────────

function displayCode(): string {
  const raw = randomBytes(4).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Completes a pending authorization: on approval, mints a one-time auth code and
 * redirects back to the client; on denial, redirects with an error.
 */
export function handleApproval(
  id: string,
  decision: string,
  res: Response,
): void {
  const req = pending.get(id);
  if (!req) {
    res.status(400).send('Unknown or expired approval request.');
    return;
  }
  pending.delete(id);

  const redirect = new URL(req.params.redirectUri);
  if (decision === 'approve') {
    const code = randomBytes(24).toString('hex');
    authCodes.set(code, {
      clientId: req.clientId,
      codeChallenge: req.params.codeChallenge,
      redirectUri: req.params.redirectUri,
      scopes: req.params.scopes ?? [],
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    redirect.searchParams.set('code', code);
  } else {
    redirect.searchParams.set('error', 'access_denied');
  }
  if (req.params.state) redirect.searchParams.set('state', req.params.state);
  res.redirect(redirect.toString());
}

// ── provider ──────────────────────────────────────────────────────────────

export const oauthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client, params, res) {
    const id = randomUUID();
    const clientName = client.client_name ?? client.client_id;
    pending.set(id, {
      clientId: client.client_id,
      clientName,
      displayCode: displayCode(),
      params,
    });

    // Dev/testing: skip the human step.
    if (process.env.DOMBOT_MCP_AUTOAPPROVE === '1') {
      handleApproval(id, 'approve', res);
      return;
    }

    res.setHeader('content-type', 'text/html');
    res.send(approvalPage(id, pending.get(id)!));
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
    };
    grantedTokens.set(accessToken, info);
    saveGrantedTokens();

    const tokens: OAuthTokens = {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: TOKEN_TTL_SEC,
      scope: rec.scopes.join(' ') || undefined,
    };
    return tokens;
  },

  async exchangeRefreshToken() {
    // Long-lived local tokens; refresh isn't used.
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

// ── approval page ────────────────────────────────────────────────────────────

function approvalPage(id: string, req: PendingApproval): string {
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
  const origin = (() => {
    try {
      return new URL(req.params.redirectUri).origin;
    } catch {
      return req.params.redirectUri;
    }
  })();

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Approve connection · dombot</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#020617;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:32px;max-width:420px;width:90%}
  h1{font-size:18px;margin:0 0 4px}
  p{color:#94a3b8;font-size:14px;line-height:1.5}
  .meta{margin:20px 0;font-size:13px}
  .meta div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1e293b}
  .meta span:first-child{color:#64748b}
  .code{font-family:ui-monospace,monospace;letter-spacing:2px;color:#a5b4fc}
  .btns{display:flex;gap:12px;margin-top:24px}
  button{flex:1;padding:10px;border-radius:8px;border:0;font-size:14px;font-weight:600;cursor:pointer}
  .approve{background:#4f46e5;color:#fff}
  .deny{background:#1e293b;color:#e2e8f0}
</style></head>
<body>
  <div class="card">
    <h1>Approve MCP connection</h1>
    <p>A client wants to connect to your dombot portfolio. Approve only if you started this.</p>
    <div class="meta">
      <div><span>Client</span><span>${esc(req.clientName)}</span></div>
      <div><span>Redirect</span><span>${esc(origin)}</span></div>
      <div><span>Code</span><span class="code">${esc(req.displayCode)}</span></div>
    </div>
    <form method="post" action="/oauth/approve" class="btns">
      <input type="hidden" name="id" value="${esc(id)}">
      <button class="deny" name="decision" value="deny">Deny</button>
      <button class="approve" name="decision" value="approve">Approve</button>
    </form>
  </div>
</body></html>`;
}
