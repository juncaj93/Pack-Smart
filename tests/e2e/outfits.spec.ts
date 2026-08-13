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
  await page.getByRole('button', { name: 'Outfits', exact: true }).click()
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
    await card.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()

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
    await expect(card.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  })

  test('does not claim to have remembered anything when un-approving', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E NoRemember'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    await approveOutfit(card)
    await expect(page.locator('.outfit-remembered')).toBeVisible()

    await card.getByRole('button', { name: 'Undo', exact: true }).click()
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

  /*
   * P1A. The picker used to close only when the PUT came back, so tap-to-closed
   * scaled with network latency: measured 155 ms locally, 857 ms at 300 ms RTT
   * and 1368 ms at 1000 ms. The write is unchanged and still transactional —
   * what changed is that the INTERACTION no longer waits for the PERSISTENCE.
   *
   * The request is held open by the test rather than delayed by a clock, so the
   * assertion is about ordering rather than about speed: the sheet is gone, the
   * garment is on the card, and the screen is usable, all while the write is
   * still in flight. Releasing it afterwards proves nothing was dropped.
   */
  test('the picker closes before the write finishes, and the choice is already there', async ({
    page,
  }) => {
    await tripWithOutfits(page, ownedName('E2E SwapOptimistic'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    let release: (() => void) | null = null
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/trips/*/outfits/*/slots/*', async (route) => {
      await held
      await route.continue()
    })

    const card = page.locator('.outfit-card').first()
    await card.locator('.slot').first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.locator('.swap-row').first()).toBeVisible()

    const chosen = (await sheet
      .locator('.swap-row:not(.is-current)')
      .first()
      .locator('.swap-name')
      .textContent())!.trim()
    await sheet.locator('.swap-row:not(.is-current)').first().click()

    // Still in flight, and the screen has already moved on.
    await expect(sheet).toBeHidden()
    await expect(card).toContainText(chosen)
    /*
     * Usable, not merely uncovered. Another slot opens while the first write is
     * still in flight, which is the property that actually matters: a screen
     * that is visible but inert is the defect this release already fixed once.
     */
    await card.locator('.slot').nth(1).click()
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(sheet).toBeHidden()

    release!()
    await expect(card).toContainText(chosen)
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

/**
 * The two product decisions the compression pass states as requirements rather
 * than as polish (§52 and §53), end to end on the real engine.
 *
 * Both are about what Alex can SEE at the moment he is deciding. Neither is
 * provable from a unit test of a pure function — one is a query joining the
 * outfit's other slots, the other is a comparison against a snapshot written by
 * a previous run — so both are asserted through the screen.
 */
test.describe('changing one piece of an outfit', () => {
  test('shows what the replacement has to be worn with', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Paired'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)

    /*
     * The names of the OTHER garments, read off the card before the sheet is
     * opened — so the assertion is "the sheet shows what the screen behind it
     * showed", which is the actual complaint being fixed.
     */
    const names = (await card.locator('.slot-item').allTextContents()).map((t) => t.trim())
    expect(names.length, 'this outfit has too few garments to pair').toBeGreaterThan(1)

    await card.locator('.slot').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const paired = page.locator('.swap-paired')
    await expect(paired).toBeVisible()

    // Every other garment is named…
    for (const name of names.slice(1)) {
      await expect(paired).toContainText(name)
    }
    // …and the one on its way out is not, because it is not a constraint.
    await expect(paired).not.toContainText(names[0]!)
  })

  /*
   * §17 and §37. `Recommended` used to mean `eligible`, ordered alphabetically
   * — so the garment Pack Smart would actually have chosen sat wherever the
   * alphabet put it. The list is `rank`'s order now, which is the planner's
   * own, and `rank` breaks ties on item id.
   *
   * What is asserted is STABILITY rather than a fixed order. The order depends
   * on the wardrobe, so pinning it would be a test of the seed data; what must
   * never happen is the same slot producing two different orders, which is the
   * "random novelty" §36 rules out and the thing an unsorted query gives you.
   */
  test('offers the same recommendations in the same order every time', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Ranked'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    const suitable = page.locator('.swap-row:not(.is-unsuitable) .swap-name')

    /*
     * A slot that HAS recommendations, rather than the first one.
     *
     * Which slots come back with eligible candidates depends on the wardrobe
     * and the forecast — the outer slot on a dry mild trip frequently has none,
     * and asserting on it would be a test of the seed rather than of the order.
     */
    const slots = card.locator('.slot')
    let names: string[] = []
    let index = -1

    for (let i = 0; i < (await slots.count()); i += 1) {
      await slots.nth(i).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      /*
       * Wait for the wardrobe to arrive before counting.
       *
       * The sheet renders `Looking through your wardrobe…` first, so counting
       * on `dialog` alone counts an empty list every time — which is a race
       * that reports itself as "this slot has no recommendations".
       */
      await expect(page.locator('.swap-row').first()).toBeVisible()
      if ((await suitable.count()) > 1) {
        names = (await suitable.allTextContents()).map((t) => t.trim())
        index = i
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      if (index >= 0) break
    }

    expect(index, 'no slot on this outfit offered more than one recommendation').toBeGreaterThan(-1)

    await slots.nth(index).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('.swap-row').first()).toBeVisible()
    expect((await suitable.allTextContents()).map((t) => t.trim())).toEqual(names)
  })
})

test.describe('planning again', () => {
  /*
   * §26 and §36. Against an unchanged trip the control must not imply it will
   * invent alternatives, and pressing it must not produce different outfits —
   * determinism is a product feature here, not an implementation detail.
   */
  test('offers to refresh, not to update, when nothing about the trip changed', async ({
    page,
  }) => {
    await tripWithOutfits(page, ownedName('E2E Steady'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    await expect(page.getByRole('button', { name: 'Refresh suggestions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update outfits for changes' })).toHaveCount(0)
    // No supporting line, because there is nothing to support.
    await expect(page.locator('.outfit-replan-why')).toHaveCount(0)

    const before = await page.locator('.slot-item').allTextContents()

    await page.getByRole('button', { name: 'Refresh suggestions' }).click()
    await expect(page.getByRole('button', { name: 'Refresh suggestions' })).toBeEnabled()

    expect(await page.locator('.slot-item').allTextContents()).toEqual(before)
  })

  /*
   * §39. `Back to packing list` is navigation and `Refresh suggestions` mutates
   * the plan. They were two full-width bordered buttons stacked at the end of
   * the page, which is how somebody leaving the screen accidentally replans.
   */
  test('does not dress navigation up as a plan change', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Bottom'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    const back = page.getByRole('button', { name: 'Back to packing list' })
    const replan = page.getByRole('button', { name: 'Refresh suggestions' })

    const weight = (locator: typeof back) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el)
        return `${style.borderTopWidth}|${style.backgroundColor}`
      })

    expect(await weight(back)).not.toBe(await weight(replan))
  })
})
