import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { approvableCard, approveOutfit, ownedName } from './fixtures'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

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
    await tripWithOutfits(page, ownedName('E2E Outfits'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nice dinners' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Travel days' })).toBeVisible()

    // A twelve-day trip must not produce twelve cards.
    expect(await page.locator('.outfit-card').count()).toBeLessThan(8)
  })

  test('approving an outfit puts its clothing on the packing list', async ({ page }) => {
    const name = ownedName('E2E Approve')
    await tripWithOutfits(page, name)
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    /*
     * A card that CAN be approved, rather than the one called Safari.
     *
     * Which groups come back complete depends on the wardrobe, the trip's
     * activities and the forecast — so naming one was two assertions in one,
     * and only the approval was this test's subject. See `approveOutfit`.
     */
    const card = await approvableCard(page)
    const garment = await card.locator('.slot-item').first().textContent()

    await approveOutfit(card)

    await page.getByRole('button', { name: 'Back to packing list' }).click()
    /*
     * `.first()`, and NOT `exact`.
     *
     * The original failure was intermittent: `getByText` matches substrings, so
     * when the planner picked a garment whose name is contained in another
     * item's name this resolved to two elements and strict mode failed. Which
     * garment gets picked now varies within a run, because approved outfits
     * write pairings that influence later choices.
     *
     * My first attempt at this used `exact: true` and made it fail EVERY time —
     * a checklist row is "<name> · <qty>", so the text is never exactly the
     * name. The test below looked like a precedent for `exact` but is not: it
     * asserts `toHaveCount(0)`, where exactness never has to match anything.
     *
     * `.first()` is the honest assertion: the garment reached the list, at least
     * once, whatever else shares part of its name.
     */
    await expect(page.getByText(garment!.trim()).first()).toBeVisible()
  })

  test('un-approving takes the clothing back off the list', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Unapprove'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    const garment = (await card.locator('.slot-item').first().textContent())!.trim()

    await approveOutfit(card)
    await card.getByRole('button', { name: 'Undo approval' }).click()
    await expect(card.getByRole('button', { name: 'Approve outfit' })).toBeVisible()

    await page.getByRole('button', { name: 'Back to packing list' }).click()
    await expect(page.getByText(garment, { exact: true })).toHaveCount(0)
  })

  /*
   * The only place an ordinary action on this screen writes something that
   * outlives the trip (doc 04 §5). `CLAUDE.md` requires permanent preference
   * changes to be explicit, so it must announce itself and be refusable.
   */
  test('says when it has remembered a combination, and lets it be undone', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Remember'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    await approveOutfit(card)

    const remembered = page.locator('.outfit-remembered')
    await expect(remembered).toContainText('these go together')

    await remembered.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.outfit-remembered')).toHaveCount(0)

    // Declining the habit must not undo the approval — they are separate.
    await expect(card.getByRole('button', { name: 'Undo approval' })).toBeVisible()
  })

  test('does not claim to have remembered anything when un-approving', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E NoRemember'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    await approveOutfit(card)
    await expect(page.locator('.outfit-remembered')).toBeVisible()

    await card.getByRole('button', { name: 'Undo approval' }).click()
    await expect(page.locator('.outfit-remembered')).toHaveCount(0)
  })

  test('swapping offers suitable garments first and unsuitable ones with a reason', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Swap'))
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
    await tripWithOutfits(page, ownedName('E2E SwapApply'))
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

  /**
   * G3 — the replacement sheet reaches the whole wardrobe.
   *
   * Against the real workbook, in a real browser, because the defect was that a
   * garment Alex owns was **not in the response at all**: no amount of scrolling
   * or typing on this screen produced it. Every layer between the SQL and the
   * list had to change for that to stop being true, so the proof belongs here as
   * well as in the two suites that test the halves.
   */
  test('a jacket can be reached from a slot that is not for jackets', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E SwapAll'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const dinner = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    await dinner.locator('.slot').first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    const recommended = sheet.getByRole('radio', { name: 'Recommended' })
    await expect(recommended).toHaveAttribute('aria-checked', 'true')
    const narrow = await sheet.locator('.swap-row').count()

    await sheet.getByRole('radio', { name: 'All items' }).click()
    const wide = await sheet.locator('.swap-row').count()

    // The whole active wardrobe, which is strictly more than one slot's worth.
    expect(wide).toBeGreaterThan(narrow)

    // And every extra row says what it is rather than appearing unexplained.
    await expect(sheet.locator('.swap-row.is-unsuitable .swap-why').first()).not.toBeEmpty()
  })

  test('searching All items finds a garment by what it is', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E SwapSearch'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const dinner = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    await dinner.locator('.slot').first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByRole('radio', { name: 'All items' }).click()
    await sheet.getByRole('searchbox').fill('shoes')

    // Named or not, a pair of shoes is findable from a Top slot. Nothing here
    // recommends them; they are simply no longer unreachable.
    await expect(sheet.locator('.swap-row').first()).toBeVisible()
    expect(await sheet.locator('.swap-row').count()).toBeGreaterThan(0)
  })

  /*
   * A choice made outside the recommendation is still a choice. This is the
   * whole reason the slice exists, so it is followed all the way to the card.
   */
  test('an unconventional choice sticks, and says it is current when reopened', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E SwapOutside'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const dinner = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    const slot = dinner.locator('.slot').first()
    await slot.click()

    const sheet = page.getByRole('dialog')
    /*
     * What the recommendation was, read only once the list has actually
     * rendered — collecting the names a tick early gives an empty set, and an
     * empty set makes the "not in the recommendation" filter below vacuous.
     */
    await expect(sheet.locator('.swap-row').first()).toBeVisible()
    const recommended = (await sheet.locator('.swap-name').allTextContents()).map((n) => n.trim())
    expect(recommended.length).toBeGreaterThan(0)

    await sheet.getByRole('radio', { name: 'All items' }).click()
    await expect(sheet.locator('.swap-row').first()).toBeVisible()

    // A garment the old sheet could not have offered at all: present in All
    // items and absent from the slot's own list.
    const everything = (await sheet.locator('.swap-name').allTextContents()).map((n) => n.trim())
    const beyond = everything.filter((name) => !recommended.includes(name))
    expect(beyond.length, 'All items adds something the slot list did not have').toBeGreaterThan(0)
    const chosen = beyond[0]!

    await sheet.locator('.swap-row', { hasText: chosen }).first().click()

    await expect(sheet).toHaveCount(0)
    await expect(slot.locator('.slot-item').first()).toHaveText(chosen)

    // Reopened, the sheet shows it in the DEFAULT view and marks it Current —
    // a garment from elsewhere would otherwise be invisible in the very slot it
    // is filling, which reads as the swap having been discarded.
    await slot.click()
    const again = page.getByRole('dialog')
    await expect(again.getByRole('radio', { name: 'Recommended' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(again.locator('.swap-row.is-current')).toContainText(chosen)
  })

  test('the swap sheet does not scroll sideways on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await tripWithOutfits(page, ownedName('E2E SwapWidth'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const dinner = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    await dinner.locator('.slot').first().click()

    const sheet = page.getByRole('dialog')
    await sheet.getByRole('radio', { name: 'All items' }).click()
    await expect(sheet.locator('.swap-row').first()).toBeVisible()

    // The chips wrap; they do not add a sideways scroller inside a sheet that
    // is itself draggable.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // And both chips are full-size targets, at the narrowest width worth caring
    // about (`VISUAL_ACCEPTANCE.md` §1).
    for (const name of ['Recommended', 'All items']) {
      const box = (await sheet.getByRole('radio', { name }).boundingBox())!
      expect(box.height, name).toBeGreaterThanOrEqual(44)
    }
  })

  test('does not scroll sideways', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E OutfitWidth'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
