import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { OUT_DIR } from './gates'

/**
 * The screen-real-estate ledger.
 *
 * `screens.spec.ts` proves the mechanical rules and produces the images. This
 * file produces the NUMBERS — how many pixels of a 390px iPhone are spent
 * before the thing Alex came for, and how tall the repeated rows are.
 *
 * It exists because "looks cleaner" is not evidence. A density pass that cannot
 * show a before and an after is a matter of taste; one that can is a decision.
 * The values are written to `.visual/measurements.json` so a later run can be
 * diffed against an earlier one.
 *
 * Every measurement is taken in DOCUMENT coordinates at 390px, from a real
 * production build over the seeded wardrobe and trips — the same harness the
 * screenshots come from, for the same reason (`AUTONOMY.md` §8): a number taken
 * against a convenient fixture measures the fixture.
 */

interface Measurement {
  screen: string
  what: string
  px: number
}

const measurements: Measurement[] = []

function note(screen: string, what: string, px: number | null): void {
  if (px === null) return
  measurements.push({ screen, what, px: Math.round(px) })
}

/**
 * The distance from the top of the page to the top of an element.
 *
 * Document coordinates, not viewport ones: a sticky header would otherwise make
 * "how far down does the list start" depend on where the page happens to be
 * scrolled, which is exactly the question this is asked to answer.
 */
async function topOf(page: Page, selector: string): Promise<number | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return rect.top + window.scrollY
  }, selector)
}

async function heightOf(page: Page, selector: string): Promise<number | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    return el.getBoundingClientRect().height
  }, selector)
}

/** The mean height of a repeated row, which is where small waste multiplies. */
async function averageHeight(page: Page, selector: string): Promise<number | null> {
  return page.evaluate((sel) => {
    const rows = Array.from(document.querySelectorAll(sel))
    if (rows.length === 0) return null
    const total = rows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0)
    return total / rows.length
  }, selector)
}

/**
 * Everything above the page's own content: safe-area padding, the page title,
 * and the primary navigation.
 *
 * Measured to the BOTTOM of the navigation rather than by summing parts, so it
 * stays honest whichever order those pieces end up in.
 */
async function chromeHeight(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const nav = document.querySelector('.primary-nav')
    if (!nav) return null
    const rect = nav.getBoundingClientRect()
    return rect.bottom + window.scrollY
  })
}

/** The first trip the seeded database offers, by opening it from Trips. */
async function openFirstTrip(page: Page): Promise<void> {
  await page.goto('/trips')
  await page.locator('.trip-row').first().click()
  await expect(page.locator('.checklist').first()).toBeVisible({ timeout: 20_000 })
}

test.describe('screen real estate at 390px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 })
  })

  test('home', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.home-card')).toBeVisible({ timeout: 20_000 })
    // The readiness round trip decides the primary action's label; measuring
    // before it lands would measure the placeholder.
    await expect(page.locator('.home-primary')).toBeEnabled()

    note('home', 'chrome above content', await chromeHeight(page))
    note('home', 'before the active trip', await topOf(page, '.home-card'))
    note('home', 'active trip module', await heightOf(page, '.home-card'))
    /*
     * The recommended action and the other door beneath it, as one block.
     *
     * Deliberately not "every button on the screen": `Plan a Trip` and `All
     * trips` sit below the trip sections, and sweeping them in would measure
     * how many trips the database happens to hold rather than what the actions
     * cost.
     */
    note('home', 'action stack', await page.evaluate(() => {
      const primary = document.querySelector('.home-primary')
      if (!primary) return null
      const top = primary.getBoundingClientRect().top
      const alternate = Array.from(document.querySelectorAll('.button-secondary')).find(
        (button) => button.getBoundingClientRect().top >= top,
      )
      return (alternate ?? primary).getBoundingClientRect().bottom - top
    }))
  })

  test('trips', async ({ page }) => {
    await page.goto('/trips')
    await expect(page.locator('.trip-row').first()).toBeVisible({ timeout: 20_000 })

    note('trips', 'chrome above content', await chromeHeight(page))
    note('trips', 'before the first trip', await topOf(page, '.trip-row'))
    note('trips', 'trip row', await averageHeight(page, '.trip-row'))
  })

  test('trip', async ({ page }) => {
    await openFirstTrip(page)

    note('trip', 'chrome above content', await chromeHeight(page))
    /*
     * The headline number of this whole pass.
     *
     * Not the section heading and not one pixel of a row — the top of the first
     * real packing row, which is the first thing on the screen Alex can act on.
     */
    const firstRow = await topOf(page, '.checklist li')
    note('trip', 'before the first packing row', firstRow)

    /*
     * The one measurement in this file that is also a gate.
     *
     * Everything else here is recorded so a change can be judged; this is the
     * outcome of the V1.1 pass, and a screen that quietly grows another panel
     * above the list would undo it without failing anything. A row has to be
     * ON the screen — not one pixel of one — so the top of the first row must
     * leave a full 44px target inside the 664px fold.
     *
     * Measured on the seeded trip, which carries a readiness summary, a
     * coverage gap and a bag plan: the busiest realistic state, not the
     * emptiest. It stood at 767px on `main`.
     */
    expect(firstRow, 'the first packing row must be inside the first viewport').toBeLessThanOrEqual(
      664 - 44,
    )
    note('trip', 'trip summary', await heightOf(page, '.trip-summary'))
    note('trip', 'search and filter', await heightOf(page, '.checklist-controls'))
    note('trip', 'packing row', await averageHeight(page, '.checklist li'))
  })

  test('my stuff', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible({ timeout: 20_000 })

    note('my stuff', 'chrome above content', await chromeHeight(page))
    note('my stuff', 'before the first wardrobe row', await topOf(page, '.stuff-row'))
    note('my stuff', 'search filter and sort', await heightOf(page, '.stuff-controls'))
    note('my stuff', 'wardrobe row', await averageHeight(page, '.stuff-row'))
  })

  test('settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('.settings-row').first()).toBeVisible({ timeout: 20_000 })

    note('settings', 'chrome above content', await chromeHeight(page))
    note('settings', 'before the first setting', await topOf(page, '.settings-row'))
    note('settings', 'settings row', await averageHeight(page, '.settings-row'))
  })

  test.afterAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(`${OUT_DIR}/measurements.json`, `${JSON.stringify(measurements, null, 2)}\n`)

    const width = Math.max(...measurements.map((m) => `${m.screen} · ${m.what}`.length))
    const lines = measurements.map(
      (m) => `${`${m.screen} · ${m.what}`.padEnd(width)}  ${String(m.px).padStart(5)}px`,
    )
    writeFileSync(`${OUT_DIR}/measurements.txt`, `${lines.join('\n')}\n`)
  })
})
