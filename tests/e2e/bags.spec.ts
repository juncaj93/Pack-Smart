import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Which bag each thing goes in, on the browser the product ships on (doc 09 §11).
 *
 * The rules and the preservation are proved against real SQL in
 * `tests/integration/bags.test.ts`. What only a browser can prove is the part
 * Alex touches: that the control is reachable, that it is a radio group a screen
 * reader can operate, that a choice survives a reload, and that the bag filters
 * work alongside search and the packing-state filters rather than instead of
 * them.
 */

let trip: TripFixture

test.beforeEach(async ({ page }) => {
  await signIn(page)
  trip = await createTrip(page, { owner: 'Bags' })
  await page.goto(`/trips/${trip.id}`)
  await expect(page.locator('.swipe-row').first()).toBeVisible()
})

test.afterEach(async ({ page }) => {
  await deleteTrip(page, trip.id)
})

/** Opens the ⋯ sheet for the first row in Pack now, and returns its name. */
async function openFirstRow(page: Page): Promise<string> {
  const section = page.locator('.checklist-section', { hasText: 'Pack now' }).first()
  const row = section.locator('.swipe-row').first()
  await row.scrollIntoViewIfNeeded()

  const name = ((await row.locator('.check-name').first().textContent()) ?? '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*·\s*,?\s*Essential\s*$/u, '')
    .trim()

  await row.getByRole('button', { name: /^Options for/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  return name
}

test.describe('assigning a bag', () => {
  test('is a named radio group with five choices, reachable from the row', async ({ page }) => {
    await openFirstRow(page)

    const group = page.getByRole('radiogroup', { name: 'Which bag' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('radio')).toHaveCount(5)

    // Every one is a real target for a thumb (doc 02: 44px minimum).
    for (const radio of await group.getByRole('radio').all()) {
      const box = await radio.boundingBox()
      expect(box!.height, (await radio.textContent()) ?? '').toBeGreaterThanOrEqual(44)
    }
  })

  test('sticks, shows on the row, and survives a reload', async ({ page }) => {
    const name = await openFirstRow(page)

    await page.getByRole('radio', { name: 'Checked bag' }).click()
    await expect(page.getByRole('radio', { name: 'Checked bag' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await page.getByRole('button', { name: 'Done' }).click()

    // On the row, in the secondary line, without opening anything.
    const row = page.locator('.swipe-row', { hasText: name }).first()
    await expect(row).toContainText('Checked')

    await page.reload()
    await expect(page.locator('.swipe-row', { hasText: name }).first()).toContainText('Checked')
  })

  test('can be reassigned, and handed back to the suggestion', async ({ page }) => {
    await openFirstRow(page)

    await page.getByRole('radio', { name: 'Checked bag' }).click()
    await expect(page.getByRole('radio', { name: 'Checked bag' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await page.getByRole('radio', { name: 'Carry-on' }).click()
    await expect(page.getByRole('radio', { name: 'Carry-on' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByRole('radio', { name: 'Checked bag' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    // And the way back exists, because a choice must be undoable.
    await expect(page.getByRole('button', { name: /Use what Pack Smart suggests/i })).toBeVisible()
  })

  /*
   * §11: a recommendation and a choice must be told apart. A highlighted chip
   * alone cannot say which, so the sentence beside it is part of the feature.
   */
  test('says when the answer is only a suggestion, and why', async ({ page }) => {
    // Medication is one of the categories Pack Smart keeps within reach.
    const sheet = page.getByRole('dialog')
    const row = page.locator('.swipe-row', { hasText: 'Synthroid' }).first()

    if ((await row.count()) === 0) test.skip(true, 'this wardrobe has no medication row')

    await row.scrollIntoViewIfNeeded()
    await row.getByRole('button', { name: /^Options for/ }).click()
    await expect(sheet).toBeVisible()

    await expect(sheet.getByText(/Pack Smart suggests this/i)).toBeVisible()
    await expect(sheet.getByRole('radio', { name: 'Personal bag' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  /*
   * `Either cabin bag` is the one choice whose label cannot carry its own
   * meaning — it has to say WHICH two, and it has to read differently from a
   * row nobody has assigned.
   */
  test('says what Either means, and appears in both cabin bags', async ({ page }) => {
    const name = await openFirstRow(page)

    const either = page.getByRole('radio', { name: 'Either cabin bag' })
    await either.click()
    await expect(either).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/personal bag or the carry-on/i)).toBeVisible()

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('.swipe-row', { hasText: name }).first()).toContainText(
      'Either cabin bag',
    )

    const filter = page.getByRole('combobox')
    for (const label of ['Carry-on', 'Personal bag']) {
      await filter.selectOption({ label })
      await expect(page.locator('.swipe-row', { hasText: name }).first()).toBeVisible()
    }

    // And not in the hold, which is the whole point of the word.
    await filter.selectOption({ label: 'Checked bag' })
    await expect(page.locator('.swipe-row', { hasText: name })).toHaveCount(0)
  })
})

test.describe('the bag filters', () => {
  test('narrow the list to one bag, and clear again', async ({ page }) => {
    const name = await openFirstRow(page)
    await page.getByRole('radio', { name: 'Checked bag' }).click()
    await page.getByRole('button', { name: 'Done' }).click()

    const filter = page.getByRole('combobox')
    await filter.selectOption({ label: 'Checked bag' })
    await expect(page.locator('.swipe-row', { hasText: name }).first()).toBeVisible()

    await filter.selectOption({ label: 'Personal bag' })
    await expect(page.locator('.swipe-row', { hasText: name })).toHaveCount(0)

    await filter.selectOption({ label: 'Everything' })
    await expect(page.locator('.swipe-row', { hasText: name }).first()).toBeVisible()
  })

  test('work alongside search and the packing-state filters', async ({ page }) => {
    const name = await openFirstRow(page)
    await page.getByRole('radio', { name: 'Checked bag' }).click()
    await page.getByRole('button', { name: 'Done' }).click()

    const filter = page.getByRole('combobox')
    const search = page.getByPlaceholder('Search')

    // Bag AND search.
    await filter.selectOption({ label: 'Checked bag' })
    await search.fill(name.slice(0, 4))
    await expect(page.locator('.swipe-row', { hasText: name }).first()).toBeVisible()

    // A search that matches nothing in this bag empties it honestly.
    await search.fill('zzzznothing')
    await expect(page.locator('.swipe-row')).toHaveCount(0)
    await search.fill('')

    /*
     * And bag alongside packing state: pack the row, and it leaves
     * `Still to pack` while staying in its bag.
     */
    await filter.selectOption({ label: 'Everything' })
    const row = page.locator('.swipe-row', { hasText: name }).first()
    await row.scrollIntoViewIfNeeded()
    await row.locator('.check-main').first().click()

    await filter.selectOption({ label: 'Checked bag' })
    await expect(page.locator('.swipe-row', { hasText: name }).first()).toBeVisible()

    await filter.selectOption({ label: 'Still to pack' })
    await expect(page.locator('.swipe-row', { hasText: name })).toHaveCount(0)
  })
})
