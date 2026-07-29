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
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragStartTime = useRef(0)

  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

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

    if (distance > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY) onClose()
  }

  if (!open) return null

  return createPortal(
    <>
      <div
        className="sheet-backdrop"
        data-open={open}
        data-testid="sheet-backdrop"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="sheet"
        data-open={open}
        data-dragging={dragging}
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
            Done
          </button>
        </div>

        <div className="sheet-body scroll-region">{children}</div>
      </div>
    </>,
    document.body,
  )
}
