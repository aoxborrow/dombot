// Atom's seller API answers every failure with HTTP 200 and a JSON body that
// has only a `message` (observed unauthenticated, 2026-10-27: a bad token is
// `{"message":"Invalid API token or insufficient permissions"}` with status
// 200 and Content-Type text/html). There are no error codes, so `code` here
// is DomBot's own, from the status or the message's wording.

export type AtomErrorCode =
  /** The token or user id is missing, wrong or not allowed this call. */
  | 'AUTH'
  /** A daily quota (appraisal 10 a day by default). */
  | 'DAILY_LIMIT'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  /** Atom refused the request; the message says why. */
  | 'REJECTED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | `HTTP_${number}`;

/**
 * Any failed Atom call. `status` is the HTTP status (usually 200), 0 when
 * there was no response. Messages never include the token: they come from
 * Atom's body or from DomBot, never from a request URL.
 */
export class AtomError extends Error {
  readonly code: AtomErrorCode;
  readonly status: number;
  /** From a daily-limit answer, when Atom says. */
  readonly dailyLimit: number | null;
  readonly usedToday: number | null;

  constructor(
    code: AtomErrorCode,
    message: string,
    status = 200,
    quota: { dailyLimit?: number | null; usedToday?: number | null } = {},
  ) {
    super(redact(message));
    this.name = 'AtomError';
    this.code = code;
    this.status = status;
    this.dailyLimit = quota.dailyLimit ?? null;
    this.usedToday = quota.usedToday ?? null;
  }

  /** Worth retrying a read: rate-limited, a server error, or no response. */
  get retryable(): boolean {
    return (
      this.code === 'RATE_LIMITED' || this.status === 0 || this.status >= 500
    );
  }
}

/** Strips anything that looks like a token parameter, wherever it came from. */
export function redact(text: string): string {
  return text.replace(/(api_token|user_id)=[^&\s"']*/gi, '$1=<redacted>');
}

/** DomBot's code for one of Atom's error messages. */
export function codeFor(message: string): AtomErrorCode {
  const m = message.toLowerCase();
  if (/token|user ?id|permission|unauthori[sz]ed|access/.test(m)) return 'AUTH';
  if (/daily (rate )?limit/.test(m)) return 'DAILY_LIMIT';
  if (/rate limit|too many/.test(m)) return 'RATE_LIMITED';
  if (/not found|does not exist|doesn't exist|no such|not listed/.test(m)) {
    return 'NOT_FOUND';
  }
  return 'REJECTED';
}
