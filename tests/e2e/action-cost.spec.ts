import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createOwnedItem, createTrip, deleteTrip, ownedName, signIn } from './fixtures'

/**
 * What every write on the P1B list costs, ranked (P1B audit).
 *
 * The brief names nine more paths after `Apply itinerary` and says to
 * **prioritise by actual user-visible blocking time rather than code
 * neatness**. That is a measurement, and this is it: each action is performed
 * against the real Worker with Alex's real workbook seeded, and the
 * `Server-Timing` header says where the time went inside.
 *
 * ## Why this drives the API rather than the screen
 *
 * Every one of these writes is awaited by the client before anything changes,
 * so the server's own time IS the blocking time — and driving eight different
 * screens to reach eight different buttons would make this an eight-screen
 * regression suite that happens to print numbers, fragile in eight new ways and
 * measuring the same figure at the end. The screens' own cost is already
 * covered: `performance.spec.ts` measures loading and navigation, and
 * `itinerary-apply.spec.ts` measures one whole tap end to end.
 *
 * ## Nothing here asserts a duration
 *
 * Same rule as everywhere else in this repository. The assertions are that each
 * action SUCCEEDS; the numbers are printed for the record and read by a person.
 * A ranked table that fails the build when a runner is loaded would be worse
 * than no table at all.
 */

interface Cost {
  action: string
  /** Milliseconds from issuing the request to having the whole response. */
  ms: number
  /** `Server-Timing` stages, in the order the Worker ran them. */
  inside: string
  status: number
}

/**
 * Performs one write in the page and reports what it cost.
 *
 * In the page rather than from node, so it goes through the same origin, the
 * same session cookie and the same Worker the app uses.
 */
