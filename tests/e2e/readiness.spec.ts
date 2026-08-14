import { expect, test } from '@playwright/test'
import { createTrip, deleteTrip, liveDates, ownedName } from './fixtures'
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

/**
 * Home, showing a featured card that has finished working out its readiness.
 *
 * The card, not just the frame: since P1c Home paints the trip a round trip
 * before its readiness, and every assertion in this file is about the readiness.
 *
 * Reloaded rather than merely waited for, and that is the point. The header
 * above says no spec can own the trip Home features — it is the soonest live
 * trip on the DATABASE, and locally the suite runs several workers over one.
 * So the trip Home just fetched can be another spec's, and that spec can delete
 * it in its `afterEach` in the gap before the readiness call goes out. The
 * readiness call then 404s and `.home-countdown` stays empty for good, which
 * failed a `beforeEach` for a reason none of these tests is about.
 *
 * A reload re-reads both, and this spec's own trip is still there — so the
 * retry converges rather than spinning. Bounded anyway, so a genuinely empty
 * Home fails with the assertion rather than by timing out.
 *
 * None of this is reachable in CI, which runs `workers: 1`.
 */
async function openHomeWithAReadyCard(page: Page) {
  const ready = page.locator('.home-countdown:not(:empty)')
  for (let attempt = 1; attempt < 4; attempt += 1) {
    await page.goto('/')
    try {
      // `expect`, not `isVisible`. The latter does not wait — it answers about
      // the DOM as it stands, which straight after a `goto` is a page that has
      // not painted its readiness yet. Every attempt would have said no and the
      // reloads would have been racing the load rather than the other worker.
      await expect(ready).toBeVisible({ timeout: 4000 })
      return
    } catch {
      // The featured trip belonged to another worker and went away. Look again:
      // this spec's own trip is still there, so the retry converges.
    }
  }
  await page.goto('/')
  await expect(ready).toBeVisible()
}

