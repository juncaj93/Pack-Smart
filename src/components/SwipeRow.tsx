import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type React from 'react'
import './SwipeRow.css'

/**
 * A row you can swipe either way, with the thresholds from
 * `INTERACTION_PATTERNS.md` §2 as the contract rather than as taste.
 *
 * The gesture is an accelerator and never the only path: everything reachable by
 * swiping must also be reachable by tapping, which is what keeps the product whole
 * for VoiceOver, for a keyboard, and for anyone who never discovers a swipe.
 *
 * **Right** is the single action that a second swipe reverses — pack, then unpack.
 * **Left** reveals a tray of buttons and stays open until one is tapped or the row
 * is dismissed, because "edit" and "not bringing" are different enough that
 * committing one of them from a drag distance would be a guess.
 *
 * That asymmetry is deliberate, and it is how iOS behaves: a swipe that means one
 * unambiguous thing commits on release, and a swipe that offers a choice holds
 * still and waits.
 */

/** Movement before the axis is decided. Small enough not to feel laggy. */
const LOCK_DISTANCE = 8
/** How much more horizontal than vertical the movement must be to count. */
const HORIZONTAL_BIAS = 1.4
/** Fraction of the row's width that commits the right-swipe action. */
const COMMIT_FRACTION = 0.45
/** A flick commits early, in px/ms. */
const FLICK_VELOCITY = 0.5
/**
 * How far even a fast flick must travel.
 *
 * Velocity alone was enough at first, guarded only by a 30px minimum — and the
 * interaction test caught what that allows: a 40px twitch, which is a tenth of
 * the row, commits if it happens quickly enough. On the checklist that marks
 * something packed by accident. A flick still commits earlier than a slow drag;
 * it just has to be a flick across the row rather than a flinch.
 */
const FLICK_MIN_FRACTION = 0.25
/** How far the revealed action can be dragged past its natural width. */
const OVERDRAG = 0.35
/** The width of the left tray, in px — two 64px buttons. */
const TRAY_WIDTH = 128
/** Past this much of the tray, releasing opens it rather than springing back. */
const TRAY_OPEN_FRACTION = 0.4

/*
 * How the row settles when the thumb lifts.
 *
 * A CSS transition has one duration for every distance, and that is what made
 * this feel springy: a row over-dragged 12px past the tray took exactly as long
 * to correct those 12px as a full 128px open took to travel. Twelve pixels
 * crawling for a quarter of a second is not a snap, it is a drift.
 *
 * iOS has no such problem because it animates with a spring that inherits the
 * gesture's velocity, so a short correction is over almost immediately. The
 * closest honest approximation with a transition is to make the DURATION
 * proportional to the distance actually left to cover — same speed every time,
 * which is what "it moves like the thing you were dragging" means.
 *
 * Clamped at both ends: below the floor a correction is imperceptible and reads
 * as a jump, and above the ceiling a full-width open starts to feel slow again.
 *
 * Tightened a second time, after "better, close, but still". A UITableView row
 * settles in about a tenth of a second and the eye reads the arrival rather than
 * the travel; the first pass was still letting the travel be the thing you
 * noticed. A full 128px open is now ~109ms and a small correction 80ms.
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

/**
 * Whether this phone has asked for less movement.
 *
 * Read here rather than left to the stylesheet, because the settle duration is an
 * INLINE style now and an inline style beats a media query in the cascade — so
 * `@media (prefers-reduced-motion) { transition: none }` silently stopped applying
 * the moment the duration moved into the component. The row still goes exactly
 * where it went; it just arrives without the travel.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    ? (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    : false
}

type Axis = 'undecided' | 'horizontal' | 'vertical'

export interface SwipeAction {
  label: string
  glyph: string
  onSelect: () => void
  /** Renders in the danger colour. Still needs an Undo behind it. */
  destructive?: boolean
}

interface SwipeRowProps {
  children: ReactNode
  /** What a right-swipe does. Must also exist as a visible control. */
  onComplete: () => void
  /** Behind the row while swiping right: an icon and a word. */
  actionLabel: string
  actionGlyph: string
  /** Revealed by a left-swipe, and held open until one is tapped. */
  leftActions?: SwipeAction[]
  /** Reverses on a second right-swipe, so the gesture is symmetrical. */
  completed?: boolean
  disabled?: boolean
  className?: string
}

