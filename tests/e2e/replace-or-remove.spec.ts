import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { approvableCard, approveOutfit, ownedName } from './fixtures'

/**
 * Doc 04 §8, on the phone: taking clothing off the packing list must name the
 * outfit that was wearing it, offer to replace it, and keep saying so until it
 * is settled — "the user must never maintain two conflicting clothing plans".
 *
 * WebKit at 390×844, which is where the undo bar has to fit two actions beside a
 * sentence and still clear the 44px touch minimum.
 */

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

interface ApprovedOutfit {
  /** A garment the approved outfit is wearing, which the tests set aside. */
  garment: string
  /** What that outfit is CALLED, so every assertion below names the same card. */
  outfit: string
}

/** A trip with one approved outfit, sitting on the packing list. */
async function tripWithApprovedOutfit(page: Page, name: string): Promise<ApprovedOutfit> {
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
  /*
   * `exact`, because the trip screen now has more than one control whose name
   * contains the word.
   *
   * The readiness summary reports "2 outfits need attention" as a tappable line,
   * and a substring match resolved to both it and the navigation button. The
   * loose selector was always ambiguous about which control it meant; it simply
   * had only one candidate until now. Identity, not resemblance.
   */
  await page.getByRole('button', { name: 'Outfits', exact: true }).click()
  await page.getByRole('button', { name: 'Plan Outfits' }).click()

  /*
   * The approved outfit here is SETUP, not the subject — every test in this
   * file is about what happens on the packing list afterwards. So it asks for
   * a card that can be approved rather than for the one named Safari, and it
   * fails on the server's own answer rather than on a missing button label.
   */
  const card = await approvableCard(page)
  const garment = (await card.locator('.slot-item').first().textContent())!.trim()

  const outfit = (await card.locator('.outfit-name').textContent())!.trim()
  await approveOutfit(card, outfit)

  await page.getByRole('button', { name: 'Back to packing list' }).click()
  return { garment, outfit }
}

async function setAside(page: Page, garment: string) {
  await page.getByRole('button', { name: `Options for ${garment}` }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Not bringing this' }).click()
}

test.describe('removing clothing an outfit relies on', () => {
  test('names the outfit that was wearing it and offers a replacement', async ({ page }) => {
    const { garment, outfit } = await tripWithApprovedOutfit(page, ownedName('E2E Remove'))
    await setAside(page, garment)

    const bar = page.locator('.undo-bar')
    await expect(bar).toContainText(outfit)
    await expect(bar).toContainText('moved to Not bringing')
    await expect(bar.getByRole('button', { name: 'Replace it' })).toBeVisible()

    // And it keeps saying so, in the list itself, after the bar has gone.
    await expect(page.locator('.outfit-conflict')).toContainText(`${outfit} needs the ${garment}`)
  })

  test('replacing it from the packing list settles both plans', async ({ page }) => {
    const { garment, outfit } = await tripWithApprovedOutfit(page, ownedName('E2E Replace'))
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
    await page.getByRole('button', { name: 'Outfits', exact: true }).click()
    const approved = page.locator('.outfit-card').filter({ hasText: outfit }).first()
    await expect(approved.locator('.slot.is-set-aside')).toHaveCount(0)
    await expect(approved).not.toContainText('Incomplete')
  })

  test('undoing the removal clears the conflict it raised', async ({ page }) => {
    const { garment, outfit } = await tripWithApprovedOutfit(page, ownedName('E2E RemoveUndo'))
    await setAside(page, garment)
    await expect(page.locator('.outfit-conflict')).toHaveCount(1)

    await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click()

    await expect(page.locator('.outfit-conflict')).toHaveCount(0)

    /*
     * Both halves back as they were: the garment on the list, the outfit whole.
     *
     * `Approved` in the card's footer, not `On your packing list` under the
     * header. The status line said the same thing as the footer state and cost
     * a line on every card to do it, so the compression pass removed it — what
     * it said is now where every other list row in the product says its state.
     */
    await page.getByRole('button', { name: 'Outfits', exact: true }).click()
    const approved = page.locator('.outfit-card').filter({ hasText: outfit }).first()
    await expect(approved.locator('.slot.is-set-aside')).toHaveCount(0)
    await expect(approved.locator('.outfit-state')).toHaveText('Approved')
    await expect(approved.locator('.outfit-flag')).toHaveCount(0)
  })

  test('the outfit card says which garment is missing until it is settled', async ({ page }) => {
    const { garment, outfit } = await tripWithApprovedOutfit(page, ownedName('E2E Marked'))
    await setAside(page, garment)

    await page.getByRole('button', { name: 'Outfits', exact: true }).click()
    const approved = page.locator('.outfit-card').filter({ hasText: outfit }).first()

    /*
     * The same two facts, in the shapes the compression pass gave them: a
     * labelled flag row for the outfit-level problem, and a marker at the end
     * of the garment's own row rather than a sentence under it.
     */
    await expect(approved.locator('.outfit-flag')).toContainText('Incomplete')
    await expect(approved.locator('.outfit-flag')).toContainText(
      `You are not bringing the ${garment}`,
    )
    await expect(approved.locator('.slot.is-set-aside')).toHaveCount(1)
    await expect(approved.locator('.slot-mark')).toContainText('Not bringing')
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
    const { garment } = await tripWithApprovedOutfit(page, ownedName('E2E ConflictWidth'))
    await setAside(page, garment)
    await expect(page.locator('.outfit-conflict')).toHaveCount(1)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