test.describe('the recommended next action', () => {
  /*
   * One worker, in order — the only file in the suite that needs it.
   *
   * Everywhere else the ownership model is enough: a spec creates its own trip,
   * follows it by name, and deletes it. This file cannot, because what it
   * asserts about is the trip HOME CHOOSES, and Home chooses the soonest live
   * one on the whole database. Under `fullyParallel` several workers ran this
   * same file at once, each creating its own three-days-out trip and each
   * deleting one in its `afterEach` — so the card Home was featuring belonged
   * to another worker and vanished mid-test. Two of them are visible together
   * in the failure this replaced:
   *
   *     button "Readiness 94-53xe42  17 Aug – 21 Aug 2026 · 5 days"
   *     button "Readiness 91-qlnybb  17 Aug – 21 Aug 2026 · 5 days  3 days"
   *
   * with `.home-countdown` empty for good, because the readiness round trip for
   * the featured trip had 404ed. Serial makes this file the only writer of
   * three-days-out trips at any moment, which is the condition its premise
   * needs. CI never saw it — `workers: 1` there — so it failed only locally,
   * which is the worst place for a gate to be unreliable.
   */
  test.describe.configure({ mode: 'serial' })

  let featured: { id: string } | null = null

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    /*
     * Live dates, not the fixture's defaults.
     *
     * This file's whole premise is that Home has a featured trip to be ready
     * ABOUT — the note above says so: "what it CAN own is whether there is one
     * at all." It could not, because `createTrip`'s defaults are 31 Jul – 11
     * Aug 2026, and on 12 Aug 2026 that trip stopped being live. Home then
     * rendered its empty state, `.home-countdown` did not exist, and all five
     * tests here failed on the `beforeEach` for a reason none of them is about.
     *
     * Three days out, so the trip is upcoming rather than underway: Home sends
     * an underway trip's card to Today, which the last test in this file then
     * has to navigate back out of.
     */
    featured = await createTrip(page, { owner: 'Readiness', ...liveDates(3) })
    await openHomeWithAReadyCard(page)
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

    /*
     * The reason sits under the button rather than inside it, and there is at
     * most ONE of it. Two would mean a stale render survived a restructure —
     * which is exactly what happened once, and was invisible until a screenshot
     * showed the second one printed behind the button.
     *
     * At most rather than exactly, since §0q: the ordinary packing case has no
     * reason worth printing, because "Keep packing" was being explained by the
     * number it was derived from. The duplicate-render guard is what this test
     * is actually for and it is unaffected.
     */
    expect(await page.locator('.home-why').count()).toBeLessThanOrEqual(1)
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
    /*
     * `.home-alternate`, not `.button-secondary`.
     *
     * This control is the other door into the trip; which button TIER it wears
     * is a presentation decision and has already changed once — it became a
     * quiet text action when a bordered pill floating under the primary read as
     * disconnected. Selecting on the tier made this test fail for a reason it
     * is not about.
     */
    const secondary = page.locator('.home-alternate')

    const primaryLabel = (await primary.textContent())?.trim()
    const secondaryLabel = (await secondary.textContent())?.trim()
    expect(primaryLabel).not.toBe(secondaryLabel)

    await primary.click()
    await expect(page).toHaveURL(/\/trips\//)
    const afterPrimary = page.url()

    await page.goBack()
    await expect(page.locator('.home-primary')).toBeVisible()
    await page.locator('.home-alternate').click()
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
    /*
     * Read, follow, compare — and start again if the trip went away in between.
     *
     * The header of this file says no spec can own the trip Home is featuring:
     * it is the soonest live trip ON THE DATABASE, and locally the suite runs
     * several workers at once. So the trip Home was featuring a moment ago can
     * belong to another spec, and that spec can delete it in its `afterEach`
     * while this one is still walking to it. What that produced was
     *
     *     Could not load this trip
     *     Pack Smart could not reach the server.
     *
     * and a five-second wait for a `.trip-summary-state` that was never going
     * to exist — a failure whose message said nothing about what happened.
     * (Green in CI throughout, which runs `workers: 1`.)
     *
     * A vanished trip is the harness racing, not the product disagreeing with
     * itself, so it is retried rather than reported. The claim being tested is
     * untouched: one trip, one headline, both screens, compared exactly. If the
     * two screens genuinely disagree, every attempt fails on the comparison and
     * the last one is thrown.
     */
    for (let attempt = 1; ; attempt += 1) {
      const headline = (await page.locator('.home-countdown').textContent())?.trim()
      expect(headline?.length).toBeGreaterThan(0)

      // Follow Home's own card to the trip it is featuring, so this is one trip
      // rather than two that happen to be in the same state.
      await page.locator('.home-card').click()
      await expect(page).toHaveURL(/\/trips\//)

      /*
       * Which screen the card landed on is decided by the URL, not by counting
       * the DOM.
       *
       * `.trip-summary-state` was counted immediately after `toHaveURL`
       * resolved — and the trip screen paints a skeleton for its first frames,
       * so the count was 0 whether or not this was the trip screen. The test
       * then took the underway branch on a trip that was not underway, went
       * back, and hung for thirty seconds waiting for a button that was never
       * going to be there. A `count()` is a snapshot with no waiting in it; the
       * URL is the actual condition being tested, because Home sends an
       * underway trip's card to Today and every other trip's straight to the
       * list.
       */
      if (/\/today$/.test(new URL(page.url()).pathname)) {
        // The trip screen is one tap further on, and the claim is the same.
        await page.goBack()
        await page.getByRole('button', { name: 'Packing list' }).click()
      }

      const gone = await page
        .getByText('Could not load this trip')
        .isVisible()
        .catch(() => false)
      if (gone && attempt < 4) {
        await openHomeWithAReadyCard(page)
        continue
      }

      await expect(page.locator('.trip-summary-state')).toHaveText(headline!)
      return
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
    /*
     * The removed sentence and the rewordings it would come back as. The ruling
     * is about the SHAPE — a count of ordinary outstanding work, given standing
     * space — so pinning one literal string would not hold it.
     *
     * Every pattern here requires the COUNT. "Still to pack" on its own is the
     * filter chip below, which is a control Alex taps rather than something the
     * screen tells him, and the assertion after this one keeps it.
     */
    await expect(page.getByText(/\d+\s+\S+\s+still to pack/i)).toHaveCount(0)
    await expect(page.getByText(/\d+\s+(things?|essentials?)\s+(left|still|to pack)/i)).toHaveCount(0)
    await expect(page.getByText(/\d+\s+essentials?\b/i)).toHaveCount(0)
  })

  test('keeps the filter that answers the same question on demand', async ({ page }) => {
    /*
     * The distinction the ruling rests on. "10 essentials still to pack" was the
     * screen volunteering a count; `Still to pack` is Alex asking for one. The
     * second is why the first was redundant, so removing it too would be reading
     * the ruling as "never mention unpacked things".
     */
    const filter = page.getByLabel('Show')
    await expect(filter.locator('option', { hasText: 'Still to pack' })).toHaveCount(1)

    await filter.selectOption('unpacked')
    expect(await page.locator('.swipe-row').count()).toBeGreaterThan(0)
  })

  test('still leads the list with the essentials it stopped shouting about', async ({ page }) => {
    /*
     * The other half of the ruling, and the reason this is not simply "delete the
     * feature": the intelligence stays, and it stays where it is actionable. The
     * rows carry the Essential tag, and `orderRank` floats unpacked essentials
     * above everything ordinary.
     *
     * `toBeVisible()` once — which stopped being the right question when the
     * marker stopped being painted. The word is now clipped out of the page and
     * left in the accessible name, so what this asserts is that the rows still
     * CARRY it: `attached` rather than visible, which is exactly the claim the
     * comment above was making all along.
     */
    await expect(page.locator('.check-critical').first()).toBeAttached()

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
