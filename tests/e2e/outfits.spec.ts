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

/**
 * The visual facts this streamlining pass is accountable for.
 *
 * All three were defects a screenshot showed and no assertion caught: a footer
 * whose three controls sat at three different heights, a fixed left column
 * that made garment names wrap for no reason, and rows that stopped being one
 * tappable unit. Geometry, on the real engine, because that is what they are.
 */
test.describe('an outfit card reads as a list of clothes', () => {
  test('the footer is one row on one baseline, clear of its separator', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Footer'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    const footer = card.locator('.outfit-foot')
    await expect(footer).toBeVisible()

    const geometry = await footer.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const controls = Array.from(el.querySelectorAll('span, button')).filter((child) => {
        const rect = child.getBoundingClientRect()
        return rect.height > 0 && (child.textContent ?? '').trim().length > 0
      })
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        controls: controls.map((child) => {
          const rect = child.getBoundingClientRect()
          return {
            label: (child.textContent ?? '').trim(),
            centre: rect.top + rect.height / 2,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          }
        }),
      }
    })

    expect(geometry.controls.length, 'the footer has nothing in it').toBeGreaterThan(1)

    /*
     * One optical baseline. This is the defect: `Draft` and `Why?` were text
     * and `Approve` was a 44px outlined box, so the three sat at three
     * different centres and read as unrelated elements sharing a row.
     */
    const centres = geometry.controls.map((c) => c.centre)
    expect(
      Math.max(...centres) - Math.min(...centres),
      `footer controls are not on one centre line: ${JSON.stringify(geometry.controls)}`,
    ).toBeLessThanOrEqual(1)

    /*
     * Nothing protrudes. The separator is the footer's own top border, so a
     * control taller than the row would visibly cross it — which is exactly
     * what the outlined Approve did.
     */
    for (const control of geometry.controls) {
      expect(control.top, `${control.label} rises above the footer`).toBeGreaterThanOrEqual(
        geometry.top - 0.5,
      )
      expect(control.bottom, `${control.label} drops below the footer`).toBeLessThanOrEqual(
        geometry.bottom + 0.5,
      )
    }

    // And the row is still a comfortable target.
    expect(geometry.height).toBeGreaterThanOrEqual(44)
  })

  /*
   * §7, as amended by the colour-dot placement pass.
   *
   * The original rule was that a garment name is FLUSH with the outfit's own
   * title — one content inset for the whole card — because the role used to be a
   * fixed 56px column and the garment started a third of the way into the card.
   *
   * The colour dot now leads the garment, so the name is no longer flush: it is
   * indented by exactly the swatch column. That is an approved product change
   * and not a regression of §7, whose complaint was the SIZE of the old indent
   * and the wrapping it caused. What is asserted is what still matters — the
   * indent is small, identical on every row, and the name still takes the width
   * up to the chevron.
   */
  test('a garment name is indented only by its colour column, and takes the rest', async ({
    page,
  }) => {
    await tripWithOutfits(page, ownedName('E2E Rows'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    const measured = await card.evaluate((el) => {
      const heading = el.querySelector('.outfit-name')!
      const chevron = el.querySelector('.slot-chevron')!
      return {
        headingLeft: heading.getBoundingClientRect().left,
        chevronLeft: chevron.getBoundingClientRect().left,
        names: Array.from(el.querySelectorAll('.slot-item')).map((n) => ({
          left: n.getBoundingClientRect().left,
          right: n.getBoundingClientRect().right,
        })),
      }
    })

    expect(measured.names.length).toBeGreaterThan(0)
    const first = measured.names[0]!

    /*
     * A colour column, not the old role column. 32px covers the 20px reserved
     * for two overlapped dots plus the 8px that binds them to the text, and is
     * deliberately far below the 56px this rule was written against — so a
     * regression back toward a wide leading column still fails here.
     */
    const indent = first.left - measured.headingLeft
    expect(indent, 'the garment name is not indented at all').toBeGreaterThan(0)
    expect(indent, 'the leading column has grown back into a role column').toBeLessThanOrEqual(32)

    // Identical on every row, including rows whose colour has no honest swatch.
    for (const name of measured.names) {
      expect(Math.abs(name.left - first.left)).toBeLessThanOrEqual(1)
    }

    // And it never runs under the chevron.
    expect(first.right).toBeLessThanOrEqual(measured.chevronLeft + 1)
  })

  /*
   * §10. A chevron aligned to the garment's baseline jumped up the row whenever
   * a long name wrapped to two lines, which made a list of rows look assembled
   * by hand.
   */
  test('every chevron sits at the middle of its own row', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Chevrons'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    const offsets = await card.evaluate((el) =>
      Array.from(el.querySelectorAll('.slot')).map((row) => {
        const chevron = row.querySelector('.slot-chevron')!
        const rowBox = row.getBoundingClientRect()
        const mark = chevron.getBoundingClientRect()
        return (mark.top + mark.height / 2) - (rowBox.top + rowBox.height / 2)
      }),
    )

    expect(offsets.length).toBeGreaterThan(1)
    for (const offset of offsets) {
      expect(Math.abs(offset), 'a chevron is off the centre of its row').toBeLessThanOrEqual(1)
    }
  })

  /*
   * §34. The names in the seeded wardrobe are short enough to fit whatever the
   * layout does, so the guarantee is asserted against a name that cannot.
   */
  test('a very long garment name wraps instead of clipping or overlapping', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E LongName'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    await card.locator('.slot-item').first().evaluate((el) => {
      el.textContent = 'Deconstructed Waterproof Merino Overshirt With A Very Long Name'
    })

    const measured = await card.evaluate((el) => {
      const row = el.querySelector('.slot')!
      const name = el.querySelector('.slot-item')!
      const chevron = row.querySelector('.slot-chevron')!
      return {
        nameRight: name.getBoundingClientRect().right,
        chevronLeft: chevron.getBoundingClientRect().left,
        rowHeight: row.getBoundingClientRect().height,
        pageOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    // It grew rather than clipping…
    expect(measured.rowHeight).toBeGreaterThan(48)
    // …it never reached the chevron…
    expect(measured.nameRight).toBeLessThanOrEqual(measured.chevronLeft + 1)
    // …and it did not push the page sideways.
    expect(measured.pageOverflow).toBeLessThanOrEqual(0)
  })
})

