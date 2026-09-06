import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpClient, McpPendingApproval } from '../../shared/ipc';
import { broadcastApprovalsChanged } from '../events';
import { Namespace } from '../storage/namespace';

// A minimal, single-user OAuth 2.1 authorization server for the MCP endpoint,
// host-neutral: every piece of state lives in the `mcp` namespace of the
// DocStore, so the desktop (a JSON file) and the web host (D1, where the
// authorize request, the in-app approval, and the token exchange may each land
// on a different isolate) run the same code. Clients self-register (dynamic
// registration); the human approves each new connection in the DomBot UI; the
// issued access token stays valid until revoked, so a paired client survives
// restarts.
//
// Access tokens are stored by SHA-256 hash: the store never holds a usable
// bearer token, only enough to recognize one. WebCrypto only — no node:crypto —
// so this runs unchanged in a Worker.

const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
/** A registered client that never finished pairing is forgotten after this. */
const UNPAIRED_CLIENT_TTL_MS = 60 * 60 * 1000;
/** Cap on unpaired registrations kept at once (a public endpoint can be spammed). */
const MAX_UNPAIRED_CLIENTS = 50;
/** Cap on approvals waiting at once; /authorize is public too. A client gets
 *  one — its newest request replaces the older — and past the cap the oldest
 *  request is dropped, so an attacker can't crowd out or bury the real one. */
const MAX_PENDING_APPROVALS = 10;
// Access tokens are long-lived, but the bearer check requires an explicit
// expiry, so we set a far-future one.
const TOKEN_TTL_SEC = 365 * 24 * 60 * 60;

/** What the authorize step needs to remember until the token exchange. */
export interface AuthorizationParams {
  state?: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  resource?: string;
}

interface StoredClient extends OAuthClientInformationFull {
  registeredAt: number;
}

interface StoredAuthCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
}

/** A token record — keyed by the token's hash, never the token itself. */
export interface StoredToken {
  clientId: string;
  clientName: string;
  scopes: string[];
  pairedAt: number;
  /** Seconds since epoch. */
  expiresAt: number;
}

export interface PendingApproval {
  id: string;
  clientId: string;
  clientName: string;
  displayCode: string;
  params: AuthorizationParams;
  status: 'pending' | 'approved' | 'denied';
  redirect?: string;
  createdAt: number;
}

type Record_ = StoredClient | StoredAuthCode | StoredToken | PendingApproval;

export const MCP_NAMESPACE = 'mcp';
const store = new Namespace<Record_>(MCP_NAMESPACE);

const CLIENT = 'client:';
const CODE = 'code:';
const TOKEN = 'token:';
const PENDING = 'pending:';

function entries<T extends Record_>(prefix: string): [string, T][] {
  return Object.entries(store.all())
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => [k.slice(prefix.length), v as T]);
}

// ── crypto helpers (WebCrypto) ───────────────────────────────────────────────

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of a token, hex — the key a token is stored under. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export async function verifyPkce(
  verifier: string,
  challenge: string,
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return b64 === challenge;
}

