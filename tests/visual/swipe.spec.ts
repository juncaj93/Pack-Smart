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

  const startX = box.x + 12
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
