import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import './UndoBar.css'

/**
 * The transient "that happened, and you can take it back" strip.
 *
 * Doc 02 §2 prefers undo over a confirmation dialog, which only works if undo is
 * actually there — so this is the one mechanism, extracted from the trip screen
 * where it was first written rather than copied to each new caller. Three timers
 * counting six seconds in three files is how they start disagreeing about how
 * long six seconds is, and how one of them quietly stops clearing itself on
 * unmount.
 *
 * ## What it is not
 *
 * Not a notification system. It says one thing about the action just taken and
 * offers to reverse it; anything that needs to persist, stack, or be dismissed
 * by hand is a different problem and should not be solved by growing this.
 */

export const UNDO_VISIBLE_MS = 6000

export interface Undoable {
  /** What happened, in Alex's words. Never a field name. */
  message: string
  undo: () => Promise<void>
  /** A second, action-specific control. Rare — most callers pass nothing. */
  extra?: { label: string; onClick: () => void }
}

export interface UndoOffer {
  /** The offer on screen, or null. Render it with `<UndoBar>`. */
  undoable: Undoable | null
  /** Show one. Replaces whatever was there and restarts the clock. */
  offer: (undoable: Undoable) => void
  /** Take it away now — after the undo runs, or when the screen moves on. */
  dismiss: () => void
}

/**
 * Holds the current offer and clears it after `UNDO_VISIBLE_MS`.
 *
 * The timer lives in a ref and is cleared on unmount, which is the bug this
 * being one implementation prevents: a `setTimeout` calling `setState` on a
 * screen Alex has already left is a React warning in development and a leak in
 * every environment.
 *
 * ## Why there is a deadline as well as a timer
 *
 * `setTimeout` measures how long the PAGE has been running, and iOS Safari stops
 * running a backgrounded tab. Six seconds of timer therefore takes six seconds
 * of foreground: archive something, take a call, come back twenty minutes later,
 * and the strip is still on screen offering to undo an action from before the
 * call. It would even work — the restore is still valid — but an offer that has
 * outlived its moment is a control Alex has to stop and reason about, and the
 * whole point of a transient strip is that it does not ask for that.
 *
 * So the deadline is wall clock, checked when the tab comes back. The timer
 * still does the ordinary work; this only catches the case where the timer was
 * asleep for it.
 *
 * Deliberately not restarted on return. The offer is about the thing Alex just
 * did, and after an interruption it is not the thing he just did — the permanent
 * path (My Stuff → *Show archived* → Restore) is the honest way back by then.
 */
export function useUndoOffer(): UndoOffer {
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Wall clock, in ms, at which this offer stops being about a recent action. */
  const expiresAt = useRef(0)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    expiresAt.current = 0
  }, [])

  useEffect(() => clear, [clear])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      if (expiresAt.current === 0 || Date.now() < expiresAt.current) return

      clear()
      setUndoable(null)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [clear])

  const offer = useCallback(
    (next: Undoable) => {
      clear()
      setUndoable(next)
      expiresAt.current = Date.now() + UNDO_VISIBLE_MS
      timer.current = setTimeout(() => {
        expiresAt.current = 0
        setUndoable(null)
      }, UNDO_VISIBLE_MS)
    },
    [clear],
  )

  const dismiss = useCallback(() => {
    clear()
    setUndoable(null)
  }, [clear])

  return { undoable, offer, dismiss }
}

/**
 * `role="status"` rather than `alert`.
 *
 * An alert interrupts whatever a screen reader is saying, and this is the
 * consequence of an action Alex just took deliberately — polite is the honest
 * register. It is announced, not shouted, which is the same judgement the
 * weather-conflict banner makes.
 */
export function UndoBar({ offer, onUndone }: { offer: UndoOffer; onUndone?: () => void }): ReactNode {
  const { undoable, dismiss } = offer
  if (!undoable) return null

  return (
    <div className="undo-bar" role="status">
      <span>{undoable.message}</span>
      <span className="undo-actions">
        {undoable.extra ? (
          <button type="button" onClick={undoable.extra.onClick}>
            {undoable.extra.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            await undoable.undo()
            dismiss()
            onUndone?.()
          }}
        >
          Undo
        </button>
      </span>
    </div>
  )
}
