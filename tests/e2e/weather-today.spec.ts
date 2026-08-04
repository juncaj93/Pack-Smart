import { expect, test } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'
import { createTrip, deleteTrip, signIn, type TripFixture } from './fixtures'

/**
 * Weather on the Today screen, in a browser (E2).
 *
 * ## Why the forecast is served rather than stored
 *
 * This environment cannot reach Open-Meteo at all — `09_IMPLEMENTATION_NOTES.md`
 * §5 — so there is no way to make the app store a real forecast from a browser,
 * and **there must not be a test-only endpoint that writes one.** A door into
 * production code that exists for tests is a door.
 *
 * So the layers split by what each can honestly prove:
 *
 * - **`weather-conflict.test.ts`** proves the rules: which days conflict with
 *   which outfits, and which do not.
 * - **`weather-refresh.test.ts`** proves the wiring, against real SQL: that
 *   `fetched_at` reaches the briefing, that a dismissal is stored against the
 *   forecast it answered, that the approved outfit is untouched.
 * - **This file** proves what only a browser can: that the four states do not
 *   render alike, that a conflict is a pair of choices rather than a
 *   notification, that the buttons are wired to the endpoints, and that none of
 *   it pushes an iPhone screen sideways.
 *
 * The Today response is intercepted, and the service worker is blocked so the
 * interception is real — `page.route` does not see a request a service worker
 * makes, which is the trap `performance.spec.ts` documents at length.
 */

test.use({ serviceWorkers: 'block' })

function currentDates() {
  const today = new Date()
  const iso = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
  return { start: iso(-2), end: iso(5) }
}

interface WeatherPatch {
  freshness: 'live' | 'stale' | 'seasonal' | 'unavailable'
  ageDays?: number
  seasonal?: boolean
  conflicts?: Array<Record<string, unknown>>
}

/**
 * Serves the real Today response with its weather half replaced.
 *
 * Everything else — the plan, the outfit, the carry list — is whatever the
 * server actually said, so a change that broke the rest of the screen still
 * fails here.
 */
async function withWeather(page: Page, patch: WeatherPatch): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000)

  await page.route('**/api/trips/*/today**', async (route: Route) => {
    const response = await route.fetch()
    const body = (await response.json()) as Record<string, unknown>

    body.freshness = patch.freshness
    body.weatherFetchedAt =
      patch.freshness === 'unavailable' ? null : nowSeconds - (patch.ageDays ?? 0) * 86_400
    body.weather =
      patch.freshness === 'unavailable'
        ? null
        : {
            source: patch.seasonal ? 'climate_normal' : 'forecast',
            lowF: 54,
            highF: 75,
            rainLikely: false,
            precipitationProbability: 10,
            tempMinC: 12,
            tempMaxC: 24,
            windKph: 8,
          }
    body.conflicts = patch.conflicts ?? []

    await route.fulfill({ response, json: body })
  })
}

const RAIN_CONFLICT = {
  kind: 'rain',
  headline: 'Rain is likely and nothing in today’s outfit keeps it off',
  detail: 'Your approved outfit has not changed. Swap one in for today only, or keep what you have.',
  role: 'top',
  roleLabel: 'Top',
  itemId: 'w1',
  itemName: 'Linen shirt',
  alternatives: [{ itemId: 'shell', name: 'Gore-Tex Shell' }],
}

async function readyTrip(page: Page, owner: string): Promise<TripFixture> {
  const { start, end } = currentDates()
  return createTrip(page, { owner, startDate: start, endDate: end })
}

