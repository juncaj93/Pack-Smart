import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { assertFocusStaysInSheet, capture, collected, writeReport } from './gates'

/** The real workbook, so the client's own parse runs as it will for Alex. */
const WORKBOOK_PATH = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

/**
 * An import review with one of each kind of question on it.
 *
 * Stubbed so the capture shows the same screen every run: what the local
 * database holds decides how many rows a real dry-run returns, and a screenshot
 * that changes shape between runs is not a regression test.
 */
async function stubImportReview(page: Page): Promise<void> {
  await page.route('**/api/import/dry-run', (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        summary: {
          clothingRows: 118, clothingUnique: 118, exactDuplicates: 0, identityDuplicates: 0,
          reviewCards: [], gearItems: 33, triggerRules: 0, rulesNeedingReview: [],
          coverageWarnings: [],
        },
        existingItems: 118,
        willAppend: true,
        review: {
          counts: {
            new: 2, exactDuplicates: 114, updateCandidates: 1, likelyDuplicates: 1, conflicts: 1,
          },
          attention: [
            {
              key: 'clothing#4', sheet: 'clothing', name: 'Uniqlo Grey Tee',
              decision: 'update_candidate', matchedItemId: 'a', matchedName: 'Uniqlo Grey Tee',
              why: 'Already in your wardrobe, but the spreadsheet now says something different about one thing.',
              differences: [
                {
                  field: 'notes', label: 'Notes', existing: 'Work staple',
                  incoming: 'Work staple; getting thin at the elbows',
                },
              ],
              candidates: [], defaultChoice: 'keep_existing',
            },
            {
              key: 'clothing#7', sheet: 'clothing', name: 'Muji Grey Tee',
              decision: 'likely_duplicate', matchedItemId: 'b', matchedName: 'Uniqlo Grey Tee',
              why: 'You already have a “Uniqlo Grey Tee” with a different brand.',
              differences: [
                { field: 'brand', label: 'Brand', existing: 'Uniqlo', incoming: 'Muji' },
              ],
              candidates: [], defaultChoice: 'import_separately',
            },
            {
              key: 'clothing#9', sheet: 'clothing', name: 'Columbia Zip-Up',
              decision: 'conflict', matchedItemId: null, matchedName: null,
              why: 'You already have 2 things called “Columbia Zip-Up”, and this matches none of them exactly.',
              differences: [],
              candidates: [
                { id: 'c', name: 'Columbia Zip-Up' },
                { id: 'd', name: 'Columbia Zip-Up' },
              ],
              defaultChoice: 'import_separately',
            },
          ],
          retiredRulesKept: ['Gas-X'],
        },
      }),
    }),
  )
}

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

  /*
   * Home while its second round trip is still out (P1c).
   *
   * Home paints the featured trip after `/api/trips` and its readiness — the
   * countdown, the progress bar and the recommended action — a whole round trip
   * later. That in-between state is on screen at every cold launch and nothing
   * reviewed it, which is exactly how a layout that jumps ships.
   *
   * The checklist and outfits are HELD rather than emptied: an empty checklist
   * is a different screen with a different answer, and this is meant to be the
   * real one, caught halfway.
   */
  test('home, halfway — the trip is up, the readiness is not', async ({ page }) => {
    // On the origin first: `withoutServiceWorker` reaches for `caches`, which
    // does not exist on about:blank.
    await openApp(page)
    await withoutServiceWorker(page)

    const held: Array<() => void> = []
    await page.route('**/api/trips/*/checklist', async (route) => {
      await new Promise<void>((release) => held.push(release))
      await route.continue().catch(() => {})
    })

    // A reload, not a client-side navigation: the in-memory snapshot from the
    // capture above would otherwise paint the finished screen instantly.
    await page.reload()
    await expect(page.locator('.home-trip-name')).toBeVisible()
    await expect(page.locator('.home-pending').first()).toBeVisible()
    await capture(page, 'home-partial')

    for (const release of held) release()
    await page.unroute('**/api/trips/*/checklist')
    await settled(page)
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

  /*
   * The guided review (doc 09 §7).
   *
   * A screen of its own rather than a state of the outfits list, so it gets its
   * own mechanical gate. The two states worth reviewing are the ones with
   * different shapes: one outfit under decision, and the coverage summary the
   * walkthrough ends on.
   */
  test('the guided outfit review', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)

    await page.goto(`/trips/${tripNamed('Cape Town & Kruger').id}/outfits/review`)
    await settled(page)

    // Either an outfit is under decision, or every one is already approved and
    // the summary is what there is to look at. Both are real states.
    const panel = page.locator('.review-panel')
    if ((await panel.count()) > 0) {
      await expect(panel).toBeVisible()
      await capture(page, 'outfit-review')

      // The garments become tappable only when Alex asks to change something,
      // which is a different layout and worth its own look.
      await page.getByRole('button', { name: 'Change something' }).click()
      await settled(page)
      await capture(page, 'outfit-review-changing')
    } else {
      await expect(page.locator('.review-summary-headline')).toBeVisible()
      await capture(page, 'outfit-review-summary')
    }
  })

  test('during trip', async ({ page }) => {
    await openApp(page)
    await loadTrips(page)
    await page.goto(`/trips/${tripNamed('Cape Town & Kruger').id}/today`)
    await settled(page)
    await capture(page, 'today')
  })

  /*
   * Today, with something actually on it (E1).
   *
   * The seeded Cape Town trip has nothing packed, so `today` above photographs
   * the empty state and nothing else — which is how the four repeated dead ends
   * survived a review that had a screenshot of them. This one builds the state
   * the screen is FOR: an approved outfit, a full bag, and then one garment
   * taken back out, which is the ordinary mid-trip case rather than the edge one.
   *
   * Its own trip, created and deleted here, for the same reason the departure
   * capture below has one: the `dark appearance` spec re-captures Home and
   * Trips, so this has to leave the database exactly as it found it.
   */
  test('during trip, with an outfit and a gap', async ({ page }) => {
    await openApp(page)

    const today = new Date()
    const iso = (offset: number) =>
      new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
      )
        .toISOString()
        .slice(0, 10)

    const created = await page.evaluate(
      async ([payload]) => {
        const response = await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload as string,
        })
        const body = (await response.json()) as { trip: { id: string } }
        return body.trip.id
      },
      [
        JSON.stringify({
          name: 'Mid-trip',
          startDate: iso(-2),
          endDate: iso(5),
          destinations: [{ name: 'Cape Town', country: 'South Africa' }],
          activities: ['safari', 'nice_dinner'],
          international: true,
          laundryAvailable: false,
          flightHours: 15,
        }),
      ],
    )

    try {
      await page.evaluate(
        async ([tripId]) => {
          const post = (url: string, body?: unknown) =>
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: body === undefined ? undefined : JSON.stringify(body),
            })

          await post(`/api/trips/${tripId}/outfits/generate`)

          const planned = (await (await fetch(`/api/trips/${tripId}/outfits`)).json()) as {
            groups: Array<{ id: string; status: string }>
          }
          for (const group of planned.groups) {
            if (group.status === 'incomplete') continue
            await post(`/api/trips/${tripId}/outfits/${group.id}/status`, { status: 'approved' })
          }

          const listed = (await (await fetch(`/api/trips/${tripId}/checklist`)).json()) as {
            entries: Array<{ id: string; category: string; requiredQty: number; excludedAt: number | null }>
          }
          const patch = (id: string, body: unknown) =>
            fetch(`/api/trips/${tripId}/checklist/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })

          for (const entry of listed.entries) {
            if (entry.excludedAt !== null) continue
            await patch(entry.id, { packedQty: entry.requiredQty })
          }

          // One garment back out of the bag, which is what the unresolved
          // section exists for.
          const shoes = listed.entries.find((e) => e.category === 'Footwear')
          if (shoes) await patch(shoes.id, { packedQty: 0 })
        },
        [created],
      )

      await page.goto(`/trips/${created}/today`)
      await settled(page)
      await capture(page, 'today-live')

      // And the way out of the gap, which is the whole E1 interaction.
      const gap = page.locator('.today-issue-list .today-row').first()
      if (await gap.count()) {
        await gap.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await settled(page)
        await capture(page, 'today-resolve-sheet')
        await assertFocusStaysInSheet(page, 'today-resolve-sheet')
        await page.keyboard.press('Escape')
      }
    } finally {
      await page.evaluate(
        async ([tripId]) => {
          await fetch(`/api/trips/${tripId}`, { method: 'DELETE' })
        },
        [created],
      )
    }
  })

  /*
   * The departure screen (D4).
   *
   * On its own trip, created here and deleted at the end. No seeded trip leaves
   * today — deliberately, because moving one so this capture could exist would
   * change which trip Home features and rewrite every screenshot above. The
   * `dark appearance` spec below re-captures Home and Trips, so this one has to
   * leave the database exactly as it found it.
   */
  test('the morning you leave', async ({ page }) => {
    await openApp(page)

    const today = new Date()
    const iso = (offset: number) =>
      new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
      )
        .toISOString()
        .slice(0, 10)

    const created = await page.evaluate(
      async ([payload]) => {
        const response = await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload as string,
        })
        const body = (await response.json()) as { trip: { id: string } }
        return body.trip.id
      },
      [
        JSON.stringify({
          name: 'Leaving today',
          startDate: iso(0),
          endDate: iso(3),
          destinations: [{ name: 'Lisbon', country: 'Portugal' }],
          activities: ['sightseeing'],
          international: true,
          laundryAvailable: false,
          flightHours: 3,
        }),
      ],
    )

    try {
      /*
       * The state the screen is for: one thing still in use, one packed but
       * unconfirmed, and the rest untouched so the leftover count is real.
       */
      await page.evaluate(
        async ([tripId]) => {
          const listed = await fetch(`/api/trips/${tripId}/checklist`)
          const { entries } = (await listed.json()) as {
            entries: Array<{ id: string; requiredQty: number; requiresFinalCheck: boolean }>
          }
          const patch = (id: string, body: unknown) =>
            fetch(`/api/trips/${tripId}/checklist/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })

          const ordinary = entries.filter((e) => !e.requiresFinalCheck)
          if (ordinary[0]) await patch(ordinary[0].id, { packingTiming: 'day_of' })
          if (ordinary[1]) await patch(ordinary[1].id, { packingTiming: 'day_of' })

          const checkable = entries.filter((e) => e.requiresFinalCheck)
          for (const row of checkable.slice(0, 2)) {
            await patch(row.id, { packedQty: row.requiredQty })
          }
        },
        [created],
      )

      await page.goto(`/trips/${created}/day-of`)
      await settled(page)
      await capture(page, 'day-of')

      // And the way in, on the trip screen it belongs to.
      await page.goto(`/trips/${created}`)
      await settled(page)
      await capture(page, 'trip-leaving-today')
    } finally {
      await page.evaluate(
        async ([tripId]) => {
          await fetch(`/api/trips/${tripId}`, { method: 'DELETE' })
        },
        [created],
      )
    }
  })

  /*
   * The post-trip review (F1).
   *
   * On its own trip for the same reason the departure screen is: a seeded trip
   * moved into the past would change which one Home features and rewrite every
   * screenshot above it. Created here, captured empty and with a proposal on
   * screen, and deleted at the end so `dark appearance` below finds the database
   * exactly as it was.
   */
  test('the post-trip review', async ({ page }) => {
    await openApp(page)

    const today = new Date()
    const iso = (offset: number) =>
      new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset),
      )
        .toISOString()
        .slice(0, 10)

    const created = await page.evaluate(
      async ([payload]) => {
        const response = await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload as string,
        })
        const body = (await response.json()) as { trip: { id: string } }
        return body.trip.id
      },
      [
        JSON.stringify({
          name: 'Just back',
          startDate: iso(-12),
          endDate: iso(-4),
          destinations: [{ name: 'Lisbon', country: 'Portugal' }],
          activities: ['sightseeing'],
          international: true,
          laundryAvailable: false,
          flightHours: 3,
        }),
      ],
    )

    try {
      // Nothing answered yet: the summary, five collapsed questions, one action.
      await page.goto(`/trips/${created}/review`)
      await settled(page)
      await capture(page, 'review')

      // The wardrobe picker, which is the densest thing this screen can show.
      await page.getByRole('button', { name: 'Did you forget anything?' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await settled(page)
      await capture(page, 'review-picker')
      await page.keyboard.press('Escape')

      /*
       * A proposal on screen, and its effect above the buttons that decide it.
       * Answered through the API rather than through the picker: which garment
       * the list happens to offer first is not what this capture is about.
       */
      await page.evaluate(
        async ([tripId]) => {
          const listed = await fetch(`/api/trips/${tripId}/review`)
          const { choices } = (await listed.json()) as {
            choices: { notPacked: Array<{ id: string }> }
          }
          const first = choices.notPacked[0]
          if (!first) return
          await fetch(`/api/trips/${tripId}/review/answers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'forgot', itemId: first.id }),
          })
        },
        [created],
      )

      await page.goto(`/trips/${created}/review`)
      await settled(page)
      await capture(page, 'review-proposal')

      // And the way in, on the trip screen it belongs to.
      await page.goto(`/trips/${created}`)
      await settled(page)
      await capture(page, 'trip-finished')
    } finally {
      await page.evaluate(
        async ([tripId]) => {
          await fetch(`/api/trips/${tripId}`, { method: 'DELETE' })
        },
        [created],
      )
    }
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

  /*
   * A default Alex has changed, which is a state the rules sheet only reaches
   * after an edit and therefore never appeared in a review.
   *
   * AUTONOMY §8: a capture that cannot show the state under review is not
   * evidence. The whole of A4b's interface claim is that a changed default says
   * what it changed from and offers the original back, and a screenshot of a
   * list where nothing has been changed says nothing about it.
   *
   * Changed and put back within the test, so the next capture in this run — and
   * the e2e suite sharing this database — starts where it did.
   */
  test('a packing rule changed from its default', async ({ page }) => {
    await openApp(page, '/settings')
    await page.getByRole('button', { name: 'Packing rules' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByPlaceholder('Search').fill('Hairspray')

    await sheet.locator('.rule-row').first().click()
    // Asserted before the shutter: the row must really be showing the changed
    // state, or this is a screenshot of an ordinary rule under a name claiming
    // otherwise.
    await expect(sheet.getByText(/^Turned off/)).toBeVisible()
    await settled(page)
    await capture(page, 'settings-rules-changed')

    await sheet.getByRole('button', { name: 'Use the default' }).click()
    await expect(sheet.getByText(/^Turned off/)).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  /* The form for writing one, which is likewise unreachable without a tap. */
  test('writing a new packing rule', async ({ page }) => {
    await openApp(page, '/settings')
    await page.getByRole('button', { name: 'Packing rules' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Add a rule' }).click()
    await sheet.getByPlaceholder('Search your things').fill('Watch')
    await expect(sheet.locator('.picker-row').first()).toBeVisible()
    await settled(page)
    await capture(page, 'settings-rules-add')

    await sheet.locator('.picker-row').first().click()
    await expect(sheet.getByRole('button', { name: 'Save this rule' })).toBeVisible()
    await settled(page)
    await capture(page, 'settings-rules-add-kind')

    await page.keyboard.press('Escape')
  })

  /*
   * The import review, in both appearances (G5b).
   *
   * Stubbed at `/api/import/dry-run` and reached without a file, because the
   * gates below measure the SCREEN — the four widths, the tap targets, the
   * horizontal overflow — and what the local database happens to hold has no
   * bearing on any of them. The classification itself is proved in
   * `tests/integration/import-review.test.ts`.
   *
   * Both appearances, because the comparison leans on a struck-through "was"
   * beside a "now": if `--color-text-secondary` and `--color-text` stop
   * separating in Dark, the two halves read as one sentence.
   */
  test('import review', async ({ page }) => {
    await stubImportReview(page)

    await openApp(page, '/import')
    await page.setInputFiles('input[type="file"]', WORKBOOK_PATH)
    await expect(page.getByRole('heading', { name: /to decide$/ })).toBeVisible({ timeout: 30_000 })
    await settled(page)
    await capture(page, 'import-review')

    await page.emulateMedia({ colorScheme: 'dark' })
    await settled(page)
    await capture(page, 'dark-import-review')
    await page.emulateMedia({ colorScheme: 'light' })
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

    await page.goto(`/trips/${trip.id}/outfits/review`)
    await settled(page)
    await capture(page, 'dark-outfit-review')

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
