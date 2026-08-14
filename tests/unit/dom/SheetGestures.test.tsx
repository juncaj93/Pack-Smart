// @vitest-environment jsdom
import { Profiler } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '@/components/BottomSheet'

/**
 * The sheet under a thumb.
 *
 * `SheetDismissal.test.tsx` asserts WHICH dismissals a sheet allows. This file
 * asserts how the gesture that performs one behaves — where it may start, what
 * counts as a flick, what the sheet does while it is being refused, and what
 * happens to the sheet when the software keyboard takes a third of the screen.
 *
 * These are separated because they fail for different reasons. A change to the
 * dirty guard breaks the first file; a change to a threshold, the drag region or
 * the viewport arithmetic breaks this one.
 */

function open(props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const onClose = vi.fn()
  render(
    <BottomSheet open onClose={onClose} title="A sheet" {...props}>
      <p>Body</p>
    </BottomSheet>,
  )
  return onClose
}

const sheet = () => screen.getByRole('dialog')
const grabber = () => screen.getByTestId('sheet-grabber')

/**
 * Drives one drag, in control of how long it took.
 *
 * The clock is stubbed rather than waited on, because velocity is the whole
 * subject of half these tests: a real timer would make "was this a flick" depend
 * on how busy the machine running the suite happened to be, which is the kind of
 * test that goes green while the gesture is broken.
 */
function drag(
  from: HTMLElement,
  { to, ms = 300, release = true }: { to: number; ms?: number; release?: boolean },
) {
  const now = vi.spyOn(performance, 'now')
  now.mockReturnValue(0)
  fireEvent.pointerDown(from, { clientY: 0, pointerId: 1 })

  // Two moves, so the first can cross the slop threshold and the second can be
  // the travel that is actually measured — which is how a real drag arrives.
  fireEvent.pointerMove(from, { clientY: Math.min(to, 12), pointerId: 1 })
  fireEvent.pointerMove(from, { clientY: to, pointerId: 1 })

  now.mockReturnValue(ms)
  if (release) fireEvent.pointerUp(from, { clientY: to, pointerId: 1 })
  now.mockRestore()
}

/**
 * The sheet's live translation, once the pending animation frame has run.
 *
 * The drag paints on `requestAnimationFrame` rather than through React, so
 * there is no state change for the testing library to flush and reading the
 * transform straight after the move reads the frame before it. Queueing a
 * second callback is what proves the first one has been called.
 */
async function offset(): Promise<number> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  const match = /translateY\((-?[\d.]+)px\)/.exec(sheet().style.transform)
  return match?.[1] ? Number(match[1]) : 0
}

describe('where a drag may start', () => {
  it('dismisses from the grabber', () => {
    const onClose = open()
    drag(grabber(), { to: 300 })
    expect(onClose).toHaveBeenCalled()
  })

  it('dismisses from the title, which is the reachable part of the header', () => {
    /*
     * The point of the change: 32px of grabber was the only drag surface, and
     * it is the strip a thumb has least reason to be resting on. The title is
     * where a thumb already is.
     */
    const onClose = open()
    drag(screen.getByText('A sheet'), { to: 300 })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not drag from the body, which scrolls', () => {
    const onClose = open()
    drag(screen.getByText('Body'), { to: 300 })
    expect(onClose).not.toHaveBeenCalled()
  })

  /*
   * Not tested here: a drag whose first move has already left the ~76px drag
   * region, which is what a real flick produces. It depends on `pointermove`
   * being retargeted to the element holding the pointer capture, and jsdom
   * implements no capture at all — `tests/setup.ts` stubs the three methods to
   * no-ops. A test written for it here would pass whatever the component did.
   *
   * It lives in `tests/e2e/sheet-gestures.spec.ts`, on an engine that retargets.
   */
})

