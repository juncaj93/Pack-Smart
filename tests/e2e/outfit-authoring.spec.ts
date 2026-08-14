import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { approvableCard, approveOutfit, createTrip, deleteTrip, signIn } from './fixtures'

/**
 * Alex authoring an outfit, in a browser (§18–§31, §49, §50).
 *
 * The rules themselves are proved against real SQL in
 * `tests/integration/manual-outfits.test.ts` — that a replan cannot delete a
 * manual outfit, that a name collision cannot merge two, that a two-piece
 * outfit is not incomplete. What only a browser can prove is that the flows
 * exist and land where they say they do: that `+ Add item` adds a garment
 * rather than replacing one, that `+ Add outfit` produces a card, and that an
 * approved card is visibly finished without becoming loud.
 */

/**
 * Opens the outfits screen for a trip with a real plan on it.
 *
 * `createTrip` generates the CHECKLIST, not the outfits: doc 04 §8 makes
 * approving an outfit what puts clothing on the list, so a trip arrives with no
 * plan and the screen offers `Plan Outfits`. Pressing it here rather than
 * assuming cards exist is what keeps a failure in this file about authoring
 * rather than about the planner.
 */
async function outfitsFor(page: Page, owner: string) {
  const trip = await createTrip(page, { owner })
  await page.goto(`/trips/${trip.id}/outfits`)

  const plan = page.getByRole('button', { name: 'Plan Outfits' })
  await expect(plan.or(page.locator('.outfit-card').first())).toBeVisible({ timeout: 20_000 })
  if (await plan.isVisible()) await plan.click()

  await expect(page.locator('.outfit-card').first()).toBeVisible({ timeout: 30_000 })
  return trip
}

