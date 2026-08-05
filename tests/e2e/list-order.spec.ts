import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Completed items move to the bottom, and not a moment before (doc 09 §4.2).
 *
 * The ordering itself is arithmetic and is proved in
 * `tests/unit/checklist-order.test.ts`. What can only be proved here is the
 * **settle**: that a row Alex has just tapped stays where his thumb left it, and
 * that a run of adjacent items checked quickly reorders **once**, at the end,
 * rather than four times underneath him.
 *
 * A real browser rather than a DOM test because the thing under test is timing
 * against real renders, and a fake clock would prove the timer and not the list.
 */

let trip: TripFixture

test.beforeEach(async ({ page }) => {
  await signIn(page)
  trip = await createTrip(page, { owner: 'List order' })
  await page.goto(`/trips/${trip.id}`)
  await expect(page.locator('.swipe-row').first()).toBeVisible()
})

test.afterEach(async ({ page }) => {
  await deleteTrip(page, trip.id)
})

/**
 * The `Pack now` section's rows, top to bottom, by id.
 *
 * Ids rather than names on purpose. The visible name carries the "· Essential"
 * marker, which is suppressed when every row in a section has it — so comparing
 * names compares the marker as well as the order, and the first version of this
 * file failed on a middot.
 *
 * Named explicitly rather than `.first()` because packing something that needs a
 * final check makes the **Final check** section appear, and "the first section"
 * is not a stable way to say "the one I was reading".
 */
async function order(page: Page): Promise<string[]> {
  const section = page.locator('.checklist-section', { hasText: 'Pack now' }).first()
  return section.locator('.swipe-row .check-name').evaluateAll((nodes) =>
    nodes.map((node) => node.id.replace(/^check-name-pack_now-/, '')),
  )
}

/** The subset of `ids` still present, in the order they now appear. */
const stillIn = (current: string[], ids: string[]) => current.filter((id) => ids.includes(id))

/**
 * Toggles a row's packed state by name.
 *
 * Through the checkbox rather than the swipe: the gesture has its own suite, and
 * what is under test here is what happens to the ORDER afterwards, which is the
 * same either way.
 */
async function toggleById(page: Page, id: string): Promise<void> {
  const row = page.locator(`.swipe-row:has(#check-name-pack_now-${id})`).first()
  await row.scrollIntoViewIfNeeded()
  await row.locator('.check-main').first().click()
}

test.describe('a row that has just been packed', () => {
  test('stays exactly where it was while the list is still being worked', async ({ page }) => {
    const before = await order(page)
    test.skip(before.length < 3, 'needs a few rows to have an order at all')

    const target = before[0]!
    await toggleById(page, target)

    /*
     * Immediately after the tap — no wait — the row has NOT moved. This is the
     * whole requirement: reordering here is what makes the next row jump under
     * a thumb already on its way down.
     */
    expect(stillIn(await order(page), before)).toEqual(before)
  })

  test('sinks once the tapping stops', async ({ page }) => {
    const before = await order(page)
    test.skip(before.length < 3, 'needs a few rows to have an order at all')

    const target = before[0]!
    await toggleById(page, target)

    // Settles on its own, without another interaction.
    await expect
      .poll(async () => (await order(page))[0], { timeout: 5000 })
      .not.toBe(target)

    // And it is at the bottom of its section rather than somewhere arbitrary.
    const after = stillIn(await order(page), before)
    expect(after[after.length - 1]).toBe(target)
  })

  /*
   * The case §4.2 singles out: several adjacent items checked quickly. The list
   * must reorder ONCE, at the end — so at no point during the run does a row
   * Alex is about to tap move out from under him.
   */
  test('does not shuffle while several adjacent items are checked quickly', async ({ page }) => {
    const before = await order(page)
    test.skip(before.length < 4, 'needs four rows to check a run')

    const run = before.slice(0, 3)

    for (const id of run) {
      await toggleById(page, id)
      // The order is unchanged after every single tap in the run.
      expect(stillIn(await order(page), before), `after packing ${id}`).toEqual(before)
    }

    // And then, once, at the end — all three at the bottom, in their own order.
    await expect
      .poll(async () => stillIn(await order(page), before).slice(-3), { timeout: 5000 })
      .toEqual(run)
  })

  test('comes back to where it was when the packing is undone', async ({ page }) => {
    const before = await order(page)
    test.skip(before.length < 3, 'needs a few rows to have an order at all')

    const target = before[0]!
    await toggleById(page, target)
    await expect.poll(async () => (await order(page))[0], { timeout: 5000 }).not.toBe(target)

    await toggleById(page, target)
    await expect.poll(async () => (await order(page))[0], { timeout: 5000 }).toBe(target)
    expect(stillIn(await order(page), before)).toEqual(before)
  })
})

