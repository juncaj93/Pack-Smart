import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * The swipe gesture, driven by a TOUCH rather than by a mouse.
 *
 * Every other swipe spec in this repository drives `page.mouse`, and that is why
 * all of them passed through a regression that made the row unusable on a phone:
 * `touch-action` governs touch input only, so a mouse never competes with the
 * browser for the axis. The gesture the tests exercised was not the gesture the
 * phone was running.
 *
 * The regression itself: nothing in the app handled `touchmove`. `touch-action:
 * pan-y` leaves vertical panning to the browser, and a real thumb swipe carries
 * several pixels of vertical drift — so while the row decided the gesture was
 * horizontal, Safari decided the same touch was a vertical pan, fired
 * `pointercancel`, and the row snapped back with the finger still down and still
 * moving. Repeatedly. That loop is the jitter Alex saw.
 *
 * `preventDefault()` on a pointer event cannot stop a scroll, and React attaches
 * `touchmove` as passive so `onTouchMove` cannot either. The fix is a native,
 * non-passive listener that vetoes the pan for exactly as long as the row owns
 * the axis — and these assert that veto, not the CSS that fails to imply it.
 */

/*
 * Anything thrown inside a pointer or touch handler, for every test here.
 *
 * A handler that throws breaks nothing a locator can see — the row keeps its
 * classes and the tap still works through the button behind it — so without an
 * explicit listener this file could stay green through an exception on every
 * touch.
 */
const pageErrors = new WeakMap<Page, string[]>()

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

/**
 * Opens a seeded trip's checklist, the same way `swipe.spec.ts` does.
 *
 * `trips[0]` rather than a trip by name: the multi-city fixture belongs to the
 * VISUAL config, which runs against its own state directory, and reaching for it
 * here is how this spec failed first time out.
 */
async function openChecklist(page: Page): Promise<Locator> {
  const { trips } = await page.evaluate(() =>
    fetch('/api/trips').then((r) => r.json() as Promise<{ trips: Array<{ id: string }> }>),
  )
  const trip = trips[0]
  if (!trip) throw new Error('swipe-touch: no seeded trip to open')

  await page.goto(`/trips/${trip.id}`)
  const rows = page.locator('.swipe-row')
  await expect(rows.first()).toBeVisible()
  return rows
}

/**
 * Drives a real touch across a row and reports whether the browser's pan was
 * vetoed.
 *
 * Genuine `TouchEvent`s with a real `Touch` object, dispatched on the element
 * under the finger, so the component's own native `touchmove` listener runs
 * exactly as it does on the phone. `cancelable: true` matters: a listener that
 * calls `preventDefault()` on an uncancelable event has done nothing, and
 * reading `defaultPrevented` back is the only honest way to know the veto
 * landed.
 *
 * The pointer stream is sent alongside, because the row's state machine listens
 * to pointers — a touch alone would move nothing, which is the shape of the
 * real thing: the browser sends both.
 */
async function touchSwipe(
  row: Locator,
  options: { dx: number; dy?: number; steps?: number },
): Promise<{ prevented: boolean[]; offset: number }> {
  await row.scrollIntoViewIfNeeded()
  const { dx, dy = 0, steps = 12 } = options

  return row.evaluate(
    async (node: HTMLElement, opts: { dx: number; dy: number; steps: number }) => {
      /*
       * A frame between moves, which is both faithful and necessary.
       *
       * A real finger produces one move per frame. Dispatching the whole stream
       * synchronously also means React has not flushed `setOffset` by the time
       * the transform is read, so the row looks motionless when it is merely
       * mid-batch — a test that would fail against a perfectly good gesture.
       */
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

      const box = node.getBoundingClientRect()
      // Start from whichever edge leaves room to travel, so a left swipe does
      // not run off the viewport within a few pixels.
      const startX = opts.dx >= 0 ? box.left + 12 : box.right - 12
      const startY = box.top + box.height / 2
      const prevented: boolean[] = []

      const touch = (x: number, y: number) =>
        new Touch({ identifier: 1, target: node, clientX: x, clientY: y })

      const pointerInit = (x: number, y: number) => ({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })

      node.dispatchEvent(new PointerEvent('pointerdown', pointerInit(startX, startY)))
      node.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [touch(startX, startY)],
          changedTouches: [touch(startX, startY)],
        }),
      )

      for (let step = 1; step <= opts.steps; step += 1) {
        const x = startX + (opts.dx * step) / opts.steps
        const y = startY + (opts.dy * step) / opts.steps

        node.dispatchEvent(new PointerEvent('pointermove', pointerInit(x, y)))

        const moveEvent = new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [touch(x, y)],
          changedTouches: [touch(x, y)],
        })
        node.dispatchEvent(moveEvent)
        prevented.push(moveEvent.defaultPrevented)
        await frame()
      }

      // Read while the finger is still down: this is the travel the gesture
      // achieved, not where it settled afterwards.
      const surface = node.querySelector('.swipe-surface') as HTMLElement | null
      const matrix = surface ? new DOMMatrixReadOnly(getComputedStyle(surface).transform) : null

      const endX = startX + opts.dx
      const endY = startY + opts.dy
      node.dispatchEvent(new PointerEvent('pointerup', pointerInit(endX, endY)))
      node.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          touches: [],
          changedTouches: [touch(endX, endY)],
        }),
      )

      return { prevented, offset: matrix ? matrix.m41 : 0 }
    },
    { dx, dy, steps },
  )
}

