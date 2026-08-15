import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createTrip, deleteTrip, liveDates, ownedName, signIn, type TripFixture } from './fixtures'

/**
 * What Home owes the user, from doc 02 §4.
 *
 * The screen had drifted to the featured trip and a single text link reading
 * "All trips · 4 more". That link was standing in for three separate things the
 * approved document asks for — upcoming trips, New Trip, and recent trips — which
 * is why more than half of a 390×844 viewport was empty below it. These assert the
 * sections exist and lead somewhere, so the next density pass cannot quietly
 * collapse them again.
 *
 * ## Why every test here now creates its own trips
 *
 * Three of these failed on WebKit in public CI, and they failed running ALONE,
 * which is what settles the diagnosis: this was never a product regression.
 *
 * `Home.tsx` derives `live` as the active, unfinished trips whose end date has
 * not passed, and renders an **empty state** when there are none. That empty
 * state is correct and deliberate — but its `Plan a Trip` NAVIGATES to `/trips`
 * instead of opening the sheet, and it has no `All trips` button at all. So on a
 * database with no live trip:
 *
 *   * "plans a trip without sending you to another screen first" clicked the
 *     empty state's button and waited for a dialog that was never going to open;
 *   * "lists the other upcoming trips" failed at the same first click;
 *   * "offers every trip" looked for an `All trips` button that the empty state
 *     does not render.
 *
 * The tests were reading a populated Home that **some other spec had left
 * behind**, and `teardown.ts` removing those trips is what exposed it. This is
 * the exact class `fixtures.ts` was written for: *isolation here is not a
 * database each, it is ownership*. This file was the one that never adopted it.
 *
 * So each test now creates the live trips it needs through the API and deletes
 * them afterwards. No test depends on another file, on alphabetical spec order,
 * or on what a previous run left in the database.
 *
 * ## What the assertions deliberately do NOT own
 *
 * Other specs create live trips too, and some of them start earlier than
 * anything created here, so they can share the `Also coming up` list. That is
 * fine and is not worth racing for: the assertions below are about the
 * **section** — that it lists named rows, that it is capped, that a row opens
 * the trip it names — and never about a specific foreign trip's contents. What
 * each test owns is the STATE IT REQUIRES: enough live trips to put Home in its
 * populated branch. Where a test's meaning genuinely needs its own trip to be
 * present, it asserts on that trip by name.
 */

/*
 * `liveDates` lives in `fixtures.ts` now.
 *
 * It was written here, for the reason recorded there, and then
 * `readiness.spec.ts` needed exactly the same thing and did not have it — so it
 * hard-coded a trip into the past and started failing the day those dates went
 * by. A helper two specs need is a fixture.
 */

/** Creates `count` live trips this test owns, soonest first. */
async function liveTrips(page: Page, owner: string, count: number): Promise<TripFixture[]> {
  const trips: TripFixture[] = []
  for (let i = 0; i < count; i += 1) {
    trips.push(await createTrip(page, { owner, ...liveDates(2 + i * 3) }))
  }
  return trips
}

