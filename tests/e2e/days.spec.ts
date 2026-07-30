import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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

function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

/** A short trip, so the day list is small enough to reason about. */
async function tripWithActivities(page: Page, name: string) {
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
  await sheet.getByRole('button', { name: 'Safari' }).click()
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
    await tripWithActivities(page, uniqueName('E2E Days'))

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
    // Saving named days replans every outfit before navigating; see the note in
    // itinerary.spec.ts about why this wait is longer than the default.
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible({ timeout: 20_000 })

    // Saving already replanned, so the outfits are there without asking again.
    await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible()
    await expect(page.getByText('3 days').first()).toBeVisible()
  })

  test('a tap on the chosen activity clears the day again', async ({ page }) => {
    await tripWithActivities(page, uniqueName('E2E Days Clear'))
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').nth(1)
    await row.getByRole('button', { name: 'Safari' }).click()
    await expect(row.getByText('Safari', { exact: true }).last()).toBeVisible()

    await row.getByRole('button', { name: 'Safari' }).click()
    await expect(row.getByText('An ordinary day')).toBeVisible()
  })

  test('only offers the activities chosen for this trip', async ({ page }) => {
    await tripWithActivities(page, uniqueName('E2E Days Scope'))
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()

    const row = page.locator('.day-row').first()
    // Safari was chosen; a wall of every activity Pack Smart knows would invite
    // planning a wedding Alex never mentioned.
    await expect(row.getByRole('button', { name: 'Safari' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Wedding' })).toHaveCount(0)
  })

  test('does not scroll sideways with a long day list', async ({ page }) => {
    await tripWithActivities(page, uniqueName('E2E Days Width'))
    await openTripSetup(page)
    await page.getByRole('button', { name: /Say which days are what/ }).click()
    await expect(page.getByRole('heading', { name: 'Which days?' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
