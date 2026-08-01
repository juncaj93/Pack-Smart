import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

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

/** A trip name carries an emoji and whatever Alex typed; neither is a safe pattern. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    const name = ownedName('Home sheet trip')
    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, name, '2027-03-04', '2027-03-09')
  })

  test('lists the other upcoming trips, not just a count of them', async ({ page }) => {
    /*
     * Two trips, so at least one is guaranteed to be "another" one — but the
     * assertions below are deliberately about the SECTION rather than about those
     * two names.
     *
     * An earlier version looked for the trip it had just created and passed only
     * on a database that held little else. The suite shares one local database
     * across runs, Home shows the three soonest, and a trip in 2027 is nobody's
     * next three once a few dozen trips exist. A test that needs a nearly empty
     * database is testing the database.
     */
    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, ownedName('Home soon'), '2027-04-01', '2027-04-05')

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Home/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, ownedName('Home later'), '2027-05-01', '2027-05-06')

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Home/ }).click()
    await expect(page.getByRole('heading', { name: 'Also coming up' })).toBeVisible()

    const section = page.locator('.home-section').filter({ hasText: 'Also coming up' })
    const rows = section.locator('.trip-row')

    // Named trips, not a count — and capped, so the section stays context.
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(3)

    // And a row opens the trip it names, rather than being decoration.
    const first = rows.first()
    /*
     * The emoji is a separate span inside `.trip-name`, so `textContent` returns
     * "🦁E2E Past 1240" with no space while the trip heading renders "🦁 E2E Past
     * 1240" with one. Comparing the two directly fails on a product that is
     * behaving perfectly. Only the words are the identity here.
     */
    const named = ((await first.locator('.trip-name').textContent()) ?? '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim()
    expect(named.length).toBeGreaterThan(0)
    await first.click()
    await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(named)) })).toBeVisible({
      timeout: 20_000,
    })
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