/** Creates a trip through the sheet, from wherever the sheet is opened. */
async function fillTripSheet(page: Page, name: string, leaving: string, returning: string) {
  const sheet = page.getByRole('dialog')
  await expect(
    sheet,
    'The trip sheet did not open. On a database with no live trip Home renders its ' +
      'empty state, whose `Plan a Trip` navigates to /trips instead — so this test ' +
      'is missing the live trip it is supposed to create.',
  ).toBeVisible()
  await sheet.getByLabel('Trip name').fill(name)
  await sheet.getByLabel('Destination').fill('Lisbon')
  await sheet.getByLabel('Leaving').fill(leaving)
  await sheet.getByLabel('Returning').fill(returning)
  await sheet.getByRole('button', { name: 'Create trip' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/**
 * Loads Home fresh, after the trips this test owns already exist.
 *
 * `page.goto` rather than the Home nav link, and that is a correctness fix
 * rather than a preference. `signIn` lands on Home, which fetches and — on a
 * database with no live trip — paints and CACHES the empty state. Creating
 * trips through the API afterwards does not tell that mounted screen anything,
 * and clicking the Home link while already on Home does not remount it, so the
 * stale empty state stays on screen.
 *
 * The first draft used the nav link and three of four tests passed, purely
 * because their initial fetch happened to resolve after their trips existed.
 * That is a race, and it would have been the next flake in this file rather
 * than a fix for the last one.
 */
async function goHome(page: Page) {
  await page.goto('/')
  /*
   * The populated branch, which is what every test below is about.
   *
   * Waits on the featured trip card rather than on `All trips`. That button is
   * conditional now — it renders only when trips exist that Home is not showing
   * (§2), because on a database holding one trip it was a door onto the screen
   * Alex was already looking at. The card is the actual marker of the populated
   * branch and is not conditional on how many trips there are.
   */
  await expect(page.locator('.home-card')).toBeVisible()
}

test.describe('home', () => {
  /** Everything this file creates, torn down whether the test passed or not. */
  let owned: TripFixture[] = []

  test.beforeEach(async ({ page }) => {
    owned = []
    await signIn(page)
  })

  test.afterEach(async ({ page }) => {
    for (const trip of owned) await deleteTrip(page, trip.id)
    owned = []
  })

  test('plans a trip without sending you to another screen first', async ({ page }) => {
    // One live trip is the whole precondition: it is what makes Home render the
    // populated branch, whose `Plan a Trip` opens the sheet in place.
    owned = await liveTrips(page, 'Home sheet', 1)
    await goHome(page)

    const name = ownedName('Home sheet trip')
    await page.getByRole('button', { name: 'Plan a Trip' }).click()
    await fillTripSheet(page, name, ...Object.values(liveDates(40)) as [string, string])

    // Created through the sheet, so this file owns it too.
    const id = page.url().split('/trips/')[1]
    if (id) owned.push({ id, name })
  })

  test('lists the other upcoming trips, not just a count of them', async ({ page }) => {
    /*
     * Three live trips: one becomes the featured trip and the rest are
     * "another" one, so `others` — `live.slice(1, 4)` — cannot be empty.
     *
     * The assertions are about the SECTION rather than about these three names.
     * An earlier version looked for the trip it had just created and passed only
     * on a database that held little else; Home shows the three soonest, and a
     * trip in 2027 is nobody's next three once a few dozen trips exist. A test
     * that needs a nearly empty database is testing the database.
     */
    owned = await liveTrips(page, 'Home upcoming', 3)
    await goHome(page)

    await expect(page.getByRole('heading', { name: 'Also coming up' })).toBeVisible()

    const section = page.locator('.home-section').filter({ hasText: 'Also coming up' })
    const rows = section.locator('.trip-row')

    // Named trips, not a count — and capped, so the section stays context.
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(3)

    // And a row opens the trip it names, rather than being decoration.
    const first = rows.first()
    /*
     * The emoji is a separate span inside `.trip-name`, so `textContent` returns
     * "🦁E2E Past 1240" with no space while the trip heading renders "🦁 E2E Past
     * 1240" with one. Comparing the two directly fails on a product that is
     * behaving perfectly. Only the words are the identity here.
     */
    const named = ((await first.locator('.trip-name').textContent()) ?? '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim()
    expect(named.length).toBeGreaterThan(0)
    await first.click()
    await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(named)) })).toBeVisible()
  })

  test('offers every trip, once there are more than it shows', async ({ page }) => {
    /*
     * FIVE, because that is what the test's own name claims.
     *
     * `others` is `live.slice(1, 4)` — the featured trip plus three. Five live
     * trips means there is genuinely at least one Home is NOT showing, which is
     * the condition `All trips` exists to answer. With one trip the button still
     * renders and the test would pass without ever meeting its premise.
     */
    owned = await liveTrips(page, 'Home all', 5)
    await goHome(page)

    /*
     * The premise, asserted rather than assumed: Home is showing fewer trips
     * than this test owns.
     *
     * Without this the test passes on a single trip — `All trips` renders
     * whenever Home is populated — and "once there are more than it shows"
     * would be a claim the test never checks. Measured by mutation: dropping
     * to one owned trip left every assertion below green until this line
     * existed.
     */
    const shown = await page.locator('.home-section').filter({ hasText: 'Also coming up' })
      .locator('.trip-row').count()
    expect(shown + 1).toBeLessThan(owned.length)

    await page.getByRole('button', { name: 'All trips' }).click()
    await expect(page.getByRole('heading', { name: 'Trips', exact: true })).toBeVisible()

    // "Every trip" means this file's own trips are reachable there, including
    // the ones Home had no room for.
    for (const trip of owned) {
      await expect(page.getByText(trip.name, { exact: false })).toBeVisible()
    }
  })

  /**
   * The trip card is one object, not a card with a menu underneath it.
   *
   * `Keep packing` and `Outfits` used to sit OUTSIDE the card, separated from
   * the trip they act on by its own bottom margin — so the screen read as a
   * trip, then two loose buttons. Geometry rather than class names: a rule that
   * only checked the DOM would pass on a card whose border stopped above them.
   */
  test('keeps both frequent actions inside the trip card’s own border', async ({ page }) => {
    owned = await liveTrips(page, 'Home card', 1)
    await goHome(page)

    const box = await page.evaluate(() => {
      const card = document.querySelector('.home-trip')
      const primary = document.querySelector('.home-primary')
      const alternate = document.querySelector('.home-alternate')
      if (!card || !primary || !alternate) return null
      const rect = (el: Element) => el.getBoundingClientRect()
      return {
        card: rect(card),
        primary: rect(primary),
        alternate: rect(alternate),
        border: Number.parseFloat(getComputedStyle(card).borderTopWidth),
      }
    })

    expect(box, 'Home has no trip card, or no actions in it').not.toBeNull()
    expect(box!.border, 'the trip card draws no border to be inside of').toBeGreaterThanOrEqual(1)

    for (const [name, action] of [
      ['the recommendation', box!.primary],
      ['the other door', box!.alternate],
    ] as const) {
      expect(action.top, `${name} starts above the card`).toBeGreaterThanOrEqual(box!.card.top)
      expect(action.bottom, `${name} ends below the card`).toBeLessThanOrEqual(box!.card.bottom)
    }

    // Side by side, not stacked: they share a row (§15).
    expect(Math.abs(box!.primary.top - box!.alternate.top)).toBeLessThan(4)
  })

  /**
   * The infrequent actions, behind one control (§16).
   *
   * `Edit trip` is the reason the menu exists and the one trip action with no
   * other home on this screen — losing it would put editing a trip two screens
   * away from the card that shows it.
   */
  test('puts the infrequent trip actions behind the •••', async ({ page }) => {
    owned = await liveTrips(page, 'Home more', 1)
    await goHome(page)

    const more = page.getByRole('button', { name: 'More for this trip' })
    await expect(more).toBeVisible()

    // A real touch target, in the corner of the card.
    const box = await more.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)

    await more.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('button', { name: 'Edit trip' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Trip setup' })).toBeVisible()

    await sheet.getByRole('button', { name: 'Edit trip' }).click()

    // One sheet at a time — the menu closed before the editor opened.
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.getByRole('dialog').getByText('Edit trip')).toBeVisible()
  })

  /**
   * Home tells the user what day it is and what time it is, whatever state the
   * trip is in.
   *
   * The row's CONTENT for each trip lifecycle is asserted in
   * `tests/unit/dom/HomeStatus.test.tsx`, where the responses can be stated
   * exactly — Home features whichever live trip starts soonest, and this suite
   * shares one database. What is asserted here is that the row is really on the
   * screen, above the trip, and inside the chrome the visual harness measures.
   *
   * Nothing here asserts the WEATHER. Open-Meteo is unreachable from this
   * environment, so the forecast is absent in every run of this suite; a test
   * that required it would be a test that could only ever fail.
   */
  test('says what day and what time it is, above the trip', async ({ page }) => {
    owned = await liveTrips(page, 'Home status', 1)
    await goHome(page)

    const status = page.locator('.home-status')
    await expect(status).toBeVisible()
    await expect(status.locator('.home-status-date')).not.toBeEmpty()
    await expect(status.locator('.home-status-time')).toHaveText(/\d{1,2}:\d{2}/)

    const shape = await page.evaluate(() => {
      const row = document.querySelector('.home-status')!
      const head = document.querySelector('.screen-head')!
      const card = document.querySelector('.home-trip')!
      return {
        statusTop: row.getBoundingClientRect().top,
        cardTop: card.getBoundingClientRect().top,
        insideHead: head.contains(row),
      }
    })

    expect(shape.statusTop).toBeLessThan(shape.cardTop)
    /*
     * Inside `.screen-head`, which is not a style preference: `chromeHeight()`
     * in the visual harness measures to that element's bottom, so a row rendered
     * as a sibling would make the pixel ledger understate the screen it exists
     * to police.
     */
    expect(shape.insideHead, 'the status row is outside the measured chrome').toBe(true)
  })

  /**
   * The briefing is part of the trip card now, not a block above it.
   *
   * It used to sit on the page's own background, which made Home three things
   * stacked — a briefing, a trip, a list. Inside the card it is one thing: the
   * trip, and what it means today.
   */
  test('keeps today inside the trip card rather than above it', async ({ page }) => {
    owned = await liveTrips(page, 'Home brief', 1)
    await goHome(page)

    const nested = await page.evaluate(() => {
      const hero = document.querySelector('.hero')
      const card = document.querySelector('.home-trip')
      if (!card) return null
      // A trip with nothing to say about today renders no briefing at all,
      // which is correct and is not what this test is about.
      if (!hero) return 'absent'
      return card.contains(hero) ? 'inside' : 'outside'
    })

    expect(nested, 'Home has no trip card').not.toBeNull()
    expect(nested, 'the briefing is back outside the card').not.toBe('outside')

    // And it still draws no border of its own: a bordered block inside a
    // bordered card is rejected on sight.
    const border = await page.evaluate(() => {
      const hero = document.querySelector('.hero')
      return hero ? Number.parseFloat(getComputedStyle(hero).borderLeftWidth) : 0
    })
    expect(border, 'the briefing draws a box inside the card').toBe(0)
  })

  test('never says the same thing twice in one viewport', async ({ page }) => {
    /*
     * The card and the primary action pointed at the same screen with the same
     * seven words once the trip was underway. Whatever the card ends with, it may
     * not be the label of the button beneath it.
     *
     * Needs a live trip like the rest: the duplicate this guards against only
     * exists on the populated Home, so without one the test was passing by
     * inspecting an empty state that has nothing to duplicate.
     */
    owned = await liveTrips(page, 'Home labels', 1)
    await goHome(page)

    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()),
    )
    const actionable = labels.filter((label) => label.length > 0)
    const seen = new Set<string>()
    for (const label of actionable) {
      expect(seen.has(label), `two controls both labelled "${label}"`).toBe(false)
      seen.add(label)
    }
  })
})

/** A trip name carries an emoji and whatever Alex typed; neither is a safe pattern. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
