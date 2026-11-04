// Dynadot's RESTful v2 API answers failures with a real HTTP status and an
// envelope, `{"code":404,"message":"Not Found","error":{"description":"Can
// not find the domanio.com."}}` (observed 2026-11-04). `code` here is
// DomBot's own, from the status.

export type DynadotErrorCode =
  /** The key or signature is missing, wrong or not allowed this call. */
  | 'AUTH'
  /** Dynadot refused the request as written; the message says why. */
  | 'INVALID'
  | 'NOT_FOUND'
  /** The name or account isn't in a state that allows it. */
  | 'CONFLICT'
  /** The name's own (transfer) lock is on. */
  | 'DOMAIN_LOCKED'
  /** The Dynadot account lock is on. */
  | 'ACCOUNT_LOCKED'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | `HTTP_${number}`;

/**
 * Any failed Dynadot call. `status` is the HTTP status, 0 when there was no
 * response. The key travels only in the Authorization header and the secret
 * only signs, so neither can reach a message.
 */
export class DynadotError extends Error {
  readonly code: DynadotErrorCode;
  readonly status: number;

  constructor(code: DynadotErrorCode, message: string, status: number) {
    super(message);
    this.name = 'DynadotError';
    this.code = code;
    this.status = status;
  }

  /** Worth retrying a read: rate-limited, a server error, or no response. */
  get retryable(): boolean {
    return (
      this.code === 'RATE_LIMITED' || this.status === 0 || this.status >= 500
    );
  }
}

/**
 * Which lock a refusal is about: "Domain is locked. Please unlock domain
 * first." (409) or "Please unlock your account firstly." (400), observed.
 */
export function lockCode(
  message: string,
): 'DOMAIN_LOCKED' | 'ACCOUNT_LOCKED' | null {
  if (/unlock your account|account is locked/i.test(message)) {
    return 'ACCOUNT_LOCKED';
  }
  if (/domain is locked|unlock domain/i.test(message)) return 'DOMAIN_LOCKED';
  return null;
}

/** DomBot's code for a status Dynadot answered with. */
export function codeForStatus(status: number): DynadotErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 400) return 'INVALID';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return `HTTP_${status}`;
}
