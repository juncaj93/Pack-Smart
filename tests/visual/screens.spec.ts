import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { assertFocusStaysInSheet, capture, collected, writeReport } from './gates'

/**
 * Walks every surface Pack Smart has, in the states worth reviewing, and produces
 * the evidence the visual review is judged on (`VISUAL_ACCEPTANCE.md`).
 *
 * This is not a correctness suite — `tests/e2e/` is. Nothing here asserts what a
 * screen says. It asserts the measurable rules, captures the images, and leaves
 * hierarchy and density to a reviewer looking at them.
 *
 * Serial and stateful on purpose: one seeded database, walked in order.
 */

interface SeededTrip {
  id: string
  name: string
  startDate: string
}

let trips: SeededTrip[] = []

/**
 * Every spec starts already signed in — globalSetup saved the session. This only
 * confirms the shell is up before anything is measured.
 */
async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

/** The seeded trips, read through the API the app itself uses. */
async function loadTrips(page: Page): Promise<SeededTrip[]> {
  if (trips.length > 0) return trips
  const result = await page.evaluate(() =>
    fetch('/api/trips').then((r) => r.json() as Promise<{ trips: SeededTrip[] }>),
  )
  trips = result.trips
  return trips
}

const tripNamed = (name: string) => {
  const trip = trips.find((t) => t.name === name)
  if (!trip) throw new Error(`visual: seeded trip "${name}" is missing`)
  return trip
}

/** Waits for the screen to have finished asking the server for things. */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(150)
}

/**
 * Shows Home and Trips the way a new user sees them, and reloads.
 *
 * `page.route` on its own produced two screenshots named `-empty` that were
 * pictures of the **populated** screen, and said nothing about it. Playwright does
 * not intercept requests a *service worker* makes, and ours is network-first for
 * `GET /api/*` — so the worker fetched the real trip list and handed it back, past
 * the handler. The review believed it had seen the empty state of the two screens
 * Alex opens most. It never had.
 *
 * Unregistering the worker for these captures, rather than blocking workers for
 * the whole run, is deliberate: the offline capture further down needs the real
 * one, and that evidence is only worth having if it is genuinely the shipped
 * worker answering.
 */
async function withoutServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? []
    await Promise.all(registrations.map((registration) => registration.unregister()))
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  })
}

async function asANewUser(page: Page) {
  await withoutServiceWorker(page)
  await page.route('**/api/trips', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trips: [] }),
    }),
  )
  await page.reload()
  await settled(page)
  // The interception is worthless if it silently stopped working again.
  await expect(page.getByText(/Portland weekend/)).toHaveCount(0)
}

