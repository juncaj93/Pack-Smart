import { expect, test } from '@playwright/test'
import type { Locator, Page, Request } from '@playwright/test'
import { createTrip, deleteTrip, liveDates, signIn } from './fixtures'

/**
 * How long each screen takes, and what it spends the time on (P1).
 *
 * Alex reports Home and Trips feel slow. This measures rather than guesses:
 * every screen is loaded the same way, and the numbers below are the ones any
 * fix has to move. My Stuff and Settings are here as the control — they read
 * comparable amounts of data and are not reported as slow, so a number that is
 * bad on all four is a fact about the environment rather than about Home.
 *
 * **What is asserted is a budget, not a stopwatch.** A CI runner's absolute
 * timings are not reproducible, so the assertions are about SHAPE — how many
 * requests, and whether they are in a chain — which is what actually decides
 * whether a screen feels immediate. The durations are printed for the record.
 *
 * ## Two things this harness got wrong the first time, and how it is stopped
 *
 * **It measured Settings twice and called one of them Home.** The first version
 * navigated to `/settings` as a neutral screen before each measurement. That
 * writes `pack-smart:last-route`, and `App` resumes the stored tab when the
 * app is opened at `/` — so `goto('/')` bounced straight back to Settings, and
 * the recorded "Home: 1 request, chain 1" was a photograph of the wrong screen.
 * `about:blank` is the neutral screen now: it kills the page outright, which is
 * what the neutral step was for, and it writes nothing.
 *
 * **It measured Home with no trip on the database.** Home's waterfall only
 * exists when there is a featured trip to fetch a checklist and outfits for, so
 * an empty database hid two thirds of it. The spec creates its own trip.
 *
 * **First content was the skeleton.** Every screen renders its `<Screen title>`
 * while still loading, so waiting for the heading measured the empty frame, not
 * the answer. Each screen now names a locator that cannot appear until real
 * data is on it.
 */

interface Measurement {
  screen: string
  /** Every API request the screen made, in the order they started. */
  requests: Array<{ path: string; ms: number; startedAt: number }>
  /** Milliseconds until the screen's frame — title and nav — is on the page. */
  firstPaint: number
  /** Milliseconds until the screen's first REAL information, where it has a
   * stage between the frame and the full answer. Null where it does not. */
  firstUseful: number | null
  /** Milliseconds until the screen's own ANSWER is on the page. */
  firstContent: number
  /** Milliseconds until nothing is still loading. */
  settled: number
}

/**
 * Every API response is held for this long before it is allowed through.
 *
 * **The rung count is only a fact if the network is slow enough to make it one.**
 * On a loopback a server answers in 9ms, so two requests issued in the same tick
 * and two issued one after the other are separated by single-digit milliseconds
 * — and the difference between "parallel" and "serial" becomes a guess about
 * scheduling. It read correctly for a while and then failed in a full parallel
 * run, which is the worst way for a gate to be wrong.
 *
 * 250ms turns it into arithmetic. A serial pair cannot overlap and a parallel
 * pair cannot help but overlap, by two orders of magnitude more than any
 * scheduling jitter. It is also, not incidentally, roughly what hotel wifi does
 * — so the timings printed under this are a better answer to "how does this
 * feel away from home" than the loopback ones ever were.
 */
const NETWORK_MS = 250

/**
 * The longest chain of requests that had to happen one after another.
 *
 * The number that matters. Six parallel requests cost one round trip; two
 * sequential ones cost two, and on hotel wifi that is the difference between a
 * screen that opens and a screen that thinks about it.
 *
 * **Only meaningful under `NETWORK_MS`.** Requests on the same rung are issued
 * in the same wave and start within a few milliseconds of each other; a request
 * on the next rung cannot be issued until one on this rung has answered, which
 * is a fixed 250ms later. So the rung boundary is drawn at **half the delay** —
 * a 125ms margin either way, against a real separation of about 5ms without it.
 *
 * That 5ms is not a hypothetical. This first compared each request's start
 * against the previous one's *finish*, which is causally the right question and
 * is decided by a handful of milliseconds — it read correctly for a while and
 * then failed in a full parallel run, which is the worst way for a gate to be
 * wrong.
 */