/**
 * Colour, as a thing you can see rather than read (doc 03 §16).
 *
 * The claim these make is the one the feature lives or dies on: the swatches
 * cost no vertical space. Everything else about them is judged on screenshots;
 * the height is arithmetic, so it is asserted.
 */
test.describe('colour on an outfit row', () => {
  test('costs the row no height at all', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Swatch'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    await expect(card.locator('.color-dots').first()).toBeVisible()

    const heights = await card.evaluate((el) => {
      const rows = Array.from(el.querySelectorAll('.slot'))
      return rows.map((row) => ({
        height: row.getBoundingClientRect().height,
        hasDot: row.querySelector('.color-dots') !== null,
      }))
    })

    const withDot = heights.filter((row) => row.hasDot).map((row) => row.height)
    const without = heights.filter((row) => !row.hasDot).map((row) => row.height)

    expect(withDot.length, 'no row on this outfit rendered a colour').toBeGreaterThan(0)

    /*
     * A dot is 12px inside a 49px row, so it can only add height by forcing a
     * wrap — which is what a swatch placed after the metadata text would do.
     * Comparing against the rows that have no colour is the direct test of
     * that: if the dot costs anything, the two sets differ.
     */
    if (without.length > 0) {
      expect(Math.max(...withDot)).toBeLessThanOrEqual(Math.max(...without) + 0.5)
    }
    for (const height of withDot) {
      expect(height, 'a row with a colour is taller than a plain one').toBeLessThanOrEqual(56)
    }
  })

  /*
   * The dots are a second rendering of a fact the row already states in words,
   * so they must be silent — announcing "Navy" twice per row is how a screen
   * reader becomes unusable on a screen that looks fine.
   */
  test('is silent to a screen reader, because the row already says it', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E SwatchA11y'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    const dots = card.locator('.color-dots').first()
    await expect(dots).toBeVisible()
    await expect(dots).toHaveAttribute('aria-hidden', 'true')

    // And the colour name is still there in the text, which is the actual
    // information — the dot may never be the only source of it.
    const meta = await card.locator('.slot-meta').first().textContent()
    expect((meta ?? '').trim().length).toBeGreaterThan(0)
  })

  /*
   * Unknown is allowed. Eleven of the wardrobe's colour strings are not
   * colours, and those rows must render normally rather than with a placeholder
   * implying a colour nobody recorded.
   */
  test('renders nothing at all where the colour is not one', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E SwatchUnknown'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    const counts = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.slot'))
      return {
        rows: rows.length,
        withDots: rows.filter((row) => row.querySelector('.color-dots')).length,
      }
    })

    // Both states have to occur, or this proves nothing about either.
    expect(counts.rows).toBeGreaterThan(0)
    expect(counts.withDots).toBeGreaterThan(0)
    expect(counts.withDots).toBeLessThan(counts.rows)
  })

  /*
   * The paired block in the swap sheet IS the current outfit's palette — §10
   * asks for exactly this rather than a separate `Current outfit colors` module
   * saying the same thing a second time.
   */
  test('shows the outfit’s palette on the rows that already name it', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E SwatchSheet'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)
    await card.locator('.slot').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('.swap-row').first()).toBeVisible()

    // The palette is on the paired rows themselves…
    expect(await page.locator('.swap-paired .color-dots').count()).toBeGreaterThan(0)
    // …and there is no separate module repeating it.
    expect(await page.locator('.swap-palette, .outfit-palette').count()).toBe(0)
    // Candidates carry their own colour, for the comparison.
    expect(await page.locator('.swap-row .color-dots').count()).toBeGreaterThan(0)
  })
})

