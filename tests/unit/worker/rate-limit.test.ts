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