function waterfallDepth(requests: Measurement['requests']): number {
  const sorted = [...requests].sort((a, b) => a.startedAt - b.startedAt)
  let depth = 0
  let rungStartedAt = -Infinity

  for (const request of sorted) {
    if (request.startedAt - rungStartedAt > NETWORK_MS / 2) {
      depth += 1
      rungStartedAt = request.startedAt
    }
  }

  return depth
}

interface Target {
  screen: string
  path: string
  /** The frame. Present while the screen is still loading. */
  frame: (page: Page) => Locator
  /**
   * The first thing worth looking at, where a screen has one before it has
   * everything. Home does: the trip's name lands a whole round trip before its
   * readiness does, and painting it then is the difference between a frame and
   * an answer to "which trip am I on".
   */
  partial?: (page: Page) => Locator
  /** The answer. Cannot be on the page until real data has arrived. */
  content: (page: Page) => Locator
}

async function measure(page: Page, target: Target): Promise<Measurement> {
  const requests: Measurement['requests'] = []
  const started = new Map<Request, number>()
  let origin = Date.now()

  const onRequest = (request: Request) => {
    if (request.url().includes('/api/')) started.set(request, Date.now())
  }
  const onFinished = (request: Request) => {
    const at = started.get(request)
    if (at === undefined) return
    requests.push({
      path: new URL(request.url()).pathname.replace(/\/[0-9a-f-]{36}/gi, '/:id'),
      ms: Date.now() - at,
      startedAt: at - origin,
    })
  }

  /*
   * `about:blank` first, so nothing in flight from the previous route lands
   * inside the window and reads as this screen's work. Measured without it,
   * Home appeared to fetch `/api/trips` twice — once from the page it was
   * leaving. NOT a real screen: navigating to one stores it as the resume
   * target and Home would bounce back to it. See the header note.
   */
  await page.goto('about:blank')

  // A slow network, so the rungs are unambiguous. See `NETWORK_MS`.
  await page.route('**/api/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, NETWORK_MS))
    await route.continue().catch(() => {})
  })

  page.on('request', onRequest)
  page.on('requestfinished', onFinished)

  origin = Date.now()
  await page.goto(target.path)
  await expect(target.frame(page).first()).toBeVisible()
  const firstPaint = Date.now() - origin
  let firstUseful: number | null = null
  if (target.partial) {
    await expect(target.partial(page).first()).toBeVisible()
    firstUseful = Date.now() - origin
  }
  await expect(target.content(page).first()).toBeVisible()
  const firstContent = Date.now() - origin

  // Settled: the network is quiet and no skeleton is left on screen.
  await page.waitForLoadState('networkidle')
  const settled = Date.now() - origin

  page.off('request', onRequest)
  page.off('requestfinished', onFinished)
  await page.unroute('**/api/**')

  return { screen: target.screen, requests, firstPaint, firstUseful, firstContent, settled }
}

function report(m: Measurement): void {
  const depth = waterfallDepth(m.requests)
  console.log(
    `PERF ${m.screen.padEnd(10)} requests=${String(m.requests.length).padStart(2)} ` +
      `chain=${depth} paint=${String(m.firstPaint).padStart(5)}ms ` +
      `useful=${String(m.firstUseful ?? m.firstContent).padStart(5)}ms ` +
      `content=${String(m.firstContent).padStart(5)}ms settled=${String(m.settled).padStart(5)}ms`,
  )
  for (const request of m.requests) {
    console.log(`  ${String(request.startedAt).padStart(5)}ms +${String(request.ms).padStart(4)}ms  ${request.path}`)
  }
}

