import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THROTTLE_POLICY,
  EMPTY_THROTTLE_STATE,
  checkThrottle,
  registerFailure,
  registerSuccess,
} from '@shared/rate-limit'

const NOW = 1_800_000_000
const { maxFailures, windowSeconds, baseLockSeconds, maxLockSeconds } = DEFAULT_THROTTLE_POLICY

/** Applies `count` consecutive failures at the same instant. */
function failTimes(count: number, at = NOW) {
  let state = { ...EMPTY_THROTTLE_STATE }
  for (let i = 0; i < count; i += 1) state = registerFailure(state, at)
  return state
}

describe('login throttle', () => {
  it('allows attempts when there is no history', () => {
    expect(checkThrottle(EMPTY_THROTTLE_STATE, NOW)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    })
  })

  it('tolerates failures below the threshold without locking', () => {
    const state = failTimes(maxFailures - 1)
    expect(state.lockedUntil).toBe(0)
    expect(checkThrottle(state, NOW).allowed).toBe(true)
  })

  it('locks at the threshold', () => {
    const state = failTimes(maxFailures)
    expect(state.lockedUntil).toBe(NOW + baseLockSeconds)

    const decision = checkThrottle(state, NOW)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterSeconds).toBe(baseLockSeconds)
  })

  it('releases the lock once it elapses', () => {
    const state = failTimes(maxFailures)
    expect(checkThrottle(state, NOW + baseLockSeconds - 1).allowed).toBe(false)
    expect(checkThrottle(state, NOW + baseLockSeconds).allowed).toBe(true)
  })

  it('escalates the lock exponentially, capped', () => {
    expect(failTimes(maxFailures + 1).lockedUntil).toBe(NOW + baseLockSeconds * 2)
    expect(failTimes(maxFailures + 2).lockedUntil).toBe(NOW + baseLockSeconds * 4)
    expect(failTimes(maxFailures + 20).lockedUntil).toBe(NOW + maxLockSeconds)
  })

  it('forgets failures older than the window, so scattered typos never accumulate', () => {
    // Four failures, then a long gap, then another: must not reach the threshold.
    let state = failTimes(maxFailures - 1)
    state = registerFailure(state, NOW + windowSeconds + 1)
    expect(state.failureCount).toBe(1)
    expect(state.lockedUntil).toBe(0)
  })

  it('keeps counting inside the window', () => {
    let state = failTimes(2)
    state = registerFailure(state, NOW + windowSeconds - 1)
    expect(state.failureCount).toBe(3)
  })

  it('clears everything on success', () => {
    expect(registerSuccess()).toEqual(EMPTY_THROTTLE_STATE)
    expect(checkThrottle(registerSuccess(), NOW).allowed).toBe(true)
  })
})

/**
 * The escalation has to survive elapsed time, not just consecutive calls (2026-08-06).
 *
 * Every test above fails N times at the SAME instant, so the rolling window
 * never expires and the cap arithmetic is proved in isolation. That is why a
 * real defect stayed invisible: with `windowSeconds` and `maxLockSeconds` both
 * at 15 minutes, the window expired at exactly the moment the lock reached the
 * cap, the counter reset to 1, and the attacker collected four more free
 * attempts. `maxLockSeconds` was unreachable — dead configuration describing a
 * lock nobody could ever be given.
 *
 * These two walk the clock the way an attacker would.
 */
describe('a sustained attack, with the clock running', () => {
  /** Attempts a patient attacker gets in `seconds`, obeying every lock. */
  function attemptsWithin(seconds: number): number {
    let state = { ...EMPTY_THROTTLE_STATE }
    let t = 0
    let attempts = 0
    while (t < seconds) {
      const decision = checkThrottle(state, t)
      if (!decision.allowed) {
        t += decision.retryAfterSeconds
        continue
      }
      state = registerFailure(state, t)
      attempts += 1
      t += 1
    }
    return attempts
  }

  it('keeps a day of guessing well under the old policy’s 768', () => {
    // Measured at 768/day when the window and the cap were both 900s.
    // Anything at or above that means the window is resetting the escalation
    // again and the cap has gone back to being decoration.
    expect(attemptsWithin(86_400)).toBeLessThan(500)
  })

  it('lets the escalation actually REACH the cap before the window forgets it', () => {
    // The property the old policy could not hold: the window must outlast the
    // longest lock, or the counter resets first and the cap is unreachable.
    expect(DEFAULT_THROTTLE_POLICY.windowSeconds).toBeGreaterThan(
      DEFAULT_THROTTLE_POLICY.maxLockSeconds,
    )

    let state = { ...EMPTY_THROTTLE_STATE }
    let t = 0
    let longestLock = 0
    for (let i = 0; i < 40; i += 1) {
      const decision = checkThrottle(state, t)
      if (!decision.allowed) {
        t += decision.retryAfterSeconds
        continue
      }
      state = registerFailure(state, t)
      longestLock = Math.max(longestLock, state.lockedUntil - t)
      t += 1
    }
    expect(longestLock).toBe(DEFAULT_THROTTLE_POLICY.maxLockSeconds)
  })

  it('still costs Alex nothing for four typos, and one minute for a fifth', () => {
    // The half that must not regress. These are the only two an ordinary
    // mistyped passphrase ever meets.
    expect(failTimes(maxFailures - 1).lockedUntil).toBe(0)
    expect(failTimes(maxFailures).lockedUntil).toBe(NOW + baseLockSeconds)
  })

  it('never locks Alex out for longer than the old policy could', () => {
    // 480s was the longest lock actually reachable before this retune, so the
    // worst case a person can experience has not moved.
    expect(DEFAULT_THROTTLE_POLICY.maxLockSeconds).toBeLessThanOrEqual(480)
  })
})
