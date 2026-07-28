/**
 * Login rate limiting, expressed as a pure decision function so it can be unit
 * tested without a database.
 *
 * The Worker supplies the recent attempt timestamps from D1; this decides.
 * D1-backed rather than in-memory because Workers isolates are per-colo and an
 * in-memory counter would reset unpredictably.
 */

export const RATE_LIMIT_WINDOW_SECONDS = 15 * 60 // 15 minutes
export const RATE_LIMIT_MAX_ATTEMPTS = 8

export interface RateLimitDecision {
  allowed: boolean
  /** Seconds until the next attempt is permitted. Zero when allowed. */
  retryAfterSeconds: number
  remaining: number
}

export function evaluateRateLimit(
  failedAttemptTimestamps: number[],
  nowSeconds: number,
  maxAttempts: number = RATE_LIMIT_MAX_ATTEMPTS,
  windowSeconds: number = RATE_LIMIT_WINDOW_SECONDS,
): RateLimitDecision {
  const cutoff = nowSeconds - windowSeconds
  const recent = failedAttemptTimestamps.filter((t) => t > cutoff)

  if (recent.length < maxAttempts) {
    return { allowed: true, retryAfterSeconds: 0, remaining: maxAttempts - recent.length }
  }

  const oldest = Math.min(...recent)
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(oldest + windowSeconds - nowSeconds)),
    remaining: 0,
  }
}
