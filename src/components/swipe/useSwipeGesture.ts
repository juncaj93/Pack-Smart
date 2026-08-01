import { useCallback, useEffect, useRef, useState } from 'react'
import {
  beginGesture,
  cancelGesture,
  endGesture,
  moveGesture,
  settleDuration,
  type Gesture,
  type Outcome,
} from './recognizer'

/**
 * The swipe row's event handling.
 *
 * ## Why this is a rewrite rather than another patch
 *
 * The previous recognizer listened to **Pointer Events** and vetoed the
 * browser's scroll from a **Touch Event**. Three things follow from that split,
 * and together they are the jitter Alex saw on the phone:
 *
 * 1. **The veto could only ever be late.** The axis was decided inside
 *    `onPointerMove`, after 8px of travel. WebKit decides whether a touch is a
 *    scroll from the first move past its own, smaller slop, and it does not
 *    wait for us. So for the first two or three `touchmove`s the row was still
 *    `undecided` and vetoed nothing — and by the time it claimed the axis the
 *    pan had started. Once a pan has started, every subsequent `touchmove`
 *    arrives with `cancelable === false`, which the veto explicitly skipped. It
 *    could only run after it could no longer do anything.
 *
 * 2. **It depended on an ordering nothing guaranteed.** Even inside the lock
 *    window the veto needed `pointermove` to have been dispatched before the
 *    matching `touchmove` of the same frame. React delegates `pointermove` to
 *    the root; the veto was a native listener on the row. Nothing in either
 *    spec makes that ordering the component's to rely on.
 *
 * 3. **Losing meant losing the whole gesture.** When WebKit won the axis it
 *    fired `pointercancel`, which reset the row, cleared the measured width and
 *    released the pointer — so the row then ignored the finger that was still
 *    down and still moving. Twitch, snap back, go dead: all three of the
 *    reported symptoms, from one cause.
 *
 * ## What this does instead
 *
 * **One stream per input.** On a touch screen the gesture is driven entirely by
 * Touch Events and Pointer Events are not used at all. That removes the
 * arbitration surface rather than negotiating with it:
 *
 * - Touch events have **implicit capture**: every `touchmove` and `touchend`
 *   for a touch is dispatched to the element that received its `touchstart`,
 *   even after the finger has left that element. `setPointerCapture`, and the
 *   `pointercancel` / `lostpointercapture` handling it needs, is simply gone.
 * - The axis is decided and the pan is vetoed **in the same handler, in the
 *   same tick, from the same event**. There is no second stream to order
 *   against.
 * - The lock distance is 5px rather than 8, so the claim lands inside WebKit's
 *   decision window instead of just after it.
 * - If the browser wins anyway, `touchcancel` ends the gesture cleanly and the
 *   row stops tracking — instead of resetting under a finger that is still
 *   moving and starting the whole arbitration again.
 *
 * `touch-action: pan-y` stays. Vertical gestures are never vetoed, so the list
 * scrolls with its usual momentum, and the browser will not pan horizontally on
 * its own.
 *
 * **A mouse is a separate, simpler path.** `mousedown` on the row, then
 * `mousemove`/`mouseup` on the window — a mouse never competes for a scroll
 * axis, so none of the above applies to it. It is also what every existing
 * `page.mouse` spec drives, and keeping the two apart is what stops those specs
 * from quietly re-describing a touch path they cannot exercise.
 *
 * **React does not run during the gesture.** The transform is written straight
 * to the surface's `style` and the row's state classes are toggled on the
 * element. No `setState` happens between `touchstart` and the settle, so
 * nothing can remount the row, change its key, resort the list, or overwrite
 * the transform with a stale render while the finger is down.
 */

export interface SwipeGestureOptions {
  hasTray: boolean
  disabled: boolean
  /** Runs AFTER the row has finished settling, never during the gesture. */
  onComplete: () => void
}

export interface SwipeGesture {
  rowRef: (node: HTMLDivElement | null) => void
  surfaceRef: (node: HTMLDivElement | null) => void
  trayOpen: boolean
  closeTray: () => void
}

/**
 * Emulated mouse events follow a touch on mobile browsers, and a swipe that
 * ended on a row would otherwise immediately start a second, mouse-shaped
 * gesture on the same row.
 */
