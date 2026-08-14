import { useEffect, useState } from 'react'

/**
 * How much of the screen the software keyboard is covering.
 *
 * ## Why this needs measuring at all
 *
 * On iOS Safari the keyboard changes neither the layout viewport nor `dvh`. A
 * `position: fixed` element resolved against either of those therefore stays
 * exactly where it was while roughly 300px of the screen stops being visible —
 * which is how a bottom sheet's pinned action, and a bottom toolbar, end up
 * underneath the keyboard rather than above it.
 *
 * `visualViewport` is the only thing that reports it, and the shortfall between
 * the two viewports is the number.
 *
 * ## One implementation
 *
 * `BottomSheet` writes this to its own element as a CSS length; the toolbar uses
 * it to get out of the way entirely. Both read the same measurement and the same
 * threshold from here, because two components disagreeing about whether the
 * keyboard is up is exactly the sort of drift that ends with one of them
 * covering the control the other made room for.
 */

/**
 * The smallest shortfall treated as a keyboard.
 *
 * Safari's own toolbar collapsing and expanding also moves the visual viewport,
 * by a few tens of pixels. Reacting to that would lift a sheet off the bottom
 * edge, and hide the toolbar, every time the page scrolled. A keyboard is never
 * this small, so this separates the two without having to ask which happened.
 */
export const KEYBOARD_MIN_INSET_PX = 80

/** The current keyboard inset in CSS pixels, or 0 when there is none. */
export function keyboardInset(): number {
  const viewport = window.visualViewport
  if (!viewport) return 0

  const shortfall = window.innerHeight - viewport.height - viewport.offsetTop
  return shortfall > KEYBOARD_MIN_INSET_PX ? Math.round(shortfall) : 0
}

/**
 * Subscribes to `visualViewport` and reports what the keyboard is doing.
 *
 * `subscribe` rather than a hook body, so `BottomSheet` — which writes a length
 * to an element and deliberately does not re-render mid-keyboard — can use the
 * same listeners without taking React state it does not want.
 */
export function onViewportChange(handler: () => void): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => {}

  viewport.addEventListener('resize', handler)
  // The keyboard also moves the visual viewport without resizing it — Safari
  // scrolls it to keep a focused field visible — and both callers must follow.
  viewport.addEventListener('scroll', handler)

  return () => {
    viewport.removeEventListener('resize', handler)
    viewport.removeEventListener('scroll', handler)
  }
}

/**
 * True while the software keyboard is materially covering the viewport.
 *
 * State, unlike `BottomSheet`'s use of the same measurement, because the toolbar
 * genuinely has to render differently: it leaves the screen. That is at most two
 * renders per keyboard, of one small component.
 */
export function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false)

  useEffect(() => {
    const sync = () => setUp(keyboardInset() > 0)
    sync()
    return onViewportChange(sync)
  }, [])

  return up
}
