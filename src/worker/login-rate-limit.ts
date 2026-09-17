import { toBase64Url } from './keys';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_ATTEMPTS = 10;

/** HMAC hides source addresses in D1. Cloudflare sets CF-Connecting-IP at the edge;
 * do not substitute client-controlled X-Forwarded-For. */
export async function loginSource(
  request: Request,
  key: CryptoKey,
): Promise<string | null> {
  let source = request.headers.get('cf-connecting-ip');
  if (!source) {
    const host = new URL(request.url).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return null;
    source = 'local-development';
  }
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`login-source:${source}`),
      ),
    ),
  );
}

/** Reserve an attempt atomically across isolates, before checking a password.
 * A full window stops incrementing and never extends its expiry. */
export async function reserveLoginAttempt(
  db: D1Database,
  source: string,
  now = Date.now(),
): Promise<number> {
  await db
    .prepare('DELETE FROM login_attempts WHERE expires_at <= ?1')
    .bind(now)
    .run();
  const row = await db
    .prepare(
      `
    INSERT INTO login_attempts (source, attempts, expires_at) VALUES (?1, 1, ?2)
    ON CONFLICT(source) DO UPDATE SET attempts = login_attempts.attempts + 1
    WHERE login_attempts.attempts < ?3
    RETURNING attempts
  `,
    )
    .bind(source, now + LOGIN_WINDOW_MS, LOGIN_ATTEMPTS)
    .first<{ attempts: number }>();
  if (row) return 0;
  const existing = await db
    .prepare('SELECT expires_at FROM login_attempts WHERE source = ?1')
    .bind(source)
    .first<{ expires_at: number }>();
  return Math.max(1, (existing?.expires_at ?? now + LOGIN_WINDOW_MS) - now);
}

export async function clearLoginAttempts(
  db: D1Database,
  source: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM login_attempts WHERE source = ?1')
    .bind(source)
    .run();
}
