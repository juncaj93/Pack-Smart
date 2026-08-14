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

/**
 * The outfits of the trip that actually HAS outfits.
 *
 * Not `openFirstTrip` then the Outfits button: the first trip by start date is
 * whichever the seed happens to put there, and a trip with no plan renders the
 * empty state — which measures nothing and fails in a way that looks like a
 * broken selector. `Cape Town & Kruger` is the seeded trip carrying approved
 * outfits, and it is what `screens.spec.ts` captures for the same reason.
 */
async function openOutfits(page: Page): Promise<void> {
  await page.goto('/trips')
  await expect(page.locator('.trip-row').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /Cape Town & Kruger/ }).first().click()
  await expect(page.locator('.checklist').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Outfits' }).first().click()
  await expect(page.locator('.outfit-card').first()).toBeVisible({ timeout: 20_000 })
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

    /*
     * How many rows are actually ON the screen (§37).
     *
     * The row height above says what one costs; this says what that buys, which
     * is the number the compression pass is really about. Counted against the
     * 664px fold rather than against the viewport object, so it is the same
     * measure every other number in this file is taken against.
     */
    note('trip', 'rows inside the first viewport', await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.checklist li'))
      return rows.filter((row) => {
        const box = row.getBoundingClientRect()
        return box.top + window.scrollY + box.height <= 664
      }).length
    }))

    /*
     * And the evenness, as one number: the spread between the tallest packing
     * row and the shortest. A list of one-line rows is 0 or 1; a list where a
     * garment's brand and colour wrap onto a second line is ~20.
     */
    note('trip', 'tallest row minus shortest', await page.evaluate(() => {
      const heights = Array.from(document.querySelectorAll('.check-main')).map(
        (row) => row.getBoundingClientRect().height,
      )
      return heights.length > 0 ? Math.max(...heights) - Math.min(...heights) : null
    }))
  })

  /*
   * The Add sheet, measured from the top of the sheet for the reason the swap
   * sheet is: what matters is how quickly the clothes start.
   */
  test('adding something to a trip', async ({ page }) => {
    await openFirstTrip(page)
    await page.getByRole('button', { name: 'Add to this trip' }).click()
    await expect(page.locator('.stuff-picker-row').first()).toBeVisible({ timeout: 20_000 })

    note('add sheet', 'before the first garment', await page.evaluate(() => {
      const sheet = document.querySelector('.sheet') ?? document.querySelector('[role="dialog"]')
      const row = document.querySelector('.stuff-picker-row')
      if (!sheet || !row) return null
      return row.getBoundingClientRect().top - sheet.getBoundingClientRect().top
    }))
    note('add sheet', 'garment row', await averageHeight(page, '.stuff-picker-row'))
  })

  /*
   * The outfits screen, where a card used to fill most of a viewport.
   *
   * The number that matters here is not any one card's height — it is how much
   * of the SECOND outfit is on screen, because the complaint this pass answers
   * is that a plan of five outfits was five screens of scrolling. A card you
   * can see the start of is a card you know is there.
   */
  test('outfits', async ({ page }) => {
    await openOutfits(page)

    note('outfits', 'chrome above content', await chromeHeight(page))
    note('outfits', 'before the first outfit', await topOf(page, '.outfit-card'))
    note('outfits', 'outfit card', await averageHeight(page, '.outfit-card'))
    note('outfits', 'garment row', await averageHeight(page, '.slot'))

    /*
     * How far down the page the SECOND outfit starts.
     *
     * The gate, and the one number that expresses the whole objective: with a
     * 664px Safari viewport, a second card beginning below the fold means Alex
     * cannot see that his plan has more than one outfit in it without
     * scrolling. It was ~830px before this pass.
     *
     * Guarded rather than merely recorded, for the reason the packing list's
     * first row is: a screen that quietly grows another explanation block above
     * the cards would undo this without failing anything.
     */
    const second = await page.evaluate(() => {
      const cards = document.querySelectorAll('.outfit-card')
      const card = cards[1]
      return card ? card.getBoundingClientRect().top + window.scrollY : null
    })
    note('outfits', 'before the second outfit', second)
    note('outfits', 'card footer', await heightOf(page, '.outfit-foot'))
    note('outfits', 'approve control', await heightOf(page, '.outfit-approve'))
    /*
     * What `+ Add item` costs a card, permanently (§38).
     *
     * The one number this pass has to answer for on this screen: the feature
     * makes every card taller whether or not it is used, so the cost is
     * recorded rather than asserted to be small. The gate above — the second
     * card beginning inside the fold — is what keeps it honest.
     */
    note('outfits', 'add-item row', await heightOf(page, '.outfit-add-item'))
    if (second !== null) {
      expect(
        second,
        'the second outfit must begin inside the first viewport',
      ).toBeLessThanOrEqual(664)
    }
  })

  /*
   * The swap sheet, measured from the top of the sheet rather than the page.
   *
   * `Wearing it with` is now the first thing in it and the candidates follow —
   * the question being answered is how quickly the clothes start, and a sheet
   * whose first third restated the trip's dates and formality answered it
   * badly.
   */
  test('swapping a garment', async ({ page }) => {
    await openOutfits(page)
    await page.locator('.slot').first().click()
    await expect(page.locator('.swap-row').first()).toBeVisible({ timeout: 20_000 })

    note('swap sheet', 'before the first candidate', await page.evaluate(() => {
      const sheet = document.querySelector('.sheet') ?? document.querySelector('[role="dialog"]')
      const row = document.querySelector('.swap-row')
      if (!sheet || !row) return null
      return row.getBoundingClientRect().top - sheet.getBoundingClientRect().top
    }))
    note('swap sheet', 'paired-with block', await heightOf(page, '.swap-paired'))
    note('swap sheet', 'search field', await heightOf(page, '.swap-form .field input'))
    note('swap sheet', 'recommended / all', await heightOf(page, '.swap-scope'))
    /*
     * Everything above the first candidate, as one number.
     *
     * The individual controls can each look reasonable while the block they
     * form pushes the clothes off the screen — which is what this screen's
     * complaint has been every time. This is the figure the pass is judged on.
     */
    note('swap sheet', 'everything before the results', await page.evaluate(() => {
      const first = document.querySelector('.swap-paired') ?? document.querySelector('.swap-context')
      const row = document.querySelector('.swap-row')
      if (!first || !row) return null
      return row.getBoundingClientRect().top - first.getBoundingClientRect().top
    }))
    note('swap sheet', 'candidate row', await averageHeight(page, '.swap-row'))
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