const MOUSE_AFTER_TOUCH_MS = 500

/**
 * How long after a horizontal drag a click is still assumed to be the drag's
 * own trailing click.
 *
 * Time-bounded rather than a latch. A trailing click arrives in the same beat
 * as the release or not at all — and "not at all" is the normal case on a
 * touch screen, where a vetoed `touchmove` suppresses the emulated click
 * entirely. A latched flag therefore stays armed after every phone swipe and
 * eats the next genuine tap on that row, which is a dead control that only
 * appears after a gesture and is very hard to attribute.
 */
const SWALLOW_CLICK_MS = 400

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    : false
}

export function useSwipeGesture({
  hasTray,
  disabled,
  onComplete,
}: SwipeGestureOptions): SwipeGesture {
  const [trayOpen, setTrayOpen] = useState(false)

  const rowNode = useRef<HTMLDivElement | null>(null)
  const surfaceNode = useRef<HTMLDivElement | null>(null)

  /*
   * Everything the handlers read lives in a ref.
   *
   * The listeners below are attached once and never re-attached — re-attaching
   * a non-passive `touchmove` on every render is how duplicate listeners and
   * stale closures get into a gesture in the first place — so nothing they need
   * may come from a closure over one render's props.
   */
  const gesture = useRef<Gesture | null>(null)
  const trayOpenRef = useRef(false)
  const geometry = useRef({ width: 0, hasTray })
  const disabledRef = useRef(disabled)
  const completeRef = useRef(onComplete)
  /*
   * `-Infinity`, not 0.
   *
   * Event timestamps are milliseconds since the page's time origin, so they
   * START near zero — and "no touch has happened yet" written as 0 means every
   * mouse gesture in the first half-second after load looks like it is
   * following a touch, and is suppressed. A row that ignores the first swipe
   * after opening a trip is exactly the kind of intermittent that gets
   * misattributed to the gesture being flaky.
   */
  const lastTouchAt = useRef(Number.NEGATIVE_INFINITY)
  const swallowClickUntil = useRef(0)
  const pendingComplete = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Where the surface sits between gestures. Kept out of React on purpose. */
  const resting = useRef(0)

  geometry.current.hasTray = hasTray
  disabledRef.current = disabled
  completeRef.current = onComplete

  const paint = useCallback((offset: number, ms: number | null) => {
    const surface = surfaceNode.current
    if (!surface) return
    surface.style.transition =
      ms === null || prefersReducedMotion() ? 'none' : `transform ${ms}ms var(--ease-snap)`
    surface.style.transform = offset === 0 ? '' : `translateX(${offset}px)`
  }, [])

  /**
   * The row's visible state, written to the element rather than to React.
   *
   * `is-ready` in particular: the commit fill has to change exactly when the
   * threshold is crossed, and deriving it here — from the same sample that
   * produced the offset — is the only way it cannot disagree with what is on
   * screen. Through state it would also be two renders per swipe, in the middle
   * of the gesture, which is the thing this whole rewrite exists to stop.
   */
  const mark = useCallback((dragging: boolean, offset: number, ready = false) => {
    const node = rowNode.current
    if (!node) return
    node.classList.toggle('is-dragging', dragging)
    node.classList.toggle('is-swiping', offset > 0)
    node.classList.toggle('is-swiping-left', offset < 0)
    node.classList.toggle('is-ready', ready)
  }, [])

  /**
   * Ends a gesture and runs whatever it decided.
   *
   * The completion is **deferred until the row has finished travelling**. That
   * is the whole of "the row must not reorder until the interaction is
   * finished": `onComplete` is what moves the item between sections, so calling
   * it on release would resort the list — remounting the row — while its settle
   * was still on screen.
   */
  const finish = useCallback(
    (outcome: Outcome) => {
      const ms = settleDuration(resting.current, outcome.target)
      resting.current = outcome.target
      gesture.current = null

      paint(outcome.target, ms)
      mark(false, outcome.target)

      if (outcome.kind === 'open-tray') {
        trayOpenRef.current = true
        setTrayOpen(true)
        return
      }

      if (trayOpenRef.current && outcome.target === 0) {
        trayOpenRef.current = false
        setTrayOpen(false)
      }

      if (outcome.kind === 'complete') {
        pendingComplete.current = setTimeout(() => {
          pendingComplete.current = null
          completeRef.current()
        }, ms)
      }
    },
    [paint, mark],
  )

  const start = useCallback(
    (sample: { x: number; y: number; time: number }, touchCount: number) => {
      if (disabledRef.current) return
      const node = rowNode.current
      if (!node) return

      swallowClickUntil.current = 0

      const next = beginGesture(sample, { trayOpen: trayOpenRef.current, touchCount })

      if (!next) {
        /*
         * A second finger landed. Abandon rather than re-anchor: a stray thumb
         * or the heel of a hand used to overwrite the origin, so the row jumped
         * to an offset computed from a point the moving finger had never been
         * at. Held one-handed beside a suitcase that is not a rare event, and
         * it presents identically to the arbitration loop.
         */
        if (gesture.current) finish(cancelGesture(gesture.current))
        return
      }

      geometry.current.width = node.getBoundingClientRect().width
      gesture.current = next
    },
    [finish],
  )

  /**
   * One sample of movement, and the answer to "may the browser scroll?".
   *
   * Returns true when the caller must call `preventDefault()`. It is the caller
   * that does it, because only the caller holds the event — but the decision is
   * made here, from the same sample that produced the offset, which is the
   * ordering guarantee the previous implementation did not have.
   */
  const move = useCallback(
    (sample: { x: number; y: number; time: number }): boolean => {
      const active = gesture.current
      if (!active) return false

      const next = moveGesture(active, sample, geometry.current)
      const claimed = next.axis === 'horizontal'
      gesture.current = next

      if (!claimed) {
        /*
         * A vertical claim ends this row's involvement for good. Dropping the
         * gesture — rather than leaving it `vertical` and idling — means the
         * rest of the scroll costs this row nothing, and a later sample that
         * drifts back horizontally cannot revive it halfway through a scroll.
         */
        if (next.axis === 'vertical') gesture.current = null
        return false
      }

      /*
       * A horizontal drag is never also a tap. A drag that goes down and up on
       * the same row still produces a click on some engines, so a swipe that
       * stopped short of the threshold was landing on the row's own tap target
       * and packing the item anyway — the accidental completion the threshold
       * exists to prevent, arriving by the other door.
       *
       * Refreshed on every move rather than armed once, so the window is
       * measured from the END of the gesture.
       */
      swallowClickUntil.current = sample.time + SWALLOW_CLICK_MS

      paint(next.offset, null)
      mark(true, next.offset, next.pastThreshold)
      return true
    },
    [paint, mark],
  )

  const end = useCallback(
    (sample: { x: number; y: number; time: number }) => {
      const active = gesture.current
      if (!active) return
      finish(endGesture(active, sample, geometry.current))
    },
    [finish],
  )

  const cancel = useCallback(
    () => {
      const active = gesture.current
      if (!active) return
      finish(cancelGesture(active))
    },
    [finish],
  )

  const closeTray = useCallback(() => {
    if (!trayOpenRef.current) return
    trayOpenRef.current = false
    setTrayOpen(false)
    const ms = settleDuration(resting.current, 0)
    resting.current = 0
    paint(0, ms)
    mark(false, 0)
  }, [paint, mark])

  /*
   * Attached once, by hand, and never through React.
   *
   * `touchmove` MUST be non-passive to veto a pan, and React registers its
   * `onTouchMove` at the root as passive — so `preventDefault()` from a React
   * handler is a no-op with a console warning at best. There is no version of
   * this that works through JSX props.
   */
  useEffect(() => {
    const node = rowNode.current
    if (!node) return

    function onTouchStart(event: TouchEvent) {
      lastTouchAt.current = event.timeStamp
      const touch = event.touches[0]
      if (!touch) return
      start({ x: touch.clientX, y: touch.clientY, time: event.timeStamp }, event.touches.length)
    }

    function onTouchMove(event: TouchEvent) {
      lastTouchAt.current = event.timeStamp

      if (event.touches.length > 1) {
        // A second finger mid-gesture. Abandon rather than re-anchor.
        cancel()
        return
      }
      const touch = event.touches[0]
      if (!touch) return

      if (!move({ x: touch.clientX, y: touch.clientY, time: event.timeStamp })) return

      /*
       * The veto, in the same handler that claimed the axis.
       *
       * `cancelable` is already false once the browser has committed to a pan,
       * so the guard is not defensive noise: it is the difference between
       * vetoing the pan and only appearing to.
       */
      if (event.cancelable) event.preventDefault()
    }

    function onTouchEnd(event: TouchEvent) {
      lastTouchAt.current = event.timeStamp
      const touch = event.changedTouches[0]
      if (!touch) {
        cancel()
        return
      }
      end({ x: touch.clientX, y: touch.clientY, time: event.timeStamp })
    }

    function onTouchCancel() {
      // The browser took the gesture. End cleanly rather than resetting under a
      // finger that is still moving, which is what restarted the arbitration.
      cancel()
    }

    function onMouseMove(event: MouseEvent) {
      move({ x: event.clientX, y: event.clientY, time: event.timeStamp })
    }

    function onMouseUp(event: MouseEvent) {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      end({ x: event.clientX, y: event.clientY, time: event.timeStamp })
    }

    function onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return
      if (event.timeStamp - lastTouchAt.current < MOUSE_AFTER_TOUCH_MS) return
      start({ x: event.clientX, y: event.clientY, time: event.timeStamp }, 1)
      if (!gesture.current) return

      /*
       * Window-level for the rest of the drag: the mouse's equivalent of the
       * implicit capture touch gets for free. A swipe that travels 140px across
       * a 48px-tall row very often releases somewhere else, and a `mouseup` the
       * row never hears leaves it stuck mid-swipe.
       */
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }

    function onClickCapture(event: MouseEvent) {
      /*
       * The gesture's own trailing click is eaten first, and changes nothing.
       *
       * Ordering matters and is not cosmetic: a drag that ends on the row still
       * emits a click, so the click that ENDED a left-swipe was arriving with
       * the tray already open and reading as "a tap somewhere else" — closing
       * the tray in the same frame it opened.
       */
      if (event.timeStamp <= swallowClickUntil.current) {
        swallowClickUntil.current = 0
        event.preventDefault()
        event.stopPropagation()
        return
      }

      /*
       * A later tap anywhere outside the tray dismisses it rather than doing
       * what the row normally does. That is the iOS behaviour and it is also
       * the safe one: the visible actions are the tray's, so the row beneath is
       * not really "there" to be tapped.
       */
      if (trayOpenRef.current && !(event.target as HTMLElement).closest?.('.swipe-tray')) {
        closeTray()
        event.preventDefault()
        event.stopPropagation()
      }
    }

    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd, { passive: true })
    node.addEventListener('touchcancel', onTouchCancel, { passive: true })
    node.addEventListener('mousedown', onMouseDown)
    node.addEventListener('click', onClickCapture, true)

    return () => {
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('touchend', onTouchEnd)
      node.removeEventListener('touchcancel', onTouchCancel)
      node.removeEventListener('mousedown', onMouseDown)
      node.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [start, move, end, cancel, closeTray])

  /*
   * A commit still waiting on its settle must not be lost if the row goes away
   * first — which is exactly what happens when something else resorts the list
   * underneath it.
   */
  useEffect(
    () => () => {
      if (pendingComplete.current) {
        clearTimeout(pendingComplete.current)
        pendingComplete.current = null
        completeRef.current()
      }
    },
    [],
  )

  /** Keeps a latched-open tray honest if the row is disabled underneath it. */
  useEffect(() => {
    if (disabled && trayOpenRef.current) closeTray()
  }, [disabled, closeTray])

  const attachRow = useCallback((node: HTMLDivElement | null) => {
    rowNode.current = node
  }, [])

  const attachSurface = useCallback((node: HTMLDivElement | null) => {
    surfaceNode.current = node
    /*
     * Re-applies the resting offset to a surface React has just replaced. The
     * transform is not a React-owned prop — that is what keeps a parent render
     * from overwriting it mid-gesture — so on the rare render that swaps the
     * node, this is what puts it back.
     */
    if (node && resting.current !== 0) {
      node.style.transition = 'none'
      node.style.transform = `translateX(${resting.current}px)`
    }
  }, [])

  return { rowRef: attachRow, surfaceRef: attachSurface, trayOpen, closeTray }
}
