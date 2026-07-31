/**
 * The swipe row's decisions, with no DOM in them.
 *
 * Everything that decides *what the gesture means* lives here as plain
 * functions over plain values: which axis was claimed, how far the row has
 * travelled, whether releasing commits. `useSwipeGesture` supplies the events
 * and owns the element; this file owns the contract in
 * `INTERACTION_PATTERNS.md` §2.
 *
 * The split is not tidiness. The previous recognizer could only be tested
 * through a browser, so every claim about direction locking and thresholds
 * rested on a synthesised event sequence — and a synthesised sequence is
 * exactly what let a gesture pass automation while failing on a phone. These
 * functions can be called directly with the numbers a thumb actually produces.
 */

/**
 * Movement before the axis is decided.
 *
 * **5px, down from 8.** This is the single most load-bearing number in the file
 * and it is small on purpose.
 *
 * WebKit decides whether a touch is a scroll from the first move that clears
 * its own slop, and it does not wait for us. Every touchmove we spend still
 * `undecided` is a touchmove where the browser may start a pan — and once it
 * has, the pan cannot be vetoed: subsequent `touchmove`s arrive with
 * `cancelable === false`. So the lock has to land inside the browser's own
 * decision window rather than comfortably after it.
 *
 * It cannot go much lower either. Under about four pixels the direction of a
 * thumb is noise, and locking horizontal on noise is how a list stops
 * scrolling.
 */
export const LOCK_DISTANCE = 5

/** How much more horizontal than vertical the movement must be to count. */
export const HORIZONTAL_BIAS = 1.4

/** Fraction of the row's width that commits the right-swipe action. */
export const COMMIT_FRACTION = 0.45

/** A flick commits early, in px/ms. */
export const FLICK_VELOCITY = 0.5

/**
 * How far even a fast flick must travel.
 *
 * Velocity alone was enough at first, guarded only by a 30px minimum — and the
 * interaction test caught what that allows: a 40px twitch, a tenth of the row,
 * commits if it happens quickly enough. On the checklist that marks something
 * packed by accident.
 */
export const FLICK_MIN_FRACTION = 0.25

/** How far the revealed action can be dragged past its natural width. */
export const OVERDRAG = 0.35

/** Resistance applied beyond the natural width, in both directions. */
export const RUBBER_BAND = 0.25

/** The width of the left tray, in px — two 64px buttons. */
export const TRAY_WIDTH = 128

/** Past this much of the tray, releasing opens it rather than springing back. */
export const TRAY_OPEN_FRACTION = 0.4

/** A flick left opens the tray from a shorter distance, as a flick right commits early. */
export const TRAY_FLICK_FRACTION = 0.2

export type Axis = 'undecided' | 'horizontal' | 'vertical'

export interface Sample {
  x: number
  y: number
  /** Milliseconds on any monotonic clock. Only differences are used. */
  time: number
}

export interface Geometry {
  /** The row's width. Zero means "not measured", and nothing commits. */
  width: number
  hasTray: boolean
}

export interface Gesture {
  origin: Sample
  /** Where the surface sat when the finger landed: 0, or -TRAY_WIDTH if open. */
  from: number
  axis: Axis
  /** Where the surface sits now, rubber-banding included. */
  offset: number
  /** True once the row has travelled far enough that releasing would commit. */
  pastThreshold: boolean
}

/**
 * Starts tracking, or refuses to.
 *
 * `touchCount` is the number of touches on the *screen*, not on this row. A
 * second finger landing anywhere mid-swipe used to overwrite the origin, so the
 * row jumped to an offset computed from a point the moving finger had never
 * been at — which presents identically to the jitter it is easy to blame on
 * scroll arbitration. One finger, or nothing.
 */
export function beginGesture(
  origin: Sample,
  { trayOpen, touchCount = 1 }: { trayOpen: boolean; touchCount?: number },
): Gesture | null {
  if (touchCount !== 1) return null
  return {
    origin,
    from: trayOpen ? -TRAY_WIDTH : 0,
    axis: 'undecided',
    offset: trayOpen ? -TRAY_WIDTH : 0,
    pastThreshold: false,
  }
}

/**
 * Advances the gesture one sample.
 *
 * Returns a NEW gesture; the caller decides what to do with it. Critically, the
 * axis is decided *here* — in the same call that produces the offset — so the
 * handler that receives the result can veto the browser's pan in the same tick
 * it learns the gesture is horizontal. The previous implementation decided the
 * axis in a pointer handler and vetoed in a touch handler, which made the veto
 * depend on an ordering between two event streams that nothing guaranteed.
 */
