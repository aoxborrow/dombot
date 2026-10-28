// Sedo reports a failed call as a <SEDOFAULT> document with a fault code
// (E1…E11101) and a fault string (docs: "Faultcodes & Faultstrings").
// UNVERIFIED: whether that comes with HTTP 200 or an error status; the
// client checks the body either way.

/** Faults that mean "try again later", per the docs' wording. */
const BUSY = new Set([
  // "Service not available. Please try again in five minutes"
  'E11',
  // "We are busy... please try again later..."
  'E17',
  // "Please note that the statistics are currently unavailable."
  'E2000',
]);

/** Faults about the credentials themselves, for the Settings card. */
const CREDENTIALS = new Set([
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
  'E8',
  'E9',
]);

/**
 * Any failed Sedo call. `code` is Sedo's fault code, or NETWORK, TIMEOUT,
 * HTTP_<status> or BAD_RESPONSE when there was no fault document. `status`
 * is the HTTP status, 0 when there was no response. Messages never include
 * credentials.
 */
export class SedoError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 200) {
    super(message);
    this.name = 'SedoError';
    this.code = code;
    this.status = status;
  }

  /** Worth retrying: Sedo said it's busy, a server error, or no response. */
  get retryable(): boolean {
    return BUSY.has(this.code) || this.status === 0 || this.status >= 500;
  }

  /** The partner ID, sign key, username or password is missing or wrong. */
  get credentials(): boolean {
    return CREDENTIALS.has(this.code);
  }
}

/** A friendlier line for the faults a Settings card is likely to show. */
export function faultHint(code: string): string | null {
  switch (code) {
    case 'E5':
    case 'E6':
      return 'Check the Sedo username and password (changing the password on sedo.com breaks the connection).';
    case 'E7':
    case 'E8':
    case 'E9':
      return 'Check the partner ID and sign key from Sedo’s partner program.';
    case 'E10':
      return 'Accept Sedo’s user agreement on sedo.com first.';
    case 'E12':
      return 'This Sedo partner account isn’t allowed to use that function.';
    default:
      return null;
  }
}
