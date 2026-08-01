import { describe, expect, it } from 'vitest'
import {
  COMMIT_FRACTION,
  FLICK_MIN_FRACTION,
  LOCK_DISTANCE,
  TRAY_WIDTH,
  beginGesture,
  cancelGesture,
  endGesture,
  moveGesture,
  settleDuration,
  type Gesture,
} from '@/components/swipe/recognizer'

/**
 * The gesture's decisions, tested as arithmetic.
 *
 * This file exists because the previous coverage could not have caught the
 * regression it was supposed to. Every swipe assertion in the repository ran
 * through a browser and a synthesised event sequence — so the tests agreed with
 * the implementation about what a swipe *is*, which is precisely the agreement
 * that let a gesture pass automation while failing on a phone.
 *
 * These call the recognizer with the numbers a thumb actually produces. They
 * cannot prove the feel; they can prove that the arithmetic under it says what
 * `INTERACTION_PATTERNS.md` §2 says.
 */

const WIDTH = 360
const GEOMETRY = { width: WIDTH, hasTray: true }

function at(x: number, y: number, time = 0) {
  return { x, y, time }
}

function fresh(trayOpen = false): Gesture {
  const gesture = beginGesture(at(0, 0, 0), { trayOpen })
  if (!gesture) throw new Error('the fixture gesture was refused')
  return gesture
}

/** Walks a gesture through a straight line in `steps` samples. */
function drag(gesture: Gesture, dx: number, dy: number, steps = 10, duration = 200): Gesture {
  let current = gesture
  for (let step = 1; step <= steps; step += 1) {
    current = moveGesture(
      current,
      at((dx * step) / steps, (dy * step) / steps, (duration * step) / steps),
      GEOMETRY,
    )
  }
  return current
}

describe('direction locking', () => {
  it('claims nothing until the finger has actually moved', () => {
    /*
     * The lock distance is the window inside which the BROWSER is also deciding
     * whether this touch is a scroll. Claiming early is not a nicety — a claim
     * that lands after the browser's is a claim that cannot be enforced.
     */
    const gesture = moveGesture(fresh(), at(LOCK_DISTANCE - 1, 0, 16), GEOMETRY)
    expect(gesture.axis).toBe('undecided')
    expect(gesture.offset).toBe(0)
  })

  it('claims horizontal as soon as the movement clears the lock distance', () => {
    const gesture = moveGesture(fresh(), at(LOCK_DISTANCE + 1, 0, 16), GEOMETRY)
    expect(gesture.axis).toBe('horizontal')
  })

  it('leaves a diagonal thumb to the browser unless it is clearly sideways', () => {
    // 1.4× is the contract. 10 across and 8 down is a scroll; 20 and 8 is a swipe.
    expect(moveGesture(fresh(), at(10, 8, 16), GEOMETRY).axis).toBe('vertical')
    expect(moveGesture(fresh(), at(20, 8, 16), GEOMETRY).axis).toBe('horizontal')
  })

  it('never moves the row once the gesture is the browser’s', () => {
    /*
     * The half of the fight that is easy to forget. A row sliding sideways
     * underneath a list that is scrolling is the same defect as a list that
     * will not scroll — it is just less obvious in a screenshot.
     */
    const scrolled = drag(fresh(), 12, 90)
    expect(scrolled.axis).toBe('vertical')
    expect(scrolled.offset).toBe(0)
    expect(scrolled.pastThreshold).toBe(false)
  })

  it('decides once and does not change its mind', () => {
    // A swipe that starts sideways and curls downwards stays a swipe.
    const gesture = drag(drag(fresh(), 40, 0), 40, 120)
    expect(gesture.axis).toBe('horizontal')
  })

  it('does not track a row it could not measure', () => {
    // Width zero means the row was never measured. Nothing may move, and
    // nothing may commit, rather than dividing by a guess.
    const gesture = moveGesture(fresh(), at(80, 0, 32), { width: 0, hasTray: true })
    expect(gesture.offset).toBe(0)
    expect(endGesture(gesture, at(80, 0, 32), { width: 0, hasTray: true }).kind).toBe('settle')
  })
})

describe('more than one finger', () => {
  it('refuses to start', () => {
    /*
     * A second `touchstart` used to overwrite the origin, so a stray thumb or
     * the heel of a hand landing mid-swipe re-anchored the gesture and the row
     * jumped to an offset computed from a point the moving finger had never
     * been at. Held one-handed beside a suitcase that is not rare, and it looks
     * exactly like the jitter it is easy to blame on the browser.
     */
    expect(beginGesture(at(0, 0), { trayOpen: false, touchCount: 2 })).toBeNull()
    expect(beginGesture(at(0, 0), { trayOpen: false, touchCount: 3 })).toBeNull()
  })

  it('starts for exactly one', () => {
    expect(beginGesture(at(0, 0), { trayOpen: false, touchCount: 1 })).not.toBeNull()
  })
})

