import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * The swipe contract from `INTERACTION_PATTERNS.md` §2, exercised with real
 * pointer events.
 *
 * Click simulation would pass every one of these while the gesture was broken, so
 * each case drives `pointerdown` / `pointermove` / `pointerup` with coordinates —
 * which is also the only way to prove the two properties that decide whether the
 * gesture is usable: a nudge must not commit, and a diagonal thumb must still
 * scroll the list.
 */

interface SeededTrip {
  id: string
  name: string
}

async function firstTrip(page: Page): Promise<SeededTrip> {
  await page.goto('/')
  const { trips } = await page.evaluate(() =>
    fetch('/api/trips').then((r) => r.json() as Promise<{ trips: SeededTrip[] }>),
  )
  const trip = trips.find((t) => t.name === 'Cape Town & Kruger')
  if (!trip) throw new Error('swipe: the seeded multi-city trip is missing')
  return trip
}

/**
 * Drags a row horizontally by `dx`, in steps, as a thumb would.
 *
 * Real pointer events through `page.mouse` rather than `dispatchEvent`: a
 * synthesised event carries no timeStamp, so the velocity path could never be
 * exercised, and a hand-built event dictionary is exactly the kind of test that
 * passes while the gesture is broken.
 */
async function swipe(page: Page, row: Locator, dx: number, dy = 0, steps = 12) {
  // Mouse coordinates are viewport coordinates: a row below the fold is not under
  // the pointer at all, and the gesture silently lands on nothing.
  await row.scrollIntoViewIfNeeded()
  const box = await row.boundingBox()
  if (!box) throw new Error('swipe: row has no box')

  /*
   * Start at whichever edge leaves room for the drag.
   *
   * Every gesture used to begin 12px from the LEFT, which is fine going right and
   * useless going left: the pointer runs off the viewport within a few pixels and
   * the browser clamps the rest, so a 140px leftward swipe was delivered as about
   * twelve. The tray correctly refused to open, and the failure looked like a
   * broken gesture rather than a test dragging from the wrong side.
   */
  const startX = dx < 0 ? box.x + box.width - 12 : box.x + 12
  const startY = box.y + box.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + (dx * step) / steps, startY + (dy * step) / steps)
  }
  await page.mouse.up()
}

const packed = (row: Locator) => row.locator('.check-main')

/**
 * Puts a row into a known state before the gesture under test.
 *
 * These specs share one seeded database with the screen walk, which deliberately
 * leaves rows packed. A test that assumed "the first row starts unpacked" passed
 * or failed on run order rather than on the gesture — so each one now establishes
 * its own precondition through the tap path, and asserts the transition.
 */
async function ensurePacked(row: Locator, wanted: boolean) {
  const current = (await packed(row).getAttribute('aria-pressed')) === 'true'
  if (current === wanted) return
  await packed(row).click()
  await expect(packed(row)).toHaveAttribute('aria-pressed', String(wanted))
}

test.describe('swipe to pack', () => {
  test('a small nudge changes nothing', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)

    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    // 40px on a 390px screen is about a tenth of the row — nowhere near the 45%
    // commit threshold, and exactly the accidental movement that must be free.
    await swipe(page, row, 40)
    await page.waitForTimeout(250)

    await expect(packed(row)).toHaveAttribute('aria-pressed', 'false')
    // And the row is back where it started rather than left hanging open.
    await expect(row.locator('.swipe-surface')).not.toHaveAttribute('style', /translateX/)
  })

  test('a deliberate swipe packs the row', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)

    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await swipe(page, row, 260)
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'true')
  })

  test('swiping again puts it back', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)

    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await swipe(page, row, 260)
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'true')

    await swipe(page, row, 260)
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'false')
  })

  /*
   * The property that decides whether the gesture is usable at all: a thumb
   * moving down and slightly sideways is scrolling, and the row must not take it.
   */
  test('a mostly vertical drag scrolls instead of packing', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)

    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await swipe(page, row, 80, 200)
    await page.waitForTimeout(250)

    await expect(packed(row)).toHaveAttribute('aria-pressed', 'false')
  })

  test('the tap does the same thing, for anyone who never swipes', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)

    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await packed(row).click()
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'true')
    await packed(row).click()
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'false')
  })

  test('the keyboard does too', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)

    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await packed(row).focus()
    await page.keyboard.press('Enter')
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'true')
  })
})

/**
 * Swiping the other way.
 *
 * The two directions behave differently on purpose, and the difference is the
 * thing worth pinning: a right swipe means one unambiguous thing and commits on
 * release, while a left swipe offers a CHOICE and therefore has to hold still and
 * wait rather than guess which of Edit and Remove was meant from a drag distance.
 */
test.describe('swipe the other way for edit and remove', () => {
  const tray = (row: Locator) => row.locator('.swipe-tray')

  test('a left swipe opens the tray and leaves it open', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row').first()
    await expect(row).toBeVisible()

    await swipe(page, row, -140)

    /*
     * Latched, not committed. Nothing has happened to the item yet — that is the
     * whole distinction from the right swipe, and it is what makes a destructive
     * action safe to put behind a gesture.
     */
    await expect(row).toHaveClass(/is-tray-open/)
    await expect(tray(row).getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(tray(row).getByRole('button', { name: 'Remove' })).toBeVisible()
  })

  test('a small nudge the other way opens nothing', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row').first()
    await expect(row).toBeVisible()

    await swipe(page, row, -20)
    await expect(row).not.toHaveClass(/is-tray-open/)
  })

  test('tapping the row closes the tray instead of packing anything', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await swipe(page, row, -140)
    await expect(row).toHaveClass(/is-tray-open/)

    /*
     * With the tray open the row beneath is not really "there" to be tapped, so a
     * tap dismisses. Packing the item here would be the accidental completion the
     * commit threshold exists to prevent, arriving through the other door.
     */
    await packed(row).click()
    await expect(row).not.toHaveClass(/is-tray-open/)
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'false')
  })

  test('Edit opens the same sheet the ⋯ button does', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row').first()

    await swipe(page, row, -140)
    await tray(row).getByRole('button', { name: 'Edit' }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('When to pack it')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('Remove moves the row to Not bringing, and Undo puts it back', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row').first()
    const name = ((await row.locator('.check-name').textContent()) ?? '').trim()

    await swipe(page, row, -140)
    await tray(row).getByRole('button', { name: 'Remove' }).click()

    /*
     * The red ✕ is reversible, and the Undo is what makes that true. A destructive
     * gesture without one would be exactly the thing `VISUAL_ACCEPTANCE.md` §3
     * rejects — and "Remove" would be the wrong word for it.
     */
    const undo = page.getByRole('button', { name: 'Undo' })
    await expect(undo).toBeVisible()
    await expect(page.getByText(/moved to Not bringing/)).toBeVisible()

    await undo.click()
    await expect(page.locator('.check-name').filter({ hasText: name }).first()).toBeVisible()
  })

  test('the right swipe still packs, from a row that has a tray', async ({ page }) => {
    const trip = await firstTrip(page)
    await page.goto(`/trips/${trip.id}`)
    const row = page.locator('.swipe-row').first()
    await ensurePacked(row, false)

    await swipe(page, row, 260)
    await expect(packed(row)).toHaveAttribute('aria-pressed', 'true')
  })
})
