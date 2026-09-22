import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Dragging a garment up an outfit by its grip, driven by TOUCH (doc 09 §0y).
 *
 * ## What this can and cannot prove
 *
 * The same limits `swipe-touch.spec.ts` sets out, and for the same reason: a
 * dispatched touch is untrusted and does not run WebKit's scroll arbitration,
 * which is the mechanism a drag actually has to win. **This passing is not
 * evidence that the drag works on hardware.** The check in
 * `technical-docs/08_MANUAL_IPHONE_CHECKLIST.md` is the gate; this is the layer
 * that stops obvious breakage reaching it.
 *
 * What it does prove is what a mouse cannot: that the grip's touch listeners
 * exist, that they veto the browser's pan — `touch-action: none` on the grip is
 * necessary and not sufficient, because the moves arrive at the window where
 * that declaration does not apply — and that a COARSE path lands correctly.
 *
 * ## Why the coarse path is the one that matters
 *
 * `INTERACTION_PATTERNS.md` §1a, learned the hard way on the swipe: a slow drag
 * emits many small moves and stays inside the region it started in, so it
 * passes while the gesture is broken for every finger that hurries. A real
 * thumb crossing two rows produces two or three moves, not twenty — and
 * `useReorderDrag` walks outward from the row's own index one neighbour at a
 * time, which is exactly the code a single large jump exercises and a creep
 * does not.
 */

const pageErrors = new WeakMap<Page, string[]>()

let trip: TripFixture

test.beforeEach(async ({ page }) => {
  /*
   * A handler that throws breaks nothing a locator can see — the rows keep
   * their classes and the swap sheet still opens — so without an explicit
   * listener this file could stay green through an exception on every touch.
   */
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))

  await signIn(page)
  trip = await createTrip(page, { owner: 'OutfitDragTouch' })
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
  if (trip) await deleteTrip(page, trip.id)
})

/** The first outfit card, with a real plan on it. */
async function firstCard(page: Page): Promise<Locator> {
  await page.goto(`/trips/${trip.id}/outfits`)

  const plan = page.getByRole('button', { name: 'Plan Outfits' })
  await expect(plan.or(page.locator('.outfit-card').first())).toBeVisible({ timeout: 20_000 })
  if (await plan.isVisible()) await plan.click()

  const card = page.locator('.outfit-card').first()
  await expect(card.locator('.slot-grip').first()).toBeVisible({ timeout: 30_000 })
  return card
}

interface DragResult {
  /** Moves on which the drag vetoed the browser's pan. */
  vetoed: number
  moves: number
}

/**
 * Drives a touch down from a grip, in `steps` moves over `duration` ms.
 *
 * `cancelable: true` matters: `preventDefault()` on an uncancelable event has
 * done nothing at all, so reading `defaultPrevented` back is the only honest
 * way to know the veto landed rather than merely being attempted.
 *
 * The moves are dispatched on `window`, because that is where `useReorderDrag`
 * listens — a real finger reaches the same listener through bubbling, and
 * dispatching on the grip would prove only that bubbling works.
 */
async function dragGrip(
  grip: Locator,
  { dy, steps, duration }: { dy: number; steps: number; duration: number },
): Promise<DragResult> {
  await grip.scrollIntoViewIfNeeded()

  return grip.evaluate(
    async (node: HTMLElement, opts: { dy: number; steps: number; duration: number }) => {
      const box = node.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y0 = box.top + box.height / 2
      /* Anchored so the gesture ENDS at now — see `swipe-touch.spec.ts`. */
      const origin = performance.now() - opts.duration

      function touch(type: string, point: { x: number; y: number }, time: number): Event {
        const event = new Event(type, { bubbles: true, cancelable: true })
        const list = [{ clientX: point.x, clientY: point.y, target: node }]
        Object.defineProperties(event, {
          touches: { value: type === 'touchend' ? [] : list },
          changedTouches: { value: list },
          timeStamp: { value: time },
        })
        return event
      }

      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

      node.dispatchEvent(touch('touchstart', { x, y: y0 }, origin))
      await frame()

      let vetoed = 0
      for (let step = 1; step <= opts.steps; step += 1) {
        const event = touch(
          'touchmove',
          { x, y: y0 + (opts.dy * step) / opts.steps },
          origin + (opts.duration * step) / opts.steps,
        )
        window.dispatchEvent(event)
        if (event.defaultPrevented) vetoed += 1
        await frame()
      }

      window.dispatchEvent(touch('touchend', { x, y: y0 + opts.dy }, origin + opts.duration))
      await frame()

      return { vetoed, moves: opts.steps }
    },
    { dy, steps, duration },
  )
}

