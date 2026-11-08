// Spaceship answers failures with a real HTTP status, an
// `application/problem+json` body (`detail`, and for 422 a `data` list of
// `{ field, details }`), and a `spaceship-error-code` header such as
// `business.…` (the spec; docs/sellerhub-api.md). `code` here is DomBot's
// own, from the status.

export type SpaceshipErrorCode =
  /** The key or secret is wrong. */
  | 'AUTH'
  /** The key works but lacks the scope for this call (SellerHub's, say). */
  | 'SCOPE'
  /** Spaceship refused the request as written; the message says why. */
  | 'INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | `HTTP_${number}`;

/**
 * Any failed Spaceship call. `status` is the HTTP status, 0 when there was
 * no response. The key and secret travel only in headers, so neither can
 * reach a message.
 */
export class SpaceshipError extends Error {
  readonly code: SpaceshipErrorCode;
  readonly status: number;
  /** Spaceship's own code (`spaceship-error-code`), when it sent one. */
  readonly spaceshipCode: string | null;

  constructor(
    code: SpaceshipErrorCode,
    message: string,
    status: number,
    spaceshipCode: string | null = null,
  ) {
    super(message);
    this.name = 'SpaceshipError';
    this.code = code;
    this.status = status;
    this.spaceshipCode = spaceshipCode;
  }

  /** Worth retrying a read: rate-limited, a server error, or no response. */
  get retryable(): boolean {
    return (
      this.code === 'RATE_LIMITED' || this.status === 0 || this.status >= 500
    );
  }
}

/** DomBot's code for a status Spaceship answered with. */
export function codeForStatus(status: number): SpaceshipErrorCode {
  if (status === 401) return 'AUTH';
  if (status === 403) return 'SCOPE';
  if (status === 400 || status === 422) return 'INVALID';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return `HTTP_${status}`;
}
