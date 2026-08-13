import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createOwnedItem, createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Getting back out of a search, in one tap.
 *
 * Until this existed the only way to empty a search field was to select the
 * text and delete it — one-handed, beside an open suitcase, on a screen whose
 * whole job is to be faster than a paper list.
 *
 * The contract asserted here is deliberately about BEHAVIOUR rather than about
 * the glyph: the control is absent when there is nothing to clear, it empties
 * the field, the list underneath answers immediately, and the caret stays where
 * Alex can type the next search. The last of those is the one that would be
 * silently lost by a refactor — a clear button that steals focus dismisses the
 * iPhone keyboard, and the next search costs a tap that this feature was
 * supposed to save.
 */

const CLEAR = { name: 'Clear search' }

/** Where the caret is, by accessible name — not by element identity. */
async function focusedName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return null
    return el.getAttribute('aria-label') ?? el.getAttribute('placeholder')
  })
}

/**
 * The whole contract, run against whichever search field is handed in.
 *
 * One function rather than two copies, because the point of `SearchInput` is
 * that the wardrobe and the packing list cannot drift apart — a test written
 * twice would let them.
 */
async function behavesLikeASearchField(
  page: Page,
  field: Locator,
  options: { query: string; expectFewer: Locator },
): Promise<void> {
  const clear = page.getByRole('button', CLEAR)

  // Absent while there is nothing to clear.
  await expect(clear).toHaveCount(0)

  const before = await options.expectFewer.count()
  expect(before, 'the list needs rows for filtering to be observable').toBeGreaterThan(0)

  await field.fill(options.query)
  await expect(clear).toBeVisible()

  // The search actually did something, so "results return" means something.
  await expect(options.expectFewer).not.toHaveCount(before)

  await clear.click()

  await expect(field).toHaveValue('')
  // Immediately, and without being asked again: the list is back.
  await expect(options.expectFewer).toHaveCount(before)
  await expect(clear).toHaveCount(0)
}

test.describe('clearing a search', () => {
  let trip: TripFixture | null = null

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test.afterEach(async ({ page }) => {
    if (trip) await deleteTrip(page, trip.id)
    trip = null
  })

  test('the wardrobe search clears in one tap and gives the list back', async ({ page }) => {
    // An owned row guarantees the search has something to find and something
    // to hide, whatever else is in the database.
    const item = await createOwnedItem(page, 'SearchClear')
    await page.goto('/my-stuff')
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    await behavesLikeASearchField(page, page.getByLabel('Search your items'), {
      query: item.name,
      expectFewer: page.locator('.stuff-row'),
    })
  })

  test('the packing list search clears in one tap and gives the list back', async ({ page }) => {
    trip = await createTrip(page, { owner: 'SearchClear' })
    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.checklist li').first()).toBeVisible()

    await behavesLikeASearchField(page, page.getByPlaceholder('Search this list'), {
      // A string no packing row can match, so the filter is unambiguous.
      query: 'zzzz-no-such-row',
      expectFewer: page.locator('.checklist li'),
    })
  })

  test('leaves the caret in the field, so the next search costs no extra tap', async ({ page }) => {
    /*
     * The assertion this file exists for.
     *
     * On an iPhone, focus leaving the input dismisses the keyboard — and it
     * comes back only when the field is tapped again, which is exactly the tap
     * the clear button was added to save. `SearchInput` prevents the default on
     * pointerdown so focus never moves, and calls `focus()` as well so the
     * keyboard path behaves the same way.
     */
    await createOwnedItem(page, 'SearchFocus')
    await page.goto('/my-stuff')
    const field = page.getByLabel('Search your items')
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    await field.fill('Parka')
    await page.getByRole('button', CLEAR).click()

    expect(await focusedName(page)).toBe('Search your items')

    // And it is genuinely usable, not merely focused: typing lands in the field.
    await page.keyboard.type('Boots')
    await expect(field).toHaveValue('Boots')
  })

  test('is reachable and operable from the keyboard', async ({ page }) => {
    /*
     * A control that only a thumb can reach is not an accessible control, and
     * the clear button sits inside a field where tab order is easy to get
     * wrong. Tab from the input has to land on it, and Enter has to activate
     * it — the same two things a screen-reader user does.
     */
    await createOwnedItem(page, 'SearchKeys')
    await page.goto('/my-stuff')
    const field = page.getByLabel('Search your items')
    await expect(page.locator('.stuff-row').first()).toBeVisible()

    await field.fill('Parka')
    await field.focus()
    await page.keyboard.press('Tab')

    await expect(page.getByRole('button', CLEAR)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(field).toHaveValue('')
  })

  test('is one control, not one per screen', async ({ page }) => {
    /*
     * Two search fields are on screen together nowhere in the product, so a
     * second `Clear search` means a screen grew its own copy of this — which is
     * the duplication `SearchInput` exists to prevent and the thing a later
     * "just add a small × here" would quietly reintroduce.
     */
    await createOwnedItem(page, 'SearchOne')
    await page.goto('/my-stuff')
    await page.getByLabel('Search your items').fill('a')
    await expect(page.getByRole('button', CLEAR)).toHaveCount(1)
  })

  test('does not push the screen sideways at any supported width', async ({ page }) => {
    /*
     * The button is positioned inside the field over padding reserved for it,
     * so it should cost no width at all — but "should" is how a 44px control
     * ends up hanging off the right edge of a 360px phone.
     */
    await createOwnedItem(page, 'SearchWidth')

    for (const width of [360, 375, 390]) {
      await page.setViewportSize({ width, height: 664 })
      await page.goto('/my-stuff')
      await page.getByLabel('Search your items').fill('Something reasonably long to type')
      await expect(page.getByRole('button', CLEAR)).toBeVisible()

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0)
    }
  })
})
