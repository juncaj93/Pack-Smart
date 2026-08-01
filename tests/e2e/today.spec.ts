import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/** A trip whose dates cover today, so Today has a real day to show. */
function currentDates() {
  const today = new Date()
  const start = new Date(today.getTime() - 2 * 86_400_000).toISOString().slice(0, 10)
  const end = new Date(today.getTime() + 5 * 86_400_000).toISOString().slice(0, 10)
  return { start, end }
}

/**
 * Approves every complete outfit, one at a time.
 *
 * Each approval rewrites the clothing checklist server-side, so they must not
 * overlap — waiting for the button to flip is what serialises them.
 */
async function approveAll(page: Page) {
  const cards = page.locator('.outfit-card')
  // Wait for the plan to render before counting; counting an empty list would
  // silently approve nothing and leave the test asserting against a blank Today.
  await expect(cards.first()).toBeVisible()

  for (let i = 0; i < (await cards.count()); i += 1) {
    const card = cards.nth(i)
    const approve = card.getByRole('button', { name: 'Approve outfit' })
    if (await approve.count()) {
      await approve.click()
      await expect(card.getByRole('button', { name: 'Undo approval' })).toBeVisible()
    }
  }
}

/** Ticks off every checklist row, waiting for each to register. */
async function packEverything(page: Page) {
  const rows = page.locator('.check-main')
  await expect(rows.first()).toBeVisible()

  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i)
    if ((await row.getAttribute('aria-pressed')) === 'false') {
      await row.click()
      await expect(row).toHaveAttribute('aria-pressed', 'true')
    }
  }
}

async function activeTrip(page: Page, name: string) {
  const { start, end } = currentDates()

  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill(start)
  await sheet.getByLabel('Returning').fill(end)
  await sheet.getByRole('button', { name: 'Safari' }).click()
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
}

test.describe('during the trip', () => {
  test('says nothing is packed rather than inventing an outfit', async ({ page }) => {
    await activeTrip(page, ownedName('E2E Today Empty'))
    await page.getByRole('button', { name: 'Today', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(page.getByText('Nothing packed yet')).toBeVisible()
    // Critically: no clothing is suggested at all.
    await expect(page.locator('.today-row')).toHaveCount(0)
  })

  test('shows the approved outfit once its clothing is packed', async ({ page }) => {
    await activeTrip(page, ownedName('E2E Today Packed'))

    await page.getByRole('button', { name: 'Outfits' }).click()
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    await approveAll(page)
    await page.getByRole('button', { name: 'Back to packing list' }).click()
    await packEverything(page)

    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Wear' })).toBeVisible()
    await expect(page.locator('.today-row').first()).toBeVisible()
  })

  test('shows the same plan when reopened', async ({ page }) => {
    const name = ownedName('E2E Today Stable')
    await activeTrip(page, name)

    await page.getByRole('button', { name: 'Outfits' }).click()
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await approveAll(page)
    await page.getByRole('button', { name: 'Back to packing list' }).click()
    await packEverything(page)

    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.locator('.today-row').first()).toBeVisible()
    const first = await page.locator('.today-name').allTextContents()

    await page.reload()
    await expect(page.locator('.today-row').first()).toBeVisible()
    const second = await page.locator('.today-name').allTextContents()

    expect(second).toEqual(first)
  })

  test('moves between days without losing its place', async ({ page }) => {
    await activeTrip(page, ownedName('E2E Today Nav'))
    await page.getByRole('button', { name: 'Today', exact: true }).click()

    await expect(page.getByText(/Day 3 of 8/)).toBeVisible()
    await page.getByRole('button', { name: 'Previous day' }).click()
    await expect(page.getByText(/Day 2 of 8/)).toBeVisible()
  })

  test('does not scroll sideways', async ({ page }) => {
    await activeTrip(page, ownedName('E2E Today Width'))
    await page.getByRole('button', { name: 'Today', exact: true }).click()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
