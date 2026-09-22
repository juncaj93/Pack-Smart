import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dragging a row up and down a short list by its handle (doc 09 §0y).
 *
 * Built for the outfit card's four-or-five garments and for nothing longer.
 * There is no virtualisation, no auto-scroll at the edges and no cross-list
 * dropping, because a list that needed any of those would be the wrong shape
 * for a drag on a phone in the first place.
 *
 * ## Why a handle rather than the row
 *
 * The row is already a tap target that opens the swap sheet, and it sits in a
 * page that scrolls. A long-press-then-drag on the row itself competes with
 * both — and a press that has to be held for 400ms before anything happens is
 * the least discoverable gesture there is. A dedicated handle claims the
 * gesture outright: `touch-action: none` on 44px of the row, and the other 280
 * still scroll the page and still open the sheet.
 *
 * ## The rules this shares with `SwipeRow`
 *
 * `INTERACTION_PATTERNS.md` §2's two hardest-won lessons apply here unchanged,
 * and for the same reasons:
 *
 * - **Touch events, never Pointer Events.** Touch events have implicit capture,
 *   so a finger that wanders off the handle mid-drag still delivers its moves
 *   to the handle it started on. `setPointerCapture` would work too and would
 *   also swallow the click that follows.
 * - **No React render between the finger landing and the drop.** Every
 *   transform is written to the element's own `style`. A render mid-drag is
 *   what lets a key change or a list resort replace the row under the thumb.
 *
 * What it does NOT share is a commit threshold. A drag that ends where it began
 * simply reorders nothing; there is no distance at which the outcome flips, so
 * there is nothing to tune and nothing to get wrong.
 */

/** Movement before a press on the handle counts as a drag rather than a tap. */
export const DRAG_SLOP = 4

interface Measured {
  id: string
  top: number
  height: number
}

interface Drag {
  from: number
  to: number
  startY: number
  rows: Measured[]
  /** True once the finger has moved past `DRAG_SLOP`. */
  moved: boolean
}

export interface ReorderDrag {
  /** Put this on the scrolling container of the rows — the `ul`. */
  listRef: (node: HTMLElement | null) => void
  /** Starts a drag from a handle. Pass the row's id. */
  startDrag: (id: string, event: React.TouchEvent | React.MouseEvent) => void
  /** The row being dragged, or null. Rendered as a lifted state. */
  dragging: string | null
}

/**
 * @param ids   The rows' ids, in the order they are currently rendered.
 * @param onDrop Called with the new order when the drop actually changes it.
 */