export function SwipeRow({
  children,
  onComplete,
  actionLabel,
  actionGlyph,
  leftActions = [],
  completed = false,
  disabled = false,
  className = '',
}: SwipeRowProps) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  /** How long the current settle should take, from the distance it has to cover. */
  const [settleMs, setSettleMs] = useState(SETTLE_MIN_MS)
  /** The left tray, latched open. Negative offsets while dragging are separate. */
  const [trayOpen, setTrayOpen] = useState(false)

  const start = useRef({ x: 0, y: 0, time: 0 })
  /*
   * Set once a gesture is recognised as horizontal, and cleared by the next
   * gesture as well as by the click it eats — so a swipe on a touch screen, which
   * sends no trailing click at all, cannot leave it armed against a later tap.
   */
  const swallowClick = useRef(false)
  const axis = useRef<Axis>('undecided')
  /** The one pointer this row is following, or null at rest. */
  const pointer = useRef<number | null>(null)
  const width = useRef(0)
  const element = useRef<HTMLDivElement | null>(null)

  const hasTray = leftActions.length > 0

  /*
   * The line that makes this work with a thumb, and the whole of the regression.
   *
   * `touch-action: pan-y` tells the browser vertical panning is its business. A
   * real thumb swipe across a row is never purely horizontal — it carries five
   * to fifteen pixels of vertical drift — so while WE are deciding the gesture
   * is horizontal, Safari is independently deciding the same touch is a vertical
   * pan. When it wins it fires `pointercancel`, the row settles back to nothing,
   * and the finger is STILL DOWN and still moving, so the whole arbitration
   * starts again. That loop is the jitter: the row twitches, never travels, and
   * neither swipe ever reaches its action.
   *
   * The fix has to be a `touchmove` listener, and it has to be attached by hand:
   *
   *   - `preventDefault()` on a POINTER event does not stop scrolling. Only the
   *     touch event can, and only if it is not passive.
   *   - React attaches `touchmove` at the root as PASSIVE, so `onTouchMove`
   *     cannot call `preventDefault()` at all — it is a silent no-op with a
   *     console warning at best.
   *
   * So: a native, non-passive listener on this row, which vetoes the browser's
   * pan for exactly as long as we own the axis. Vertical gestures never reach
   * the `preventDefault` and scroll normally, which is the half that must keep
   * working.
   *
   * None of this was visible to a single existing test, because every one of
   * them drives the gesture with `page.mouse` — and `touch-action` governs touch
   * input only. A mouse never competes for the axis, so the tests exercised a
   * gesture the phone was never running.
   */
  useEffect(() => {
    const node = element.current
    if (!node) return

    function vetoBrowserPan(event: TouchEvent) {
      // Only once WE own the axis. Before the lock, and for every vertical
      // gesture, the browser must be left alone to scroll the list.
      if (axis.current === 'horizontal' && event.cancelable) event.preventDefault()
    }

    node.addEventListener('touchmove', vetoBrowserPan, { passive: false })
    return () => node.removeEventListener('touchmove', vetoBrowserPan)
  }, [])

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    /*
     * Pointer-agnostic on purpose. Excluding a mouse here would leave the gesture
     * untestable with real events — and a trackpad drag doing the same thing as a
     * thumb is correct behaviour, not a side effect.
     */
    if (disabled) return
    /*
     * One finger owns the row.
     *
     * A second `pointerdown` used to overwrite `start`, so a stray thumb or the
     * heel of a hand landing mid-swipe re-anchored the gesture to the new
     * contact — the row jumped to a new offset computed from an origin the
     * moving finger had never been at. On a phone held one-handed beside a
     * suitcase that is not a rare event, and it presents identically to the
     * cancel loop above: the row twitches and never arrives.
     */
    if (pointer.current !== null) return
    pointer.current = event.pointerId

    swallowClick.current = false
    start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp }
    axis.current = 'undecided'
    width.current = element.current?.getBoundingClientRect().width ?? 0
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || width.current === 0) return
    if (pointer.current !== null && event.pointerId !== pointer.current) return

    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (axis.current === 'undecided') {
      if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return
      axis.current = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS ? 'horizontal' : 'vertical'
      if (axis.current === 'horizontal') {
        setDragging(true)
        /*
         * Claim the pointer for the rest of the gesture.
         *
         * Without this the row only receives `pointerup` if the release happens
         * inside its own bounds — and a swipe that travels 140px across a 48px-tall
         * row very often ends somewhere else, especially once the tray appearing
         * mid-drag has re-rendered the subtree under the finger. When that happened
         * the row never settled: it kept `is-dragging`, kept its 1:1 transform, and
         * simply stayed where the thumb left it.
         *
         * It was latent from the day the gesture was written and surfaced as one CI
         * run in two failing while its twin passed, which is exactly how a missing
         * pointer capture presents.
         */
        event.currentTarget.setPointerCapture?.(event.pointerId)
        /*
         * A horizontal drag is never also a tap.
         *
         * A pointer that goes down and up on the same row still produces a click,
         * so a swipe that stopped short of the threshold was landing on the row's
         * tap target and packing the item anyway — the accidental completion the
         * threshold exists to prevent, arriving by the other door. Armed as soon
         * as the gesture is recognised, not only when it commits.
         */
        swallowClick.current = true
      }
    }

    if (axis.current !== 'horizontal') return

    /* Dragging from an open tray continues from where the tray left it. */
    const from = trayOpen ? -TRAY_WIDTH : 0
    const travel = from + dx

    if (travel >= 0) {
      const limit = width.current * (COMMIT_FRACTION + OVERDRAG)
      // Past the action's own width the row resists, so the edge of the gesture
      // is felt rather than guessed.
      setOffset(travel > limit ? limit + (travel - limit) * 0.25 : travel)
      return
    }

    if (!hasTray) {
      setOffset(0)
      return
    }

    // The same rubber-banding on the way out, so both directions feel alike.
    const past = -travel - TRAY_WIDTH
    setOffset(past > 0 ? -(TRAY_WIDTH + past * 0.25) : travel)
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    /*
     * Nothing releases the capture here, on purpose.
     *
     * The browser releases it implicitly as soon as `pointerup` has fired, so an
     * explicit call adds nothing — and it would run on every release, including
     * the taps and vertical scrolls that never captured anything in the first
     * place. `onLostPointerCapture` below is the only thing that needs to react,
     * and it fires either way.
     */
    if (pointer.current !== null && event.pointerId !== pointer.current) return

    if (axis.current !== 'horizontal') {
      settle()
      return
    }

    const dx = event.clientX - start.current.x
    const elapsed = Math.max(1, event.timeStamp - start.current.time)
    const velocity = dx / elapsed
    const travel = (trayOpen ? -TRAY_WIDTH : 0) + dx

    if (travel > 0) {
      const committed =
        travel >= width.current * COMMIT_FRACTION ||
        (velocity >= FLICK_VELOCITY && travel >= width.current * FLICK_MIN_FRACTION)
      settle(false)
      if (committed) onComplete()
      return
    }

    /*
     * The tray latches open rather than committing anything. A flick left opens
     * it early, exactly as a flick right commits early.
     */
    const opened =
      hasTray &&
      (-travel >= TRAY_WIDTH * TRAY_OPEN_FRACTION ||
        (velocity <= -FLICK_VELOCITY && -travel >= TRAY_WIDTH * 0.2))
    settle(opened)
  }

  /** Ends the gesture, leaving the tray open or closed. */
  function settle(open = trayOpen) {
    const target = open ? -TRAY_WIDTH : 0
    axis.current = 'undecided'
    width.current = 0
    // Released here rather than in `end`, so every path out of a gesture —
    // release, cancel, lost capture — frees the row for the next finger. A
    // pointer left owned would make the row ignore every subsequent swipe,
    // which is the same "unusable" symptom by a slower route.
    pointer.current = null
    setSettleMs(settleDuration(offset, target))
    setDragging(false)
    setTrayOpen(open)
    setOffset(target)
  }

  function close() {
    setSettleMs(settleDuration(offset, 0))
    setTrayOpen(false)
    setOffset(0)
  }

  function swallowTrailingClick(event: React.MouseEvent<HTMLDivElement>) {
    /*
     * The gesture's OWN trailing click is eaten first, and changes nothing.
     *
     * This has to come before the dismiss-on-tap rule below, and the ordering is
     * not cosmetic: a pointer that goes down and up on the same row still emits a
     * click, so the click that ENDED the swipe was arriving with the tray already
     * open and being read as "a tap somewhere else" — which closed the tray in the
     * same frame it opened. On a touch screen there is no trailing click and it
     * looked fine; with a trackpad the tray was unusable, and the interaction test
     * is what caught it.
     */
    if (swallowClick.current) {
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }

    /*
     * A later tap anywhere outside the tray dismisses it rather than doing what
     * the row normally does. That is the iOS behaviour and it is also the safe
     * one: the visible actions are the tray's, so the row beneath is not really
     * "there" to be tapped.
     */
    if (trayOpen && !(event.target as HTMLElement).closest?.('.swipe-tray')) {
      close()
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const revealed = offset > 0
  const willCommit = offset >= (width.current || Number.POSITIVE_INFINITY) * COMMIT_FRACTION

  return (
    <div
      ref={element}
      className={`swipe-row ${className} ${revealed ? 'is-swiping' : ''} ${
        trayOpen ? 'is-tray-open' : ''
      } ${dragging ? 'is-dragging' : ''}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => settle()}
      /*
       * The safety net. If the capture is lost some other way — a system gesture,
       * the element being removed, a browser deciding otherwise — the row settles
       * rather than being left mid-swipe with no way back.
       */
      onLostPointerCapture={() => {
        if (axis.current !== 'undecided') settle()
      }}
      onClickCapture={swallowTrailingClick}
    >
      {/*
        * The right-swipe action. Hidden from assistive technology on purpose: it
        * is a visual consequence of dragging, and the same action is announced by
        * the row's own control.
        */}
      <div className={`swipe-action ${willCommit ? 'is-ready' : ''}`} aria-hidden="true">
        <span className="swipe-glyph">{completed ? '↩' : actionGlyph}</span>
        <span className="swipe-label">{completed ? 'Unpack' : actionLabel}</span>
      </div>

      {/*
        * The left tray holds real buttons, not decoration — they are tapped, so
        * they are focusable and named. They are only reachable once the tray is
        * open, which is why the row's own ⋯ control still carries every one of
        * these actions: the gesture is the shortcut, never the only door.
        */}
      {/*
        * Rendered only while the tray is in play — never at rest.
        *
        * This is what stopped the red ✕ flashing across rows as they scrolled into
        * view. The tray sits behind the row's own surface and is covered by it, so
        * "covered" depends on the surface having painted first. On a long list
        * being scrolled fast that is not guaranteed: rows arrive, the parent layer
        * paints with the tray in it, and the promoted surface layer lands a frame
        * later. For that frame the delete button is simply visible.
        *
        * Not rendering it is a better fix than hiding it, because it also takes two
        * buttons per row out of a forty-row list — and nothing is lost: the tray is
        * unreachable when closed anyway, and both actions live in the ⋯ sheet.
        */}
      {hasTray && (trayOpen || offset < 0) ? (
        <div className="swipe-tray" aria-hidden={!trayOpen}>
          {leftActions.map((leftAction) => (
            <button
              key={leftAction.label}
              type="button"
              className={`swipe-tray-button ${leftAction.destructive ? 'is-destructive' : ''}`}
              tabIndex={trayOpen ? 0 : -1}
              onClick={() => {
                close()
                leftAction.onSelect()
              }}
            >
              <span className="swipe-tray-glyph" aria-hidden="true">
                {leftAction.glyph}
              </span>
              <span className="swipe-tray-label">{leftAction.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="swipe-surface"
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          /*
           * `none` while the thumb is down — the row tracks 1:1 and a transition
           * there would put the surface behind the finger. On release the duration
           * comes from the distance, which is the whole point.
           */
          transition:
            dragging || prefersReducedMotion()
              ? 'none'
              : `transform ${settleMs}ms var(--ease-snap)`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