test.describe('the gesture under a thumb', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    pageErrors.set(page, errors)
    page.on('pageerror', (error) => errors.push(error.message))
    await signIn(page)
  })

  test.afterEach(({ page }) => {
    expect(pageErrors.get(page) ?? []).toEqual([])
  })

  test('vetoes the browser pan once the row owns the axis', async ({ page }) => {
    /*
     * THE regression test. Against the broken build every one of these is
     * `false` — nothing handled `touchmove` at all — which is what let the
     * browser cancel the pointer mid-gesture and reset the row on a loop.
     */
    const rows = await openChecklist(page)
    const result = await touchSwipe(rows.first(), { dx: 160 })

    expect(result.prevented.some(Boolean), 'the browser pan was never vetoed').toBe(true)

    // And the row actually travelled, rather than twitching back to nothing.
    expect(Math.abs(result.offset)).toBeGreaterThan(20)
  })

  test('vetoes it for a slightly diagonal swipe, which is what a real thumb is', async ({
    page,
  }) => {
    // The case that broke first. A thumb crossing a 48px row drifts vertically,
    // and that drift is what Safari reads as the start of a scroll.
    const rows = await openChecklist(page)
    const result = await touchSwipe(rows.first(), { dx: 160, dy: 18 })

    expect(result.prevented.some(Boolean)).toBe(true)
    expect(Math.abs(result.offset)).toBeGreaterThan(20)
  })

  test('leaves a vertical drag entirely alone, so the list still scrolls', async ({ page }) => {
    /*
     * The half that must keep working, and the reason the veto is conditional
     * rather than a blanket `touch-action: none`. A vertical gesture never
     * locks the axis, so it never reaches `preventDefault` and the browser
     * scrolls the checklist normally.
     */
    const rows = await openChecklist(page)
    const result = await touchSwipe(rows.first(), { dx: 6, dy: 140 })

    expect(result.prevented.every((p) => p === false), 'a vertical drag was blocked').toBe(true)
    expect(Math.abs(result.offset)).toBeLessThanOrEqual(1)
  })

  test('a small twitch moves nothing and commits nothing', async ({ page }) => {
    const rows = await openChecklist(page)
    const row = rows.first()
    const before = await row.locator('.check-main').getAttribute('aria-pressed')

    const result = await touchSwipe(row, { dx: 6, steps: 3 })

    expect(Math.abs(result.offset)).toBeLessThanOrEqual(1)
    await expect(row.locator('.check-main')).toHaveAttribute('aria-pressed', before ?? 'false')
  })

  test('a deliberate touch swipe right reaches its action', async ({ page }) => {
    const rows = await openChecklist(page)
    const row = rows.first()
    const main = row.locator('.check-main')

    const before = (await main.getAttribute('aria-pressed')) === 'true'
    await touchSwipe(row, { dx: 320, steps: 16 })
    await expect(main).toHaveAttribute('aria-pressed', String(!before))
  })

  test('a deliberate touch swipe left opens the tray and holds it', async ({ page }) => {
    const rows = await openChecklist(page)
    const row = rows.first()

    await touchSwipe(row, { dx: -150, steps: 14 })
    // Held open rather than committing anything: Edit and Remove are different
    // enough that choosing between them from a drag distance would be a guess.
    await expect(row.locator('.swipe-tray')).toBeVisible()
  })

  test('a second finger does not re-anchor a gesture in flight', async ({ page }) => {
    /*
     * The other half of the jitter, and one a single-pointer test cannot see.
     * A stray thumb landing mid-swipe used to overwrite the gesture's origin, so
     * the row jumped to an offset computed from a contact point the moving
     * finger had never been at.
     */
    const rows = await openChecklist(page)
    const row = rows.first()

    const settled = await row.evaluate(async (node: HTMLElement) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      const box = node.getBoundingClientRect()
      const y = box.top + box.height / 2
      const init = (id: number, x: number) => ({
        pointerId: id,
        pointerType: 'touch',
        isPrimary: id === 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })

      node.dispatchEvent(new PointerEvent('pointerdown', init(1, box.left + 12)))
      node.dispatchEvent(new PointerEvent('pointermove', init(1, box.left + 90)))
      await frame()

      // A second finger lands somewhere else entirely, and moves.
      node.dispatchEvent(new PointerEvent('pointerdown', init(2, box.right - 20)))
      node.dispatchEvent(new PointerEvent('pointermove', init(2, box.right - 120)))
      await frame()

      const surface = node.querySelector('.swipe-surface') as HTMLElement
      const offset = new DOMMatrixReadOnly(getComputedStyle(surface).transform).m41

      node.dispatchEvent(new PointerEvent('pointerup', init(2, box.right - 120)))
      node.dispatchEvent(new PointerEvent('pointerup', init(1, box.left + 90)))
      return offset
    })

    // Still following the FIRST finger: a positive offset of roughly its travel,
    // never a jump backwards from the second contact.
    expect(settled).toBeGreaterThan(0)
  })
})
