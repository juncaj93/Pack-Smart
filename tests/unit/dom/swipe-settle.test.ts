import { describe, expect, it } from 'vitest'
import { settleDuration } from '@/components/SwipeRow'

/**
 * How long a row takes to settle after the thumb lifts.
 *
 * This exists because "way too springy" was the report, and the cause was not the
 * easing curve — it was that a CSS transition has ONE duration for every distance.
 * Correcting a 12px over-drag took the same quarter-second as travelling the full
 * 128px to open the tray, so the small movement crawled instead of snapping.
 *
 * iOS does not have this problem because it animates with a spring carrying the
 * gesture's velocity. The honest approximation is a constant SPEED: the duration
 * comes from the distance left to cover. These tests pin that, because a future
 * "let us just simplify this to a constant" would restore the exact complaint.
 */

describe('the settle takes as long as the distance deserves', () => {
  it('is quick for a short correction', () => {
    // The over-drag case: a dozen pixels must not take a quarter of a second.
    expect(settleDuration(-140, -128)).toBeLessThan(150)
  })

  it('is longer for the full width of the tray', () => {
    expect(settleDuration(-128, 0)).toBeGreaterThan(settleDuration(-140, -128))
  })

  it('scales with distance rather than being one number', () => {
    const short = settleDuration(0, -30)
    const long = settleDuration(0, -128)
    expect(long).toBeGreaterThan(short)
  })

  it('never crawls, and never drags', () => {
    /*
     * Both clamps matter. Below the floor a correction is imperceptible and reads
     * as a jump rather than a movement; above the ceiling a full-width open starts
     * to feel slow again, which is where this came in.
     */
    for (const [from, to] of [
      [0, 0],
      [-1, 0],
      [-140, -128],
      [-128, 0],
      [300, 0],
      [1000, 0],
    ] as const) {
      const ms = settleDuration(from, to)
      expect(ms).toBeGreaterThanOrEqual(110)
      expect(ms).toBeLessThanOrEqual(220)
    }
  })

  it('does not care which direction the row is moving', () => {
    expect(settleDuration(0, -128)).toBe(settleDuration(-128, 0))
    expect(settleDuration(0, 128)).toBe(settleDuration(0, -128))
  })
})
