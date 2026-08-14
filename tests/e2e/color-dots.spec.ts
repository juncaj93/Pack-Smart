import { expect, test } from '@playwright/test'
import { ownedName, signIn } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Where a garment's colour sits, and why it is not the same answer twice.
 *
 * The placements are deliberately opposite. On Outfits the dot LEADS the
 * garment, because there the garment is part of a composed outfit and the
 * colour belongs to its identity. In My Stuff it TRAILS, because the wardrobe
 * is a browsable list and the colour is one more thing known about the row —
 * where the trip count already sits.
 *
 * The asymmetry is the design, so it is asserted rather than left to a
 * screenshot: normalising the two placements is exactly the tidy-looking change
 * that would undo the point of this pass.
 *
 * One system underneath both. `ColorDots` and `swatchesFor` are unchanged, and
 * neither screen has its own mapping.
 */

/**
 * A trip of this suite's own making, with outfits planned on it.
 *
 * Not the visual harness's seeded `Cape Town & Kruger`: the two suites keep
 * separate databases, so naming that trip here passes locally against the visual
 * state directory and fails on CI against nothing. Built the way
 * `outfits.spec.ts` builds one, and owned by this file.
 */
async function openOutfits(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: /Trips/ })
    .click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Trip name').fill(ownedName('Dots'))
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill('2026-07-31')
  await sheet.getByLabel('Returning').fill('2026-08-11')
  await sheet.getByRole('button', { name: 'Safari' }).click()
  await sheet.getByRole('button', { name: 'Nice dinners' }).click()
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await page.getByRole('button', { name: 'Outfits', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()
  await page.getByRole('button', { name: 'Plan Outfits' }).click()

  // Generating against the whole wardrobe is genuinely slow; see trips.spec.ts.
  await expect(page.locator('.slot').first()).toBeVisible({ timeout: 20_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('Outfits — the colour leads the garment', () => {
  test('the dot comes before the name, not after it', async ({ page }) => {
    await openOutfits(page)

    const withDot = page.locator('.slot').filter({ has: page.locator('.color-dot') }).first()
    await expect(withDot).toBeVisible()

    const order = await withDot.evaluate((row) => {
      const dot = row.querySelector('.color-dot')?.getBoundingClientRect()
      const name = row.querySelector('.slot-item')?.getBoundingClientRect()
      const chevron = row.querySelector('.slot-chevron')?.getBoundingClientRect()
      if (!dot || !name || !chevron) return null
      return { dot: dot.left, name: name.left, chevron: chevron.left }
    })

    expect(order, 'the row is missing a dot, a name or a chevron').not.toBeNull()
    // Dot, then name, then the chevron still on the far right.
    expect(order!.dot).toBeLessThan(order!.name)
    expect(order!.name).toBeLessThan(order!.chevron)
  })

  test('every row in a card starts its name on the same line', async ({ page }) => {
    /*
     * The reason the swatch column is always rendered even when the dot is not.
     *
     * `ColorDots` draws nothing for the eleven wardrobe strings that are not
     * colours — `Various Colors`, `Patterned`, `Suede` — so without a reserved
     * column those rows would start 20px left of their neighbours and every card
     * holding one honest gap would read as ragged. This is the assertion a
     * screenshot review is worst at: two pixels of drift is invisible in an
     * image and obvious under a thumb scanning a list.
     */
    await openOutfits(page)

    const cards = page.locator('.outfit-card, .outfit')
    const count = await cards.count()
    expect(count, 'no outfit cards on the seeded trip').toBeGreaterThan(0)

    let checkedACardWithAGap = false

    for (let i = 0; i < count; i += 1) {
      const lefts = await cards.nth(i).evaluate((card) => {
        const rows = Array.from(card.querySelectorAll('.slot'))
        return rows.map((row) => ({
          left: row.querySelector('.slot-item')?.getBoundingClientRect().left ?? null,
          hasDot: Boolean(row.querySelector('.color-dot')),
        }))
      })

      const present = lefts.filter((r) => r.left !== null)
      if (present.length < 2) continue

      const first = present[0]!.left!
      for (const row of present) {
        expect(
          Math.abs(row.left! - first),
          `a garment name in card ${i} starts on a different line`,
        ).toBeLessThanOrEqual(1)
      }

      if (present.some((r) => !r.hasDot) && present.some((r) => r.hasDot)) {
        checkedACardWithAGap = true
      }
    }

    /*
     * Asserted, so a wardrobe where every garment happens to map to a swatch
     * reports itself instead of passing the interesting case silently — the
     * alignment above is trivially true when no row is missing a dot.
     */
    expect(
      checkedACardWithAGap,
      'no card mixed dotted and undotted rows, so the reserved column was never exercised',
    ).toBe(true)
  })

  test('tapping a row still opens the swap sheet', async ({ page }) => {
    // The dot moved; nothing about what the row does moved with it.
    await openOutfits(page)
    await page.locator('.slot').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test.describe('My Stuff — the colour trails the row', () => {
  test('the dot comes after the name', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible()
    await page.waitForLoadState('networkidle')

    const withDot = page.locator('.stuff-row').filter({ has: page.locator('.color-dot') }).first()
    await expect(withDot).toBeVisible()

    const order = await withDot.evaluate((row) => {
      const dot = row.querySelector('.color-dot')?.getBoundingClientRect()
      const name = row.querySelector('.stuff-name')?.getBoundingClientRect()
      if (!dot || !name) return null
      return { dot: dot.left, name: name.left, rowRight: row.getBoundingClientRect().right }
    })

    expect(order, 'the row is missing a dot or a name').not.toBeNull()
    expect(order!.name).toBeLessThan(order!.dot)
    // And it really is in the right-hand metadata area, not floating mid-row.
    expect(order!.rowRight - order!.dot).toBeLessThan(80)
  })

  test('a colour that is not a colour gets no dot, and still says so in words', async ({ page }) => {
    /*
     * `Various Colors` is a real wardrobe value and the honest answer is a gap,
     * not a grey dot standing in for knowledge nobody has. The words stay in the
     * subtitle, which is also what keeps the row's accessible name complete —
     * the dots are `aria-hidden`, so the text is the information either way.
     */
    await page.goto('/my-stuff')
    await page.getByLabel('Search your items').fill('Boxer Briefs')

    const row = page.locator('.stuff-row').filter({ hasText: 'Boxer Briefs' }).first()
    await expect(row).toBeVisible()
    await expect(row).toContainText('Various Colors')
    await expect(row.locator('.color-dot')).toHaveCount(0)
  })

  test('tapping a row still opens the item sheet', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible()
    await page.locator('.stuff-row').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('the dot never crowds the row out of its width', async ({ page }) => {
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 664 })
      await page.waitForTimeout(120)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `My Stuff scrolls sideways at ${width}`).toBeLessThanOrEqual(0)
    }
  })
})

test('one colour system, not two', async ({ page }) => {
  /*
   * Both screens render the same component, so there is nothing to keep in sync
   * — but "nothing to keep in sync" is a claim worth failing on. Every dot in
   * the product carries `.color-dot` and gets its fill from `swatchesFor`; a
   * screen that grew its own swatch markup would not.
   */
  await page.goto('/my-stuff')
  await expect(page.locator('.stuff-row').first()).toBeVisible()

  const strays = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[class*="swatch" i], [class*="colour" i]'))
      .filter((el) => !el.classList.contains('slot-swatch'))
      .map((el) => el.className),
  )
  expect(strays).toEqual([])
})
