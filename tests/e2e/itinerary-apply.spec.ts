import { expect, test } from '@playwright/test'
import type { Page, Response } from '@playwright/test'
import { createTrip, deleteTrip, signIn } from './fixtures'

/**
 * What `Apply itinerary` costs Alex, stage by stage (P1B).
 *
 * The brief names ten stages and asks for numbers before and after, so this
 * measures all ten through one real tap rather than timing repository calls in
 * a vitest harness. Four of them happen inside the Worker and nothing on the
 * client can see them from outside; those are read out of the `Server-Timing`
 * header the route now sets (see `worker/timing.ts`).
 *
 * **The assertions are about SHAPE, never about milliseconds.** `performance.spec.ts`
 * established the rule and the reason: a CI runner's absolute timings are not
 * reproducible, and a gate that fails when the runner is loaded is the flake
 * this repository keeps refusing to accept. What is stable is causality — which
 * work the tap waits for — and that is what is asserted. The durations are
 * printed for the record, and belong in doc 09 beside the after numbers.
 */

const ITINERARY = [
  'Destination: Cape Town',
  '2 August 2026 - game drive at first light',
  '3 August 2026 - game drive',
  '4 August 2026 - game drive, afternoon at leisure',
  '6 August 2026 - wine tasting in Stellenbosch',
].join('\n')

/** One request the tap caused, and what the Worker said it spent inside. */
interface Call {
  path: string
  /** Milliseconds from the tap to the request being issued. */
  startedAt: number
  /** Milliseconds from the tap to the response being complete. */
  finishedAt: number
  /** The `Server-Timing` stages, in the order the Worker ran them. */
  stages: Array<{ name: string; ms: number }>
}

function parseServerTiming(header: string | null): Call['stages'] {
  if (!header) return []
  return header
    .split(',')
    .map((entry) => {
      const [name, ...rest] = entry.trim().split(';')
      const duration = rest.find((part) => part.trim().startsWith('dur='))
      return { name: name!.trim(), ms: Number(duration?.split('=')[1] ?? NaN) }
    })
    .filter((stage) => Number.isFinite(stage.ms))
}

/**
 * Starts recording SPA navigations.
 *
 * `navigate()` from react-router is a `history.pushState` call, not a document
 * navigation, so Playwright's own navigation events never fire — the only
 * honest way to timestamp "navigation begins" is from inside the page. Polling
 * `page.url()` would time the poll rather than the navigation.
 */
async function recordNavigations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record: Array<{ path: string; at: number }> = []
    ;(window as unknown as { __nav: typeof record }).__nav = record

    for (const name of ['pushState', 'replaceState'] as const) {
      const original = history[name].bind(history)
      history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
        original(data, unused, url)
        // Two statements rather than one, so `location.pathname` and a clock
        // never share a line: `e2e-isolation.test.ts` forbids that shape, and
        // it is right to — a trip NAME built from a clock is invisible to the
        // run-level teardown. This is neither, but the rule cannot tell, and a
        // rule that gets relaxed for one false positive stops catching the real
        // ones.
        const at = Date.now()
        record.push({ path: location.pathname, at })
      }
    }
  })
}

async function navigatedToOutfitsAt(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const record = (window as unknown as { __nav?: Array<{ path: string; at: number }> }).__nav ?? []
    return record.find((entry) => entry.path.endsWith('/outfits'))?.at ?? null
  })
}