test.describe('how long each screen takes', () => {
  /*
   * The service worker is blocked, and it has to be.
   *
   * `page.route` does not intercept a request a service worker makes — the
   * worker's own `fetch` goes to the real network — so with `sw.js` running,
   * `NETWORK_MS` would be applied to nothing at all and every timing below
   * would silently be the loopback one again.
   */
  test.use({ serviceWorkers: 'block' })

  test('Home, Trips, My Stuff and Settings, measured the same way', async ({ page }) => {
    await signIn(page)

    /*
     * Home's waterfall does not exist without a trip to feature. Measured on an
     * empty database it issues one request and looks like the fastest screen in
     * the app, which is the opposite of what Alex reports.
     *
     * `liveDates`, because "a trip to feature" means an UPCOMING one. The
     * fixture's default dates are 31 Jul – 11 Aug 2026 and went past on 12 Aug
     * 2026, after which this trip was history: Home rendered its empty state,
     * `.home-countdown` never filled, and the test timed out measuring a
     * waterfall that had nothing to wait for. It survived a while on whichever
     * live trip another spec had left behind, which is the borrowed-data
     * failure `fixtures.ts` exists to stop.
     */
    const trip = await createTrip(page, { owner: 'Perf', ...liveDates(5) })

    try {
      const targets: Target[] = [
        {
          screen: '/',
          path: '/',
          frame: (p) => p.getByRole('heading', { name: /Pack Smart/i }),
          // The featured trip's name, which lands with `/api/trips` — one
          // round trip before the readiness headline below it.
          partial: (p) => p.locator('.home-trip-name'),
          /*
           * The readiness headline, which is empty until the WHOLE chain has
           * landed: /api/trips picks the featured trip, then its checklist and
           * outfits feed `readiness()`. Nothing shorter measures Home's answer.
           *
           * Deliberately not the trip's own NAME. Home features the soonest
           * live trip on the database, which may belong to any spec that ran
           * before this one — asserting on ours made this the one test in the
           * suite that reads another spec's data, which is exactly what
           * `fixtures.ts` exists to stop, and it failed on CI for that reason.
           * The spec still creates a trip, because Home has no waterfall
           * without one; it just does not care which trip wins.
           */
          content: (p) => p.locator('.home-countdown:not(:empty)'),
        },
        {
          screen: '/trips',
          path: '/trips',
          frame: (p) => p.getByRole('heading', { name: /Trips/i }),
          content: (p) => p.locator('.trip-item').first(),
        },
        {
          screen: '/my-stuff',
          path: '/my-stuff',
          frame: (p) => p.getByRole('heading', { name: /My Stuff/i }),
          content: (p) => p.locator('.stuff-row').first(),
        },
        {
          // Settings reads no API data of its own, so its frame IS its answer.
          screen: '/settings',
          path: '/settings',
          frame: (p) => p.getByRole('heading', { name: /Settings/i }),
          /*
           * The last row on the screen, which used to be `Sign out`.
           *
           * That control has been removed — a private single-user app has nobody
           * to sign out from — so the marker moved to the appearance choice,
           * which is now what the bottom of a fully rendered Settings looks like.
           * It has to be the LAST thing rather than the first, or this measures
           * a screen that is still painting.
           */
          content: (p) => p.getByRole('heading', { name: 'Appearance' }).first(),
        },
      ]

      const measured: Measurement[] = []
      for (const target of targets) measured.push(await measure(page, target))
      for (const m of measured) report(m)

      /*
       * The budget, as shape rather than as milliseconds — and set at what is
       * MEASURED, not at what would be nice.
       *
       * P1 measured 3 for Home and 2 for the rest, because `App` rendered
       * nothing until `/api/auth/session` answered: no route was mounted, so no
       * route could ask for its data, and that check was a serial rung in front
       * of every screen. P1b removed it for a device that has unlocked before —
       * the check now runs BESIDE the first screen's request rather than in
       * front of it.
       *
       * What remains is Home's own second rung: it cannot ask for a checklist
       * until `/api/trips` has told it which trip. That is P1c.
       *
       * Server responses are 9–33ms; nothing in the database is slow.
       */
      const budget: Record<string, number> = {
        '/': 2,
        '/trips': 1,
        '/my-stuff': 1,
        '/settings': 1,
      }

      for (const m of measured) {
        expect(waterfallDepth(m.requests), `${m.screen}: sequential request chain`).toBeLessThanOrEqual(
          budget[m.screen] ?? 2,
        )
      }

      // And nothing asks for the same thing twice on one load.
      for (const m of measured) {
        const seen = new Set<string>()
        const duplicated = m.requests.filter((r) => !seen.add(r.path))
        expect(duplicated.map((r) => r.path), `${m.screen}: duplicate requests`).toEqual([])
      }

      /*
       * The status row is asked for on the FIRST rung, beside `/api/trips`.
       *
       * Asserted rather than assumed: it depends on nothing the trip list
       * returns — the server resolves whether the row is about home or about a
       * trip — so a later refactor could quietly demote it to the second rung
       * and the chain-depth budget above would still pass, while the top of the
       * screen went from one round trip to two.
       */
      const homeRequests = measured[0]!.requests
      const tripsAt = homeRequests.find((r) => r.path === '/api/trips')?.startedAt
      const statusAt = homeRequests.find((r) => r.path === '/api/home/weather')?.startedAt
      expect(statusAt, 'Home did not ask for its status row').not.toBeUndefined()
      expect(
        Math.abs(statusAt! - tripsAt!),
        'the status row is on a later rung than the trip list',
      ).toBeLessThan(NETWORK_MS / 2)

      /*
       * Home's own two stages. The trip's name is on screen a full round trip
       * before its readiness is — which is the point of P1c, and is worth an
       * assertion rather than a printed number, because the obvious "fix" to
       * a flickering countdown is to hold the whole card back again.
       */
      const home = measured[0]!
      expect(home.firstUseful, 'Home: trip name measured').not.toBeNull()
      expect(home.firstUseful!, 'Home: trip name is not held back for readiness')
        .toBeLessThanOrEqual(home.firstContent)
    } finally {
      await page.unroute('**/api/**')
      await deleteTrip(page, trip.id)
    }
  })
})