export function moveGesture(gesture: Gesture, sample: Sample, geometry: Geometry): Gesture {
  const { width, hasTray } = geometry
  const dx = sample.x - gesture.origin.x
  const dy = sample.y - gesture.origin.y

  let axis = gesture.axis
  if (axis === 'undecided') {
    if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return gesture
    axis = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS ? 'horizontal' : 'vertical'
  }

  /*
   * A vertical gesture is over as far as this row is concerned, and the offset
   * must not move: the browser is scrolling the list and a row sliding sideways
   * underneath that is the fight we are here to end.
   */
  if (axis !== 'horizontal') return { ...gesture, axis }
  if (width === 0) return { ...gesture, axis }

  const travel = gesture.from + dx
  const offset = travel >= 0 ? resistRight(travel, width) : resistLeft(travel, hasTray)

  return {
    ...gesture,
    axis,
    offset,
    pastThreshold: offset > 0 && offset >= width * COMMIT_FRACTION,
  }
}

/** Past the action's own width the row resists, so the edge is felt rather than guessed. */
function resistRight(travel: number, width: number): number {
  const limit = width * (COMMIT_FRACTION + OVERDRAG)
  return travel > limit ? limit + (travel - limit) * RUBBER_BAND : travel
}

/** The same resistance on the way out, so both directions feel alike. */
function resistLeft(travel: number, hasTray: boolean): number {
  if (!hasTray) return 0
  const past = -travel - TRAY_WIDTH
  return past > 0 ? -(TRAY_WIDTH + past * RUBBER_BAND) : travel
}

export type Outcome =
  /** Right-swipe committed. The row settles to 0 FIRST, then the action runs. */
  | { kind: 'complete'; target: 0 }
  /** Left-swipe latched the tray open. */
  | { kind: 'open-tray'; target: number }
  /** Everything else: spring back to wherever the row was, and do nothing. */
  | { kind: 'settle'; target: number }

/**
 * What releasing means.
 *
 * `complete` deliberately targets 0 rather than sliding the row off. The row
 * snaps back under the finger's own momentum and the tick fills in behind it,
 * which is the iOS behaviour — and it is also what lets the completion be
 * *deferred* until the travel is over, so the list cannot resort while the
 * gesture is still on screen.
 */
export function endGesture(gesture: Gesture, sample: Sample, geometry: Geometry): Outcome {
  const { width, hasTray } = geometry

  if (gesture.axis !== 'horizontal' || width === 0) {
    return { kind: 'settle', target: gesture.from }
  }

  const dx = sample.x - gesture.origin.x
  const elapsed = Math.max(1, sample.time - gesture.origin.time)
  const velocity = dx / elapsed
  const travel = gesture.from + dx

  if (travel > 0) {
    const committed =
      travel >= width * COMMIT_FRACTION ||
      (velocity >= FLICK_VELOCITY && travel >= width * FLICK_MIN_FRACTION)
    return committed ? { kind: 'complete', target: 0 } : { kind: 'settle', target: 0 }
  }

  const opened =
    hasTray &&
    (-travel >= TRAY_WIDTH * TRAY_OPEN_FRACTION ||
      (velocity <= -FLICK_VELOCITY && -travel >= TRAY_WIDTH * TRAY_FLICK_FRACTION))

  return opened ? { kind: 'open-tray', target: -TRAY_WIDTH } : { kind: 'settle', target: 0 }
}

/**
 * Where a cancelled gesture goes.
 *
 * A cancel is not a release: the finger was taken away by something that was
 * not Alex — a call arriving, a system edge gesture, the browser deciding the
 * touch was its after all. Nothing may commit, and the row returns to whatever
 * state it was in before the finger landed rather than to zero, so an open tray
 * survives an interruption.
 */
export function cancelGesture(gesture: Gesture): Outcome {
  return { kind: 'settle', target: gesture.from }
}

/*
 * How the row settles when the thumb lifts.
 *
 * A CSS transition has one duration for every distance, and that is what made
 * this feel springy: a row over-dragged 12px past the tray took exactly as long
 * to correct those 12px as a full 128px open took to travel.
 *
 * iOS has no such problem because it animates with a spring that inherits the
 * gesture's velocity, so a short correction is over almost immediately. The
 * closest honest approximation with a transition is to make the DURATION
 * proportional to the distance actually left to cover — same speed every time,
 * which is what "it moves like the thing you were dragging" means.
 */
const SETTLE_MS_PER_PX = 0.85
const SETTLE_MIN_MS = 80
const SETTLE_MAX_MS = 170

export function settleDuration(from: number, to: number): number {
  const distance = Math.abs(to - from)
  return Math.round(
    Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, distance * SETTLE_MS_PER_PX)),
  )
}
