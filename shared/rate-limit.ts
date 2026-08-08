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
 * Deliberately gentle. This guards one person's site against online guessing,
 * not a credential-stuffing campaign; locking Alex out of his own packing list
 * on a hotel connection would be the worse failure.
 *
 * RETUNED WHEN THE REPOSITORY WENT PUBLIC (2026-08-06), and the change is
 * smaller than it looks.
 *
 * The old policy had `windowSeconds` and `maxLockSeconds` both at 15 minutes,
 * and that made the cap DEAD CONFIGURATION: the rolling window expired at
 * exactly the moment the escalating lock would have reached it, so the counter
 * reset to 1 and the attacker got four more free attempts. Measured against the
 * real functions: the longest lock anyone could actually reach was **480s**,
 * never the 900s the constant claimed, and a sustained attacker got **768
 * attempts a day**.
 *
 * So the window is now longer than the cap, which is what makes escalation
 * accumulate — and the cap is lowered to 480s, the longest lock that was ever
 * genuinely reachable before. **Alex's worst case is therefore unchanged**, and
 * a sustained attacker drops to about 336 attempts a day.
 *
 * `maxFailures` stays at 5 and `baseLockSeconds` at 60, because those are the
 * two Alex actually meets: four typos still cost nothing at all, and a fifth
 * costs a minute.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not raise the maximum lock, even
 * though that would slow an attacker further. `THROTTLE_KEY` in `worker/auth.ts`
 * is the constant `'login'` — ONE GLOBAL BUCKET, not per source — so a longer
 * lock is also a longer window in which any stranger who knows the URL can hold
 * Alex out of his own app. Publishing the repository made that URL easy to find.
 * The real fix is to key the bucket per source address; until that exists,
 * lengthening the lock trades a threat the passphrase already handles for one it
 * does not.
 */
export const DEFAULT_THROTTLE_POLICY: ThrottlePolicy = {
  maxFailures: 5,
  windowSeconds: 60 * 60,
  baseLockSeconds: 60,
  maxLockSeconds: 8 * 60,
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
