// @vitest-environment jsdom
import { useEffect, useRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SwipeRow } from '@/components/SwipeRow'

/**
 * The swipe row as a DOM component, driven by touch.
 *
 * `tests/unit/dom/swipe-recognizer.test.ts` proves the arithmetic. This proves
 * the wiring — the part that broke on the phone and that no unit test could
 * see: which listeners exist, whether the browser's pan is actually vetoed,
 * whether a render happens under the finger, and when the list is allowed to
 * resort.
 *
 * What it deliberately does NOT claim: that any of this feels right on a
 * phone. jsdom has no compositor, no scroll arbitration and no thumb. It is
 * the layer below the browser tests, not a substitute for the one real-device
 * check.
 */

const ROW_WIDTH = 360

/** jsdom measures everything as zero, and a row of zero width cannot commit. */
function measureRows() {
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('swipe-row') ? ROW_WIDTH : 100
      return { x: 0, y: 0, width, height: 48, top: 0, left: 0, right: width, bottom: 48, toJSON() {} }
    })
}

/**
 * A touch event shaped like the ones WebKit dispatches.
 *
 * Built by hand rather than with `new TouchEvent(...)`: jsdom does not
 * implement `Touch`, and WebKit refuses `new Touch(...)` outright — a previous
 * attempt at this coverage was written with the constructor, passed on
 * Chromium, and could not run at all on the engine the product ships on.
 * The recognizer reads four things from an event, and these are those four.
 */
function touchEvent(
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  points: Array<{ x: number; y: number }>,
  { cancelable = true, time = 0 }: { cancelable?: boolean; time?: number } = {},
) {
  const event = new Event(type, { bubbles: true, cancelable })
  const touches = points.map((point) => ({ clientX: point.x, clientY: point.y }))
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : touches },
    changedTouches: { value: touches },
    timeStamp: { value: time },
  })
  return event as unknown as TouchEvent
}

interface Swipe {
  dx: number
  dy?: number
  /** Total gesture time. Short means a flick. */
  duration?: number
  steps?: number
  /** Stops mid-gesture without releasing, so a partial swipe can be inspected. */
  release?: boolean
  end?: 'touchend' | 'touchcancel'
}

/** Drives a touch across a row and reports what the browser was allowed to do. */
function swipe(row: HTMLElement, { dx, dy = 0, duration = 300, steps = 10, release = true, end = 'touchend' }: Swipe) {
  const moves: Array<{ prevented: boolean }> = []

  act(() => {
    row.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }], { time: 0 }))
  })

  for (let step = 1; step <= steps; step += 1) {
    const point = { x: (dx * step) / steps, y: (dy * step) / steps }
    const event = touchEvent('touchmove', [point], { time: (duration * step) / steps })
    act(() => {
      row.dispatchEvent(event)
    })
    moves.push({ prevented: event.defaultPrevented })
  }

  if (release) {
    act(() => {
      row.dispatchEvent(
        end === 'touchend'
          ? touchEvent('touchend', [{ x: dx, y: dy }], { time: duration })
          : touchEvent('touchcancel', [], { time: duration }),
      )
    })
  }

  return { moves, vetoed: moves.filter((move) => move.prevented).length }
}

/** A click carrying a chosen timestamp, so the swallow window can be tested. */
function trailingClick(time: number) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: time })
  return event
}

function offsetOf(row: HTMLElement): number {
  const surface = row.querySelector<HTMLElement>('.swipe-surface')
  const match = /translateX\((-?[\d.]+)px\)/.exec(surface?.style.transform ?? '')
  return match ? Number(match[1]) : 0
}

/**
 * A row that counts its own renders and mounts.
 *
 * The count is the assertion. "React must not run during the gesture" is not a
 * style preference — a render mid-swipe is what lets a key change, a list
 * resort, or an optimistic update replace the row instance under the finger.
 */
