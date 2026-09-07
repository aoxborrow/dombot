import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ApiValidationError, invoke, type ApiMethodName } from '../core/api';
import { MCP_PUBLIC_PATHS, createMcpRoutes } from '../core/mcp/routes';
import { setAppIdentity } from '../core/app-info';
import { syncAll } from '../core/services/auto-sync';
import { resetBulkMemory } from '../core/services/bulk-jobs';
import { getSettings } from '../core/services/settings';
import { BundleError } from '../core/storage/bundle';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../core/storage/namespace';
import { APP_VERSION, webApi } from './api';
import {
  buildAuthConfig,
  checkPassword,
  clearSessionCookie,
  createSession,
  isAuthenticated,
  loginLockRemaining,
  recordLoginFailure,
  recordLoginSuccess,
  sameOrigin,
  sessionCookie,
  type AuthConfig,
} from './auth';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { withRequestLock } from './lock';
import { D1DocStore } from './storage/d1-doc-store';

// The Cloudflare Worker host: the same core (services, API table, storage
// façade) as the desktop app behind an HTTP transport. See
// docs/web-deployment.md.
//
// Per-isolate: the DocStore and derived keys are built once from env (bindings
// are stable for an isolate's life). Per-request: every namespace is
// re-hydrated from D1 — one query — so two isolates (or a cron and a request)
// never serve each other stale memory, and writes are flushed before the
// response goes out. Requests that touch state run one at a time within the
// isolate (src/worker/lock.ts), so that cycle can't interleave with another
// request's.

interface Boot {
  auth: AuthConfig;
}

let boot: Promise<Boot> | null = null;
let bootFor = '';

/** The env values boot depends on. If they change under a live isolate
 *  (wrangler dev reloading .dev.vars; a secret rotated in place), the cached
 *  keys and auth config must not outlive them. */
function bootFingerprint(env: Env): string {
  return [
    env.DOMBOT_SECRET,
    env.DOMBOT_PASSWORD,
    env.DOMBOT_AUTH,
    env.CF_ACCESS_TEAM_DOMAIN,
    env.CF_ACCESS_AUD,
  ].join('\u0000');
}

function bootOnce(env: Env): Promise<Boot> {
  const fp = bootFingerprint(env);
  if (boot && bootFor === fp) return boot;
  bootFor = fp;
  boot = (async () => {
    setAppIdentity({ version: APP_VERSION, platform: 'web' });
    const root = parseRootSecret(env.DOMBOT_SECRET);
    const cipher = await aesGcmCipher(await deriveEncryptionKey(root));
    configureStore(new EncryptedDocStore(new D1DocStore(env.DB), cipher));
    return { auth: await buildAuthConfig(env, root) };
  })().catch((err) => {
    boot = null; // let the next request retry (e.g. secret set after deploy)
    throw err;
  });
  return boot;
}

/** Fresh view of the store for this request. */
async function hydrate(): Promise<void> {
  await hydrateStores();
  resetBulkMemory();
}

type Vars = { auth: AuthConfig };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── boot on every request ───────────────────────────────────────────────────
app.use('*', async (c, next) => {
  let b: Boot;
  try {
    b = await bootOnce(c.env);
  } catch (err) {
    // Misconfigured instance: say exactly what's missing, to the operator
    // only (this page is reachable before any auth exists).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[worker] boot failed:', message);
    return c.text(`DomBot isn't configured yet.\n\n${message}\n`, 503);
  }
  c.set('auth', b.auth);
  await next();
});

// ── hydrate → handle → flush, serialized, for handlers that have state ─────
// Applied per route, *after* the checks that need no store (session cookie,
// origin, auth mode), so an unauthenticated request never costs a full
// decrypt of D1 or a turn on the lock. Under the lock a bulk step can't be
// re-hydrated out from under by a poll, and a burst of logins counts every
// attempt.
const stateful: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = (
  c,
  next,
) =>
  withRequestLock(async () => {
    await hydrate();
    await next();
    try {
      await flushWrites();
    } catch (err) {
      // The handler already answered, but its data didn't land; the next
      // hydrate will show the pre-request state. Say so instead of 200.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[worker] persist failed:', message);
      c.res = c.json({ error: `Could not save changes: ${message}` }, 500);
    }
  });
// The MCP surface is bearer-authenticated by its own routes, and the gate
// (Settings → MCP) and OAuth state live in the store, so those paths hydrate
// before their handlers run.
for (const path of MCP_PUBLIC_PATHS) app.use(path, stateful);