async function openToday(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/today`)
  await expect(page.locator('.day-nav')).toBeVisible()
}

const weatherLine = (page: Page): Locator => page.locator('.today-weather')
const conflicts = (page: Page): Locator => page.locator('.today-conflict')

/* ------------------------------------------------------------------ */

test.describe('the four weather states', () => {
  test('a live forecast reads as a plain number with no caveat', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Live')

    try {
      await withWeather(page, { freshness: 'live' })
      await openToday(page, trip.id)

      await expect(weatherLine(page)).toHaveClass(/is-live/)
      await expect(weatherLine(page)).toContainText('°F')
      // No age, no `Usually`, and nothing to check again — a label on the
      // ordinary case is noise.
      await expect(weatherLine(page).locator('.today-weather-tag')).toHaveCount(0)
      await expect(weatherLine(page).getByRole('button')).toHaveCount(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('a stale forecast says how old it is and offers to check again', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Stale')

    try {
      await withWeather(page, { freshness: 'stale', ageDays: 3 })
      await openToday(page, trip.id)

      await expect(weatherLine(page)).toHaveClass(/is-stale/)
      await expect(weatherLine(page)).toContainText('Checked 3 days ago')
      await expect(weatherLine(page).getByRole('button', { name: 'Check again' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('seasonal guidance never reads as a forecast', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Seasonal')

    try {
      await withWeather(page, { freshness: 'seasonal', seasonal: true })
      await openToday(page, trip.id)

      await expect(weatherLine(page)).toHaveClass(/is-seasonal/)
      await expect(weatherLine(page)).toContainText('Usually')
      await expect(weatherLine(page)).toContainText('Usual weather, not a forecast')
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('no weather at all is said out loud rather than left blank', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W None')

    try {
      await withWeather(page, { freshness: 'unavailable' })
      await openToday(page, trip.id)

      await expect(weatherLine(page)).toHaveClass(/is-unavailable/)
      await expect(weatherLine(page)).toContainText('No weather for today')
      await expect(weatherLine(page).getByRole('button', { name: 'Check' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  /**
   * The assertion the whole first half of E2 exists for.
   *
   * `54–75°F` is true in three of these states and means something different in
   * each. If two of them render the same text, the screen is misleading by
   * omission — which is `01_ARCHITECTURE.md` §6's complaint about climate
   * normals, extended to age.
   */
  test('no two states produce the same line', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Distinct')

    try {
      const readings: string[] = []

      const states: WeatherPatch[] = [
        { freshness: 'live' },
        { freshness: 'stale', ageDays: 3 },
        { freshness: 'seasonal', seasonal: true },
        { freshness: 'unavailable' },
      ]

      for (const state of states) {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        await withWeather(page, state)
        await openToday(page, trip.id)
        readings.push((await weatherLine(page).textContent())?.trim() ?? '')
      }

      expect(new Set(readings).size).toBe(readings.length)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})

/* ------------------------------------------------------------------ */

test.describe('when the weather disagrees with the outfit', () => {
  test('says what is wrong, names the slot, and offers two answers', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Rain')

    try {
      await withWeather(page, { freshness: 'live', conflicts: [RAIN_CONFLICT] })
      await openToday(page, trip.id)

      await expect(conflicts(page)).toHaveCount(1)
      await expect(conflicts(page)).toContainText('Rain is likely')
      // The slot it is about, named rather than counted.
      await expect(conflicts(page)).toContainText('Linen shirt')
      // And the promise, on the banner itself.
      await expect(conflicts(page)).toContainText('has not changed')

      await expect(conflicts(page).getByRole('button', { name: 'Wear something else' })).toBeVisible()
      await expect(conflicts(page).getByRole('button', { name: 'Keep this outfit' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('says nothing on an ordinary day', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Calm')

    try {
      await withWeather(page, { freshness: 'live' })
      await openToday(page, trip.id)

      await expect(conflicts(page)).toHaveCount(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('offers only the packed alternatives it was given, and applies none of them by itself', async ({
    page,
  }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Alternatives')

    try {
      await withWeather(page, { freshness: 'live', conflicts: [RAIN_CONFLICT] })
      await openToday(page, trip.id)

      await conflicts(page).getByRole('button', { name: 'Wear something else' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      // For today only, said before anything is tapped.
      await expect(sheet).toContainText('For today only')
      await expect(sheet.locator('.swap-name')).toHaveText(['Gore-Tex Shell'])
      // And saying no is a control in the sheet too, not just an ✕.
      await expect(sheet.getByRole('button', { name: 'Keep this outfit' })).toBeVisible()
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  /**
   * "Keep this outfit" is an ANSWER, not a dismissal.
   *
   * Doc 04 §12 is that an approved outfit changes only when Alex says so, and
   * that has to include saying no. This asserts the browser half: the button
   * reaches the endpoint, and the screen repaints from what came back rather
   * than from a guess. That it is *remembered* is proved against real SQL in
   * `weather-refresh.test.ts`.
   */
  test('keeping the outfit posts the answer and repaints from it', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Keep')

    try {
      await withWeather(page, { freshness: 'live', conflicts: [RAIN_CONFLICT] })
      await openToday(page, trip.id)
      await expect(conflicts(page)).toHaveCount(1)

      const posted: string[] = []
      await page.route('**/api/trips/*/today/dismiss', async (route: Route) => {
        posted.push(route.request().postData() ?? '')
        const current = await (await page.request.get(`/api/trips/${trip.id}/today`)).json()
        await route.fulfill({ json: { ...current, conflicts: [] } })
      })

      await conflicts(page).getByRole('button', { name: 'Keep this outfit' }).click()

      await expect(conflicts(page)).toHaveCount(0)
      expect(posted).toHaveLength(1)
      expect(posted[0]).toContain('"kind":"rain"')
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('Check again asks the server to go and look', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Refresh')

    try {
      await withWeather(page, { freshness: 'stale', ageDays: 3 })
      await openToday(page, trip.id)

      let asked = 0
      await page.route('**/api/trips/*/today/weather', async (route: Route) => {
        asked += 1
        const current = (await (await page.request.get(`/api/trips/${trip.id}/today`)).json()) as
          Record<string, unknown>
        await route.fulfill({
          json: {
            ...current,
            freshness: 'live',
            weatherFetchedAt: Math.floor(Date.now() / 1000),
            weather: {
              source: 'forecast',
              lowF: 54,
              highF: 75,
              rainLikely: false,
              precipitationProbability: 10,
              tempMinC: 12,
              tempMaxC: 24,
              windKph: 8,
            },
            conflicts: [],
          },
        })
      })

      await weatherLine(page).getByRole('button', { name: 'Check again' }).click()

      await expect(weatherLine(page)).toHaveClass(/is-live/)
      expect(asked).toBe(1)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('is announced rather than shouted, and every control has a name', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W A11y')

    try {
      await withWeather(page, { freshness: 'live', conflicts: [RAIN_CONFLICT] })
      await openToday(page, trip.id)

      await expect(page.locator('.today-conflicts')).toHaveAttribute('role', 'status')
      for (const button of await conflicts(page).getByRole('button').all()) {
        expect(((await button.textContent()) ?? '').trim().length).toBeGreaterThan(0)
      }
    } finally {
      await deleteTrip(page, trip.id)
    }
  })

  test('does not push the screen sideways', async ({ page }) => {
    await signIn(page)
    const trip = await readyTrip(page, 'W Width')

    try {
      await withWeather(page, {
        freshness: 'stale',
        ageDays: 3,
        conflicts: [RAIN_CONFLICT, { ...RAIN_CONFLICT, kind: 'colder', headline: 'Colder today than this outfit was planned for' }],
      })
      await openToday(page, trip.id)
      await expect(conflicts(page).first()).toBeVisible()

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await deleteTrip(page, trip.id)
    }
  })
})
