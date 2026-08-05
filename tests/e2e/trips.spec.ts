import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
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
    const name = ownedName('E2E Trip')
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
    await sheet.getByLabel('Trip name').fill(ownedName('Backwards'))
    await sheet.getByLabel('Destination').fill('Nowhere')
    await sheet.getByLabel('Leaving').fill('2026-08-11')
    await sheet.getByLabel('Returning').fill('2026-07-31')
    await sheet.getByRole('button', { name: 'Create trip' }).click()

    await expect(sheet.getByText(/before the start date/i)).toBeVisible()
    await expect(sheet).toBeVisible()
  })

  test('adds a trip-only item, packs it, and moves it out and back', async ({ page }) => {
    await createTrip(page, ownedName('E2E Checklist'))

    const itemName = ownedName('Snorkel')
    await page.getByRole('button', { name: 'Add a unique item' }).click()
    await page.getByPlaceholder('Unique item for this trip').fill(itemName)
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
    await createTrip(page, ownedName('E2E Facts'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'What Pack Smart understood' }).click()
    const facts = page.locator('.facts')

    await expect(facts).toContainText('12 days')
    await expect(facts).toContainText('11 nights')
    await expect(facts).not.toContainText('%')
  })

  test('does not scroll sideways on a trip screen', async ({ page }) => {
    await createTrip(page, ownedName('E2E Width'))

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('one last look', () => {
  test('says nothing is missing rather than showing the whole closet', async ({ page }) => {
    await unlock(page)
    await createTrip(page, ownedName('E2E Last Look'))

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
    await createTrip(page, ownedName('E2E Last Look Add'))

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
    const name = ownedName('E2E Past')

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
    const name = ownedName('Retry trip')
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
    const name = ownedName('Archive me')
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
    const name = ownedName('Keep me')
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
    const keep = ownedName('Survivor')
    await createTrip(page, keep)

    const doomed = ownedName('Delete me')
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

test.describe('finding what is left on a long packing list', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('filters down to what is still to pack, and the progress count does not move', async ({
    page,
  }) => {
    const name = ownedName('Filter me')
    await createTrip(page, name)

    const filter = page.getByLabel('Show')
    await expect(filter).toBeVisible()

    /*
     * The progress line is the assertion that matters. A filtered list that also
     * filtered "0 of 31 packed" would tell Alex he is further along than he is —
     * and `Still to pack` going empty would read as "0 of 0", which is the exact
     * opposite of what it means.
     */
    const progress = page.locator('.trip-summary-progress')
    const whole = (await progress.textContent())?.trim()
    const total = await page.locator('.swipe-row').count()
    expect(total).toBeGreaterThan(0)

    // Everything is still to pack on a new trip, and the progress line still
    // speaks for the whole trip rather than for the filtered view.
    await filter.selectOption('unpacked')
    expect(await page.locator('.swipe-row').count()).toBe(total)
    await expect(progress).toHaveText(whole!)

    /*
     * Pack one, and it moves from one filter to the other.
     *
     * Scoped to Pack now, and counted there. A row that needs a final check is
     * on screen TWICE once it is packed — under its own section and under Final
     * check (doc 03 §8) — so "one packed row" is not the same statement as "one
     * packed item". It never mattered until D2 sorted unpacked essentials to the
     * top and `.first()` started landing on one.
     */
    await filter.selectOption('all')
    const packNow = page.locator('.checklist-section', { hasText: 'Pack now' })
    // Pack now's own count. `total` is the whole list, and comparing one against
    // the other is comparing two different questions.
    const packNowTotal = await packNow.locator('.swipe-row').count()
    const control = packNow.locator('.swipe-row .check-main').first()
    await control.click()
    await expect(control).toHaveAttribute('aria-pressed', 'true')

    await filter.selectOption('unpacked')
    expect(await packNow.locator('.swipe-row').count()).toBe(packNowTotal - 1)
    await expect(progress).not.toHaveText(whole!)
  })

  test('says which control emptied the list, and offers the way back', async ({ page }) => {
    const name = ownedName('Empty filter')
    await createTrip(page, name)

    /*
     * A dead end is the failure mode of any filter. A bag nothing has been
     * assigned to is legitimately empty on a fresh trip, and the list has to
     * account for it rather than looking broken — with the way out in the
     * sentence, not a second button under it.
     *
     * `Packed` used to be the empty one here; G4 retired it, and a bag filter is
     * the same shape of question with the same answer.
     */
    await page.getByLabel('Show').selectOption('bag_checked')
    await expect(page.locator('.checklist-empty')).toBeVisible()

    await page.getByRole('button', { name: 'Show everything' }).click()
    await expect(page.getByLabel('Show')).toHaveValue('all')
    expect(await page.locator('.swipe-row').count()).toBeGreaterThan(0)
  })
})

test.describe('what a trip teaches My Stuff', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page)
  })

  test('ranks by what has actually been packed, and says how many trips', async ({ page }) => {
    /*
     * The distinction "Most packed" exists to make: **confirmed packing, not
     * inclusion.** Generating a checklist suggests plenty and packs nothing, so
     * the sort has to be empty until Alex ticks something off — otherwise its top
     * is whatever the engine proposes most often, which he already knows.
     *
     * Lives here rather than in `my-stuff.spec.ts` because it needs a trip, and
     * the trip helpers are here. It is the one place the whole path runs end to
     * end: tick a row on a trip, and it becomes an answer in My Stuff.
     *
     * **Every assertion is about one named item**, not about the screen. These
     * specs share one database and run in file order, so other tests have packed
     * their own rows by the time this one runs — the first version asserted "no
     * badges anywhere" and "exactly one badge", passed alone, and failed in the
     * suite. Anything global here would be an assertion about the test order.
     */
    const trip = ownedName('Packed for')
    await createTrip(page, trip)

    /** The item this test packs, as My Stuff spells it — no category emoji. */
    const control = page.locator('.swipe-row .check-main').first()
    await expect(control).toBeVisible()
    const rowText = (await page.locator('.swipe-row .check-name').first().textContent()) ?? ''
    const itemName = rowText
      .replace(/^[^\p{L}\p{N}]+/u, '')
      // The "· Essential" marker lives inside the name, and D2 sorts unpacked
      // essentials to the top — so the first row now usually carries it, and
      // My Stuff spells the item without it.
      .replace(/\s*·\s*,?\s*Essential\s*$/u, '')
      .trim()
    expect(itemName).not.toBe('')

    const openMyStuff = async () => {
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: /My Stuff/ })
        .click()
      await expect(page.getByRole('heading', { name: 'My Stuff' })).toBeVisible()
      await page.getByLabel('Sort').selectOption('packed')
      await page.getByLabel('Search your items').fill(itemName)
      const row = page.locator('.stuff-row').filter({ hasText: itemName }).first()
      await expect(row).toBeVisible()
      return row
    }

    /*
     * The count BEFORE, rather than an assumed zero.
     *
     * Earlier tests in this file pack rows of their own, and the checklist
     * generator suggests the same wardrobe to every trip — so by the time this
     * runs, this item may well already have travelled. What is being asserted is
     * the increment, which is true whatever ran first.
     */
    const badge = (row: Locator) => row.locator('.stuff-packed')
    const before = Number((await badge(await openMyStuff()).textContent())?.split(' ')[0] ?? 0)

    // Back to the trip, and pack it.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.locator('.trip-row').filter({ hasText: trip }).first().click()
    await expect(control).toBeVisible()
    await control.click()
    await expect(control).toHaveAttribute('aria-pressed', 'true')

    /*
     * Exactly one more. A query that counted *suggestions* rather than packings
     * would already have counted this trip before the row was ticked, so the
     * number would not move at all — which is the failure this is here to catch.
     */
    const after = before + 1
    await expect(badge(await openMyStuff())).toHaveText(
      `${after} ${after === 1 ? 'trip' : 'trips'}`,
    )
  })
})