function displayCode(): string {
  const raw = randomHex(4).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── housekeeping ─────────────────────────────────────────────────────────────

/** Drops expired codes, stale approvals, and registrations that never paired. */
export function pruneStale(now = Date.now()): void {
  for (const [code, rec] of entries<StoredAuthCode>(CODE)) {
    if (rec.expiresAt < now) void store.delete(CODE + code);
  }
  for (const [id, p] of entries<PendingApproval>(PENDING)) {
    if (now - p.createdAt > PENDING_TTL_MS) void store.delete(PENDING + id);
  }
  const paired = new Set(
    entries<StoredToken>(TOKEN).map(([, t]) => t.clientId),
  );
  const pendingClients = new Set(
    entries<PendingApproval>(PENDING).map(([, p]) => p.clientId),
  );
  const unpaired = entries<StoredClient>(CLIENT)
    .filter(([id]) => !paired.has(id) && !pendingClients.has(id))
    .sort((a, b) => a[1].registeredAt - b[1].registeredAt);
  unpaired.forEach(([id, c], i) => {
    const overCap = unpaired.length - i > MAX_UNPAIRED_CLIENTS;
    if (overCap || now - c.registeredAt > UNPAIRED_CLIENT_TTL_MS) {
      void store.delete(CLIENT + id);
    }
  });
}

// ── clients (dynamic registration) ───────────────────────────────────────────

export function getClient(id: string): OAuthClientInformationFull | undefined {
  return store.get(CLIENT + id) as StoredClient | undefined;
}

/** Registers a client (RFC 7591). Public clients get no secret. */
export function registerClient(
  metadata: Omit<OAuthClientInformationFull, 'client_id'>,
): OAuthClientInformationFull {
  pruneStale();
  const isPublic = metadata.token_endpoint_auth_method === 'none';
  const issuedAt = nowSec();
  const full: StoredClient = {
    ...metadata,
    client_id: crypto.randomUUID(),
    client_id_issued_at: issuedAt,
    client_secret: isPublic ? undefined : randomHex(32),
    client_secret_expires_at: isPublic ? undefined : 0,
    registeredAt: Date.now(),
  };
  void store.set(CLIENT + full.client_id, full);
  const info: OAuthClientInformationFull & { registeredAt?: number } = {
    ...full,
  };
  delete info.registeredAt;
  return info;
}

/** Client authentication for /token and /revoke: secret required if issued. */
export function authenticateClient(
  clientId: string,
  clientSecret: string | undefined,
): OAuthClientInformationFull | null {
  const client = getClient(clientId);
  if (!client) return null;
  if (client.client_secret) {
    if (!clientSecret || clientSecret !== client.client_secret) return null;
    if (
      client.client_secret_expires_at &&
      client.client_secret_expires_at < nowSec()
    ) {
      return null;
    }
  }
  return client;
}

// ── approval flow ────────────────────────────────────────────────────────────

/** Starts an authorization: parks the request until the user decides. */
export function createPendingApproval(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): PendingApproval {
  pruneStale();
  const open = entries<PendingApproval>(PENDING).sort(
    (a, b) => a[1].createdAt - b[1].createdAt,
  );
  for (const [id, existing] of open) {
    if (existing.clientId === client.client_id) void store.delete(PENDING + id);
  }
  const remaining = open.filter(([, e]) => e.clientId !== client.client_id);
  for (const [id] of remaining.slice(
    0,
    Math.max(0, remaining.length + 1 - MAX_PENDING_APPROVALS),
  )) {
    void store.delete(PENDING + id);
  }
  const p: PendingApproval = {
    id: crypto.randomUUID(),
    clientId: client.client_id,
    clientName: client.client_name ?? client.client_id,
    displayCode: displayCode(),
    params,
    status: 'pending',
    createdAt: Date.now(),
  };
  void store.set(PENDING + p.id, p);
  broadcastApprovalsChanged();
  return p;
}

/** Pending approvals awaiting a decision, for display in the app. */
export function listPendingApprovals(): McpPendingApproval[] {
  pruneStale();
  return entries<PendingApproval>(PENDING)
    .map(([, p]) => p)
    .filter((p) => p.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((p) => ({
      id: p.id,
      clientName: p.clientName,
      code: p.displayCode,
      createdAt: p.createdAt,
    }));
}

/** Status of an authorization, polled by the browser waiting page. */
export function getApprovalStatus(id: string): {
  status: PendingApproval['status'] | 'unknown';
  redirect?: string;
} {
  const p = store.get(PENDING + id) as PendingApproval | undefined;
  if (!p || Date.now() - p.createdAt > PENDING_TTL_MS)
    return { status: 'unknown' };
  return { status: p.status, redirect: p.redirect };
}

/**
 * Records the user's decision: on approval mints a one-time auth code and
 * builds the redirect back to the client; on denial builds an error redirect.
 * The waiting page picks the redirect up via getApprovalStatus().
 */
export function resolvePending(id: string, approve: boolean): string | null {
  const p = store.get(PENDING + id) as PendingApproval | undefined;
  if (!p) return null;
  if (p.status !== 'pending') return p.redirect ?? null;

  const redirect = new URL(p.params.redirectUri);
  const next: PendingApproval = { ...p };
  if (approve) {
    const code = randomHex(24);
    const rec: StoredAuthCode = {
      clientId: p.clientId,
      codeChallenge: p.params.codeChallenge,
      redirectUri: p.params.redirectUri,
      scopes: p.params.scopes,
      expiresAt: Date.now() + CODE_TTL_MS,
    };
    void store.set(CODE + code, rec);
    redirect.searchParams.set('code', code);
    next.status = 'approved';
  } else {
    redirect.searchParams.set('error', 'access_denied');
    next.status = 'denied';
  }
  if (p.params.state) redirect.searchParams.set('state', p.params.state);
  next.redirect = redirect.toString();
  void store.set(PENDING + id, next);
  broadcastApprovalsChanged();
  return next.redirect;
}

// ── token exchange ───────────────────────────────────────────────────────────

export class OAuthGrantError extends Error {
  constructor(
    readonly code: 'invalid_grant' | 'invalid_request',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Redeems an authorization code (PKCE S256 verified here) for an access token.
 * Returns the token response body.
 */
export async function exchangeAuthorizationCode(
  client: OAuthClientInformationFull,
  code: string,
  codeVerifier: string,
  redirectUri?: string,
): Promise<{
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  scope?: string;
}> {
  const rec = store.get(CODE + code) as StoredAuthCode | undefined;
  if (!rec || rec.clientId !== client.client_id || rec.expiresAt < Date.now()) {
    throw new OAuthGrantError(
      'invalid_grant',
      'Invalid or expired authorization code',
    );
  }
  if (redirectUri !== undefined && redirectUri !== rec.redirectUri) {
    throw new OAuthGrantError('invalid_grant', 'redirect_uri mismatch');
  }
  if (!(await verifyPkce(codeVerifier, rec.codeChallenge))) {
    throw new OAuthGrantError(
      'invalid_grant',
      'code_verifier does not match the challenge',
    );
  }
  void store.delete(CODE + code);

  const accessToken = randomHex(32);
  const token: StoredToken = {
    clientId: client.client_id,
    clientName: client.client_name ?? client.client_id,
    scopes: rec.scopes,
    pairedAt: Date.now(),
    expiresAt: nowSec() + TOKEN_TTL_SEC,
  };
  void store.set(TOKEN + (await hashToken(accessToken)), token);
  // Also covers "the paired-client list changed" so an open settings page
  // refreshes without a reload.
  broadcastApprovalsChanged();

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: TOKEN_TTL_SEC,
    scope: rec.scopes.join(' ') || undefined,
  };
}

/** Looks a bearer token up. Null if unknown or expired. */
export async function verifyAccessToken(
  token: string,
): Promise<AuthInfo | null> {
  const rec = store.get(TOKEN + (await hashToken(token))) as
    StoredToken | undefined;
  if (!rec || rec.expiresAt < nowSec()) return null;
  return {
    token,
    clientId: rec.clientId,
    scopes: rec.scopes,
    expiresAt: rec.expiresAt,
    extra: { clientName: rec.clientName, pairedAt: rec.pairedAt },
  };
}

/** Revokes one token (RFC 7009); unknown tokens are a no-op, per the RFC. */
export async function revokeToken(
  client: OAuthClientInformationFull,
  token: string,
): Promise<void> {
  const key = TOKEN + (await hashToken(token));
  const rec = store.get(key) as StoredToken | undefined;
  if (rec && rec.clientId === client.client_id) {
    await store.delete(key);
    broadcastApprovalsChanged();
  }
}

// ── paired clients ───────────────────────────────────────────────────────────

/** Distinct paired clients (by client id), most recent first. */
export function listMcpClients(): McpClient[] {
  const byClient = new Map<string, McpClient>();
  for (const [, t] of entries<StoredToken>(TOKEN)) {
    const existing = byClient.get(t.clientId);
    if (!existing || t.pairedAt > existing.pairedAt) {
      byClient.set(t.clientId, {
        clientId: t.clientId,
        clientName: t.clientName,
        pairedAt: t.pairedAt,
      });
    }
  }
  return [...byClient.values()].sort((a, b) => b.pairedAt - a.pairedAt);
}

/** Whether any client is paired (an upgrade hint for the MCP default). */
export function hasPairedClients(): boolean {
  return entries<StoredToken>(TOKEN).length > 0;
}

/** Revokes every token issued to a client, un-pairing it. */
export async function revokeMcpClient(clientId: string): Promise<void> {
  for (const [hash, t] of entries<StoredToken>(TOKEN)) {
    if (t.clientId === clientId) await store.delete(TOKEN + hash);
  }
  await store.delete(CLIENT + clientId);
  broadcastApprovalsChanged();
}

/**
 * The store entry for a token issued by an earlier DomBot (the desktop's
 * mcp-tokens.json), so a host's storage migration can keep the pairing. Runs
 * before hydration, hence returns the raw entry rather than writing it.
 */
export async function legacyTokenEntry(
  info: AuthInfo,
): Promise<{ key: string; value: StoredToken }> {
  return {
    key: TOKEN + (await hashToken(info.token)),
    value: {
      clientId: info.clientId,
      clientName: String(info.extra?.clientName ?? info.clientId),
      scopes: info.scopes ?? [],
      pairedAt: Number(info.extra?.pairedAt ?? 0),
      expiresAt: info.expiresAt ?? nowSec() + TOKEN_TTL_SEC,
    },
  };
}