// ── security headers ────────────────────────────────────────────────────────
// Mirrors the desktop renderer's CSP (src/electron/index.ts): same-origin
// only. The renderer talks to /api on its own origin and nothing else.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function secure(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

// ── auth endpoints (password mode) ──────────────────────────────────────────

app.get('/auth/status', async (c) => {
  const auth = c.get('auth');
  return c.json({
    mode: auth.mode,
    authenticated: await isAuthenticated(auth, c.req.raw),
    version: APP_VERSION,
  });
});

app.post(
  '/auth/login',
  async (c, next) => {
    const auth = c.get('auth');
    if (auth.mode !== 'password')
      return c.json({ error: 'No login in this mode' }, 404);
    if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
    await next();
  },
  stateful, // the attempts counter lives in the store
  async (c) => {
    const auth = c.get('auth');
    // Requests are serialized per isolate, so a burst of guesses counts every
    // failure; across isolates the counter is last-write-wins (see
    // docs/self-hosting.md for the rate-limit rule that closes that gap).
    const wait = loginLockRemaining();
    if (wait > 0) {
      return c.json(
        {
          error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`,
        },
        429,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      password?: string;
    };
    if (
      typeof body.password !== 'string' ||
      !(await checkPassword(auth, body.password))
    ) {
      recordLoginFailure();
      return c.json({ error: 'Wrong password' }, 401);
    }
    recordLoginSuccess();
    c.header(
      'Set-Cookie',
      sessionCookie(await createSession(auth.sessionKey!), secure(c)),
    );
    return c.json({ ok: true });
  },
);

app.post('/auth/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie(secure(c)));
  return c.json({ ok: true });
});

// ── the API: one route over the method table ────────────────────────────────

app.post(
  '/api/:method',
  async (c, next) => {
    // Gate first — the session check needs only the derived key — so an
    // unauthenticated call never hydrates.
    if (!(await isAuthenticated(c.get('auth'), c.req.raw))) {
      return c.json({ error: 'Not signed in' }, 401);
    }
    if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
    await next();
  },
  stateful,
  async (c) => {
    const name = c.req.param('method') as ApiMethodName;
    const entry = Object.prototype.hasOwnProperty.call(webApi, name)
      ? webApi[name]
      : undefined;
    if (!entry) return c.json({ error: `Unknown method ${name}` }, 404);

    const body = (await c.req.json().catch(() => null)) as {
      args?: unknown;
    } | null;
    const args = Array.isArray(body?.args) ? (body!.args as unknown[]) : [];
    try {
      const result = await invoke(name, entry, args);
      return c.json({ result: result === undefined ? null : result });
    } catch (err) {
      if (err instanceof ApiValidationError || err instanceof BundleError) {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api] ${name} failed:`, message);
      return c.json({ error: message }, 500);
    }
  },
);

app.all('/api/*', (c) => c.json({ error: 'Method not allowed' }, 405));

// ── MCP + its OAuth server ──────────────────────────────────────────────────
// Shared with the desktop (src/core/mcp/routes.ts). Bearer-authenticated on
// its own, so it sits outside the session gate above; it answers 404 until
// the user turns it on in Settings → MCP. Behind Cloudflare Access these
// paths must be excluded from the Access policy (docs/self-hosting.md).
app.route('/', createMcpRoutes({ version: APP_VERSION }));

// ── the SPA ─────────────────────────────────────────────────────────────────
// Everything else is the renderer, served from the assets binding. In
// password mode the HTML itself is public (it has to be — it holds the login
// form) but carries no data; every data call is gated above. In the other
// modes the gate sits in front of the whole origin anyway.
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(res.headers);
  if ((headers.get('content-type') ?? '').includes('text/html')) {
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(res.body, { status: res.status, headers });
});

export default {
  fetch: app.fetch,

  // Hourly cron (wrangler.jsonc). syncAll() runs only when the cache is older
  // than the configured interval, so the setting decides the real cadence.
  async scheduled(_controller, env) {
    await bootOnce(env);
    await withRequestLock(async () => {
      await hydrate();
      const minutes = getSettings().autoSyncIntervalMinutes;
      if (minutes <= 0) {
        console.log('[cron] auto-sync disabled in settings');
        return;
      }
      const ran = await syncAll(minutes * 60_000);
      console.log(
        ran ? '[cron] portfolio synced' : '[cron] cache fresh; skipped',
      );
      await flushWrites();
    });
  },
} satisfies ExportedHandler<Env>;