/**
 * The rows of `Pack now` as `(band, category)` pairs, top to bottom.
 *
 * The band is whether the row is an essential, because `orderRank` puts
 * unpacked essentials in a band of their own **above** everything else — and the
 * category rank sorts *inside* a band, never across one. Reading the section as
 * one flat list would make correct output look wrong: the categories restart at
 * the band boundary, and they are supposed to.
 *
 * The emoji is the category. `CATEGORY_EMOJI` maps one to one and it is the only
 * category marker a row renders.
 */
async function bandedCategories(page: Page): Promise<Array<[boolean, string]>> {
  return page
    .locator('.checklist-section', { hasText: 'Pack now' })
    .first()
    .locator('.swipe-row')
    .evaluateAll((rows) =>
      rows.map((row): [boolean, string] => [
        row.querySelector('.check-critical') !== null,
        row.querySelector('.check-emoji')?.textContent ?? '',
      ]),
    )
}

test.describe('the order the bag fills in', () => {
  /**
   * G4's category order, on a real list rather than in the arithmetic.
   *
   * `checklist-order.test.ts` proves the comparator. What only a browser can
   * prove is that the comparator is the one the screen actually renders with —
   * `applyOrder` sits between them, and a snapshot taken before the rank existed
   * would go on showing the old order indefinitely.
   */
  test('puts the documents and the pills above the clothes', async ({ page }) => {
    const reachFirst = ['📄', '💊', '👓', '🔌']
    const clothing = ['🧥', '👖', '👟', '🧦']

    for (const band of [true, false]) {
      const categories = (await bandedCategories(page))
        .filter(([essential]) => essential === band)
        .map(([, category]) => category)

      const lastReachable = categories.map((c) => reachFirst.includes(c)).lastIndexOf(true)
      const firstClothing = categories.map((c) => clothing.includes(c)).indexOf(true)
      if (lastReachable === -1 || firstClothing === -1) continue

      expect(firstClothing, categories.join(' ')).toBeGreaterThan(lastReachable)
    }
  })

  test('groups a category into one run inside its band', async ({ page }) => {
    const rows = await bandedCategories(page)

    /*
     * Per band, and that is not a loophole — it is the rule.
     *
     * An unpacked essential outranks everything ordinary (`orderRank` 0 against
     * 1), so the categories legitimately restart once, at the boundary. What
     * must never happen is a category being left and returned to *within* one
     * band, which is what a missing or badly-placed rank produces.
     */
    for (const band of [true, false]) {
      const categories = rows
        .filter(([essential]) => essential === band)
        .map(([, category]) => category)
        .filter(Boolean)

      const seen = new Set<string>()
      let previous = ''
      for (const category of categories) {
        if (category === previous) continue
        expect(seen.has(category), `${category} twice in ${categories.join(' ')}`).toBe(false)
        seen.add(category)
        previous = category
      }
    }
  })

  test('keeps the essentials above everything, whatever their category', async ({ page }) => {
    // The band boundary itself: category grouping may reorder inside a band and
    // must never lift an ordinary row over an essential to do it.
    const bands = (await bandedCategories(page)).map(([essential]) => essential)
    const lastEssential = bands.lastIndexOf(true)
    const firstOrdinary = bands.indexOf(false)
    if (lastEssential !== -1 && firstOrdinary !== -1) {
      expect(firstOrdinary).toBeGreaterThan(lastEssential)
    }
  })
})

test.describe('the order under a filter', () => {
  /*
   * Every filter has to be correct, not only Everything — §4.2 names them. The
   * cheap way to be wrong here is to sort the whole list once and then filter,
   * which leaves a filtered view in the order of a list it is not showing.
   */
  test('is right under every filter, not only Everything', async ({ page }) => {
    const filter = page.getByRole('combobox')

    // G4 replaced `Packed` and `Essentials` with the bag filters; the trap is
    // the same either way — sorting the whole list once and then filtering
    // leaves a filtered view in the order of a list it is not showing.
    for (const label of ['Still to pack', 'Personal bag', 'Checked bag']) {
      await filter.selectOption({ label })

      const rows = page.locator('.checklist-section').first().locator('.swipe-row')
      const count = await rows.count()
      if (count === 0) continue

      // Whatever is shown, anything packed is below anything unpacked.
      const packedFlags: boolean[] = []
      for (let i = 0; i < count; i += 1) {
        const box = rows.nth(i).locator('.check-box').first()
        packedFlags.push(((await box.getAttribute('class')) ?? '').includes('is-on'))
      }

      const firstPacked = packedFlags.indexOf(true)
      const lastUnpacked = packedFlags.lastIndexOf(false)
      if (firstPacked !== -1 && lastUnpacked !== -1) {
        expect(firstPacked, `under ${label}`).toBeGreaterThan(lastUnpacked)
      }
    }
  })
})
