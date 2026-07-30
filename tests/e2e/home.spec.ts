import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * What Home owes the user, from doc 02 §4.
 *
 * The screen had drifted to the featured trip and a single text link reading
 * "All trips · 4 more". That link was standing in for three separate things the
 * approved document asks for — upcoming trips, New Trip, and recent trips — which
 * is why more than half of a 390×844 viewport was empty below it. These assert the
 * sections exist and lead somewhere, so the next density pass cannot quietly
 * collapse them again.
 */

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

/** Creates a trip through the sheet, from wherever the sheet is opened. */
async function fillTripSheet(page: Page, name: string, leaving: string, returning: string) {
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Lisbon')
  await sheet.getByLabel('Leaving').fill(leaving)
  await sheet.getByLabel('Returning').fill(returning)
  await sheet.getByRole('button', { name: 'Create trip' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test.describe('home', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('plans a trip without sending you to another screen first', async ({ page }) => {
    const name = uniqueName('Home sheet trip')
    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, name, '2027-03-04', '2027-03-09')
  })

  test('lists the other upcoming trips, not just a count of them', async ({ page }) => {
    const soon = uniqueName('Home soon')
    const later = uniqueName('Home later')

    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, soon, '2027-04-01', '2027-04-05')

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Home/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, later, '2027-05-01', '2027-05-06')

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Home/ }).click()
    await expect(page.getByRole('heading', { name: 'Also coming up' })).toBeVisible()

    /*
     * The later trip is named on Home rather than folded into "and 1 more". The
     * featured trip is whichever leaves first, so the other one is the one that
     * has to appear in the section.
     */
    const section = page.locator('.home-section').filter({ hasText: 'Also coming up' })
    await expect(section.getByText(later)).toBeVisible()

    // And the row opens that trip, rather than being decoration.
    await section.getByText(later).click()
    await expect(page.getByRole('heading', { name: later })).toBeVisible()
  })

  test('offers every trip, once there are more than it shows', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All trips' })).toBeVisible()
    await page.getByRole('button', { name: 'All trips' }).click()
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible()
  })

  test('never says the same thing twice in one viewport', async ({ page }) => {
    /*
     * The card and the primary action pointed at the same screen with the same
     * seven words once the trip was underway. Whatever the card ends with, it may
     * not be the label of the button beneath it.
     */
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()),
    )
    const actionable = labels.filter((label) => label.length > 0)
    const seen = new Set<string>()
    for (const label of actionable) {
      expect(seen.has(label), `two controls both labelled "${label}"`).toBe(false)
      seen.add(label)
    }
  })
})
