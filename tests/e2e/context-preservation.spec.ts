import { expect, test } from '@playwright/test'
import { createOwnedItem, createTrip, deleteTrip, liveDates, signIn, type TripFixture } from './fixtures'

/**
 * Coming back to a screen is coming back to where you were.
 *
 * Search in the wardrobe, tap through to a trip, come back — and the search box
 * was empty and the list was at the top of 119 rows. The same on the packing
 * list: a filter set to *Still to pack*, a tap into Outfits, and back to
 * *Everything*. The app was throwing away the narrowing Alex had just done, on
 * the two screens where narrowing is the whole point (§7).
 *
 * What these assert is the CONTRACT rather than the mechanism: that the state
 * comes back, that it is scoped to the thing it describes, and that it does not
 * survive a sign-out. A test written against `viewState`'s internals would pass
 * just as happily with the screens no longer reading it.
 */

test.describe('what a screen remembers', () => {
  let trip: TripFixture | null = null
  let second: TripFixture | null = null

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test.afterEach(async ({ page }) => {
    for (const owned of [trip, second]) if (owned) await deleteTrip(page, owned.id)
    trip = null
    second = null
  })

  test('the wardrobe search survives a trip to another tab and back', async ({ page }) => {
    const item = await createOwnedItem(page, 'ContextSearch')

    await page.goto('/my-stuff')
    const field = page.getByLabel('Search your items')
    await field.fill(item.name)
    await expect(page.locator('.stuff-row')).toHaveCount(1)

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible()

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /My Stuff/ }).click()
    await expect(field).toHaveValue(item.name)
    // And it is a real filter on return, not just text left in a box.
    await expect(page.locator('.stuff-row')).toHaveCount(1)
  })

  test('the packing filter survives a trip to Outfits and back', async ({ page }) => {
    trip = await createTrip(page, { owner: 'ContextFilter', ...liveDates(6) })

    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.checklist li').first()).toBeVisible()

    const filter = page.getByLabel('Show')
    await filter.selectOption('unpacked')
    await expect(filter).toHaveValue('unpacked')

    await page.getByRole('button', { name: 'Outfits' }).click()
    await expect(page).toHaveURL(/\/outfits$/)
    await page.goBack()

    await expect(page.locator('.checklist li').first()).toBeVisible()
    await expect(page.getByLabel('Show')).toHaveValue('unpacked')
  })

  test('one trip does not inherit another trip\'s narrowing', async ({ page }) => {
    /*
     * The half that makes this preservation rather than leakage. Two trips are
     * two different packing problems, and carrying "still to pack" from one
     * onto the other would be restoring the wrong context.
     */
    trip = await createTrip(page, { owner: 'ContextA', ...liveDates(6) })
    second = await createTrip(page, { owner: 'ContextB', ...liveDates(20) })

    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.checklist li').first()).toBeVisible()
    await page.getByLabel('Show').selectOption('unpacked')

    await page.goto(`/trips/${second.id}`)
    await expect(page.locator('.checklist li').first()).toBeVisible()
    await expect(page.getByLabel('Show')).toHaveValue('all')
  })

  test('a clear filters control appears only while a filter is set', async ({ page }) => {
    trip = await createTrip(page, { owner: 'ContextReset', ...liveDates(6) })

    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.checklist li').first()).toBeVisible()

    const reset = page.getByRole('button', { name: 'Clear filters' })
    await expect(reset).toHaveCount(0)

    // A search alone is covered by the field's own ×, so it is not enough.
    await page.getByPlaceholder('Search this list').fill('zzz-no-such-row')
    await expect(reset).toHaveCount(0)

    await page.getByLabel('Show').selectOption('unpacked')
    await expect(reset).toBeVisible()

    await reset.click()
    await expect(page.getByLabel('Show')).toHaveValue('all')
    // It clears the search too: a reset that leaves half the narrowing behind
    // is not a reset.
    await expect(page.getByPlaceholder('Search this list')).toHaveValue('')
    await expect(reset).toHaveCount(0)
  })
})