/*
 * The service worker is BLOCKED for this one, and that is not incidental.
 *
 * `page.route` does not intercept a request a service worker makes — the
 * worker's own `fetch` goes to the real network — so with `sw.js` running, a
 * route handler here sees nothing at all and every assertion below passes on
 * data that arrived normally. It did, silently, until this was found. Blocking
 * the worker is what makes the held-request harness mean anything.
 */
test.describe('coming back to a tab', () => {
  test.use({ serviceWorkers: 'block' })

  /*
   * Tapping between tabs, which nothing measured before this.
   *
   * The launch numbers above are one half of what Alex is describing; the other
   * half is that he is beside a suitcase moving between Home and Trips over and
   * over. Every one of those taps refetched everything, because each route
   * loads in a mount effect and nothing remembered the last answer.
   *
   * The network is HELD rather than slowed or aborted, and that distinction is
   * the whole test. Slow is a race. Aborted is worse than a race: `sw.js` falls
   * back to its own cache when a request FAILS, so an aborted request would be
   * answered from disk. A held request never fails and never answers, so the
   * only thing left that can put a trip on the screen is the snapshot the tab
   * took last time.
   */
  test('a tab that has been open once paints again without waiting', async ({ page }) => {
    await signIn(page)
    // Live, for the same reason as above: every assertion here is about Home
    // repainting its featured trip from the snapshot, and there is no featured
    // trip on a database whose only trip is in the past.
    const trip = await createTrip(page, { owner: 'Repeat', ...liveDates(5) })

    try {
      const go = async (name: string) => {
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name }).click()
      }

      // Prime all three tabs, so each has been open once this session.
      await page.goto('/')
      await expect(page.locator('.home-countdown:not(:empty)')).toBeVisible()
      await go('Trips')
      await expect(page.locator('.trip-section').first()).toBeVisible()
      await go('My Stuff')
      await expect(page.locator('.stuff-row').first()).toBeVisible()

      // Every API request from here on is accepted and never answered.
      const held: Array<() => void> = []
      await page.route('**/api/**', async (route) => {
        await new Promise<void>((release) => held.push(release))
        // The test may already have finished with this route by now; letting it
        // through is a courtesy to the teardown, not part of the assertion.
        await route.continue().catch(() => {})
      })

      /*
       * Each assertion names a marker that exists ONLY on the screen being
       * tested. `.trip-item` would not do: Home renders the same rows under
       * "Also coming up", so a Trips screen that painted nothing at all would
       * still have satisfied it from the tab before. That is how the first
       * version of this test passed with the cache deleted.
       */
      await go('Home')
      await expect(page.locator('.home-trip-name')).toBeVisible()
      await expect(page.locator('.home-countdown:not(:empty)')).toBeVisible()

      await go('Trips')
      await expect(page.locator('.trip-section').first()).toBeVisible()

      await go('My Stuff')
      await expect(page.locator('.stuff-row').first()).toBeVisible()

      // Let the held requests finish so teardown is not fighting them. Released
      // BEFORE unrouting: a route abandoned by `unroute` cannot be continued.
      for (const release of held) release()
      await page.unroute('**/api/**')
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
