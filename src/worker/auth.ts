import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Namespace } from '../core/storage/namespace';
import {
  deriveSessionKey,
  fromBase64Url,
  timingSafeEqualStrings,
  toBase64Url,
} from './keys';

// Authentication for the web host. Three modes, chosen by DOMBOT_AUTH
// (docs/web-deployment.md → Auth modes):
//
//   password           built-in login against the DOMBOT_PASSWORD secret; a
//                      signed, HttpOnly cookie carries the session
//   cloudflare-access  Cloudflare Access fronts the Worker; every request's
//                      Cf-Access-Jwt-Assertion is verified against the team's
//                      JWKS and the app's audience tag
//   external           a platform gate the function can't verify (Vercel
//                      Password Protection, a reverse proxy) — explicit opt-in,
//                      the app runs with no login of its own
//
// No auth state lives in the database except login-attempt backoff.

export type AuthMode = 'password' | 'cloudflare-access' | 'external';

export interface AuthConfig {
  mode: AuthMode;
  /** password mode */
  password?: string;
  sessionKey?: CryptoKey;
  /** cloudflare-access mode */
  accessTeamDomain?: string;
  accessAud?: string;
}

export function parseAuthMode(value: string | undefined): AuthMode {
  if (value === undefined || value === '' || value === 'password')
    return 'password';
  if (value === 'cloudflare-access' || value === 'external') return value;
  throw new Error(
    `DOMBOT_AUTH must be "password", "cloudflare-access", or "external" (got "${value}")`,
  );
}

/** Builds the auth config from the Worker's env. Fails loudly on a mode
 *  whose prerequisites are missing — better than an unlocked instance. */
export async function buildAuthConfig(
  env: {
    DOMBOT_AUTH?: string;
    DOMBOT_PASSWORD?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
  },
  root: Uint8Array,
): Promise<AuthConfig> {
  const mode = parseAuthMode(env.DOMBOT_AUTH);
  if (mode === 'password') {
    if (!env.DOMBOT_PASSWORD) {
      throw new Error(
        'DOMBOT_PASSWORD is not set. Run `npm run web:secrets` (see docs/self-hosting.md).',
      );
    }
    return {
      mode,
      password: env.DOMBOT_PASSWORD,
      sessionKey: await deriveSessionKey(root, env.DOMBOT_PASSWORD),
    };
  }
  if (mode === 'cloudflare-access') {
    if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
      throw new Error(
        'DOMBOT_AUTH=cloudflare-access needs CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.',
      );
    }
    return {
      mode,
      accessTeamDomain: env.CF_ACCESS_TEAM_DOMAIN.replace(/\/$/, ''),
      accessAud: env.CF_ACCESS_AUD,
    };
  }
  return { mode };
}

// ── password mode: sessions ─────────────────────────────────────────────────

export const SESSION_COOKIE = 'dombot_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionClaims {
  iat: number;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Mints a signed session token: base64url(claims).base64url(hmac). */
export async function createSession(
  key: CryptoKey,
  now = Date.now(),
): Promise<string> {
  const claims: SessionClaims = { iat: now, exp: now + SESSION_TTL_MS };
  const body = toBase64Url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(body)),
  );
  return `${body}.${toBase64Url(sig)}`;
}

/** Verifies a session token's signature and expiry. */
export async function verifySession(
  key: CryptoKey,
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sig),
      enc.encode(body),
    );
  } catch {
    return false;
  }
  if (!ok) return false;
  try {
    const claims = JSON.parse(dec.decode(fromBase64Url(body))) as SessionClaims;
    return typeof claims.exp === 'number' && claims.exp > now;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  return (
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; ` +
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` +
    (secure ? '; Secure' : '')
  );
}

export function clearSessionCookie(secure: boolean): string {
  return (
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` +
    (secure ? '; Secure' : '')
  );
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

// ── password mode: login attempts ───────────────────────────────────────────
// Single user, so a crude exponential backoff on failed attempts is enough:
// after the 3rd failure each further attempt must wait 2^(n-3) seconds, capped
// at an hour. Stored in the `auth` namespace so it survives isolate churn.

const attempts = new Namespace<{ failures: number; lockedUntil: number }>(
  'auth',
);
const ATTEMPTS_KEY = 'attempts';
const FREE_FAILURES = 3;
const MAX_LOCK_MS = 60 * 60 * 1000;

/** Milliseconds until another attempt is allowed (0 = now). */
export function loginLockRemaining(now = Date.now()): number {
  const a = attempts.get(ATTEMPTS_KEY);
  return a ? Math.max(0, a.lockedUntil - now) : 0;
}

export function recordLoginFailure(now = Date.now()): void {
  const a = attempts.get(ATTEMPTS_KEY) ?? { failures: 0, lockedUntil: 0 };
  const failures = a.failures + 1;
  const over = failures - FREE_FAILURES;
  const lockMs = over > 0 ? Math.min(2 ** (over - 1) * 1000, MAX_LOCK_MS) : 0;
  void attempts.set(ATTEMPTS_KEY, { failures, lockedUntil: now + lockMs });
}

export function recordLoginSuccess(): void {
  void attempts.delete(ATTEMPTS_KEY);
}

/** Checks a submitted password against the configured one, constant-time. */
export function checkPassword(
  config: AuthConfig,
  submitted: string,
): Promise<boolean> {
  if (!config.password) return Promise.resolve(false);
  return timingSafeEqualStrings(config.password, submitted);
}

// ── cloudflare-access mode ──────────────────────────────────────────────────

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verifies the Access JWT on a request. Never trusts the header's presence. */
export async function verifyAccessJwt(
  config: AuthConfig,
  token: string | undefined,
): Promise<boolean> {
  if (!token || !config.accessTeamDomain || !config.accessAud) return false;
  let jwks = jwksCache.get(config.accessTeamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${config.accessTeamDomain}/cdn-cgi/access/certs`),
    );
    jwksCache.set(config.accessTeamDomain, jwks);
  }
  try {
    await jwtVerify(token, jwks, {
      issuer: config.accessTeamDomain,
      audience: config.accessAud,
    });
    return true;
  } catch {
    return false;
  }
}

// ── the gate ────────────────────────────────────────────────────────────────

/** Whether a request is authenticated under the configured mode. */
export async function isAuthenticated(
  config: AuthConfig,
  request: Request,
): Promise<boolean> {
  switch (config.mode) {
    case 'password':
      return verifySession(
        config.sessionKey!,
        readCookie(request.headers.get('cookie') ?? undefined, SESSION_COOKIE),
      );
    case 'cloudflare-access':
      return verifyAccessJwt(
        config,
        request.headers.get('cf-access-jwt-assertion') ?? undefined,
      );
    case 'external':
      return true;
  }
}

/** Belt-and-braces CSRF check for state-changing requests: the Origin (or,
 *  failing that, Referer) must match the request's own host. */
export function sameOrigin(request: Request): boolean {
  const origin =
    request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
