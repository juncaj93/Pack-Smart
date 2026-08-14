import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './BottomSheet.css'

/** Drag distance past which releasing dismisses the sheet. */
const DISMISS_DISTANCE_PX = 96
/** Downward flick speed that dismisses regardless of distance. */
const DISMISS_VELOCITY = 0.5

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /**
   * The sheet's primary action, pinned below the scrolling body.
   *
   * Optional, and worth explaining. A Save button at the end of the form scrolls
   * away with it — which on a 664px viewport (what Safari actually gives a page
   * on an iPhone 14, not the 844px screen) put `Add to My Stuff` below the fold
   * on the Add Item sheet. It is also the whole of the open question in
   * `UX_AUDIT` U5: whether Save stays reachable with the keyboard raised. Pinned,
   * it is reachable by construction, at any height, keyboard or not.
   */
  footer?: React.ReactNode
  /**
   * What the top-right control means (§9a).
   *
   * `done` — the default, and right for every sheet whose edits apply as they
   * are made: the bag chips, the timing radios, the rating pickers. There is
   * nothing to save, so the only thing left to do is leave, and `Done` says so.
   *
   * `cancel` — for a sheet with an authoritative primary action in its footer.
   * `Done` beside `Save changes` is two completion-like controls with different
   * meanings, and the wrong guess loses an edit. Naming the top-right for what
   * it actually does — abandon this and go back — leaves exactly one way to
   * finish.
   */
  dismiss?: 'done' | 'cancel'
  /**
   * True while the sheet holds edits that have not been saved (§9f).
   *
   * When it is, the two CASUAL dismissals stop working: a downward drag snaps
   * back and a backdrop tap does nothing. A sheet that can be swiped away by a
   * thumb that meant to scroll should not be able to take a half-filled form
   * with it, and the alternatives are worse — a confirmation dialogue taxes
   * every correct dismissal to catch the rare wrong one (doc 02 §2 prefers undo
   * to exactly that), and there is nothing to undo once the draft is gone.
   *
   * The DELIBERATE exits are untouched and both are on screen: `Cancel` at the
   * top right, and the primary action in the footer. Escape is untouched too —
   * a key is not something a thumb does by accident.
   */
  dirty?: boolean
  /**
   * True while this sheet's content is still on its way.
   *
   * ## The bug this exists for
   *
   * A sheet is `position: fixed; bottom: 0` and sizes to its content, so it
   * grows UPWARD. A sheet that opens before its list has arrived therefore
   * opens short — a search field, one action, and the word "Loading…" — and
   * then leaps when the reply lands. Measured, on the seeded database, at the
   * real fold:
   *
   *     Add to this trip     419 -> 100   -319px
   *     Your usual amounts   414 -> 117   -297px
   *     Packing rules        378 -> 100   -278px
   *     One last look        513 -> 427    -86px
   *
   * Everything in the sheet moves up by that much, at a moment Alex has already
   * been able to touch it for a few hundred milliseconds. He aims at the one
   * control the short sheet was showing him; the reply lands; a list row lands
   * under his finger instead. On the rules sheet that means tapping `Add a
   * rule` and silently turning off a packing rule 278px further down — which
   * is exactly what happened on Alex's phone, and is worse than a tap that does
   * nothing, because nothing on screen says a rule just changed.
   *
   * ## What passing it does
   *
   * The sheet holds the full height it is allowed from its first frame, so the
   * content fills a frame that is already the right size instead of pushing the
   * frame open. The three sheets above all SETTLE at that height anyway — 100,
   * 100 and 117 against a 664px fold — so for them this costs nothing at all.
   *
   * Latched for the life of one opening: releasing it when the content lands
   * would shrink the sheet instead of growing it, which is the same defect
   * pointing the other way.
   *
   * A sheet whose content is already in hand when it opens — every form in the
   * product — passes nothing and is unchanged.
   */
  loading?: boolean
}

