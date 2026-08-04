import { expect, test } from '@playwright/test'
import type { Locator, Page, Request } from '@playwright/test'
import { createTrip, deleteTrip, signIn } from './fixtures'

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
  /** Milliseconds until the screen's own ANSWER is on the page. */
  firstContent: number
  /** Milliseconds until nothing is still loading. */
  settled: number
}

/**
 * The longest chain of requests that had to happen one after another.
 *
 * The number that matters. Six parallel requests cost one round trip; two
 * sequential ones cost two, and on hotel wifi that is the difference between a
 * screen that opens and a screen that thinks about it.
 */
function waterfallDepth(requests: Measurement['requests']): number {
  const sorted = [...requests].sort((a, b) => a.startedAt - b.startedAt)
  let depth = 0
  let reachedBy = 0

  for (const request of sorted) {
    // Started after everything before it had finished: a new rung.
    if (request.startedAt >= reachedBy - 5) {
      depth += 1
      reachedBy = request.startedAt + request.ms
    } else {
      reachedBy = Math.max(reachedBy, request.startedAt + request.ms)
    }
  }

  return depth
}

interface Target {
  screen: string
  path: string
  /** The frame. Present while the screen is still loading. */
  frame: (page: Page) => Locator
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

  page.on('request', onRequest)
  page.on('requestfinished', onFinished)

  origin = Date.now()
  await page.goto(target.path)
  await expect(target.frame(page).first()).toBeVisible()
  const firstPaint = Date.now() - origin
  await expect(target.content(page).first()).toBeVisible()
  const firstContent = Date.now() - origin

  // Settled: the network is quiet and no skeleton is left on screen.
  await page.waitForLoadState('networkidle')
  const settled = Date.now() - origin

  page.off('request', onRequest)
  page.off('requestfinished', onFinished)

  return { screen: target.screen, requests, firstPaint, firstContent, settled }
}

function report(m: Measurement): void {
  const depth = waterfallDepth(m.requests)
  console.log(
    `PERF ${m.screen.padEnd(10)} requests=${String(m.requests.length).padStart(2)} ` +
      `chain=${depth} paint=${String(m.firstPaint).padStart(5)}ms ` +
      `content=${String(m.firstContent).padStart(5)}ms settled=${String(m.settled).padStart(5)}ms`,
  )
  for (const request of m.requests) {
    console.log(`  ${String(request.startedAt).padStart(5)}ms +${String(request.ms).padStart(4)}ms  ${request.path}`)
  }
}

test.describe('how long each screen takes', () => {
  test('Home, Trips, My Stuff and Settings, measured the same way', async ({ page }) => {
    await signIn(page)

    /*
     * Home's waterfall does not exist without a trip to feature. Measured on an
     * empty database it issues one request and looks like the fastest screen in
     * the app, which is the opposite of what Alex reports.
     */
    const trip = await createTrip(page, { owner: 'Perf' })

    try {
      const targets: Target[] = [
        {
          screen: '/',
          path: '/',
          frame: (p) => p.getByRole('heading', { name: /Pack Smart/i }),
          // The featured trip's own name — nothing renders it until
          // /api/trips has answered and a trip has been chosen.
          content: (p) => p.getByText(trip.name, { exact: false }),
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
          content: (p) => p.getByRole('button', { name: /Sign out/i }).first(),
        },
      ]

      const measured: Measurement[] = []
      for (const target of targets) measured.push(await measure(page, target))
      for (const m of measured) report(m)

      /*
       * The budget, as shape rather than as milliseconds — and set at what was
       * MEASURED, not at what would be nice.
       *
       * Today every screen waits on `/api/auth/session` before it issues its
       * own data request: `App` renders nothing at all until the session check
       * answers, so no route is mounted to ask for anything. That is one serial
       * round trip in front of every navigation. Home then adds a second,
       * because it cannot ask for a checklist until `/api/trips` has told it
       * which trip. Server responses are 9–33ms; nothing in the database is
       * slow.
       *
       * So the budget is what is measured today — **3 for Home, 2 for the rest**
       * — and it holds the line while the fix is scoped. Lowering it is P1b's
       * job and this is its acceptance test.
       */
      const budget: Record<string, number> = {
        '/': 3,
        '/trips': 2,
        '/my-stuff': 2,
        '/settings': 2,
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
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