test.describe('applying an itinerary', () => {
  /*
   * The service worker is blocked, for the same reason `performance.spec.ts`
   * blocks it: a request the worker handles never reaches the page's own
   * `response` events, so half the calls below would simply not be recorded.
   */
  test.use({ serviceWorkers: 'block' })

  test('moves on without waiting for the whole wardrobe to be replanned', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'ApplyCost', activities: [] })

    try {
      await page.goto(`/trips/${trip.id}/itinerary`)
      await page.getByLabel('Your itinerary').fill(ITINERARY)
      await page.getByRole('button', { name: 'Read this' }).click()
      await expect(page.getByText('Here is what Pack Smart understood')).toBeVisible()

      const calls: Call[] = []
      let tappedAt = 0

      const onResponse = async (response: Response) => {
        const url = new URL(response.url())
        if (!url.pathname.startsWith('/api/')) return
        const request = response.request()
        const startedAt = request.timing().startTime
        calls.push({
          path: url.pathname.replace(/\/[0-9a-f-]{36}/gi, '/:id'),
          startedAt: startedAt - tappedAt,
          finishedAt: Date.now() - tappedAt,
          stages: parseServerTiming(await response.headerValue('server-timing')),
        })
      }

      await recordNavigations(page)
      const listener = (response: Response) => void onResponse(response)
      page.on('response', listener)

      /*
       * Located by position rather than by name, because its NAME is what
       * changes: the button reads "Add these to the trip" before the tap and
       * "Saving…" after it, so a name-based locator stops matching at exactly
       * the moment being measured.
       */
      const apply = page.locator('section.proposal > button.button-primary')

      /* 1 — the tap. Every number below is measured from here. */
      tappedAt = Date.now()
      await apply.click()

      /*
       * 2 — immediate acknowledgement.
       *
       * The changed label, not merely the button's presence: it is on the page
       * before the tap, so asserting it is visible would measure nothing and
       * would pass in a build that acknowledged nothing at all.
       */
      await expect(apply).toHaveText('Saving…')
      const acknowledged = Date.now() - tappedAt

      /* 8 — navigation begins (recorded in the page, read back afterwards). */
      /* 9 — the destination screen's frame. */
      await expect(page.getByRole('heading', { name: 'Outfits', exact: true })).toBeVisible({
        timeout: 30_000,
      })
      const rendered = Date.now() - tappedAt

      /*
       * 10 — interactive. The primary navigation is on the page and responds,
       * which is what "the app has moved on" means for Alex: he can leave.
       */
      await expect(
        page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trips/ }),
      ).toBeEnabled()
      const interactive = Date.now() - tappedAt

      /*
       * 11 — the answer. NOT one of the brief's ten, and deliberately reported
       * anyway: deferring expensive work moves the wait rather than deleting
       * it, and a before/after table that stopped at stage 10 would read as a
       * twenty-fold win when the plan still takes exactly as long to compute.
       * What changes is whether Alex is held still while it does.
       */
      await expect(page.getByRole('heading', { name: 'Safari' })).toBeVisible({ timeout: 30_000 })
      const answered = Date.now() - tappedAt

      const navigatedAt = await navigatedToOutfitsAt(page)
      page.off('response', listener)

      const line = (stage: string, ms: number | null) =>
        `  ${stage.padEnd(34)}${ms === null ? '     —' : `${String(Math.round(ms)).padStart(6)}ms`}`

      const lines = [
        '',
        'APPLY ITINERARY — ten stages, one tap',
        line('1  tap', 0),
        line('2  immediate acknowledgement', acknowledged),
      ]

      for (const call of calls) {
        lines.push(line(`3  request dispatch  ${call.path}`, call.startedAt))
        let elapsed = call.startedAt
        for (const stage of call.stages) {
          if (stage.name === 'total') continue
          lines.push(line(`   ├ ${stage.name}`, (elapsed += stage.ms)))
        }
        const server = call.stages.find((s) => s.name === 'total')?.ms ?? 0
        lines.push(line(`   └ response complete (server ${server.toFixed(1)}ms)`, call.finishedAt))
      }

      lines.push(
        line('8  navigation begins', navigatedAt === null ? null : navigatedAt - tappedAt),
        line('9  destination renders', rendered),
        line('10 screen is interactive', interactive),
        line('11 the plan is on screen', answered),
        '',
      )
      console.log(lines.join('\n'))

      /*
       * One machine-readable line as well as the table.
       *
       * Before/after numbers are only worth having if they come from more than
       * one run each — the very first attempt at this comparison read a 26ms
       * REGRESSION in time-to-navigation, which turned out to be an unrelated
       * request on a cold database being 53ms slower that afternoon. This line
       * is what makes `--repeat-each` aggregatable.
       */
      const days = calls.find((call) => call.path.endsWith('/days'))
      console.log(
        `P1B-SUMMARY ack=${acknowledged} daysServer=${
          days?.stages.find((s) => s.name === 'total')?.ms.toFixed(1) ?? '?'
        } nav=${navigatedAt === null ? '?' : navigatedAt - tappedAt} render=${rendered} ` +
          `interactive=${interactive} plan=${answered}`,
      )

      /*
       * The shape, as causality rather than as a stopwatch.
       *
       * `navigation begins` is the number the product goal is about — "the app
       * moves on quickly". Asserting it against the wall clock would be a
       * flake; asserting it against the work it used to wait for is a fact.
       */
      expect(navigatedAt, 'navigation was recorded').not.toBeNull()
      const navigated = navigatedAt! - tappedAt

      const replan = calls.find((call) => call.stages.some((stage) => stage.name === 'replan'))
      expect(replan, 'the replan is attributed to a request').toBeTruthy()
      expect(navigated, 'the tap does not wait for the replan').toBeLessThan(replan!.finishedAt)

      // And moving on did not cost the answer: the plan still arrives, and it
      // is the plan the itinerary asked for.
      await expect(page.getByText('3 days').first()).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
