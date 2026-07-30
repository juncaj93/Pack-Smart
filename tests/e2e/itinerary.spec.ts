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

const ITINERARY = [
  'Destination: Cape Town',
  '2 August 2026 - game drive at first light',
  '3 August 2026 - game drive',
  '4 August 2026 - game drive, afternoon at leisure',
  '6 August 2026 - wine tasting in Stellenbosch',
].join('\n')

/** A trip with no activities, so everything on screen comes from the itinerary. */
async function bareTrip(page: Page, name: string) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill('2026-08-01')
  await sheet.getByLabel('Returning').fill('2026-08-08')
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible()
}

test.describe('itinerary', () => {
  test('reads pasted text into days, and changes nothing until told to', async ({ page }) => {
    const name = uniqueName('E2E Itinerary')
    await bareTrip(page, name)

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Add an itinerary' }).click()
    await expect(page.getByRole('heading', { name: 'Itinerary' })).toBeVisible()

    await page.getByLabel('Your itinerary').fill(ITINERARY)
    await page.getByRole('button', { name: 'Read this' }).click()

    await expect(page.getByText('Here is what Pack Smart understood')).toBeVisible()

    // Three safari days, quoted from the lines they came from.
    await expect(page.getByText('Safari · 3 days')).toBeVisible()
    // The same line is quoted twice — once under the activity, once under its
    // day — which is the point: both are traceable.
    await expect(page.getByText('“2 August 2026 - game drive at first light”').first()).toBeVisible()

    // Nothing has been applied yet.
    await expect(page.getByRole('button', { name: 'Add these to the trip' })).toBeVisible()

    await page.getByRole('button', { name: 'Add these to the trip' }).click()

    // Landing on Outfits with three safari outfits is the whole point.
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible()
    await expect(page.getByText('3 days').first()).toBeVisible()
  })

  test('lets a wrong reading be unticked before it is applied', async ({ page }) => {
    await bareTrip(page, uniqueName('E2E Itinerary Untick'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Add an itinerary' }).click()
    await page.getByLabel('Your itinerary').fill(ITINERARY)
    await page.getByRole('button', { name: 'Read this' }).click()

    const winery = page.locator('.proposal-row').filter({ hasText: 'Winery' }).first()
    await expect(winery).toHaveAttribute('aria-pressed', 'true')
    await winery.click()
    await expect(winery).toHaveAttribute('aria-pressed', 'false')

    await page.getByRole('button', { name: 'Add these to the trip' }).click()
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()

    // The unticked activity was never added.
    await expect(page.getByRole('heading', { name: 'Winery' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible()
  })

  test('says nothing was found rather than inventing a trip', async ({ page }) => {
    await bareTrip(page, uniqueName('E2E Itinerary Empty'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Add an itinerary' }).click()
    await page.getByLabel('Your itinerary').fill('Terms and conditions apply. Retain for your records.')
    await page.getByRole('button', { name: 'Read this' }).click()

    await expect(page.getByText(/Nothing recognisable was found/)).toBeVisible()
    await expect(page.getByText('Here is what Pack Smart understood')).toHaveCount(0)
  })

  test('explains a link it could not read instead of failing silently', async ({ page }) => {
    await bareTrip(page, uniqueName('E2E Itinerary Link'))

    await openTripSetup(page)
    await page.getByRole('button', { name: 'Add an itinerary' }).click()
    await page.getByRole('button', { name: 'Paste a link' }).click()
    await page.getByLabel('Link to your itinerary').fill('https://example.invalid/booking')
    await page.getByRole('button', { name: 'Read this link' }).click()

    await expect(page.getByText(/could not be reached|answered/)).toBeVisible()
  })

  test('does not scroll sideways', async ({ page }) => {
    await bareTrip(page, uniqueName('E2E Itinerary Width'))
    await openTripSetup(page)
    await page.getByRole('button', { name: 'Add an itinerary' }).click()
    await page.getByLabel('Your itinerary').fill(ITINERARY)
    await page.getByRole('button', { name: 'Read this' }).click()
    await expect(page.getByText('Here is what Pack Smart understood')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('trip identity', () => {
  test('suggests an icon from the activities and shows it everywhere', async ({ page }) => {
    const name = uniqueName('E2E Emoji')

    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2026-08-01')
    await sheet.getByLabel('Returning').fill('2026-08-08')
    await sheet.getByRole('button', { name: 'Safari' }).click()

    // The suggestion reacts to what has just been entered.
    await expect(sheet.locator('.emoji-glyph')).toHaveText('🦁')
    await expect(sheet.getByText('Suggested · tap to change')).toBeVisible()

    await sheet.getByRole('button', { name: 'Create trip' }).click()

    // On the trip's own heading...
    await expect(page.getByRole('heading', { name: `🦁 ${name}` })).toBeVisible()

    // ...and on its card in the list.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    const card = page.locator('.trip-name').filter({ hasText: name })
    await expect(card.locator('.trip-emoji')).toHaveText('🦁')
  })

  test('lets the suggestion be overruled, and keeps the choice', async ({ page }) => {
    const name = uniqueName('E2E Emoji Override')

    await page.goto('/')
    await page.getByLabel('Passphrase').fill(PASSPHRASE)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Trip name').fill(name)
    await sheet.getByLabel('Destination').fill('Cape Town')
    await sheet.getByLabel('Leaving').fill('2026-08-01')
    await sheet.getByLabel('Returning').fill('2026-08-08')
    await sheet.getByRole('button', { name: 'Safari' }).click()

    await sheet.locator('.emoji-current').click()
    await sheet.getByRole('button', { name: 'Use 🚢' }).click()
    await expect(sheet.locator('.emoji-glyph')).toHaveText('🚢')

    await sheet.getByRole('button', { name: 'Create trip' }).click()
    await expect(page.getByRole('heading', { name: `🚢 ${name}` })).toBeVisible()

    /*
     * The half that matters: an edit that has nothing to do with the icon must
     * not re-suggest it. Adding an activity here would have flipped it back to
     * the safari lion if the suggestion ran again.
     */
    // Scoped to the trip's action row: "Edit" also appears inside checklist row
    // labels once the list has been generated.
    await openTripSetup(page)
    await page.getByRole('button', { name: 'Edit trip' }).click()
    const edit = page.getByRole('dialog')
    await edit.getByRole('button', { name: 'Winery' }).click()
    await edit.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('heading', { name: `🚢 ${name}` })).toBeVisible()
  })
})
