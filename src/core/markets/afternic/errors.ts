import type { WireError } from './wire';

/**
 * Any failed Afternic call. `status` is the HTTP status, or 0 when the
 * request never got a response (network error, timeout). `requestId` is the
 * X-Request-Id we sent: Afternic support asks for it.
 *
 * Messages never include credentials or request bodies.
 */
export class AfternicError extends Error {
  readonly status: number;
  /** Afternic's code (`RESOURCE_NOT_FOUND`, `RATE_LIMIT_EXCEEDED`, …). */
  readonly code: string;
  readonly fields: { code?: string; message?: string; path?: string }[];
  readonly requestId: string;
  /** Seconds, from a 429's Retry-After. */
  readonly retryAfter: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId: string;
    fields?: AfternicError['fields'];
    retryAfter?: number | null;
  }) {
    super(init.message);
    this.name = 'AfternicError';
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields ?? [];
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter ?? null;
  }

  /** Worth retrying: rate limited, a server error, or no response. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** An error from a response, reading Afternic's JSON body when there is one. */
export function errorFromResponse(
  status: number,
  body: string,
  requestId: string,
  retryAfter: string | null,
): AfternicError {
  let wire: WireError = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') wire = parsed as WireError;
  } catch {
    // Not JSON (the 404 for an unknown path is plain text).
  }
  const detail = wire.details ?? wire.detail;
  const fieldText = (wire.fields ?? [])
    .map((f) => (f.path ? `${f.path}: ${f.message}` : f.message))
    .filter(Boolean)
    .join('; ');
  const base = wire.message ?? (body.trim().slice(0, 200) || `HTTP ${status}`);
  const message = [base, detail, fieldText].filter(Boolean).join(' — ');
  const seconds = retryAfter == null ? NaN : Number(retryAfter);
  return new AfternicError({
    status,
    code: wire.code ?? `HTTP_${status}`,
    message,
    requestId,
    fields: wire.fields,
    retryAfter: Number.isFinite(seconds) ? seconds : null,
  });
}