test.describe('dragging a garment by its grip', () => {
  /*
   * ONE move, covering the whole distance, in 40ms. This is the path a hurrying
   * thumb actually produces and the one a slow creep would not test.
   */
  test('a coarse flick down one row moves it one place', async ({ page }) => {
    const card = await firstCard(page)
    const before = await card.locator('.slot-item').allTextContents()
    expect(before.length, 'an outfit with one garment cannot be reordered').toBeGreaterThan(1)

    const first = (await card.locator('.slot-swipe').first().boundingBox())!
    const second = (await card.locator('.slot-swipe').nth(1).boundingBox())!
    /* Past the second row's midpoint, which is where the swap is decided. */
    const dy = second.y + second.height - (first.y + first.height / 2)

    const result = await dragGrip(card.locator('.slot-grip').first(), {
      dy,
      steps: 1,
      duration: 40,
    })

    // The pan was vetoed, or the page scrolled instead of the row moving.
    expect(result.vetoed, 'the drag did not veto the browser pan').toBe(result.moves)

    await expect(card.locator('.slot-item')).toHaveText([
      before[1]!,
      before[0]!,
      ...before.slice(2),
    ])
  })

  /*
   * The same distance, slowly, in many moves. It has to land in the same place:
   * this gesture has no velocity threshold, and asserting that is what stops one
   * being introduced by accident.
   */
  test('the same drag taken slowly lands in the same place', async ({ page }) => {
    const card = await firstCard(page)
    const before = await card.locator('.slot-item').allTextContents()

    const first = (await card.locator('.slot-swipe').first().boundingBox())!
    const second = (await card.locator('.slot-swipe').nth(1).boundingBox())!
    const dy = second.y + second.height - (first.y + first.height / 2)

    await dragGrip(card.locator('.slot-grip').first(), { dy, steps: 16, duration: 900 })

    await expect(card.locator('.slot-item')).toHaveText([
      before[1]!,
      before[0]!,
      ...before.slice(2),
    ])
  })

  /*
   * Short of the next row's midpoint, the row goes back where it was. Cancelling
   * has to be free, exactly as it is for the swipe.
   */
  test('a drag that stops short of the next row changes nothing', async ({ page }) => {
    const card = await firstCard(page)
    const before = await card.locator('.slot-item').allTextContents()

    const first = (await card.locator('.slot-swipe').first().boundingBox())!

    await dragGrip(card.locator('.slot-grip').first(), {
      dy: Math.round(first.height / 3),
      steps: 4,
      duration: 200,
    })

    await expect(card.locator('.slot-item')).toHaveText(before)
  })

  /*
   * The whole way to the bottom in one move, which crosses every row at once.
   * `targetIndex` steps outward one neighbour at a time, so a jump past several
   * is the case that would expose it stopping after one.
   */
  test('a flick to the bottom takes the garment all the way there', async ({ page }) => {
    const card = await firstCard(page)
    const before = await card.locator('.slot-item').allTextContents()
    expect(before.length).toBeGreaterThan(2)

    const first = (await card.locator('.slot-swipe').first().boundingBox())!
    const last = (await card.locator('.slot-swipe').last().boundingBox())!
    const dy = last.y + last.height - (first.y + first.height / 2)

    await dragGrip(card.locator('.slot-grip').first(), { dy, steps: 1, duration: 40 })

    await expect(card.locator('.slot-item')).toHaveText([...before.slice(1), before[0]!])
  })
})