describe('what counts as a dismissal', () => {
  it('dismisses on a long slow drag', () => {
    const onClose = open()
    drag(grabber(), { to: 200, ms: 2000 })
    expect(onClose).toHaveBeenCalled()
  })

  it('snaps back from a short slow drag', () => {
    const onClose = open()
    drag(grabber(), { to: 60, ms: 2000 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('dismisses on a fast flick that still travels', () => {
    // 60px in 40ms is 1.5px/ms — fast, and far enough to have been meant.
    const onClose = open()
    drag(grabber(), { to: 60, ms: 40 })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not dismiss on a fast nudge that goes nowhere', () => {
    /*
     * The defect this test exists for. Velocity is distance over time, so a
     * 15px slip in 10ms is 1.5px/ms and used to dismiss the sheet — on the one
     * strip of every sheet a thumb reaches for first. A flick has to be fast
     * AND arrive somewhere (`INTERACTION_PATTERNS.md` §2).
     */
    const onClose = open()
    drag(grabber(), { to: 15, ms: 10 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores an upward drag entirely', () => {
    const onClose = open()
    drag(grabber(), { to: -300, ms: 100 })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a touch that is not a drag', () => {
  it('leaves the sheet where it is below the slop threshold', async () => {
    open()
    drag(grabber(), { to: 4, ms: 200, release: false })
    expect(sheet().dataset.dragging).toBeUndefined()
    expect(await offset()).toBe(0)
  })

  it('still lets the close control be pressed', () => {
    /*
     * `Done` lives inside the drag region now. A press on it that carries no
     * movement must remain an ordinary click on an ordinary button — nothing is
     * captured and nothing is prevented until a finger has actually travelled.
     */
    const onClose = open()
    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.pointerDown(done, { clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(done, { clientY: 0, pointerId: 1 })
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not let a completed drag press the control it ended on', () => {
    /*
     * The other half of the same problem (§29): a drag that ends over `Done`
     * fires a click on it, so a drag far too short to dismiss would have closed
     * the sheet anyway — by the one route the dirty guard does not cover.
     */
    const onClose = open({ dirty: true, dismiss: 'cancel' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    drag(cancel, { to: 40, ms: 300 })
    fireEvent.click(cancel)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a gesture the browser takes away', () => {
  it('returns the sheet without dismissing it', async () => {
    const onClose = open()
    drag(grabber(), { to: 300, release: false })
    fireEvent.pointerCancel(grabber(), { clientY: 300, pointerId: 1 })

    expect(onClose).not.toHaveBeenCalled()
    expect(await offset()).toBe(0)
    expect(sheet().dataset.dragging).toBeUndefined()
  })
})

describe('a sheet holding unsaved edits', () => {
  it('gives a little and stops, so the finger is told it is held', async () => {
    /*
     * It refused before too — silently, after tracking the finger 300px down
     * and snapping back from there, which reads as a gesture that failed rather
     * than one that was refused.
     */
    open({ dirty: true })
    drag(grabber(), { to: 300, release: false })

    const moved = await offset()
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThanOrEqual(44)
  })

  it('follows the finger exactly when there is nothing to lose', async () => {
    open()
    drag(grabber(), { to: 120, release: false })
    expect(await offset()).toBe(120)
  })

  it('returns to rest on release', async () => {
    open({ dirty: true })
    drag(grabber(), { to: 300 })
    expect(await offset()).toBe(0)
  })
})

describe('the cost of a drag', () => {
  it('does not re-render the sheet while the finger is down', () => {
    /*
     * `INTERACTION_PATTERNS.md` §2, applied to sheets: no React state changes
     * between the finger landing and the settle. What would re-render on every
     * touchmove here is a whole open sheet — the swap sheet's options, the
     * wardrobe picker's results — none of which can change mid-drag.
     *
     * `Profiler` rather than a counter inside a child, because a child is the
     * one thing this cannot be measured from: `children` is the same element on
     * every render, so React skips it and the child's count stays flat while
     * the sheet re-renders 20 times. The first version of this test was green
     * against an implementation that re-rendered on every single move.
     */
    let commits = 0

    render(
      <Profiler id="sheet" onRender={() => (commits += 1)}>
        <BottomSheet open onClose={vi.fn()} title="A sheet">
          <p>Body</p>
        </BottomSheet>
      </Profiler>,
    )

    const before = commits
    const target = screen.getByTestId('sheet-grabber')
    fireEvent.pointerDown(target, { clientY: 0, pointerId: 1 })
    for (let y = 10; y <= 200; y += 10) {
      fireEvent.pointerMove(target, { clientY: y, pointerId: 1 })
    }
    expect(commits).toBe(before)
  })
})

describe('the software keyboard', () => {
  /**
   * A stand-in for `window.visualViewport`.
   *
   * jsdom has none, and no test can raise a real keyboard — but the arithmetic
   * that decides where the sheet sits is ordinary code, and the shortfall
   * between the two viewports is the only input it has.
   */
  function fakeViewport(height: number) {
    const listeners: Record<string, (() => void)[]> = { resize: [], scroll: [] }
    const viewport = {
      height,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => listeners[type]?.push(fn),
      removeEventListener: (type: string, fn: () => void) => {
        const list = listeners[type]
        if (list) list.splice(list.indexOf(fn), 1)
      },
    }
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    return {
      /** Raises or lowers the keyboard and tells the page about it. */
      resizeTo(next: number) {
        viewport.height = next
        listeners.resize?.forEach((fn) => fn())
      },
    }
  }

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 664, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport')
  })

  it('sits on top of the keyboard rather than behind it', () => {
    const viewport = fakeViewport(664)
    open()
    expect(sheet().style.getPropertyValue('--sheet-keyboard-inset')).toBe('0px')

    viewport.resizeTo(328) // a 336px keyboard, roughly an iPhone's
    expect(sheet().style.getPropertyValue('--sheet-keyboard-inset')).toBe('336px')
  })

  it('returns to the bottom edge when the keyboard closes, without dismissing', () => {
    const viewport = fakeViewport(664)
    const onClose = open()

    viewport.resizeTo(328)
    viewport.resizeTo(664)

    expect(sheet().style.getPropertyValue('--sheet-keyboard-inset')).toBe('0px')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('ignores Safari collapsing its own toolbar', () => {
    /*
     * The toolbar moves the visual viewport too, by a few tens of pixels. Lifting
     * the sheet by that much would open a gap under it every time the page
     * scrolled — so a shortfall this small is not a keyboard.
     */
    const viewport = fakeViewport(664)
    open()
    viewport.resizeTo(614)
    expect(sheet().style.getPropertyValue('--sheet-keyboard-inset')).toBe('0px')
  })

  it('costs nothing where the browser cannot report a keyboard', () => {
    // No `visualViewport` defined at all: every older browser, and jsdom.
    const onClose = open()
    expect(screen.queryByRole('dialog')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