describe('the commit threshold', () => {
  it('commits a slow drag past 45% of the row', () => {
    const dx = WIDTH * COMMIT_FRACTION + 1
    expect(endGesture(drag(fresh(), dx, 0, 10, 900), at(dx, 0, 900), GEOMETRY)).toEqual({
      kind: 'complete',
      target: 0,
    })
  })

  it('does not commit a slow drag that stopped short', () => {
    const dx = WIDTH * COMMIT_FRACTION - 1
    expect(endGesture(drag(fresh(), dx, 0, 10, 900), at(dx, 0, 900), GEOMETRY).kind).toBe('settle')
  })

  it('commits a flick that still crossed a quarter of the row', () => {
    const dx = WIDTH * FLICK_MIN_FRACTION + 5
    expect(endGesture(drag(fresh(), dx, 0, 6, 60), at(dx, 0, 60), GEOMETRY).kind).toBe('complete')
  })

  it('refuses a fast twitch, however fast it was', () => {
    /*
     * Velocity alone, guarded only by a small minimum, lets a 40px flinch — a
     * tenth of the row — mark something packed by accident. A flick still
     * commits earlier than a drag; it just has to be a flick ACROSS the row.
     */
    const dx = WIDTH * FLICK_MIN_FRACTION - 5
    expect(endGesture(drag(fresh(), dx, 0, 4, 30), at(dx, 0, 30), GEOMETRY).kind).toBe('settle')
  })

  it('reports the threshold while the finger is still down', () => {
    // This is what fills the action in behind the row, so it has to be true
    // BEFORE the release rather than derived from it.
    expect(drag(fresh(), WIDTH * COMMIT_FRACTION + 10, 0).pastThreshold).toBe(true)
    expect(drag(fresh(), WIDTH * COMMIT_FRACTION - 10, 0).pastThreshold).toBe(false)
  })

  it('resists past the action’s own width instead of tracking 1:1 forever', () => {
    const far = drag(fresh(), WIDTH, 0)
    expect(far.offset).toBeLessThan(WIDTH)
    expect(far.offset).toBeGreaterThan(WIDTH * COMMIT_FRACTION)
  })
})

describe('the left tray', () => {
  it('latches open past 40% of the tray', () => {
    expect(endGesture(drag(fresh(), -60, 0, 10, 900), at(-60, 0, 900), GEOMETRY)).toEqual({
      kind: 'open-tray',
      target: -TRAY_WIDTH,
    })
  })

  it('springs back from a short pull', () => {
    expect(endGesture(drag(fresh(), -20, 0, 10, 900), at(-20, 0, 900), GEOMETRY).kind).toBe('settle')
  })

  it('does not move left at all on a row that has no tray', () => {
    const geometry = { width: WIDTH, hasTray: false }
    let gesture = fresh()
    for (const x of [-10, -40, -90]) gesture = moveGesture(gesture, at(x, 0, 32), geometry)
    expect(gesture.offset).toBe(0)
    expect(endGesture(gesture, at(-90, 0, 200), geometry).kind).toBe('settle')
  })

  it('continues from where an open tray left the row', () => {
    // Not from zero: the row is already 128px to the left, so a 40px pull right
    // leaves it 88px out rather than 40px in.
    expect(drag(fresh(true), 40, 0).offset).toBe(-TRAY_WIDTH + 40)
  })

  it('needs a real pull to close an open tray, not a tug', () => {
    /*
     * Both directions of the same threshold. A tray Alex opened on purpose must
     * survive a nudge, and it must close without having to be dragged the whole
     * 128px back.
     */
    const tugged = drag(fresh(true), 40, 0, 10, 900)
    expect(endGesture(tugged, at(40, 0, 900), GEOMETRY).kind).toBe('open-tray')

    const pulled = drag(fresh(true), 90, 0, 10, 900)
    expect(endGesture(pulled, at(90, 0, 900), GEOMETRY)).toEqual({ kind: 'settle', target: 0 })
  })
})

describe('cancelling', () => {
  it('commits nothing, whatever the row had travelled', () => {
    /*
     * A cancel is not a release: the finger was taken away by something that
     * was not Alex. Committing on it is how an interruption packs an item.
     */
    const almost = drag(fresh(), WIDTH * COMMIT_FRACTION + 40, 0)
    expect(cancelGesture(almost)).toEqual({ kind: 'settle', target: 0 })
  })

  it('puts an open tray back rather than closing it', () => {
    // The row returns to the state it was in before the finger landed, so an
    // interruption does not silently undo something Alex opened on purpose.
    expect(cancelGesture(drag(fresh(true), -20, 0))).toEqual({
      kind: 'settle',
      target: -TRAY_WIDTH,
    })
  })
})

describe('the settle takes as long as the distance deserves', () => {
  /*
   * Kept from `swipe-settle.test.ts`, because a future "let us just simplify
   * this to a constant" would restore the exact complaint this came from: a
   * 12px correction taking the same quarter-second as a full 128px open.
   */
  it('is quick for a short correction and longer for a long one', () => {
    expect(settleDuration(-140, -128)).toBeLessThanOrEqual(80)
    expect(settleDuration(-128, 0)).toBeGreaterThan(settleDuration(-140, -128))
  })

  it('never crawls and never drags', () => {
    for (const [from, to] of [
      [0, 0],
      [-140, -128],
      [-128, 0],
      [1000, 0],
    ] as const) {
      expect(settleDuration(from, to)).toBeGreaterThanOrEqual(80)
      expect(settleDuration(from, to)).toBeLessThanOrEqual(170)
    }
  })
})
