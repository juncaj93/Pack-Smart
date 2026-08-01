import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * The swipe gesture, on the browser the product actually ships on.
 *
 * The gesture's whole contract — twenty-seven assertions — lives in
 * `tests/visual/swipe.spec.ts`, which runs Chromium, because WebKit cannot be
 * installed in the agent environment (`AUTONOMY.md` §7). The e2e suite is the one
 * place WebKit does run, and until this file it contained no swipe at all. So
 * every claim about the gesture on the browser Pack Smart actually ships on
 * rested on the two engines behaving alike — an assumption, held for the whole
 * life of the feature, that nothing had ever checked.
 *
 * Deliberately small: the contract is proven next door, and this exists so the
 * touches Alex makes most often are known to execute on the target engine.
 */

/**
 * Anything thrown inside a handler, for every test in this file.
 *
 * A pointer handler that throws breaks nothing a locator can see: the row keeps
 * its classes, the tap still works through the `onClick` behind it, and the
 * screen looks exactly right. Only an explicit listener notices, so without this
 * the suite could stay green through an exception on every touch.
 */
const pageErrors = new WeakMap<Page, string[]>()

/**
 * A trip this file owns, and nobody else touches.
 *
 * These tests PACK and UNPACK rows. Doing that to `trips[0]` — whichever trip
 * some other spec happened to create with the latest start date — is what made
 * this file, and the specs whose trip it was borrowing, order-dependent.
 */
let trip: TripFixture

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))

  await signIn(page)
  trip = await createTrip(page, { owner: 'Swipe' })
})

test.afterEach(async ({ page }) => {
  if (trip) await deleteTrip(page, trip.id)
})

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

/** Opens this file's own trip, where the swipe rows are. */
async function openChecklist(page: Page): Promise<Locator> {
  await page.goto(`/trips/${trip.id}`)
  const row = page.locator('.swipe-row').first()
  await expect(row).toBeVisible()
  return row
}

/**
 * Drags the row with `page.mouse`, as the visual suite does.
 *
 * A synthetic `dispatchEvent` would be the wrong tool twice over: the events are
 * untrusted, and more to the point they create no *active pointer*, so
 * `setPointerCapture` would throw for a reason that only exists inside the test.
 * `page.mouse` produces a genuine pointer the browser is tracking, which is the
 * only way the capture path can be exercised at all.
 *
 * The cost, stated: this is a mouse pointer rather than a finger. It runs the
 * same capture code, and how the gesture *feels* under a thumb remains a manual
 * check (`08_MANUAL_IPHONE_CHECKLIST.md`).
 */
async function drag(page: Page, row: Locator, dx: number) {
  await row.scrollIntoViewIfNeeded()
  const box = await row.boundingBox()
  if (!box) throw new Error('swipe: row has no box')

  const startX = dx < 0 ? box.x + box.width - 12 : box.x + 12
  const y = box.y + box.height / 2

  await page.mouse.move(startX, y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(startX + (dx * step) / 12, y)
  }
  await page.mouse.up()
}

test.describe('the gesture, on the target engine', () => {
  test('a tap on a row throws nothing, and still packs it', async ({ page }) => {
    /*
     * The commonest touch in the product, and the one the gesture code has to be
     * most careful around: a tap runs the whole pointer path — down, up, and the
     * click behind it — without ever locking an axis or capturing anything.
     */
    const row = await openChecklist(page)
    const control = row.locator('.check-main')

    const before = await control.getAttribute('aria-pressed')
    await control.tap()
    await expect(control).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  })

  test('a swipe runs end to end and leaves the row settled', async ({ page }) => {
    const row = await openChecklist(page)

    // Far enough to open the tray, which is the longest travel the gesture has
    // and therefore the one most likely to end outside the row.
    await drag(page, row, -140)
    await expect(row).not.toHaveClass(/is-dragging/)

    // And back, so the row is not left open behind the next assertion.
    await drag(page, row, 140)
    await expect(row).not.toHaveClass(/is-dragging/)
  })

  test('a vertical drag scrolls the list and throws nothing', async ({ page }) => {
    /*
     * The other half of the release path: the axis locks to `vertical`, no
     * capture is ever taken, and the release still has to leave the row alone.
     */
    const row = await openChecklist(page)
    const box = await row.boundingBox()
    if (!box) throw new Error('swipe: row has no box')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + step * 12)
    }
    await page.mouse.up()

    await expect(row).not.toHaveClass(/is-dragging/)
  })
})