/*
 * The green fill sits inside the footer rather than filling it, and the shape
 * is wide rather than tall.
 *
 * Sized to its label inside a 45px footer, `Approve` came out roughly as tall
 * as it was wide — a small green rectangle standing on end, which reads as a
 * fragment rather than as a control. What may NOT change is the target: the
 * button is still the footer's full height and the inset is painted rather
 * than laid out.
 */
test('the Approve fill is shorter than its target, and wider than it is tall', async ({ page }) => {
  await tripWithOutfits(page, ownedName('E2E ApproveFill'))
  await page.getByRole('button', { name: 'Plan Outfits' }).click()

  const card = await approvableCard(page)
  const approve = card.getByRole('button', { name: 'Approve', exact: true })
  await expect(approve).toBeVisible()

  const measured = await approve.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      height: el.getBoundingClientRect().height,
      width: el.getBoundingClientRect().width,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      clip: style.backgroundClip,
    }
  })

  // The target is untouched.
  expect(measured.height).toBeGreaterThanOrEqual(44)
  // The paint is inset from it on both edges, by the same amount.
  expect(measured.clip).toBe('content-box')
  expect(measured.paddingTop).toBeGreaterThanOrEqual(4)
  expect(measured.paddingTop).toBe(measured.paddingBottom)
  // …and the fill is meaningfully shorter than the row it sits in.
  const fill = measured.height - measured.paddingTop - measured.paddingBottom
  expect(fill).toBeLessThanOrEqual(measured.height - 8)

  /*
   * The proportion, which is the actual complaint. A button says "press me"
   * partly through its shape, and nothing at 80×45 does.
   */
  expect(measured.width / fill, 'Approve is still taller than it is wide').toBeGreaterThan(2.5)
  expect(measured.width).toBeGreaterThanOrEqual(96)
})

/**
 * The calm pass: less interface at the top, and a surface that says "done".
 */