/**
 * The shared bottom sheet.
 *
 * Product doc 02 mandates sheets over desktop-style modals for every quick edit,
 * so this is built once in M0 and reused from M2 onward for item editing,
 * quantities, and add flows.
 *
 * Dismissible three ways — backdrop tap, downward drag, Escape — because doc 02
 * §2 requires that a swipe is never the only route to an action.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  dismiss = 'done',
  dirty = false,
  loading = false,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragStartTime = useRef(0)

  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  /**
   * Whether this opening ever waited for its content, and therefore holds its
   * height for the rest of the opening. Reset on close, so the next opening
   * decides again — a sheet reopened over a wardrobe already in memory has
   * nothing to wait for and is sized to its content like any other.
   */
  const [reserved, setReserved] = useState(false)

  useEffect(() => {
    // `open &&`, because a closed sheet still runs its hooks and several report
    // themselves as loading while shut — the Add sheet's wardrobe is unfetched
    // whenever it is not on screen. Latching on that would arm the reservation
    // permanently, on sheets that may have nothing to wait for next time.
    if (open && loading) setReserved(true)
    else if (!open) setReserved(false)
  }, [loading, open])

  /* ---------------------------------------------------------------- */
  /* body scroll lock                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open) return

    // position:fixed is the only lock that reliably stops iOS from scrolling the
    // page behind the sheet, but it resets scroll to 0 — so the offset is
    // captured and restored on close.
    const scrollY = window.scrollY
    document.body.style.top = `-${scrollY}px`
    document.body.classList.add('is-locked')

    return () => {
      document.body.classList.remove('is-locked')
      document.body.style.top = ''
      window.scrollTo(0, scrollY)
    }
  }, [open])

  /* ---------------------------------------------------------------- */
  /* focus management                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    // Focus the sheet itself rather than its first control: on iOS, focusing an
    // input immediately raises the keyboard over the sheet the user is reading.
    sheetRef.current?.focus()

    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  const focusables = useCallback((): HTMLElement[] => {
    const root = sheetRef.current
    if (!root) return []
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement)
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [focusables, onClose],
  )

  /* ---------------------------------------------------------------- */
  /* drag to dismiss                                                   */
  /* ---------------------------------------------------------------- */

  const onPointerDown = (event: React.PointerEvent) => {
    dragStartY.current = event.clientY
    dragStartTime.current = performance.now()
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragStartY.current === null) return
    // Downward only. Dragging up must not detach the sheet from the bottom edge.
    setDragOffset(Math.max(0, event.clientY - dragStartY.current))
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (dragStartY.current === null) return

    const distance = Math.max(0, event.clientY - dragStartY.current)
    const elapsed = Math.max(1, performance.now() - dragStartTime.current)
    const velocity = distance / elapsed

    dragStartY.current = null
    setDragging(false)
    setDragOffset(0)

    // A drag that would have dismissed simply snaps back while there is an
    // unsaved edit to lose (§9f). `setDragOffset(0)` above has already done the
    // snapping; this is only the decision not to close.
    if (dirty) return
    if (distance > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY) onClose()
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        className="sheet-backdrop"
        data-open={open}
        data-testid="sheet-backdrop"
        onClick={dirty ? undefined : onClose}
      />
      <div
        ref={sheetRef}
        className="sheet"
        data-open={open}
        data-dragging={dragging}
        data-reserved={reserved || loading}
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div
          className="sheet-grabber-area"
          data-testid="sheet-grabber"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="sheet-grabber" />
        </div>

        <div className="sheet-header">
          <h2 className="sheet-title">{title}</h2>
          <button type="button" className="sheet-close" onClick={onClose}>
            {dismiss === 'cancel' ? 'Cancel' : 'Done'}
          </button>
        </div>

        <div className="sheet-body scroll-region">{children}</div>

        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </>,
    document.body,
  )
}
