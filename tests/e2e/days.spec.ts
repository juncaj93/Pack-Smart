import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

/**
 * Opens the trip screen's setup disclosure.
 *
 * The itinerary, day naming, One last look and Edit moved behind it so the
 * packing list starts in the first viewport (UX_AUDIT.md UX-01). They are exactly
 * as reachable as before — one tap earlier.
 */
async function openTripSetup(page: Page) {
  await page.getByRole('button', { name: 'Trip setup' }).click()
}


const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/** A short trip, so the day list is small enough to reason about. */
async function tripWithActivities(page: Page, name: string, activities: string[] = ['Safari']) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill('2026-08-01')
  await sheet.getByLabel('Returning').fill('2026-08-05')
  for (const activity of activities) {
    await sheet.getByRole('button', { name: activity, exact: true }).click()
  }
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test.describe('which days are what', () => {
  /*
   * The behaviour Alex asked for: the planner should use what he is doing on
   * each day. Before this, one safari tag produced one safari outfit however
   * many safari days there were.
   */
  test('turns three safari days into three safari outfits', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days'))

    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()
    await expect(page.getByRole('heading', { name: 'Which days?' })).toBeVisible()

    const rows = page.locator('.day-row')
    await expect(rows).toHaveCount(5)

    for (const index of [1, 2, 3]) {
      await rows.nth(index).getByRole('button', { name: 'Safari' }).click()
    }
    await expect(page.getByText('3 of 5 days named')).toBeVisible()

    await page.getByRole('button', { name: 'Save and replan outfits' }).click()
    /*
     * The default wait, restored by P1B.
     *
     * This was 20 seconds because saving the days replanned every outfit over
     * the whole wardrobe before the response came back and the screen moved on.
     * The save now answers as soon as the days are durable, so arriving here is
     * a write and a navigation — nothing that needs an exceptional wait.
     */
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()

    // The replan runs here now, announced, with the screen already usable. The
    // outfits still arrive without Alex asking for them, which is what matters.
    await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible()
    await expect(page.getByText('3 days').first()).toBeVisible()
  })

  test('a tap on the chosen activity clears the day again', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days Clear'))
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').nth(1)
    await row.getByRole('button', { name: 'Safari' }).click()
    await expect(row.getByText('Safari', { exact: true }).last()).toBeVisible()

    await row.getByRole('button', { name: 'Safari' }).click()
    await expect(row.getByText('An ordinary day')).toBeVisible()
  })

  /*
   * A day may hold more than one activity (G2).
   *
   * The screen is where this was true-by-construction false: `chosen` was a
   * `Map<date, activityTag>`, so a beach afternoon and a formal dinner could
   * not both be said however the rest of the app was built.
   */
  test('takes a second activity on the same day, and says so in order', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days Two'), ['Beach', 'Nice dinners'])
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').nth(2)
    await row.getByRole('button', { name: 'Beach', exact: true }).click()
    await row.getByRole('button', { name: 'Nice dinners', exact: true }).click()

    // Both chips read as chosen — the state a screen reader hears, not a colour.
    await expect(row.getByRole('button', { name: 'Beach', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(row.getByRole('button', { name: 'Nice dinners', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // And the day reads back as a sequence, in the order they were tapped.
    await expect(row.locator('.day-chosen')).toHaveText('Beach → Nice dinners')
    await expect(page.getByText(/1 of 5 days named, 2 activities in all/)).toBeVisible()
  })

  test('takes one of them off again without disturbing the other', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days Remove'), ['Beach', 'Nice dinners'])
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').nth(2)
    await row.getByRole('button', { name: 'Beach', exact: true }).click()
    await row.getByRole('button', { name: 'Nice dinners', exact: true }).click()
    await expect(row.locator('.day-chosen')).toHaveText('Beach → Nice dinners')

    await row.getByRole('button', { name: 'Beach', exact: true }).click()
    await expect(row.locator('.day-chosen')).toHaveText('Nice dinners')
  })

  test('plans an outfit for each of a day’s activities', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days Plan'), ['Beach', 'Nice dinners'])
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').nth(2)
    await row.getByRole('button', { name: 'Beach', exact: true }).click()
    await row.getByRole('button', { name: 'Nice dinners', exact: true }).click()

    await page.getByRole('button', { name: 'Save and replan outfits' }).click()
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible({ timeout: 20_000 })

    // Two materially different activities are two outfit needs, whatever date
    // they share. Forcing them into one is the thing the brief rules out.
    await expect(page.getByRole('heading', { name: 'Beach' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nice dinners' })).toBeVisible()
  })

  test('does not scroll sideways with two activities on a row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 })
    await tripWithActivities(page, ownedName('E2E Days Width'), ['Beach', 'Nice dinners'])
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').nth(2)
    await row.getByRole('button', { name: 'Beach', exact: true }).click()
    await row.getByRole('button', { name: 'Nice dinners', exact: true }).click()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('only offers the activities chosen for this trip', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days Scope'))
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').first()
    // Safari was chosen; a wall of every activity Pack Smart knows would invite
    // planning a wedding Alex never mentioned.
    await expect(row.getByRole('button', { name: 'Safari' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Wedding' })).toHaveCount(0)
  })

  test('does not scroll sideways with a long day list', async ({ page }) => {
    await tripWithActivities(page, ownedName('E2E Days Width'))
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()
    await expect(page.getByRole('heading', { name: 'Which days?' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