function Harness({
  onComplete = () => {},
  leftActions = [],
  disabled = false,
}: {
  onComplete?: () => void
  leftActions?: Array<{ label: string; glyph: string; onSelect: () => void }>
  disabled?: boolean
} = {}) {
  const renders = useRef(0)
  const mounts = useRef(0)
  renders.current += 1
  useEffect(() => {
    mounts.current += 1
  }, [])

  return (
    <SwipeRow
      actionGlyph="✓"
      actionLabel="Pack"
      onComplete={onComplete}
      leftActions={leftActions}
      disabled={disabled}
    >
      <button type="button" data-testid="tick">
        Sunglasses
      </button>
      <span data-testid="renders">{String(renders.current)}</span>
      <span data-testid="mounts">{String(mounts.current)}</span>
    </SwipeRow>
  )
}

function row(): HTMLElement {
  const node = document.querySelector<HTMLElement>('.swipe-row')
  if (!node) throw new Error('no swipe row rendered')
  return node
}

function renderCount(): number {
  return Number(screen.getByTestId('renders').textContent)
}

let measured: ReturnType<typeof measureRows>

beforeEach(() => {
  vi.useFakeTimers()
  measured = measureRows()
})

afterEach(() => {
  vi.useRealTimers()
  measured.mockRestore()
})

describe('the browser’s pan', () => {
  it('is vetoed for every move once the row owns the axis', () => {
    /*
     * The whole of the regression, as an assertion.
     *
     * PR #30 decided the axis in a POINTER handler and vetoed from a TOUCH
     * handler, so the veto could only land if `pointermove` happened to be
     * dispatched first — and it never landed inside the 8px lock window at all,
     * which is the window the browser makes its own decision in. Here the axis
     * is claimed and the pan is vetoed from the same event, so the only moves
     * that go un-vetoed are the ones before the lock distance.
     */
    render(<Harness />)
    const { moves, vetoed } = swipe(row(), { dx: 200 })

    // Every move here is 20px, so the axis is claimed on the first one and the
    // browser is never given a frame in which it could have started a pan.
    expect(vetoed).toBe(moves.length)
  })

  it('is never vetoed while the gesture is still undecided', () => {
    render(<Harness />)
    // Four pixels, in one move: under the lock distance, so the browser is
    // still entitled to start a scroll and must not be interfered with.
    const { vetoed } = swipe(row(), { dx: 4, steps: 1 })
    expect(vetoed).toBe(0)
  })

  it('is never vetoed for a vertical scroll that starts on a row', () => {
    /*
     * The half that must keep working. A list that will not scroll because
     * every row grabs the gesture is a worse product than one with no swipe.
     */
    render(<Harness />)
    const { vetoed } = swipe(row(), { dx: 6, dy: 160 })
    expect(vetoed).toBe(0)
    expect(offsetOf(row())).toBe(0)
  })

  it('stops the gesture rather than fighting on when the browser wins anyway', () => {
    /*
     * `cancelable: false` is what a touchmove looks like once the browser has
     * committed to a pan. The old code reset the row here with the finger still
     * down, which restarted the whole arbitration — the twitch loop. Nothing
     * may commit, and the row must come back to rest.
     */
    render(<Harness />)
    const node = row()
    act(() => {
      node.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }], { time: 0 }))
      node.dispatchEvent(touchEvent('touchmove', [{ x: 60, y: 0 }], { time: 32 }))
    })
    expect(offsetOf(node)).toBeGreaterThan(0)

    act(() => {
      node.dispatchEvent(touchEvent('touchcancel', [], { time: 48 }))
    })
    expect(offsetOf(node)).toBe(0)
  })
})

