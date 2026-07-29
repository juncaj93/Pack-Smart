import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

function uniqueName(prefix: string) {
  return `${prefix} ${Math.floor(performance.now())}`
}

async function tripWithOutfits(page: Page, name: string) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }).click()
  await page.getByRole('button', { name: 'Plan a Trip' }).first().click()

  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Cape Town')
  await sheet.getByLabel('Leaving').fill('2026-07-31')
  await sheet.getByLabel('Returning').fill('2026-08-11')
  await sheet.getByRole('button', { name: 'Safari' }).click()
  await sheet.getByRole('button', { name: 'Nice dinners' }).click()
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('button', { name: 'Outfits' }).click()
  await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible()
}

test.describe('outfits', () => {
  test('plans outfits grouped by occasion, not by day', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Outfits'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nice dinners' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Travel days' })).toBeVisible()

    // A twelve-day trip must not produce twelve cards.
    expect(await page.locator('.outfit-card').count()).toBeLessThan(8)
  })

  test('approving an outfit puts its clothing on the packing list', async ({ page }) => {
    const name = uniqueName('E2E Approve')
    await tripWithOutfits(page, name)
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()
    const garment = await safari.locator('.slot-item').first().textContent()

    await safari.getByRole('button', { name: 'Approve outfit' }).click()
    await expect(safari.getByRole('button', { name: 'Undo approval' })).toBeVisible()

    await page.getByRole('button', { name: 'Back to packing list' }).click()
    await expect(page.getByText(garment!.trim())).toBeVisible()
  })

  test('un-approving takes the clothing back off the list', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Unapprove'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()
    const garment = (await safari.locator('.slot-item').first().textContent())!.trim()

    await safari.getByRole('button', { name: 'Approve outfit' }).click()
    await expect(safari.getByRole('button', { name: 'Undo approval' })).toBeVisible()
    await safari.getByRole('button', { name: 'Undo approval' }).click()
    await expect(safari.getByRole('button', { name: 'Approve outfit' })).toBeVisible()

    await page.getByRole('button', { name: 'Back to packing list' }).click()
    await expect(page.getByText(garment, { exact: true })).toHaveCount(0)
  })

  test('swapping offers suitable garments first and unsuitable ones with a reason', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E Swap'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const dinner = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    await dinner.locator('.slot').first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.swap-row').first()).toBeVisible()

    // Unsuitable options are shown, labelled, not hidden.
    await expect(sheet.getByText(/Pack Smart does not think these suit/)).toBeVisible()
    await expect(sheet.locator('.swap-row.is-unsuitable .swap-why').first()).not.toBeEmpty()
  })

  test('a swap sticks and is reflected on the card', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E SwapApply'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()
    await safari.locator('.slot').first().click()

    const sheet = page.getByRole('dialog')
    const rows = sheet.locator('.swap-row:not(.is-current)')
    const chosen = (await rows.first().locator('.swap-name').textContent())!.trim()
    await rows.first().click()

    await expect(sheet).toHaveCount(0)
    await expect(safari.locator('.slot-item').first()).toHaveText(chosen)
  })

  test('does not scroll sideways', async ({ page }) => {
    await tripWithOutfits(page, uniqueName('E2E OutfitWidth'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
