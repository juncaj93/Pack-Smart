import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * C1 on the screen, against the built bundle in WebKit.
 *
 * `necessity-reasons.test.ts` proves every generated row HAS a reason.
 * This proves Alex can actually reach it — which is a different claim, and the
 * one that would have been missed by a slice that stopped at the engine.
 *
 * The accessibility half is the point of the last test. A reason that only
 * exists as visual secondary text is not an explanation for anyone using
 * VoiceOver, and `INTERACTION_PATTERNS.md` §1 does not carve out an exception
 * for text.
 */

/**
 * The worked example, owned by this file.
 *
 * These assertions are about the exact reasons a specific trip's rows carry —
 * "One per trip", "International trip", the `× 2` arithmetic. Reading them off
 * `trips[0]` meant reading them off whatever trip another spec last created,
 * with whatever activities and dates that spec happened to want. The dates and
 * activities here are the approved worked example, which is what those reasons
 * were measured against.
 */
let trip: TripFixture

test.beforeEach(async ({ page }) => {
  await signIn(page)
  trip = await createTrip(page, { owner: 'Reasons' })
})

test.afterEach(async ({ page }) => {
  if (trip) await deleteTrip(page, trip.id)
})

/**
 * Page text is data, not a pattern.
 *
 * An unescaped reason would work until the day one gained a parenthesis, and
 * then throw from the test harness rather than fail an assertion — which is the
 * kind of break nobody reads as a product problem.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function openChecklist(page: Page) {
  await page.goto(`/trips/${trip.id}`)
  await expect(page.locator('.check-row').first()).toBeVisible()
}

test.describe('why a row is on the list', () => {
  test('is one tap away for every row, through the same control as everything else', async ({
    page,
  }) => {
    await openChecklist(page)

    const row = page.locator('.swipe-row').first()
    const label = (await row.locator('.check-more').getAttribute('aria-label')) ?? ''
    const name = label.replace(/^Options for /, '').trim()

    await row.locator('.check-more').click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Why it is here')).toBeVisible()

    /*
     * Non-empty, and not the item's own name read back. A sheet that said
     * "Toothbrush" under "why it is here" would technically be filling the slot.
     */
    const reason = (await sheet.locator('.entry-why').last().innerText()).replace(
      /^Why it is here\s*/i,
      '',
    )
    expect(reason.trim().length).toBeGreaterThan(3)
    expect(reason.trim().toLowerCase()).not.toBe(name.toLowerCase())
  })

  test('never shows an internal identifier anywhere on the list', async ({ page }) => {
    /*
     * The guarantee asserted against what is actually painted, rather than
     * against the strings the engine returned. A row that leaked an id would be
     * visible here whatever the unit tests believed.
     */
    await openChecklist(page)

    const text = await page.locator('.checklist').first().innerText()
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
    expect(text).not.toMatch(/\b(fixed_per_trip|per_day|per_night|conditional_include|item_id|rule_id)\b/)
    expect(text).not.toContain('{')
  })

  test('names the row by the item, and carries the reason as a description', async ({ page }) => {
    /*
     * The first version of this test asserted that the button's `innerText`
     * contained its own child's text, which cannot fail — it would have passed
     * with the meta `aria-hidden`, and it passed while the accessible NAME was
     * eighty characters of prose. It is asserted against the real accessibility
     * tree now.
     *
     * The contract: the name says what activating the control does — the item —
     * and the reason is a DESCRIPTION, which comes after a pause and which the
     * rotor can mute. A name cannot be skipped, so an explanation welded into
     * one is an explanation Alex has to hear thirty-two times.
     */
    await openChecklist(page)

    const withReason = page
      .locator('.check-main')
      .filter({ has: page.locator('.check-meta') })
      .first()

    if ((await withReason.count()) === 0) test.skip(true, 'no row carries a secondary line')

    const row = withReason.locator('xpath=..')
    // The clean item name, from the ⋯ label rather than from the row's text —
    // `.check-name` also carries the category emoji, which is `aria-hidden` and
    // correctly absent from the accessible name.
    const item = ((await row.locator('.check-more').getAttribute('aria-label')) ?? '')
      .replace(/^Options for /, '')
      .trim()
    const meta = (await withReason.locator('.check-meta').innerText()).trim()

    // The name is the item. The explanation is NOT in it — that is the whole
    // fix, and asserting only "the name contains the item" would not catch a
    // regression back to the eighty-character version.
    await expect(withReason).toHaveAccessibleName(new RegExp(`^${escapeRegExp(item)}`))
    const name = (await withReason.evaluate((node) => node.getAttribute('aria-labelledby'))) ?? ''
    expect(name).toBeTruthy()
    await expect(withReason).not.toHaveAccessibleName(
      new RegExp(escapeRegExp(meta.split('·')[0]!.trim())),
    )

    // The explanation is reachable, as a description.
    const description = (await withReason.getAttribute('aria-describedby')) ?? ''
    expect(description).toBeTruthy()
    await expect(withReason).toHaveAccessibleDescription(
      new RegExp(escapeRegExp(meta.split('·')[0]!.trim())),
    )
  })

  test('gives every row its own ids, even where one row is in two sections', async ({ page }) => {
    /*
     * A row needing a final check is listed under its timing section AND under
     * Final check — `groupChecklist` does that on purpose, and the `<li>` key
     * has always accounted for it. The `aria-labelledby` ids added for the
     * description split did not, at first: keyed by entry alone they were
     * emitted twice, and an IDREF resolves to the FIRST in document order, so
     * the Final check row was named by the Pack-now copy. Visually identical,
     * and wrong for exactly the row where `section.allEssential` is meant to
     * suppress the "Essential" marker.
     *
     * `.first()` in the test above always picks the winning copy, so only this
     * assertion can see it.
     */
    await openChecklist(page)

    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.checklist [id]')).map((node) => node.id),
    )
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('separates the facts in the description with something that is spoken', async ({ page }) => {
    /*
     * `·` is not announced at VoiceOver's default punctuation level, so two
     * facts joined by it run together with no pause. The row shows a middot and
     * carries a visually-hidden comma beside it.
     */
    await openChecklist(page)

    /*
     * Selected on the INSERTED separator, not on the character.
     *
     * `hasText: '·'` was the old selector and it was subtly wrong in a way the
     * count had been hiding: `detail` is itself `Patagonia · Navy`, a single
     * fact that happens to contain a middot as literal text and correctly has
     * no spoken comma of its own. While the quantity shared this line every
     * such row also had a real second part, so the selector always landed on
     * one. With the count moved to the end of the row it would have matched a
     * one-part line and failed against correct markup.
     *
     * The `aria-hidden` middot span is emitted only BETWEEN parts, so it is the
     * thing that actually means "two facts".
     */
    const multiPart = page
      .locator('.check-meta')
      .filter({ has: page.locator('span[aria-hidden="true"]') })
      .first()
    if ((await multiPart.count()) === 0) test.skip(true, 'no row shows two facts')

    const spoken = await multiPart.evaluate((node) => node.textContent ?? '')
    expect(spoken).toContain(',')
  })
})
