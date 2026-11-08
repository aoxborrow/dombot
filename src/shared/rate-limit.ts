/** True when an error message says the registrar's quota is spent. Main
 *  raises its own "rate limit reached" error for a detail read, and only the
 *  message survives the trip to the renderer. Namecheap's own reply over its
 *  limit is error 500000, "Too many requests". */
export function isRateLimitMessage(message: string): boolean {
  return /too many requests|rate limit/i.test(message);
}
