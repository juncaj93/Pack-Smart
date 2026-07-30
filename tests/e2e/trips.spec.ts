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

async function unlock(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
}

/** Creates a trip through the sheet and lands on its checklist. */
async function createTrip(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()

  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill('2026-07-31')
  await sheet.getByLabel('Returning').fill('2026-08-11')
  await sheet.getByRole('button', { name: 'Safari' }).click()

  await sheet.getByRole('button', { name: 'Create trip' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test.describe('trips', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('creates a trip and shows the day count it derived', async ({ page }) => {
    const name = uniqueName('E2E Trip')
    await createTrip(page, name)

    // 31 Jul -> 11 Aug counted inclusively. The whole product depends on this
    // being 12 rather than 11.
    await expect(page.locator('.screen-subtitle')).toContainText('12 days')

    // And the derivation is shown on the row, not just the answer.
    await expect(page.getByText('12 days × 2 = 24').first()).toBeVisible()
  })

  test('shows the dates as days and nights while you are still typing them', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Leaving').fill('2026-07-31')
    await sheet.getByLabel('Returning').fill('2026-08-11')

    await expect(sheet.getByText('12 days, 11 nights.')).toBeVisible()
  })

  test('leaves an unanswered question unanswered', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Not answered — nothing will be assumed.')).toHaveCount(2)

    // Tapping the chosen answer again clears it, which is the only route back.
    const yes = sheet.getByRole('button', { name: 'Yes' }).first()
    await yes.click()
    await expect(sheet.getByText('Not answered — nothing will be assumed.')).toHaveCount(1)
    await yes.click()
    await expect(sheet.getByText('Not answered — nothing will be assumed.')).toHaveCount(2)
  })

  test('refuses a return date before the start, and says so on the field', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(uniqueName('Backwards'))
    await sheet.getByLabel('Destination').fill('Nowhere')
    await sheet.getByLabel('Leaving').fill('2026-08-11')
    await sheet.getByLabel('Returning').fill('2026-07-31')
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(sheet.getByText(/before the start date/i)).toBeVisible()
    await expect(sheet).toBeVisible()
  })

  test('adds a trip-only item, packs it, and moves it out and back', async ({ page }) => {
    await createTrip(page, uniqueName('E2E Checklist'))

    const itemName = uniqueName('Snorkel')
    await page.getByRole('button', { name: 'Add something to this trip' }).click()
    await page.getByPlaceholder('Something for this trip').fill(itemName)
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    const row = page.getByRole('button', { name: new RegExp(itemName) }).first()
    await expect(row).toBeVisible()

    // One tap packs it.
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'true')

    // And the sheet can take it out entirely, with undo offered rather than a
    // confirmation dialog.
    await page.getByRole('button', { name: `Options for ${itemName}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Not bringing this' }).click()

    await expect(page.getByRole('heading', { name: /Not bringing/ })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('heading', { name: /Not bringing/ })).toHaveCount(0)
  })

  test('shows what it understood, in plain sentences with no percentages', async ({ page }) => {
    await createTrip(page, uniqueName('E2E Facts'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'What Pack Smart understood' }).click()
    const facts = page.locator('.facts')

    await expect(facts).toContainText('12 days')
    await expect(facts).toContainText('11 nights')
    await expect(facts).not.toContainText('%')
  })

  test('does not scroll sideways on a trip screen', async ({ page }) => {
    await createTrip(page, uniqueName('E2E Width'))

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('one last look', () => {
  test('says nothing is missing rather than showing the whole closet', async ({ page }) => {
    await unlock(page)
    await createTrip(page, uniqueName('E2E Last Look'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'One last look' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    // Nothing in the imported wardrobe is marked a favourite and no outfits are
    // planned yet, so there is genuinely nothing to suggest. Product doc 04 §9
    // forbids filling the gap with the closet.
    await expect(sheet.getByText('Nothing is obviously missing')).toBeVisible()
    await expect(sheet.locator('.look-row')).toHaveCount(0)
  })

  test('reaches the rest of the wardrobe only through search, and adds from it', async ({ page }) => {
    await unlock(page)
    await createTrip(page, uniqueName('E2E Last Look Add'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'One last look' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.look-row')).toHaveCount(0)

    await sheet.getByPlaceholder('Search your wardrobe').fill('jeans')
    await expect(sheet.locator('.look-row').first()).toBeVisible()

    const name = (await sheet.locator('.look-name').first().textContent())!.trim()
    await sheet.locator('.look-row').first().click()
    await expect(sheet.getByText('Added').first()).toBeVisible()

    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText(name).first()).toBeVisible()
  })
})

test.describe('trip history', () => {
  /*
   * A finished trip is a starting point, not a dead record. The test asserts
   * the two things that would be easy to get wrong: it lands in a NEW trip
   * rather than editing the old one, and last year's dates do not come with it.
   */
  test('reuses a finished trip without carrying its dates', async ({ page }) => {
    const name = uniqueName('E2E Past')

    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()

    // A trip that is already over.
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()
    let sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2025-08-01')
    await sheet.getByLabel('Returning').fill('2025-08-08')
    await sheet.getByRole('button', { name: 'Safari' }).click()
    await sheet.getByRole('button', { name: 'Create trip' }).click()
    /*
     * Creating a trip generates the whole checklist against the full wardrobe
     * before it navigates, and this spec does it twice. Under a fully parallel
     * run that is genuinely long — it started failing here the day the wardrobe
     * grew by five items, on the assertion rather than in the product, and it
     * passes on its own every time.
     *
     * Same diagnosis and same remedy as the itinerary replans in
     * `itinerary.spec.ts`: wait for a long operation for a length of time that
     * matches it, and say why. Nothing else in this file is loosened.
     */
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()

    // It files itself under Past trips and stops claiming to be planning.
    const row = page.locator('.trip-item').filter({ hasText: name })
    await expect(row.locator('.trip-status')).toHaveText('Completed')

    await row.getByRole('button', { name: 'Plan again' }).click()

    sheet = page.getByRole('dialog')
    await expect(sheet.getByLabel('Trip name')).toHaveValue(name)
    await expect(sheet.getByLabel('Destination')).toHaveValue('Cape Town')
    await expect(sheet.getByRole('button', { name: 'Safari' })).toHaveAttribute('aria-pressed', 'true')

    // Last year's dates are exactly the thing not to reuse.
    await expect(sheet.getByLabel('Leaving')).toHaveValue('')
    await expect(sheet.getByLabel('Returning')).toHaveValue('')

    await sheet.getByLabel('Leaving').fill('2027-06-01')
    await sheet.getByLabel('Returning').fill('2027-06-08')
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    // A new trip, not an edit of the old one — both are in the list.
    // Second generation of the run; see the note above.
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await expect(page.locator('.trip-item').filter({ hasText: name })).toHaveCount(2)
  })
})

test.describe('a trip that will not load', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  /*
   * The failure used to be a red sentence and one button that navigated away, so
   * a dropped connection on the packing list meant leaving the screen and coming
   * back to try again — the app making its own failure the user's problem.
   */
  test('says what happened, and retries in place', async ({ page }) => {
    const name = uniqueName('Retry trip')
    await createTrip(page, name)
    const url = page.url()

    let fail = true
    await page.route('**/api/trips/*/checklist', async (route) => {
      if (fail) {
        await route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'boom' } }) })
      } else {
        await route.continue()
      }
    })

    /*
     * The service worker answers `GET /api/*` itself and Playwright cannot route
     * a request it makes, so it has to go before the failure can be simulated at
     * all. Unregistering also drops its cached copy of this checklist, which
     * would otherwise satisfy the reload.
     */
    await page.evaluate(async () => {
      const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? []
      await Promise.all(registrations.map((registration) => registration.unregister()))
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    })

    await page.goto(url)
    await expect(page.getByText('Could not load this trip')).toBeVisible()
    await expect(page.getByText('nothing was changed')).toBeVisible()

    // Recover without leaving the screen.
    fail = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
  })
})

