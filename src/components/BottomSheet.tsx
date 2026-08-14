import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './BottomSheet.css'

/** Drag distance past which releasing dismisses the sheet. */
const DISMISS_DISTANCE_PX = 96
/** Downward flick speed that dismisses regardless of distance. */
const DISMISS_VELOCITY = 0.5
/**
 * How far a flick must still travel to count as one.
 *
 * `DISMISS_VELOCITY` on its own is a trap: velocity is distance over elapsed
 * time, so a 6px slip in 10ms is 0.6px/ms and dismissed the sheet. That is not
 * a flick, it is a thumb landing slightly off — and it happened on the one
 * strip of every sheet a thumb reaches for first. `INTERACTION_PATTERNS.md` §2
 * already writes the correct shape down for swipe rows: a flick must be fast
 * AND still cross a distance, because "a nudge is not a decision, however fast
 * it is". This is that rule, for sheets.
 */
const FLICK_MIN_DISTANCE_PX = 24
/**
 * Movement before a touch on the header is a drag rather than a tap (§29).
 *
 * The drag region now includes the header, and the header holds `Done` /
 * `Cancel`. Nothing is captured and nothing moves until the finger has travelled
 * this far, so a press on that control is an ordinary click on an ordinary
 * button; only a finger that has actually moved becomes a gesture.
 */
const DRAG_SLOP_PX = 6
/**
 * How much of the finger's travel the sheet gives up while it is holding
 * unsaved edits.
 *
 * A dirty sheet already refuses to be dragged away (§9f). What it did not do
 * was SAY so: the sheet tracked the finger the whole way down and then snapped
 * back from 300px with no explanation, which reads as a gesture that failed
 * rather than one that was refused. Damped, the sheet barely leaves the bottom
 * edge — the finger is told immediately that this one is held, in the only
 * language a drag has, and without a confirmation dialogue taxing every correct
 * dismissal to catch the rare wrong one.
 */
const DIRTY_DRAG_RESISTANCE = 0.22
/** The furthest a held sheet will travel, however far the finger goes. */
const DIRTY_DRAG_MAX_PX = 44
/**
 * The smallest visual-viewport shortfall treated as a software keyboard.
 *
 * Safari's own toolbar collapsing and expanding also moves the visual viewport,
 * by a few tens of pixels, and lifting the sheet off the bottom edge by that
 * much would open a gap under it every time the page scrolled. A keyboard is
 * never this small, so this separates the two without having to ask which one
 * happened.
 */