test.describe('adding a garment to an outfit that already exists', () => {
  test('adds a slot rather than replacing one', async ({ page }) => {
    await signIn(page)
    const trip = await outfitsFor(page, 'OutfitAdd')

    try {
      const card = page.locator('.outfit-card').first()
      const before = await card.locator('.slot').count()
      const garments = await card.locator('.slot-item').allTextContents()

      await card.getByRole('button', { name: /^Add an item to / }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      // The sheet is for ADDING, so it has no `Current` — there is no slot for
      // anything to be current in (§20).
      await expect(sheet.getByText('Current', { exact: true })).toHaveCount(0)

      const first = sheet.locator('.stuff-picker-row').first()
      const added = ((await first.getAttribute('aria-label')) ?? '').split(',')[0]!.trim()
      await first.click()
      await expect(first).toContainText('Added')

      await page.getByRole('button', { name: 'Done' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      /*
       * §18, as one number and one list. The outfit has one more garment, and
       * every garment it had before is still in it — a replacement would give
       * the same count and a different list.
       */
      await expect(card.locator('.slot')).toHaveCount(before + 1)
      const after = await card.locator('.slot-item').allTextContents()
      for (const garment of garments) expect(after).toContain(garment)
      expect(after.some((text) => text.includes(added))).toBe(true)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('offers an undo that takes the garment back out', async ({ page }) => {
    await signIn(page)
    const trip = await outfitsFor(page, 'OutfitUndo')

    try {
      const card = page.locator('.outfit-card').first()
      const before = await card.locator('.slot').count()

      await card.getByRole('button', { name: /^Add an item to / }).click()
      await page.getByRole('dialog').locator('.stuff-picker-row').first().click()
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(card.locator('.slot')).toHaveCount(before + 1)

      /*
       * §43: Back is not Undo, and the undo bar is the product's one mechanism
       * for reversing something that has already happened. Dismissing the sheet
       * must not have undone anything, which the count above already proves.
       */
      await page.getByRole('button', { name: 'Undo' }).click()
      await expect(card.locator('.slot')).toHaveCount(before)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

test.describe('writing an outfit from scratch', () => {
  test('asks only what it is for, then takes the clothes', async ({ page }) => {
    await signIn(page)
    const trip = await outfitsFor(page, 'OutfitNew')

    try {
      const before = await page.locator('.outfit-card').count()

      await page.getByRole('button', { name: '+ Add outfit' }).click()
      const naming = page.getByRole('dialog')
      await expect(naming).toBeVisible()

      /*
       * §26: one question and a few words that save typing. None of the things
       * a planner group carries is asked for, and asserting their ABSENCE is
       * the assertion — a form that grew a formality picker would still pass a
       * test that only checked the name field.
       */
      await expect(naming.getByText('What is this outfit for?')).toBeVisible()
      for (const asked of [/formality/i, /weather/i, /which day/i, /how many times/i]) {
        await expect(naming.getByText(asked)).toHaveCount(0)
      }

      await naming.getByRole('button', { name: 'Lounging' }).click()
      await naming.getByRole('button', { name: 'Create outfit' }).click()

      /*
       * §27: the picker opens by itself, so adding the first garment is not a
       * second journey. Two sheets are never stacked — the naming sheet is gone
       * before this one arrives, which is what `toHaveCount(1)` says.
       */
      await expect(page.getByRole('dialog')).toHaveCount(1)
      await expect(page.getByRole('dialog').getByText('Add to Lounging')).toBeVisible()

      // One, then another, without reopening anything.
      const rows = page.getByRole('dialog').locator('.stuff-picker-row')
      await rows.nth(0).click()
      await expect(rows.nth(0)).toContainText('Added')
      await rows.nth(1).click()
      await expect(rows.nth(1)).toContainText('Added')

      await page.getByRole('button', { name: 'Done' }).click()

      const card = page.locator('.outfit-card').filter({ hasText: 'Lounging' }).first()
      await expect(page.locator('.outfit-card')).toHaveCount(before + 1)
      await expect(card.locator('.slot')).toHaveCount(2)

      /*
       * §28: two pieces, and the card is a draft rather than incomplete — so
       * `Approve` is offered. A planner template would have demanded shoes.
       */
      await expect(card).not.toHaveClass(/is-incomplete/)
      await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('survives a replan, garments and all', async ({ page }) => {
    await signIn(page)
    const trip = await outfitsFor(page, 'OutfitReplan')

    try {
      const name = 'Lounging'
      await page.getByRole('button', { name: '+ Add outfit' }).click()
      await page.getByRole('dialog').getByRole('button', { name: name }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Create outfit' }).click()

      const rows = page.getByRole('dialog').locator('.stuff-picker-row')
      const garment = ((await rows.first().getAttribute('aria-label')) ?? '').split(',')[0]!.trim()
      await rows.first().click()
      await expect(rows.first()).toContainText('Added')
      await page.getByRole('button', { name: 'Done' }).click()

      const card = page.locator('.outfit-card').filter({ hasText: name }).first()
      await expect(card.locator('.slot')).toHaveCount(1)

      /*
       * The whole point of §29, through the control that actually runs a
       * replan. The integration suite proves the SQL; this proves the button
       * Alex presses reaches it.
       */
      await page.getByRole('button', { name: /Refresh suggestions|Update outfits for changes/ }).click()
      await expect(page.getByRole('button', { name: 'Updating…' })).toHaveCount(0, {
        timeout: 20_000,
      })

      const after = page.locator('.outfit-card').filter({ hasText: name }).first()
      await expect(after).toBeVisible()
      await expect(after.locator('.slot-item')).toContainText(garment)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('can be removed, and a planner outfit cannot', async ({ page }) => {
    await signIn(page)
    const trip = await outfitsFor(page, 'OutfitRemove')

    try {
      const planner = page.locator('.outfit-card').first()
      await expect(planner.getByRole('button', { name: /^Remove / })).toHaveCount(0)

      await page.getByRole('button', { name: '+ Add outfit' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Workout' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Create outfit' }).click()
      await page.getByRole('button', { name: 'Done' }).click()

      const mine = page.locator('.outfit-card').filter({ hasText: 'Workout' }).first()
      await expect(mine).toBeVisible()

      /*
       * Only his own. A planner card has no Remove and must not: one deleted
       * would be back on the next replan looking like a bug, and un-approving
       * is how an approved one is undone.
       */
      await mine.getByRole('button', { name: 'Remove Workout' }).click()
      await expect(page.locator('.outfit-card').filter({ hasText: 'Workout' })).toHaveCount(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

test.describe('an approved outfit looks settled', () => {
  test('gains a green outline and a stronger tint, and stays the same size', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'OutfitApproved' })

    try {
      await page.goto(`/trips/${trip.id}/outfits`)
      const plan = page.getByRole('button', { name: 'Plan Outfits' })
      await expect(plan.or(page.locator('.outfit-card').first())).toBeVisible({ timeout: 20_000 })
      if (await plan.isVisible()) await plan.click()
      await expect(page.locator('.outfit-card').first()).toBeVisible({ timeout: 30_000 })

      const card = await approvableCard(page)
      const before = await card.evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          borderWidth: style.borderTopWidth,
          shadow: style.boxShadow,
        }
      })

      await approveOutfit(card)

      const after = await card.evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
          borderWidth: style.borderTopWidth,
          shadow: style.boxShadow,
        }
      })

      // §35: a draft is neutral and an approved card is not — both halves, so a
      // pass that tinted everything would fail rather than look finished.
      expect(after.background).not.toBe(before.background)
      expect(after.border, 'the approved card has no outline of its own').not.toBe(before.border)

      /*
       * §50: the border does not increase the card's size. `border-box` is what
       * makes that true, and asserting it is what would catch someone reaching
       * for an outline or a second border instead.
       */
      expect(after.borderWidth).toBe(before.borderWidth)
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1)

      // §33: restrained. No glow, no shadow, no success-card treatment.
      expect(after.shadow).toBe(before.shadow)

      /*
       * And it is still calm: the tint is a CAST rather than a fill, so the
       * card stays much closer to the page than the accent is. Measured as
       * distance from the draft's own background — an approved card that had
       * become a green panel would be many times further away than this.
       */
      /*
       * Robust to both formats a browser can hand back.
       *
       * A `color-mix()` computes to `color(srgb 0.94 0.96 0.95)` in Chromium
       * and to `rgb(240, 245, 244)` elsewhere, and a parser that assumed one
       * read `0.94` as the number 0 followed by the number 94 — which is how
       * two almost identical greens came out 918,686 apart. Channels are
       * normalised to 0–255 by their own magnitude rather than by the string's
       * shape, so neither format has to be recognised.
       */
      const distance = (a: string, b: string) => {
        const parse = (value: string) => {
          const channels = (value.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3)
          return channels.every((n) => n <= 1) ? channels.map((n) => n * 255) : channels
        }
        const [ar, ag, ab] = parse(a)
        const [br, bg, bb] = parse(b)
        return Math.abs(ar! - br!) + Math.abs(ag! - bg!) + Math.abs(ab! - bb!)
      }
      expect(
        distance(after.background, before.background),
        'the approved tint has become a filled panel',
      ).toBeLessThan(90)
      expect(
        distance(after.background, before.background),
        'the approved tint is not visible at all',
      ).toBeGreaterThan(4)

      // Undo returns it to neutral, which is the other half of §50.
      await card.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(card).not.toHaveClass(/is-approved/)
      const undone = await card.evaluate((node) => getComputedStyle(node).backgroundColor)
      expect(undone).toBe(before.background)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
