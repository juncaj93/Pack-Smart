import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, ownedName } from './fixtures'
import type { Page } from '@playwright/test'

const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'pack-smart-e2e-passphrase'

/**
 * Home says one thing to do next, and says why.
 *
 * Doc 09 §4 asks for one derived readiness state producing ONE recommended
 * action; §21 asks Home for one obvious action; §4.1 asks the summary screens
 * to stay calm. These assert the shape of that rather than its wording — the
 * label is derived from whatever state the featured trip happens to be in, and
 * a test that pinned the sentence would break every time the data moved without
 * telling anyone anything true.
 *
 * ## Why this file creates a trip it never names
 *
 * Home features the soonest live trip **on the database**, so no spec can own
 * the one it is looking at — that is a property of the screen, not a gap in the
 * fixtures. What it CAN own is whether there is one at all.
 *
 * Without that this file asserted on whatever some other spec had left behind,
 * and it read as passing right up until a run happened to leave the database
 * empty: `.home-primary` does not exist on the empty state, so four tests
 * failed with `Received: 0` and nothing about them said "no trips". Exactly the
 * class doc 09 §5a is about. The trip below guarantees a featured card exists;
 * every assertion here is about the shape of the screen around it.
 */

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Passphrase').fill(PASSPHRASE)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

test.describe('the recommended next action', () => {
  let featured: { id: string } | null = null

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    featured = await createTrip(page, { owner: 'Readiness' })
    await page.goto('/')
    // The card, not just the frame: since P1c Home paints the trip a round trip
    // before its readiness, and every assertion here is about the readiness.
    await expect(page.locator('.home-countdown:not(:empty)')).toBeVisible()
  })

  test.afterEach(async ({ page }) => {
    if (featured) await deleteTrip(page, featured.id)
    featured = null
  })

  test('is exactly one, and it explains itself', async ({ page }) => {
    const primary = page.locator('.home-primary')
    await expect(primary).toHaveCount(1)

    const label = (await primary.textContent())?.trim() ?? ''
    expect(label.length).toBeGreaterThan(0)

    // The reason sits under the button rather than inside it, and there is one
    // of it. Two would mean a stale render survived a restructure — which is
    // exactly what happened once, and was invisible until a screenshot showed
    // the second one printed behind the button.
    await expect(page.locator('.home-why')).toHaveCount(1)
  })

  test('does not wrap to a second line at the narrowest supported width', async ({ page }) => {
    /*
     * A primary action that wraps does not read as one action, which is the
     * whole point of having only one. This is why the button is full-width:
     * "Build the packing list" and "Pack the essentials" both wrapped inside
     * the half-width button that used to be here.
     */
    await page.setViewportSize({ width: 360, height: 664 })
    await page.reload()

    const primary = page.locator('.home-primary')
    await expect(primary).toBeVisible()

    const lines = await primary.evaluate((el) => {
      const style = getComputedStyle(el)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const inner = el.getBoundingClientRect().height
        - Number.parseFloat(style.paddingTop)
        - Number.parseFloat(style.paddingBottom)
      return Number.isFinite(lineHeight) && lineHeight > 0 ? Math.round(inner / lineHeight) : 1
    })
    expect(lines, 'the recommended action wraps at 360px').toBeLessThanOrEqual(1)
  })

  test('leads somewhere other than the button beneath it', async ({ page }) => {
    // Two controls with one destination is VISUAL_ACCEPTANCE §2's competing
    // actions, and it is easy to reintroduce because the primary's destination
    // moves with the trip's state while the secondary's is written down.
    const primary = page.locator('.home-primary')
    const secondary = page.locator('.button-secondary').first()

    const primaryLabel = (await primary.textContent())?.trim()
    const secondaryLabel = (await secondary.textContent())?.trim()
    expect(primaryLabel).not.toBe(secondaryLabel)

    await primary.click()
    await expect(page).toHaveURL(/\/trips\//)
    const afterPrimary = page.url()

    await page.goBack()
    await expect(page.locator('.home-primary')).toBeVisible()
    await page.locator('.button-secondary').first().click()
    await expect(page).toHaveURL(/\/trips\//)
    expect(page.url(), 'both Home actions go to the same screen').not.toBe(afterPrimary)
  })

  test('Home and Trip Details say the same thing about one trip', async ({ page }) => {
    /*
     * Release B's acceptance criterion, and the reason the model exists: the
     * same trip must not show contradictory readiness across screens.
     *
     * Both surfaces render the headline from `readiness()` now, so this
     * compares the words themselves rather than trusting that two call sites
     * were wired the same way. Before the model they each derived their own,
     * and nothing would have noticed them drifting apart.
     */
    const headline = (await page.locator('.home-countdown').textContent())?.trim()
    expect(headline?.length).toBeGreaterThan(0)

    // Follow Home's own card to the trip it is featuring, so this is one trip
    // rather than two that happen to be in the same state.
    await page.locator('.home-card').click()
    await expect(page).toHaveURL(/\/trips\//)

    const onTrip = page.locator('.trip-summary-state')
    if (await onTrip.count()) {
      await expect(onTrip).toHaveText(headline!)
    } else {
      // The card leads to Today once the trip is underway; the trip screen is
      // then one tap further on, and the claim is the same.
      await page.goBack()
      await page.getByRole('button', { name: 'Packing list' }).click()
      await expect(page.locator('.trip-summary-state')).toHaveText(headline!)
    }
  })

  test('Home carries no alarm panel', async ({ page }) => {
    /*
     * Doc 09 §4.1: Home stays calm — readiness, progress, next action,
     * departure timing. No essentials logic is removed by this; the packing
     * list itself still leads with them, because that is the screen where
     * acting on them is one tap away.
     */
    await expect(page.locator('.banner-alert')).toHaveCount(0)
  })
})

/**
 * A trip nobody has started packing is not a trip with a problem.
 *
 * Doc 09 §0q. The trip screen used to open with "10 essentials still to pack —
 * Bite Guard, Deodorant and Glasses, and 7 more.", naming rows that sit a short
 * scroll below in Pack Now, sorted to the top of it for being essentials. The
 * first screenful of an iPhone went to restating the reason Alex opened the app.
 *
 * These run against a freshly generated checklist — every row unpacked, several
 * of them essentials — which is exactly the state that produced the panel.
 */
test.describe('the trip screen with nothing packed yet', () => {
  let trip: { id: string } | null = null

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    trip = await createTrip(page, { owner: 'NoAlarm' })
    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('.trip-summary-progress')).toBeVisible()
  })

  test.afterEach(async ({ page }) => {
    if (trip) await deleteTrip(page, trip.id)
    trip = null
  })

  test('does not count the unpacked rows at Alex, in any wording', async ({ page }) => {
    // The removed sentence, and the two rewordings it would come back as — the
    // ruling is about the shape, so pinning one literal string would not hold it.
    await expect(page.getByText(/still to pack/i)).toHaveCount(0)
    await expect(page.getByText(/\d+\s+(things?|essentials?)\s+(left|still|to pack)/i)).toHaveCount(0)
    await expect(page.getByText(/\d+\s+essentials?\b/i)).toHaveCount(0)
  })

  test('still leads the list with the essentials it stopped shouting about', async ({ page }) => {
    /*
     * The other half of the ruling, and the reason this is not simply "delete the
     * feature": the intelligence stays, and it stays where it is actionable. The
     * rows carry the Essential tag, and `orderRank` floats unpacked essentials
     * above everything ordinary.
     */
    await expect(page.locator('.check-critical').first()).toBeVisible()

    const progress = (await page.locator('.trip-summary-progress').textContent())?.trim() ?? ''
    expect(progress, 'the progress line is what reports packing, and it stayed')
      .toMatch(/of \d+ packed/)
  })
})

