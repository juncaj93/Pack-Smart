import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type React from 'react'
import './SwipeRow.css'

/**
 * A row you can swipe, with the thresholds from `INTERACTION_PATTERNS.md` §2 as
 * the contract rather than as taste.
 *
 * The gesture is an accelerator and never the only path: whatever `onComplete`
 * does must also be reachable by tapping the row's own controls, which is what
 * keeps the product whole for VoiceOver, for a keyboard, and for anyone who never
 * discovers a swipe.
 *
 * Three things here are the difference between a gesture that feels native and
 * one that fights the user:
 *
 *  - **The direction lock.** Decided once from the first few pixels, and only
 *    horizontal if the movement is clearly horizontal. A thumb travelling
 *    diagonally down a long checklist is scrolling, and a row that grabbed that
 *    movement would make the list feel broken.
 *  - **The commit threshold.** Nearly half the row, or a deliberate flick. A nudge
 *    is not a decision, and this row can mark something packed.
 *  - **Pointer events, not clicks.** `touch-action: pan-y` in the CSS is what lets
 *    the browser keep vertical scrolling while we watch the horizontal axis.
 */

/** Movement before the axis is decided. Small enough not to feel laggy. */
const LOCK_DISTANCE = 10
/** How much more horizontal than vertical the movement must be to count. */
const HORIZONTAL_BIAS = 1.4
/** Fraction of the row's width that commits the action. */
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

type Axis = 'undecided' | 'horizontal' | 'vertical'

interface SwipeRowProps {
  children: ReactNode
  /** What the swipe does. Must also exist as a visible control. */
  onComplete: () => void
  /** Behind the row while swiping: an icon and a word. */
  actionLabel: string
  actionGlyph: string
  /** Reverses on a second swipe, so the gesture is symmetrical. */
  completed?: boolean
  disabled?: boolean
  className?: string
}

export function SwipeRow({
  children,
  onComplete,
  actionLabel,
  actionGlyph,
  completed = false,
  disabled = false,
  className = '',
}: SwipeRowProps) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const start = useRef({ x: 0, y: 0, time: 0 })
  /*
   * Set once a gesture is recognised as horizontal, and cleared by the next
   * gesture as well as by the click it eats — so a swipe on a touch screen, which
   * sends no trailing click at all, cannot leave it armed against a later tap.
   */
  const swallowClick = useRef(false)
  const axis = useRef<Axis>('undecided')
  const width = useRef(0)
  const element = useRef<HTMLDivElement | null>(null)

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    /*
     * Pointer-agnostic on purpose. Excluding a mouse here would leave the gesture
     * untestable with real events — and a trackpad drag doing the same thing as a
     * thumb is correct behaviour, not a side effect.
     */
    if (disabled) return
    swallowClick.current = false
    start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp }
    axis.current = 'undecided'
    width.current = element.current?.getBoundingClientRect().width ?? 0
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || width.current === 0) return

    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (axis.current === 'undecided') {
      if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return
      axis.current =
        Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS ? 'horizontal' : 'vertical'
      if (axis.current === 'horizontal') {
        setDragging(true)
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

    /*
     * One direction only. A row can be packed or un-packed by the same gesture,
     * so there is nothing to reveal on the other side and a two-way drag would
     * just look like a bug.
     */
    const travel = Math.max(0, dx)
    const limit = width.current * (COMMIT_FRACTION + OVERDRAG)
    // Past the action's own width the row resists, so the edge of the gesture is
    // felt rather than guessed.
    setOffset(travel > limit ? limit + (travel - limit) * 0.25 : travel)
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    if (axis.current !== 'horizontal') {
      reset()
      return
    }

    const dx = event.clientX - start.current.x
    const elapsed = Math.max(1, event.timeStamp - start.current.time)
    const velocity = dx / elapsed

    const committed =
      dx >= width.current * COMMIT_FRACTION ||
      (velocity >= FLICK_VELOCITY && dx >= width.current * FLICK_MIN_FRACTION)

    reset()
    if (committed) onComplete()
  }

  function swallowTrailingClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function reset() {
    axis.current = 'undecided'
    width.current = 0
    setDragging(false)
    setOffset(0)
  }

  const revealed = offset > 0
  const willCommit = offset >= (width.current || Number.POSITIVE_INFINITY) * COMMIT_FRACTION

  return (
    <div
      ref={element}
      className={`swipe-row ${className} ${revealed ? 'is-swiping' : ''}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={reset}
      onClickCapture={swallowTrailingClick}
    >
      {/*
        * The action behind the row. Hidden from assistive technology on purpose:
        * it is a visual consequence of dragging, and the same action is announced
        * by the row's own control.
        */}
      <div className={`swipe-action ${willCommit ? 'is-ready' : ''}`} aria-hidden="true">
        <span className="swipe-glyph">{completed ? '↩' : actionGlyph}</span>
        <span className="swipe-label">{completed ? 'Unpack' : actionLabel}</span>
      </div>

      <div
        className="swipe-surface"
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: dragging ? 'none' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  )
}
