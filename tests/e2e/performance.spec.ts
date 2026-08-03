import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import { signIn } from './fixtures'

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
 */

interface Measurement {
  screen: string
  /** Every API request the screen made, in the order they started. */
  requests: Array<{ path: string; ms: number; startedAt: number }>
  /** Milliseconds until the screen's own heading is on the page. */
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

async function measure(page: Page, path: string, heading: RegExp): Promise<Measurement> {
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
   * From a neutral screen first, so nothing in flight from the previous route
   * lands inside the window and reads as this screen's work. Measured without
   * it, Home appeared to fetch `/api/trips` twice — once from the page it was
   * leaving.
   */
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /Settings/i }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')

  page.on('request', onRequest)
  page.on('requestfinished', onFinished)

  origin = Date.now()
  await page.goto(path)
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible()
  const firstContent = Date.now() - origin

  // Settled: the network is quiet and no skeleton is left on screen.
  await page.waitForLoadState('networkidle')
  const settled = Date.now() - origin

  page.off('request', onRequest)
  page.off('requestfinished', onFinished)

  return { screen: path, requests, firstContent, settled }
}

function report(m: Measurement): void {
  const depth = waterfallDepth(m.requests)
  console.log(
    `PERF ${m.screen.padEnd(12)} requests=${String(m.requests.length).padStart(2)} ` +
      `chain=${depth} firstContent=${String(m.firstContent).padStart(5)}ms ` +
      `settled=${String(m.settled).padStart(5)}ms`,
  )
  for (const request of m.requests) {
    console.log(`  ${String(request.startedAt).padStart(5)}ms +${String(request.ms).padStart(4)}ms  ${request.path}`)
  }
}

test.describe('how long each screen takes', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('Home, Trips, My Stuff and Settings, measured the same way', async ({ page }) => {
    const home = await measure(page, '/', /Pack Smart/i)
    const trips = await measure(page, '/trips', /Trips/i)
    const stuff = await measure(page, '/my-stuff', /My Stuff/i)
    const settings = await measure(page, '/settings', /Settings/i)

    for (const m of [home, trips, stuff, settings]) report(m)

    /*
     * The budget, as shape rather than as milliseconds — and set at what was
     * MEASURED, not at what would be nice.
     *
     * Today every screen waits on `/api/auth/session` before it issues its own
     * data request: the session answers at ~72ms and the data request does not
     * start until ~103ms. That is one serial round trip in front of every
     * navigation, and it is the real cost here — not, as was assumed before
     * measuring, readiness being recomputed per trip. Server responses are
     * 9–33ms.
     *
     * So the budget is **2**, which is today, and it holds the line while the
     * fix is scoped. Lowering it to 1 is P1b's job and its acceptance test.
     */
    for (const m of [home, trips, stuff, settings]) {
      expect(waterfallDepth(m.requests), `${m.screen}: sequential request chain`).toBeLessThanOrEqual(2)
    }

    // And nothing asks for the same thing twice on one load.
    for (const m of [home, trips, stuff, settings]) {
      const seen = new Set<string>()
      const duplicated = m.requests.filter((r) => !seen.add(`${r.path}`))
      expect(duplicated.map((r) => r.path), `${m.screen}: duplicate requests`).toEqual([])
    }
  })
})