/**
 * One unanswered question, asked where it changes something.
 *
 * Doc 09 §5 asks for one concise question at a time, deferrable without
 * blocking. These assert all three of those properties against a trip created
 * with the question deliberately left unanswered — `trips.spec.ts` already
 * proves the trip sheet can leave one unanswered, so this is what happens next.
 */
test.describe('an unresolved question', () => {
  test('is asked one at a time, and never blocks the list', async ({ page }) => {
    await signIn(page)

    // A trip that has not said whether it is international, far enough out that
    // the question is still worth asking.
    const trip = await page.evaluate(async (name) => {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          startDate: '2027-06-01',
          endDate: '2027-06-08',
          destinations: [{ name: 'Lisbon', country: 'Portugal' }],
          activities: [],
        }),
      })
      return (await response.json()) as { trip: { id: string } }
    }, ownedName('E2E Question'))

    await page.goto(`/trips/${trip.trip.id}`)

    const card = page.locator('.trip-question')
    await expect(card).toBeVisible()

    // ONE, not a form of three.
    await expect(card).toHaveCount(1)

    // It says what the answer changes, rather than that it helps.
    await expect(card.locator('.trip-question-why')).not.toHaveText(/improve|better|smarter/i)

    // The packing list is usable underneath it the whole time — that is what
    // "does not block" means, and it is the half easiest to lose.
    await expect(page.locator('.checklist').first()).toBeVisible()

    // Deferring moves on rather than dismissing everything.
    const first = (await card.locator('.trip-question-text').textContent())?.trim()
    await card.getByRole('button', { name: 'Not now' }).click()
    const second = (await card.locator('.trip-question-text').textContent())?.trim()
    expect(second).not.toBe(first)

    /*
     * Answering writes through, and the question does not come back.
     *
     * The second question is the flight one, which asks for a number rather
     * than a yes or a no — the two controls are different on purpose, and
     * assuming otherwise is how this test failed first time out.
     */
    await card.locator('input').fill('9')
    await card.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.trip-question-text')).not.toHaveText(second!)
  })
})
