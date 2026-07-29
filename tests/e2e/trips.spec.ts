import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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
