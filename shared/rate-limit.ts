/**
 * Login throttling policy.
 *
 * `01_ARCHITECTURE.md` §4 requires the login endpoint to be rate-limited. The
 * decision is a pure function of the stored counters and the current time, so
 * the policy is unit-testable without a database, and the Worker is left with
 * nothing but the read and the write.
 */

export interface ThrottleState {
  failureCount: number
  /** Unix seconds when the current counting window began. */
  windowStartedAt: number
  /** Unix seconds until which attempts are refused, or 0 when unlocked. */
  lockedUntil: number
}

export interface ThrottlePolicy {
  /** Failures tolerated inside one window before a lock is applied. */
  maxFailures: number
  /** Length of the counting window, in seconds. */
  windowSeconds: number
  /** Lock duration applied at the threshold, in seconds. */
  baseLockSeconds: number
  /** Cap on the exponentially escalating lock, in seconds. */
  maxLockSeconds: number
}

/**
 * Deliberately gentle. This guards one person's private site against online
 * guessing, not a credential-stuffing campaign; locking Alex out of his own
 * packing list on a hotel connection would be the worse failure.
 */
export const DEFAULT_THROTTLE_POLICY: ThrottlePolicy = {
  maxFailures: 5,
  windowSeconds: 15 * 60,
  baseLockSeconds: 60,
  maxLockSeconds: 15 * 60,
}

export const EMPTY_THROTTLE_STATE: ThrottleState = {
  failureCount: 0,
  windowStartedAt: 0,
  lockedUntil: 0,
}

export interface ThrottleDecision {
  allowed: boolean
  /** Seconds the caller must wait. Zero when allowed. */
  retryAfterSeconds: number
}

export function checkThrottle(
  state: ThrottleState,
  nowSeconds: number,
  _policy: ThrottlePolicy = DEFAULT_THROTTLE_POLICY,
): ThrottleDecision {
  if (state.lockedUntil > nowSeconds) {
    return { allowed: false, retryAfterSeconds: state.lockedUntil - nowSeconds }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Folds a failed attempt into the state.
 *
 * The window is rolling: failures older than `windowSeconds` are forgotten, so
 * a handful of typos spread over an afternoon never accumulate into a lock.
 * At the threshold the lock doubles per additional failure, capped.
 */
export function registerFailure(
  state: ThrottleState,
  nowSeconds: number,
  policy: ThrottlePolicy = DEFAULT_THROTTLE_POLICY,
): ThrottleState {
  const windowExpired = nowSeconds - state.windowStartedAt >= policy.windowSeconds
  const failureCount = windowExpired ? 1 : state.failureCount + 1
  const windowStartedAt = windowExpired ? nowSeconds : state.windowStartedAt || nowSeconds

  if (failureCount < policy.maxFailures) {
    return { failureCount, windowStartedAt, lockedUntil: 0 }
  }

  const over = failureCount - policy.maxFailures
  const lockSeconds = Math.min(policy.baseLockSeconds * 2 ** over, policy.maxLockSeconds)
  return { failureCount, windowStartedAt, lockedUntil: nowSeconds + lockSeconds }
}

/** A successful login clears the record entirely. */
export function registerSuccess(): ThrottleState {
  return { ...EMPTY_THROTTLE_STATE }
}