async function cost(
  page: Page,
  action: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Cost> {
  const result = await page.evaluate(
    async ([action, path, payload]) => {
      const options = JSON.parse(payload as string) as { method: string; body?: unknown }
      const started = performance.now()
      const response = await fetch(path as string, {
        method: options.method,
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      // Read the body: a response is not finished until it has been consumed,
      // and half of these carry a regenerated list.
      await response.text()
      return {
        action: action as string,
        ms: performance.now() - started,
        inside: response.headers.get('server-timing') ?? '—',
        status: response.status,
      }
    },
    [action, path, JSON.stringify(init)],
  )

  return result
}

test.describe('what each write costs', () => {
  /*
   * Blocked, for the reason `performance.spec.ts` gives: a request the service
   * worker handles never reaches the page's own timing, so every number here
   * would be the worker's cache rather than the Worker's work.
   */
  test.use({ serviceWorkers: 'block' })

  test('every path on the P1B list, ranked by what it makes Alex wait for', async ({ page }) => {
    await signIn(page)
    const trip = await createTrip(page, { owner: 'ActionCost' })
    /*
     * Named through `ownedName`, and that is not decoration.
     *
     * The run-level teardown matches ` \d+-[0-9a-z]{6}` **anchored at the end**
     * of the name, so a trip called `ActionCost 1-ab12cd created` is invisible
     * to it and survives the run. Doc 09 §5a records what a handful of those
     * cost: eighteen leftover trips, every one of them loaded on the Trips
     * screen and ranked for every slot of every outfit, and two consecutive
     * runs each losing a different test to a plain timeout.
     */
    const secondName = ownedName('ActionCostCreate')
    let second: string | null = null

    try {
      const costs: Cost[] = []

      /* Trip creation — the second one, so the first is not paying for a cold
       * connection that every other row below gets for free. */
      costs.push(
        await cost(page, 'POST /trips (create)', '/api/trips', {
          method: 'POST',
          body: {
            name: secondName,
            startDate: '2026-07-31',
            endDate: '2026-08-11',
            destinations: [{ name: 'Cape Town', country: 'South Africa' }],
            activities: ['safari', 'nice_dinner'],
            international: true,
            laundryAvailable: false,
            flightHours: 15,
          },
        }),
      )
      second = await page.evaluate(async ([wanted]) => {
        const response = await fetch('/api/trips')
        const body = (await response.json()) as { trips: Array<{ id: string; name: string }> }
        return body.trips.find((t) => t.name === wanted)?.id ?? null
      }, [secondName])
      expect(second, 'the measured trip was created').not.toBeNull()

      /* Itinerary editing — the trip edit that regenerates the checklist. */
      costs.push(
        await cost(page, 'PUT /trips/:id (edit)', `/api/trips/${trip.id}`, {
          method: 'PUT',
          body: {
            name: trip.name,
            startDate: '2026-07-31',
            endDate: '2026-08-12',
            destinations: [{ name: 'Cape Town', country: 'South Africa' }],
            activities: ['safari', 'nice_dinner', 'beach'],
            international: true,
            laundryAvailable: false,
            flightHours: 15,
          },
        }),
      )

      /* Naming days — P1B's first path, kept here so a regression shows up
       * beside its neighbours rather than only in its own spec. */
      costs.push(
        await cost(page, 'PUT /trips/:id/days', `/api/trips/${trip.id}/days`, {
          method: 'PUT',
          body: {
            days: [
              { date: '2026-08-02', activityTag: 'safari' },
              { date: '2026-08-03', activityTag: 'safari' },
              { date: '2026-08-04', activityTag: 'nice_dinner' },
            ],
          },
        }),
      )

      costs.push(
        await cost(page, 'POST …/outfits/generate', `/api/trips/${trip.id}/outfits/generate`, {
          method: 'POST',
        }),
      )

      /* Weather refresh — reaches the network, or fails to, and either way Alex
       * is waiting on it. */
      costs.push(
        await cost(page, 'POST /trips/:id/weather', `/api/trips/${trip.id}/weather`, {
          method: 'POST',
        }),
      )

      /* Checklist toggles, Pack Now and bag assignment are one PATCH each. */
      const entry = await page.evaluate(async ([id]) => {
        const response = await fetch(`/api/trips/${id}/checklist`)
        const body = (await response.json()) as { entries: Array<{ id: string }> }
        return body.entries[0]?.id ?? null
      }, [trip.id])
      expect(entry, 'the trip has a checklist to toggle').not.toBeNull()

      costs.push(
        await cost(page, 'PATCH checklist (pack)', `/api/trips/${trip.id}/checklist/${entry}`, {
          method: 'PATCH',
          body: { packedQty: 1 },
        }),
      )
      costs.push(
        await cost(page, 'PATCH checklist (Pack Now)', `/api/trips/${trip.id}/checklist/${entry}`, {
          method: 'PATCH',
          body: { packingTiming: 'day_of' },
        }),
      )
      costs.push(
        await cost(page, 'PATCH checklist (bag)', `/api/trips/${trip.id}/checklist/${entry}`, {
          method: 'PATCH',
          body: { bag: 'carry_on' },
        }),
      )

      /*
       * Item editing — a rating, which is the write P1A made optimistic.
       *
       * **On a garment this spec owns, never on a seeded one.** A comfort
       * rating is a planner input: `comfortSignal` reads it, so rating one of
       * Alex's real garments and leaving it rated changes what every later spec
       * plans. That is not hypothetical — `review-closet.spec.ts` did exactly
       * this and took three `today.spec.ts` tests down with it, visible only
       * under CI's one worker. The run-level teardown retires what `ownedName`
       * created, so this borrows nothing.
       */
      const owned = await createOwnedItem(page, 'ActionCost', {
        kind: 'clothing',
        category: 'Tops & Outerwear',
        subcategory: 'T-Shirt',
      })

      costs.push(
        await cost(page, 'PATCH /items/:id (rating)', `/api/items/${owned.id}`, {
          method: 'PATCH',
          body: { comfort: 4 },
        }),
      )

      /* Today — a read, and the one screen with a documented one-response
       * contract, so it belongs in the same table as the writes. */
      costs.push(
        await cost(page, 'GET /trips/:id/today', `/api/trips/${trip.id}/today`, { method: 'GET' }),
      )

      for (const measured of costs) {
        expect(measured.status, `${measured.action} succeeded`).toBeLessThan(400)
      }

      const ranked = [...costs].sort((a, b) => b.ms - a.ms)
      console.log(
        [
          '',
          'P1B AUDIT — every write, ranked by what Alex waits for',
          ...ranked.map(
            (m) => `  ${`${m.ms.toFixed(0)}ms`.padStart(7)}  ${m.action.padEnd(30)} ${m.inside}`,
          ),
          '',
        ].join('\n'),
      )

    } finally {
      // Both, on the failure path too. An assertion above throws before any
      // cleanup written after it can run — which is how a leak becomes
      // permanent rather than occasional.
      if (second) await deleteTrip(page, second)
      await deleteTrip(page, trip.id)
    }
  })
})