const KEYBOARD_MIN_INSET_PX = 80

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
  const backdropRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragStartTime = useRef(0)
  /** True once the finger has passed `DRAG_SLOP_PX` and this is a gesture. */
  const dragging = useRef(false)
  /** Set by a completed drag, and read by the click it would otherwise fire. */
  const dragged = useRef(false)
  /** The pending paint, so a burst of moves costs one frame rather than one each. */
  const frame = useRef(0)
  /**
   * Where the finger is now, read by that pending paint.
   *
   * Several `pointermove`s arrive per frame, and the frame has to draw the LAST
   * of them. Capturing the offset when the frame is scheduled draws the FIRST
   * instead and throws the rest away, so the sheet trails the thumb by however
   * many events the burst contained — worse the faster the drag, which is the
   * opposite of what coalescing is for.
   */
  const dragOffset = useRef(0)
  /**
   * Detaches the in-flight drag's window listeners.
   *
   * Null whenever no finger is down. Held here so a sheet that closes mid-drag —
   * dismissed by the drag itself, or unmounted by the screen behind it — takes
   * its listeners with it rather than leaving three on the window.
   */
  const releaseDrag = useRef<(() => void) | null>(null)

  useEffect(() => () => releaseDrag.current?.(), [])
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
  /* the software keyboard                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Keeps the sheet above the keyboard instead of behind it.
   *
   * ## The bug this exists for
   *
   * A sheet is `position: fixed; bottom: 0`, and on iOS Safari `fixed` is
   * resolved against the LAYOUT viewport, which the keyboard does not change.
   * `dvh` does not change either. So every measurement the sheet is built from
   * stays exactly as it was while roughly 300px of the screen stops being
   * visible — and the bottom of the sheet, which is where the pinned primary
   * action deliberately lives, is underneath the keyboard.
   *
   * That is the whole of `BottomSheet.css`'s note that the footer being
   * reachable "with the software keyboard raised" is "the one thing about this
   * screen that no test in this repository can check". It was reachable by
   * construction at any sheet height, and not reachable at all with a keyboard
   * up: `Add to My Stuff`, `Save changes`, `Create trip`, and the result lists
   * of all three search sheets in Settings.
   *
   * ## What this does
   *
   * `visualViewport` is the only thing that does report the keyboard, so the
   * shortfall between it and the layout viewport is measured and published as a
   * length the stylesheet can use for both the bottom edge and the height cap.
   * The sheet then sits on top of the keyboard and shrinks by exactly as much
   * as it rose, so its top edge does not move and nothing under the thumb
   * shifts.
   *
   * Written to the element rather than held in state for the same reason the
   * drag is: the keyboard animates, `resize` fires repeatedly through it, and
   * re-rendering an open sheet on every one of those is a cost with nothing to
   * show for it.
   */
  useEffect(() => {
    if (!open) return
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      const shortfall = window.innerHeight - viewport.height - viewport.offsetTop
      const inset = shortfall > KEYBOARD_MIN_INSET_PX ? Math.round(shortfall) : 0
      sheetRef.current?.style.setProperty('--sheet-keyboard-inset', `${inset}px`)

      // The sheet just got shorter under a field that was already focused, so
      // the field may now be outside it. `nearest` scrolls the sheet's own body
      // by the least that fixes it and leaves everything else alone; it is a
      // no-op when the field is already in view.
      const focused = document.activeElement
      if (inset > 0 && focused instanceof HTMLElement && sheetRef.current?.contains(focused)) {
        focused.scrollIntoView({ block: 'nearest' })
      }
    }

    update()
    viewport.addEventListener('resize', update)
    // The keyboard also moves the visual viewport without resizing it — Safari
    // scrolls it to keep a focused field visible — and the sheet has to follow.
    viewport.addEventListener('scroll', update)

    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
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
      /*
       * `preventScroll`: a guard on the order these two cleanups run in, not a
       * fix for an observed defect (§34).
       *
       * Focusing an element that is off screen scrolls the page to it, and this
       * runs immediately after the effect above has put the page back where
       * Alex was. In the ordinary case that costs nothing — the restore has
       * already brought the opener back into view, so there is nothing to
       * scroll to, and the e2e scroll-restore assertion passes with or without
       * this word. It is here for the case that is not ordinary: a page whose
       * layout changed while the sheet was open, leaving the opener somewhere
       * else. The scroll position is the restore's business; this only has to
       * move the focus ring.
       */
      previouslyFocused.current?.focus?.({ preventScroll: true })
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

  /**
   * Moves the sheet, without re-rendering it.
   *
   * The transform and the backdrop's opacity are written straight to the
   * elements, coalesced onto one animation frame. This is the same rule
   * `INTERACTION_PATTERNS.md` §2 already sets for swipe rows — "no React state
   * changes between the finger landing and the settle" — and it matters more
   * here, because the thing that would re-render on every touchmove is a whole
   * open sheet: the swap sheet's option list, the wardrobe picker's results,
   * Settings' rules. None of that can change while a thumb is dragging the
   * frame around it, so none of it should be asked to render.
   */
  const paint = useCallback((offset: number) => {
    const sheet = sheetRef.current
    if (sheet) sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : ''

    // The backdrop thins as the sheet leaves, so the drag reads as a dismissal
    // in progress rather than a sheet sliding over a still-solid screen (§28).
    // Floored, so the content behind never becomes the thing being looked at.
    const backdrop = backdropRef.current
    if (backdrop) {
      backdrop.style.opacity =
        offset > 0 ? String(Math.max(0.45, 1 - offset / (window.innerHeight || 1))) : ''
    }
  }, [])

  const settle = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = 0
    dragStartY.current = null
    dragOffset.current = 0
    dragging.current = false
    sheetRef.current?.removeAttribute('data-dragging')
    backdropRef.current?.removeAttribute('data-dragging')
    paint(0)
  }, [paint])

  /**
   * Starts a drag, and listens for the rest of it on the window.
   *
   * ## Why the window, and not this element
   *
   * `pointermove` is delivered to whatever is under the finger, and the drag
   * region is about 76px tall. One coarse move — which is what any quick drag
   * produces — lands in the sheet's BODY, which has no handler. Listening on the
   * region alone therefore worked only for slow drags, whose fine-grained moves
   * happen to stay inside the header; a real flick from the title moved the
   * sheet not at all. Every threshold test passed throughout, because they were
   * all slow.
   *
   * ## Why not `setPointerCapture`, which is the obvious answer
   *
   * Capture fixes the moves and breaks the buttons. With a capture active on
   * this element, the `click` that follows a `pointerup` is dispatched to the
   * CAPTURING element rather than to what was pressed — so `Done` and `Cancel`,
   * which live inside the drag region, stopped closing the sheet. Both e2e
   * assertions for them failed the moment the capture moved to `pointerdown`.
   *
   * Window listeners give the same guarantee — every move and the release reach
   * us wherever the finger goes — and leave the click alone entirely. They exist
   * only while a finger is down, so this is not the global scroll listener §42
   * warns about.
   */
  const onPointerDown = (event: React.PointerEvent) => {
    // A second finger while one is already dragging is not a second drag.
    if (dragStartY.current !== null) return

    dragStartY.current = event.clientY
    dragStartTime.current = performance.now()
    dragging.current = false
    dragged.current = false

    const pointerId = event.pointerId

    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId || dragStartY.current === null) return

      // Downward only. Dragging up must not detach the sheet from the bottom.
      const travelled = Math.max(0, moved.clientY - dragStartY.current)

      if (!dragging.current) {
        // Below the slop threshold this is still a press, not a gesture:
        // nothing moves, and nothing is dismissed on release (§29).
        if (travelled < DRAG_SLOP_PX) return
        dragging.current = true
        sheetRef.current?.setAttribute('data-dragging', 'true')
        backdropRef.current?.setAttribute('data-dragging', 'true')
      }

      // Damped while there is an unsaved edit to lose: the sheet gives a little
      // and stops, which is what a held sheet feels like (§9f).
      dragOffset.current = dirty
        ? Math.min(travelled * DIRTY_DRAG_RESISTANCE, DIRTY_DRAG_MAX_PX)
        : travelled

      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        paint(dragOffset.current)
      })
    }

    const up = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return
      if (dragStartY.current === null) return detach()

      const distance = Math.max(0, released.clientY - dragStartY.current)
      const elapsed = Math.max(1, performance.now() - dragStartTime.current)
      const velocity = distance / elapsed
      const wasDragging = dragging.current

      settle()
      detach()
      dragged.current = wasDragging

      // A press that never became a drag is a press. It belongs to the close
      // button, or to nothing; either way this gesture has no opinion about it.
      if (!wasDragging) return

      // A drag that would have dismissed simply snaps back while there is an
      // unsaved edit to lose (§9f). `settle()` has already done the snapping;
      // this is only the decision not to close.
      if (dirty) return

      const far = distance > DISMISS_DISTANCE_PX
      const flicked = velocity > DISMISS_VELOCITY && distance > FLICK_MIN_DISTANCE_PX
      if (far || flicked) onClose()
    }

    /*
     * Cancellation is not release.
     *
     * `pointercancel` means the browser took the gesture away — a second finger,
     * a system gesture, Safari deciding it owns the pan. The sheet returns to
     * where it was and nothing is dismissed, because nobody decided anything.
     */
    const cancel = (cancelled: PointerEvent) => {
      if (cancelled.pointerId !== pointerId) return
      settle()
      detach()
    }

    function detach() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      releaseDrag.current = null
    }

    releaseDrag.current = detach
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  /**
   * Swallows the click a completed drag would otherwise fire.
   *
   * A drag that starts on the header and ends there still produces a `click` on
   * whatever is under the finger, and on the header that is `Done` — so a drag
   * far too short to dismiss would have closed the sheet anyway, by the one
   * route the dirty guard does not cover (§29).
   */
  const onClickCapture = (event: React.MouseEvent) => {
    if (!dragged.current) return
    dragged.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        ref={backdropRef}
        className="sheet-backdrop"
        data-open={open}
        data-testid="sheet-backdrop"
        onClick={dirty ? undefined : onClose}
      />
      <div
        ref={sheetRef}
        className="sheet"
        data-open={open}
        data-reserved={reserved || loading}
        data-footer={Boolean(footer)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {/*
          * The drag region: the grabber strip AND the header under it (§24).
          *
          * The grabber alone was 32px of a 664px screen, and it is the strip a
          * thumb has the least reason to be resting on — the reachable thing at
          * the top of a sheet is the title. Together they are about 76px of
          * continuous, unambiguous drag surface, none of which scrolls, which
          * is what `INTERACTION_PATTERNS.md` §3 means by a downward drag being
          * a real way out rather than a technicality.
          *
          * Handlers here rather than on each child so a drag that starts on the
          * grabber and passes over the title is one gesture, not two.
          */}
        <div
          className="sheet-drag-region"
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
        >
          <div className="sheet-grabber-area" data-testid="sheet-grabber">
            {/* Decorative, unlabelled, unfocusable: the gesture it advertises is
                never the only way out, and `Done` beside it is the real one. */}
            <div className="sheet-grabber" />
          </div>

          <div className="sheet-header">
            <h2 className="sheet-title">{title}</h2>
            <button type="button" className="sheet-close" onClick={onClose}>
              {dismiss === 'cancel' ? 'Cancel' : 'Done'}
            </button>
          </div>
        </div>

        <div className="sheet-body scroll-region">{children}</div>

        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </>,
    document.body,
  )
}
