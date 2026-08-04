import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ownedName } from './fixtures'

/**
 * Doc 04 §8, on the phone: taking clothing off the packing list must name the
 * outfit that was wearing it, offer to replace it, and keep saying so until it
 * is settled — "the user must never maintain two conflicting clothing plans".
 *
 * WebKit at 390×844, which is where the undo bar has to fit two actions beside a
 * sentence and still clear the 44px touch minimum.
 */

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/** A trip with one approved outfit, sitting on the packing list. */
async function tripWithApprovedOutfit(page: Page, name: string): Promise<string> {
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
  await sheet.getByRole('button', { name: 'Create trip' }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('button', { name: 'Outfits' }).click()
  await page.getByRole('button', { name: 'Plan Outfits' }).click()

  const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()
  const garment = (await safari.locator('.slot-item').first().textContent())!.trim()

  await safari.getByRole('button', { name: 'Approve outfit' }).click()
  await expect(safari.getByRole('button', { name: 'Undo approval' })).toBeVisible()

  await page.getByRole('button', { name: 'Back to packing list' }).click()
  return garment
}

async function setAside(page: Page, garment: string) {
  await page.getByRole('button', { name: `Options for ${garment}` }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Not bringing this' }).click()
}

test.describe('removing clothing an outfit relies on', () => {
  test('names the outfit that was wearing it and offers a replacement', async ({ page }) => {
    const garment = await tripWithApprovedOutfit(page, ownedName('E2E Remove'))
    await setAside(page, garment)

    const bar = page.locator('.undo-bar')
    await expect(bar).toContainText('Safari')
    await expect(bar).toContainText('moved to Not bringing')
    await expect(bar.getByRole('button', { name: 'Replace it' })).toBeVisible()

    // And it keeps saying so, in the list itself, after the bar has gone.
    await expect(page.locator('.outfit-conflict')).toContainText(`Safari needs the ${garment}`)
  })

  test('replacing it from the packing list settles both plans', async ({ page }) => {
    const garment = await tripWithApprovedOutfit(page, ownedName('E2E Replace'))
    await setAside(page, garment)

    await page.locator('.undo-bar').getByRole('button', { name: 'Replace it' }).click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    const rows = sheet.locator('.swap-row:not(.is-current)')
    const chosen = (await rows.first().locator('.swap-name').textContent())!.trim()
    await rows.first().click()

    await expect(sheet).toHaveCount(0)
    // No conflict left, and the replacement is on the list.
    await expect(page.locator('.outfit-conflict')).toHaveCount(0)
    await expect(page.getByText(chosen).first()).toBeVisible()

    // The outfit shows the replacement, not a struck-through garment.
    await page.getByRole('button', { name: 'Outfits' }).click()
    const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()
    await expect(safari.locator('.slot.is-set-aside')).toHaveCount(0)
    await expect(safari).not.toContainText('Incomplete')
  })

  test('undoing the removal clears the conflict it raised', async ({ page }) => {
    const garment = await tripWithApprovedOutfit(page, ownedName('E2E RemoveUndo'))
    await setAside(page, garment)
    await expect(page.locator('.outfit-conflict')).toHaveCount(1)

    await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click()

    await expect(page.locator('.outfit-conflict')).toHaveCount(0)

    // Both halves back as they were: the garment on the list, the outfit whole.
    await page.getByRole('button', { name: 'Outfits' }).click()
    const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()
    await expect(safari.locator('.slot.is-set-aside')).toHaveCount(0)
    await expect(safari).toContainText('On your packing list')
  })

  test('the outfit card says which garment is missing until it is settled', async ({ page }) => {
    const garment = await tripWithApprovedOutfit(page, ownedName('E2E Marked'))
    await setAside(page, garment)

    await page.getByRole('button', { name: 'Outfits' }).click()
    const safari = page.locator('.outfit-card').filter({ hasText: 'Safari' }).first()

    await expect(safari).toContainText(`you are not bringing the ${garment}`)
    await expect(safari).not.toContainText('On your packing list')
    await expect(safari.locator('.slot.is-set-aside')).toHaveCount(1)
    await expect(safari.locator('.slot-set-aside')).toContainText('Not bringing this')
  })

  /*
   * The quiet half of the requirement. Most of the list is gear no outfit uses,
   * and offering to replace a toothbrush in an outfit would be nonsense.
   */
  test('says nothing about outfits for something no outfit uses', async ({ page }) => {
    await tripWithApprovedOutfit(page, ownedName('E2E NoOutfit'))

    await page.getByRole('button', { name: 'Add a unique item' }).click()
    await page.getByPlaceholder('Unique item for this trip').fill('Corkscrew')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await setAside(page, 'Corkscrew')

    const bar = page.locator('.undo-bar')
    await expect(bar).toContainText('Corkscrew moved to Not bringing')
    await expect(bar.getByRole('button', { name: 'Replace it' })).toHaveCount(0)
    await expect(page.locator('.outfit-conflict')).toHaveCount(0)
  })

  test('does not scroll sideways with a conflict on screen', async ({ page }) => {
    const garment = await tripWithApprovedOutfit(page, ownedName('E2E ConflictWidth'))
    await setAside(page, garment)
    await expect(page.locator('.outfit-conflict')).toHaveCount(1)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