test.describe('putting a trip away, and getting rid of one', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('archives a trip, finds it under Archived, and restores it', async ({ page }) => {
    const name = uniqueName('Archive me')
    await createTrip(page, name)

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Archive this trip' }).click()
    await expect(page.getByRole('button', { name: 'Restore to my trips' })).toBeVisible()

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()

    // Gone from the everyday list, but not gone.
    await expect(page.locator('.trip-item').filter({ hasText: name })).toHaveCount(0)
    await page.getByRole('button', { name: /^Show archived/ }).click()
    await expect(page.getByRole('heading', { name: 'Archived' })).toBeVisible()
    await expect(page.locator('.trip-item').filter({ hasText: name })).toHaveCount(1)

    // And it still opens, with everything in it.
    await page.locator('.trip-item').filter({ hasText: name }).first().click()
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible({
      timeout: 20_000,
    })

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Restore to my trips' }).click()
    await expect(page.getByRole('button', { name: 'Archive this trip' })).toBeVisible()
  })

  test('asks before deleting, and can be talked out of it', async ({ page }) => {
    const name = uniqueName('Keep me')
    await createTrip(page, name)
    const url = page.url()

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Delete this trip' }).click()

    /*
     * The only confirmation in the product, and it earns its place: doc 02 §2
     * prefers undo, and this is the one case where undo cannot exist. It names
     * the trip and says what survives, because "this cannot be undone" tells Alex
     * nothing about what he is actually losing.
     */
    await expect(page.getByText(/Delete/).first()).toBeVisible()
    await expect(page.getByText(/wardrobe and what Pack Smart has learned are not touched/)).toBeVisible()

    await page.getByRole('button', { name: 'Keep it' }).click()
    await expect(page.getByRole('button', { name: 'Delete for good' })).toHaveCount(0)

    // Still exactly where it was.
    expect(page.url()).toBe(url)
    await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible()
  })

  test('deletes for good, and leaves the other trips alone', async ({ page }) => {
    const keep = uniqueName('Survivor')
    await createTrip(page, keep)

    const doomed = uniqueName('Delete me')
    await createTrip(page, doomed)

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Delete this trip' }).click()
    await page.getByRole('button', { name: 'Delete for good' }).click()

    // Lands on the trips list, because there is no trip left to be on.
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('.trip-item').filter({ hasText: doomed })).toHaveCount(0)

    // Not in Archived either — deleted is not archived.
    const showArchived = page.getByRole('button', { name: /^Show archived/ })
    if (await showArchived.isVisible().catch(() => false)) {
      await showArchived.click()
      await expect(page.locator('.trip-item').filter({ hasText: doomed })).toHaveCount(0)
    }

    // The other trip is untouched.
    await expect(page.locator('.trip-item').filter({ hasText: keep })).toHaveCount(1)
  })
})