export function useReorderDrag(ids: string[], onDrop: (order: string[]) => void): ReorderDrag {
  const [dragging, setDragging] = useState<string | null>(null)

  const listNode = useRef<HTMLElement | null>(null)
  const drag = useRef<Drag | null>(null)
  const idsRef = useRef(ids)
  const dropRef = useRef(onDrop)

  idsRef.current = ids
  dropRef.current = onDrop

  const listRef = useCallback((node: HTMLElement | null) => {
    listNode.current = node
  }, [])

  /** Every row's box, in DOM order, measured once when the finger lands. */
  const measure = useCallback((): Measured[] => {
    const list = listNode.current
    if (!list) return []
    return [...list.children].map((child, index) => {
      const box = child.getBoundingClientRect()
      return { id: idsRef.current[index] ?? '', top: box.top, height: box.height }
    })
  }, [])

  /**
   * Draws the drag: the lifted row follows the finger, everything it has passed
   * steps aside by exactly the gap it left.
   *
   * The gap is the LIFTED row's height rather than each displaced row's own,
   * because that is the hole being filled — with names that wrap, two rows in
   * one card can differ by a line and using each row's own height would make
   * the list breathe as the finger crossed it.
   */
  const paint = useCallback((active: Drag, dy: number) => {
    const list = listNode.current
    if (!list) return
    const lifted = active.rows[active.from]
    if (!lifted) return

    ;[...list.children].forEach((child, index) => {
      const node = child as HTMLElement
      if (index === active.from) {
        node.style.transform = `translateY(${dy}px)`
        return
      }
      const shift =
        active.from < active.to && index > active.from && index <= active.to
          ? -lifted.height
          : active.from > active.to && index >= active.to && index < active.from
            ? lifted.height
            : 0
      node.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
    })
  }, [])

  const clearPaint = useCallback(() => {
    const list = listNode.current
    if (!list) return
    for (const child of list.children) (child as HTMLElement).style.transform = ''
  }, [])

  /**
   * Where the lifted row wants to sit, from where its CENTRE is.
   *
   * Walking outward from the row's own index rather than scanning every row,
   * so the answer cannot oscillate between two indices when a fast drag crosses
   * several rows in one move: each step has to pass the next neighbour's midpoint
   * before it is taken.
   */
  const targetIndex = useCallback((active: Drag, dy: number): number => {
    const lifted = active.rows[active.from]
    if (!lifted) return active.from
    const centre = lifted.top + dy + lifted.height / 2

    let to = active.from
    while (to > 0) {
      const above = active.rows[to - 1]!
      if (centre >= above.top + above.height / 2) break
      to -= 1
    }
    while (to < active.rows.length - 1) {
      const below = active.rows[to + 1]!
      if (centre <= below.top + below.height / 2) break
      to += 1
    }
    return to
  }, [])

  const startDrag = useCallback(
    (id: string, event: React.TouchEvent | React.MouseEvent) => {
      const rows = measure()
      const from = rows.findIndex((row) => row.id === id)
      if (from < 0) return

      const startY =
        'touches' in event ? (event.touches[0]?.clientY ?? 0) : (event as React.MouseEvent).clientY

      drag.current = { from, to: from, startY, rows, moved: false }
      /*
       * `setDragging` runs BEFORE the finger has moved, which is the one render
       * this hook allows during a gesture — and it is safe because it happens
       * while the offset is still zero, before any transform exists to be
       * overwritten. It is what lifts the row visually, so the gesture says it
       * has started rather than waiting for travel to prove it.
       */
      setDragging(id)
    },
    [measure],
  )

  /*
   * Listeners on the window, attached once, reading everything from refs.
   *
   * On the window rather than on the handle because a drag leaves the handle
   * immediately — the handle is 44px and the list is several hundred. Touch
   * events would deliver to the handle anyway through implicit capture; a mouse
   * would not, and one listener pair serves both.
   */
  useEffect(() => {
    function move(event: TouchEvent | MouseEvent) {
      const active = drag.current
      if (!active) return

      const y = 'touches' in event ? (event.touches[0]?.clientY ?? 0) : event.clientY
      const dy = y - active.startY

      if (!active.moved) {
        if (Math.abs(dy) < DRAG_SLOP) return
        active.moved = true
      }

      /*
       * The page must not scroll while a row is being dragged up it.
       *
       * `touch-action: none` on the handle is necessary and not sufficient —
       * the move events arrive at the window, where the declaration does not
       * apply — so the pan is vetoed here as well, exactly as `SwipeRow` vetoes
       * its own. The listener is registered non-passive below for this line.
       */
      if (event.cancelable) event.preventDefault()

      active.to = targetIndex(active, dy)
      paint(active, dy)
    }

    function end() {
      const active = drag.current
      drag.current = null
      if (!active) return

      clearPaint()
      setDragging(null)

      if (!active.moved || active.to === active.from) return

      const order = [...idsRef.current]
      const [moved] = order.splice(active.from, 1)
      if (moved === undefined) return
      order.splice(active.to, 0, moved)
      dropRef.current(order)
    }

    function cancel() {
      /*
       * A cancel is not a drop. The browser or the system took the finger away,
       * so nothing was decided and the row goes back where it was.
       */
      drag.current = null
      clearPaint()
      setDragging(null)
    }

    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', cancel)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)

    return () => {
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', cancel)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', end)
    }
  }, [clearPaint, paint, targetIndex])

  return { listRef, startDrag, dragging }
}