test.describe('what the page says about progress', () => {
  /*
   * §4. `5 outfits · 0 of 6 needs covered` + `Review 5` was the screen telling
   * Alex to do something the cards below already make obvious — every draft
   * carries its own `Approve`. Removing it had to leave LESS interface, not
   * different interface, so this asserts nothing replaced it.
   */
  test('carries no review counter and nothing that replaced one', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E NoCounter'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    await expect(page.locator('.outfit-coverage-line')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Review \d+|Review the last/ })).toHaveCount(0)

    // And none of the things that would be a counter by another name.
    const body = (await page.locator('.screen-inner').textContent()) ?? ''
    expect(body).not.toMatch(/needs covered/)
    expect(body).not.toMatch(/\d+ of \d+ (outfits )?reviewed/)
    expect(body).not.toMatch(/\d+\/\d+ approved/)
    await expect(page.locator('progress, [role="progressbar"]')).toHaveCount(0)
  })

  /*
   * The counter went; the walkthrough did not.
   *
   * Removing `Review 5` removed the only route in the app to `outfits/review` —
   * nothing else navigates there — so an approved, deployed feature (doc 09 C2,
   * §7) became reachable only by typing the URL. The seven tests in
   * `outfit-review.spec.ts` all failed at their first click when that happened,
   * but each of them reads as a failure about the review screen rather than
   * about the door to it, so the guarantee is stated here too, where the door
   * actually lives.
   */
  test('still opens the walkthrough, without a count on the door', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Walkthrough'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    const door = page.getByRole('button', { name: 'Review one at a time' })
    await expect(door).toBeVisible()

    // Below the cards, not above them — an alternative offered after the list,
    // rather than an instruction competing with it.
    const lastCard = await page.locator('.outfit-card').last().boundingBox()
    const doorBox = await door.boundingBox()
    expect(doorBox!.y).toBeGreaterThan(lastCard!.y)

    await door.click()
    await expect(page.locator('.review-panel')).toBeVisible()
  })

  /* §5. The one unresolved state that a card genuinely cannot answer stays. */
  test('keeps the day-assignment row, which no card can answer', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Assign'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible()

    await expect(page.getByText('Days aren’t assigned')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Assign days' })).toBeVisible()
  })

  /*
   * §6. The point of the tint is answering "which of these still needs me?"
   * while scrolling, so what matters is that an approved card and a draft are
   * actually different — and that the draft is the plain one.
   */
  test('tints an approved card and leaves drafts plain', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Tint'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = await approvableCard(page)

    /*
     * PAINT the colour and read the pixel back, which is the only reliable way
     * to compare these two.
     *
     * A plain card computes to `rgb(255, 255, 255)` and a `color-mix()` one to
     * `color(srgb 0.94 0.96 0.95)` — the same colour in two serialisations on
     * two different scales, so subtracting the parsed numbers reported a
     * "distance" of 762 between two near-identical whites. Setting
     * `ctx.fillStyle` does not normalise the second form either; it passes it
     * straight through. One filled pixel and `getImageData` resolves anything
     * the browser accepts to plain 0–255 bytes.
     */
    const surfaceOf = () =>
      card.evaluate((el) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = getComputedStyle(el).backgroundColor
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return [r, g, b] as [number, number, number]
      })

    const draft = await surfaceOf()
    await approveOutfit(card)
    const approved = await surfaceOf()

    expect(approved, 'approving changed nothing about the card').not.toEqual(draft)

    /*
     * Faint, and asserted as faint. A strong green card is as wrong as no tint
     * at all — the requirement is that a finished outfit RECEDES.
     */
    const distance = draft.reduce((sum, value, i) => sum + Math.abs(value - approved[i]!), 0)

    expect(
      distance,
      `the tint is invisible (${draft.join(',')} → ${approved.join(',')})`,
    ).toBeGreaterThan(6)
    expect(
      distance,
      `the tint is a green card rather than a hint (${approved.join(',')})`,
    ).toBeLessThan(90)

    // Undo puts it back, so the surface can never outlive the state.
    await card.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(card).not.toHaveClass(/is-approved/)
    expect(await surfaceOf()).toEqual(draft)
  })
})

/*
 * §14. `Nice dinners · Smart casual to Formal` is one fact twice — the band
 * comes from the activity's own template. Hiding the label must not touch the
 * planner, which is the half worth asserting.
 */
test.describe('the swap sheet says only what earns its space', () => {
  test('does not repeat the formality the activity already implies', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E Formality'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    await expect(card).toBeVisible()
    await card.locator('.slot').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('.swap-row').first()).toBeVisible()

    const context = (await page.locator('.swap-context').textContent()) ?? ''
    expect(context).toContain('Nice dinners')
    expect(context, 'the formality band is repeated under its own activity').not.toMatch(
      /Smart casual to Formal/,
    )
  })

  /*
   * The regression guard §14 asks for, and the reason the change is safe:
   * formality is still a HARD filter, so a garment that is too casual for this
   * occasion is still refused — it is only the label that went.
   */
  test('still refuses a garment the formality rules out', async ({ page }) => {
    await tripWithOutfits(page, ownedName('E2E FormalityGuard'))
    await page.getByRole('button', { name: 'Plan Outfits' }).click()

    const card = page.locator('.outfit-card').filter({ hasText: 'Nice dinners' }).first()
    await card.locator('.slot').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('.swap-row').first()).toBeVisible()

    // Everything the wardrobe holds, so the unsuitable ones are on screen.
    await page.getByRole('radio', { name: 'All items' }).click()

    const refused = page.locator('.swap-row.is-unsuitable')
    expect(await refused.count(), 'nothing was refused at all').toBeGreaterThan(0)
    await expect(refused.locator('.swap-why').first()).not.toBeEmpty()
  })
})
