import type { ReactNode } from 'react'
import { useSwipeGesture } from './swipe/useSwipeGesture'
import './SwipeRow.css'

export { settleDuration } from './swipe/recognizer'

/**
 * A row you can swipe either way, with the thresholds from
 * `INTERACTION_PATTERNS.md` §2 as the contract rather than as taste.
 *
 * The gesture is an accelerator and never the only path: everything reachable
 * by swiping must also be reachable by tapping, which is what keeps the product
 * whole for VoiceOver, for a keyboard, and for anyone who never discovers a
 * swipe. On the checklist that means the row's own tick button and the ⋯
 * control beside it — neither of which this component owns, and both of which
 * keep working unchanged if the gesture is ever removed.
 *
 * **Right** is the single action that a second swipe reverses — pack, then
 * unpack. **Left** reveals a tray of buttons and stays open until one is tapped
 * or the row is dismissed, because "how many" and "not bringing" are different
 * enough that committing one of them from a drag distance would be a guess.
 *
 * That asymmetry is deliberate, and it is how iOS behaves: a swipe that means
 * one unambiguous thing commits on release, and a swipe that offers a choice
 * holds still and waits.
 *
 * ## What this component does NOT do
 *
 * It does not render the gesture. There is no `offset` state, no `style`
 * prop carrying a transform, and no `setState` between the finger landing and
 * the row settling — every one of those is a way for a render to get between
 * the thumb and the row. The transform and the state classes are written to the
 * elements directly by `useSwipeGesture`, which is also where the reasons live.
 */

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
  const hasTray = leftActions.length > 0

  const { rowRef, surfaceRef, trayOpen, closeTray } = useSwipeGesture({
    hasTray,
    disabled,
    onComplete,
  })

  return (
    <div
      ref={rowRef}
      className={`swipe-row ${className} ${trayOpen ? 'is-tray-open' : ''}`}
    >
      {/*
        * The right-swipe action. Hidden from assistive technology on purpose:
        * it is a visual consequence of dragging, and the same action is
        * announced by the row's own control.
        *
        * Past the commit threshold it fills in, so the answer to "is this far
        * enough?" is visible before the thumb lifts rather than after. That
        * class is toggled on the row by the recognizer, from the same sample
        * that produced the offset — not from React state, which would put a
        * render between the finger and the transform twice per swipe.
        */}
      <div className="swipe-action" aria-hidden="true">
        <span className="swipe-glyph">{completed ? '↩' : actionGlyph}</span>
        <span className="swipe-label">{completed ? 'Unpack' : actionLabel}</span>
      </div>

      {/*
        * The left tray holds real buttons, not decoration — they are tapped, so
        * they are focusable and named. They are only reachable once the tray is
        * open, which is why the row's own ⋯ control still carries every one of
        * these actions: the gesture is the shortcut, never the only door.
        *
        * Rendered at rest and hidden with `visibility`, rather than mounted
        * once the tray comes into play.
        *
        * It used to be conditional, to stop the red ✕ flashing across rows as
        * they scrolled into view: the tray sits behind the row's surface and is
        * covered by it, so on a long list being scrolled fast the parent layer
        * could paint with the tray in it a frame before the promoted surface
        * landed. `visibility: hidden` fixes that properly — an invisible
        * element cannot paint at all — and it is what lets a drag happen with
        * no React render at all, because the tray no longer has to be mounted
        * mid-gesture in response to the offset going negative.
        */}
      {hasTray ? (
        <div className="swipe-tray" aria-hidden={!trayOpen}>
          {leftActions.map((leftAction) => (
            <button
              key={leftAction.label}
              type="button"
              className={`swipe-tray-button ${leftAction.destructive ? 'is-destructive' : ''}`}
              tabIndex={trayOpen ? 0 : -1}
              onClick={() => {
                closeTray()
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

      <div className="swipe-surface" ref={surfaceRef}>
        {children}
      </div>
    </div>
  )
}
