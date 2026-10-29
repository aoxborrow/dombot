import {
  RateLimiter as MarketRateLimiter,
  realClock,
  sharedLimiter,
  type Clock,
} from '../rate-limit';

// Afternic allows 150 requests a minute per account, across every endpoint.

export { realClock, type Clock };

export const REQUESTS_PER_MINUTE = 150;

/** The market limiter at Afternic's published rate. */
export class RateLimiter extends MarketRateLimiter {
  constructor(clock: Clock = realClock, capacity = REQUESTS_PER_MINUTE) {
    super(clock, capacity);
  }
}

/** The limiter for an API key, created on first use. */
export function limiterFor(apiKey: string, clock?: Clock): RateLimiter {
  return sharedLimiter(
    `afternic:${apiKey}`,
    () => new RateLimiter(clock),
  ) as RateLimiter;
}