describe('React during the gesture', () => {
  it('does not render at all between the finger landing and the release', () => {
    render(<Harness leftActions={[{ label: 'Remove', glyph: '✕', onSelect: () => {} }]} />)
    const before = renderCount()

    swipe(row(), { dx: 120, release: false })

    expect(renderCount()).toBe(before)
    expect(offsetOf(row())).toBeGreaterThan(0)
  })

  it('does not render mid-gesture even when the tray is being revealed', () => {
    /*
     * The tray used to be MOUNTED when the offset went negative — a render
     * under the finger, in the one frame that could least afford one. It is
     * rendered at rest and hidden with `visibility` now, so a left-swipe costs
     * no render either.
     */
    render(<Harness leftActions={[{ label: 'Remove', glyph: '✕', onSelect: () => {} }]} />)
    const before = renderCount()

    swipe(row(), { dx: -100, release: false })

    expect(renderCount()).toBe(before)
    expect(offsetOf(row())).toBeLessThan(0)
  })

  it('never puts a transition against the finger', () => {
    render(<Harness />)
    swipe(row(), { dx: 120, release: false })
    expect(row().querySelector<HTMLElement>('.swipe-surface')?.style.transition).toBe('none')
  })
})

describe('when the list is allowed to resort', () => {
  it('does not complete on release — it completes once the row has settled', () => {
    /*
     * `onComplete` is what moves the item into another section, which remounts
     * the row. Running it on release would resort the list while the settle was
     * still on screen: the row would vanish mid-travel and reappear somewhere
     * else, which is the "premature reorder" the hotfix has to rule out.
     */
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    swipe(row(), { dx: ROW_WIDTH * 0.6, duration: 400 })

    expect(onComplete).not.toHaveBeenCalled()
    expect(offsetOf(row())).toBe(0)

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not complete at all when the swipe stopped short', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    swipe(row(), { dx: ROW_WIDTH * 0.3, duration: 900 })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('does not complete when the gesture was cancelled past the threshold', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    swipe(row(), { dx: ROW_WIDTH * 0.8, end: 'touchcancel' })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('still completes if the row is unmounted before its settle finishes', () => {
    // Something else resorting the list must not swallow a commit Alex made.
    const onComplete = vi.fn()
    const view = render(<Harness onComplete={onComplete} />)

    swipe(row(), { dx: ROW_WIDTH * 0.6, duration: 400 })
    view.unmount()

    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('more than one finger', () => {
  it('refuses a gesture that starts with two, and moves nothing', () => {
    render(<Harness />)
    const node = row()

    act(() => {
      node.dispatchEvent(
        touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 40, y: 40 }], { time: 0 }),
      )
      node.dispatchEvent(touchEvent('touchmove', [{ x: 120, y: 0 }], { time: 32 }))
    })

    expect(offsetOf(node)).toBe(0)
  })

  it('abandons a gesture a second finger joins, without committing', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const node = row()

    act(() => {
      node.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }], { time: 0 }))
      node.dispatchEvent(touchEvent('touchmove', [{ x: 200, y: 0 }], { time: 32 }))
      node.dispatchEvent(
        touchEvent('touchmove', [{ x: 220, y: 0 }, { x: 40, y: 90 }], { time: 48 }),
      )
    })

    expect(offsetOf(node)).toBe(0)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('the tray', () => {
  it('latches open on a left swipe and closes on a tap elsewhere', () => {
    const onSelect = vi.fn()
    render(<Harness leftActions={[{ label: 'Remove', glyph: '✕', onSelect }]} />)

    swipe(row(), { dx: -90, duration: 400 })
    expect(row().classList.contains('is-tray-open')).toBe(true)

    act(() => {
      screen.getByTestId('tick').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(row().classList.contains('is-tray-open')).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('is unreachable while closed, and named while open', () => {
    render(<Harness leftActions={[{ label: 'Remove', glyph: '✕', onSelect: () => {} }]} />)

    const remove = screen.getByRole('button', { name: 'Remove', hidden: true })
    expect(remove.tabIndex).toBe(-1)
    expect(row().querySelector('.swipe-tray')?.getAttribute('aria-hidden')).toBe('true')

    swipe(row(), { dx: -90, duration: 400 })
    expect(remove.tabIndex).toBe(0)
    expect(row().querySelector('.swipe-tray')?.getAttribute('aria-hidden')).toBe('false')
  })
})

describe('the tap that is not a swipe', () => {
  it('reaches the row’s own control', () => {
    // The gesture is an accelerator, never the only door. A tap on the tick has
    // to keep working whatever the recognizer is doing.
    const onClick = vi.fn()
    render(<Harness />)
    screen.getByTestId('tick').addEventListener('click', onClick)

    act(() => {
      const node = row()
      node.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }], { time: 0 }))
      node.dispatchEvent(touchEvent('touchend', [{ x: 1, y: 1 }], { time: 90 }))
      screen.getByTestId('tick').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is swallowed after a horizontal drag, so a short swipe cannot also pack', () => {
    /*
     * The accidental completion the threshold exists to prevent, arriving by
     * the other door: a drag that stopped short still emits a click on the row,
     * which lands on the tick behind it.
     */
    const onClick = vi.fn()
    render(<Harness />)
    screen.getByTestId('tick').addEventListener('click', onClick)

    swipe(row(), { dx: 40, duration: 900 })
    act(() => {
      // The drag's OWN trailing click: same beat as the release. A click that
      // arrives later is a real tap and must get through — see the next test.
      screen.getByTestId('tick').dispatchEvent(trailingClick(910))
    })

    expect(onClick).not.toHaveBeenCalled()
  })

  it('gets through once the gesture is properly over', () => {
    /*
     * The swallow is a WINDOW, not a latch. On a phone a vetoed `touchmove`
     * suppresses the emulated click entirely, so a latched flag stays armed
     * after every swipe and eats the next genuine tap on that row — a control
     * that goes dead only after a gesture, which is close to un-attributable.
     */
    const onClick = vi.fn()
    render(<Harness />)
    screen.getByTestId('tick').addEventListener('click', onClick)

    swipe(row(), { dx: 40, duration: 900 })
    act(() => {
      screen.getByTestId('tick').dispatchEvent(trailingClick(2000))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('a mouse, which is the desktop path and every page.mouse spec', () => {
  /** A mouse drag, with timestamps close to the page's time origin. */
  function mouseSwipe(node: HTMLElement, dx: number, from = 20) {
    act(() => {
      node.dispatchEvent(mouse('mousedown', 0, from))
    })
    for (let step = 1; step <= 10; step += 1) {
      act(() => {
        window.dispatchEvent(mouse('mousemove', (dx * step) / 10, from + step * 16))
      })
    }
    act(() => {
      window.dispatchEvent(mouse('mouseup', dx, from + 180))
    })
  }

  function mouse(type: string, x: number, time: number) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0 })
    Object.defineProperty(event, 'timeStamp', { value: time })
    return event
  }

  it('tracks a drag that happens right after the page loads', () => {
    /*
     * The regression this test was written for: "no touch has happened yet" was
     * stored as `0`, and event timestamps are milliseconds since the page's
     * time origin — so they start near zero too. Every mouse gesture in the
     * first half-second after load therefore looked like the emulated mouse
     * event that follows a touch, and was suppressed. A row that ignores the
     * first swipe after a trip opens is exactly the kind of intermittent that
     * gets misattributed to the gesture simply being flaky.
     */
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    mouseSwipe(row(), ROW_WIDTH * 0.6)

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('keeps following a release that lands outside the row', () => {
    // The mouse's equivalent of the implicit capture touch gets for free: a
    // swipe across a 48px-tall row very often releases somewhere else, and a
    // `mouseup` the row never hears leaves it stuck mid-swipe.
    render(<Harness />)
    const node = row()

    act(() => {
      node.dispatchEvent(mouse('mousedown', 0, 20))
      window.dispatchEvent(mouse('mousemove', 120, 40))
    })
    expect(offsetOf(node)).toBeGreaterThan(0)

    act(() => {
      document.body.dispatchEvent(mouse('mouseup', 120, 60))
    })
    expect(node.classList.contains('is-dragging')).toBe(false)
  })
})

describe('a disabled row', () => {
  it('tracks nothing', () => {
    render(<Harness disabled />)
    swipe(row(), { dx: 200, release: false })
    expect(offsetOf(row())).toBe(0)
  })
})
