import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The one overlay primitive. Doc 02 §2: bottom sheets, never desktop-style
 * modals. Every screen that needs to edit something uses this.
 *
 * Behaviors that matter on iPhone and are easy to get wrong:
 * - Tapping the scrim dismisses (no confirmation for a reversible action)
 * - Escape dismisses, for the occasional desktop visit
 * - Body scroll locks while open, so the page behind doesn't drift
 * - Safe-area padding at the bottom so content clears the home indicator
 * - Focus moves into the sheet on open
 */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <button className="sheet__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="sheet__grabber" aria-hidden="true" />
        <h2 className="sheet__title">{title}</h2>
        {children}
      </div>
    </>
  )
}