test.describe('every surface, in the states worth reviewing', () => {
  test('unlock, signed out', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/')
    await expect(page.getByLabel('Passphrase')).toBeVisible()
    await capture(page, 'unlock')

    // Keyboard open: the primary action must not end up under it.
    await page.getByLabel('Passphrase').focus()
    await capture(page, 'unlock-focused')
  })

  test('home, with trips and without', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)
    await settled(page)
    await capture(page, 'home')

    /*
     * The new-user state, without emptying the database.
     *
     * Reviewing an empty screen matters as much as a full one, and the component
     * is identical — only its data is not. Intercepting the list is how both get
     * reviewed in one seeded run.
     */
    await asANewUser(page)
    await capture(page, 'home-empty')
    await page.unroute('**/api/trips')
  })

  test('trips, populated and empty', async ({ page }) => {
    await openApp(page, '/trips')
    await settled(page)
    await capture(page, 'trips')

    await asANewUser(page)
    await capture(page, 'trips-empty')
    await page.unroute('**/api/trips')
  })

  test('plan a trip, closed and opened', async ({ page }) => {
    await openApp(page, '/trips')
    await page.getByRole('button', { name: 'Plan a Trip' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture(page, 'plan-trip-sheet')
    await assertFocusStaysInSheet(page, 'plan-trip-sheet')

    await page.getByLabel('Trip name').fill('Visual review trip')
    await page.getByLabel('Trip name').focus()
    await capture(page, 'plan-trip-typing')
  })

  test('the trip command centre', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)

    // The long multi-city trip: most content, most weather, approved outfits.
    await page.goto(`/trips/${tripNamed('Cape Town & Kruger').id}`)
    await settled(page)
    await capture(page, 'trip')

    // Scrolled to the bottom of a long page — where Safari's toolbar collapses
    // and where a reserved band at the end of the page would show up.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(150)
    await capture(page, 'trip-scrolled')

    /*
      * Trip tools open, with the delete confirmation showing.
      *
      * The one confirmation in the product, and the one screen where getting the
      * wording wrong costs Alex a trip — so it is reviewed as an image rather than
      * asserted as a string.
      */
    await page.getByRole('button', { name: 'Trip setup' }).click()
    await page.getByRole('button', { name: 'Delete this trip' }).click()
    await expect(page.getByRole('button', { name: 'Delete for good' })).toBeVisible()
    await capture(page, 'trip-delete-confirm')
    await page.getByRole('button', { name: 'Keep it' }).click()

    // A trip with nothing planned yet.
    await page.goto(`/trips/${tripNamed('Portland weekend').id}`)
    await settled(page)
    await capture(page, 'trip-unplanned')
  })

  test('the packing checklist', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)
    const trip = tripNamed('Cape Town & Kruger')

    await page.goto(`/trips/${trip.id}`)
    await settled(page)

    const rows = page.locator('.check-row')
    await expect(rows.first()).toBeVisible()
    await capture(page, 'checklist')

    // Partly packed: the state the screen actually spends its life in.
    for (const index of [0, 1, 2]) {
      await rows.nth(index).locator('.check-main').click()
      await page.waitForTimeout(120)
    }
    await capture(page, 'checklist-part-packed')

    /*
      * The left-swipe tray, open.
      *
      * Captured with a real drag rather than by forcing the class: what is worth
      * reviewing is whether Edit and Remove are legible and reachable at the width
      * the gesture actually uncovers, and a state set by hand would not prove that.
      */
    const first = rows.first()
    const box = await first.boundingBox()
    if (box) {
      const y = box.y + box.height / 2
      const from = box.x + box.width - 12
      await page.mouse.move(from, y)
      await page.mouse.down()
      for (let step = 1; step <= 12; step += 1) {
        await page.mouse.move(from - (140 * step) / 12, y)
      }
      await page.mouse.up()
      await page.waitForTimeout(320)
      await capture(page, 'checklist-swipe-tray')
    }

    /*
     * Reload rather than dismissing by hand. `capture` walks four viewport widths,
     * so every coordinate measured before it is stale afterwards — clicking one to
     * close the tray landed on whatever had reflowed into that spot and left the
     * screen in a state the next capture then photographed.
     */
    await page.reload()
    await settled(page)
    await expect(rows.first()).toBeVisible()

    // The row sheet, where quantity and Not bringing live.
    const name = (await rows.first().locator('.check-name').textContent())?.trim() ?? ''
    await rows.first().locator('.check-more').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture(page, 'checklist-row-sheet')
    await assertFocusStaysInSheet(page, 'checklist-row-sheet')
    await page.keyboard.press('Escape')

    // Search, and search with no matches.
    const search = page.getByPlaceholder('Search this list')
    if (await search.isVisible().catch(() => false)) {
      await search.fill(name.slice(0, 4))
      await settled(page)
      await capture(page, 'checklist-search')
      await search.fill('zzzz-no-such-thing')
      await page.waitForTimeout(150)
      await capture(page, 'checklist-search-empty')
      await search.fill('')
    }
  })

  test('outfits, approved and unplanned', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)

    await page.goto(`/trips/${tripNamed('Cape Town & Kruger').id}/outfits`)
    await settled(page)
    await expect(page.locator('.outfit-card').first()).toBeVisible()
    await capture(page, 'outfits')

    await page.locator('.outfit-card').first().locator('.slot').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await settled(page)
    await capture(page, 'outfits-swap-sheet')
    await assertFocusStaysInSheet(page, 'outfits-swap-sheet')
    await page.keyboard.press('Escape')

    await page.goto(`/trips/${tripNamed('Portland weekend').id}/outfits`)
    await settled(page)
    await capture(page, 'outfits-empty')
  })

  test('during trip', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)
    await page.goto(`/trips/${tripNamed('Cape Town & Kruger').id}/today`)
    await settled(page)
    await capture(page, 'today')
  })

  test('my stuff', async ({ page }) => {
    await openApp(page, '/my-stuff')
    await settled(page)
    await capture(page, 'my-stuff')

    const search = page.getByLabel('Search your items')
    await search.fill('shirt')
    await settled(page)
    await capture(page, 'my-stuff-search')
    await search.fill('')

    await page.getByRole('button', { name: /^Add/ }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture(page, 'my-stuff-add-sheet')
    await assertFocusStaysInSheet(page, 'my-stuff-add-sheet')
    await page.keyboard.press('Escape')
  })

  test('settings and what it holds', async ({ page }) => {
    await openApp(page, '/settings')
    await settled(page)
    await capture(page, 'settings')

    for (const [label, name] of [
      ['Your usual amounts', 'settings-usual-amounts'],
      ['Packing rules', 'settings-rules'],
      ['What Pack Smart has noticed', 'settings-noticed'],
    ] as const) {
      await page.getByRole('button', { name: label }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await settled(page)
      await capture(page, name)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
  })

  test('itinerary import', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)
    await page.goto(`/trips/${tripNamed('Zion hiking').id}/itinerary`)
    await settled(page)
    await capture(page, 'itinerary')
  })

  test('failure and offline states', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)
    const trip = tripNamed('Cape Town & Kruger')

    /*
     * A checklist load that fails: the screen must say something useful.
     *
     * The worker has to go first, for the same reason the empty states did. It
     * answers `GET /api/*` network-first with a cached fallback, and it makes that
     * fetch itself — where `page.route` cannot reach it. Whether this capture
     * showed the failure or a perfectly loaded trip came down to whether the
     * worker had finished activating, which is a coin toss deciding what the
     * evidence says.
     */
    await withoutServiceWorker(page)
    await page.route(`**/api/trips/${trip.id}/checklist`, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: { message: 'boom' } }) }),
    )
    await page.goto(`/trips/${trip.id}`)
    await settled(page)
    await expect(page.getByText('Could not load this trip')).toBeVisible()
    await capture(page, 'trip-load-failed')
    await page.unroute(`**/api/trips/${trip.id}/checklist`)

    // Offline, having already read the trip once.
    await page.goto(`/trips/${trip.id}`)
    await settled(page)
    await page.context().setOffline(true)
    await page.locator('.check-row').first().locator('.check-main').click()
    await page.waitForTimeout(400)
    await capture(page, 'trip-offline-save-failed')
    await page.context().setOffline(false)
  })

  /*
   * The same product in Dark appearance.
   *
   * `tokens.css` has carried a full dark palette since the design system landed,
   * and nothing had ever looked at it: every screenshot above is Light, so the
   * dark values were shipping on the strength of having been typed correctly.
   * Half of iPhones are in Dark, and the failures it produces are exactly the ones
   * a light-only review cannot see — a border that vanishes into its surface, an
   * accent that stops carrying against the background, a danger tint that reads as
   * decoration.
   *
   * In this file rather than its own, because the mechanical-gate assertion below
   * reads a collection that every capture appends to. A separate file would put
   * these captures either side of that assertion depending on how Playwright
   * happened to order the files, and a gate that sometimes covers a screen is
   * worse than one that never does.
   */
  test('dark appearance', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page)
    await loadTrips(page)
    await settled(page)
    await capture(page, 'dark-home')

    await openApp(page, '/trips')
    await settled(page)
    await capture(page, 'dark-trips')

    const trip = tripNamed('Cape Town & Kruger')
    await page.goto(`/trips/${trip.id}`)
    await settled(page)
    await capture(page, 'dark-trip')

    // A sheet and its backdrop: the surface has to separate from the page behind
    // it without a shadow to lean on, which is where a dark palette usually fails.
    await page.locator('.check-row').first().getByRole('button', { name: /^Options for/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture(page, 'dark-checklist-row-sheet')
    await page.keyboard.press('Escape')

    await page.goto(`/trips/${trip.id}/outfits`)
    await settled(page)
    await capture(page, 'dark-outfits')

    await openApp(page, '/my-stuff')
    await settled(page)
    await capture(page, 'dark-my-stuff')

    await openApp(page, '/settings')
    await settled(page)
    await capture(page, 'dark-settings')

    await page.emulateMedia({ colorScheme: 'light' })
  })

  /*
   * Last in the file, and the file runs alone with one worker, so every gate above
   * has already reported by the time this reads the collection.
   */
  test('every mechanical gate passed', async () => {
    writeReport()
    const found = collected()
    const summary = found.map((v) => `${v.screen} @${v.width}  ${v.rule}: ${v.detail}`)
    expect(
      summary,
      `${found.length} visual-acceptance violations — full list in .visual/report.txt`,
    ).toEqual([])
  })
})
