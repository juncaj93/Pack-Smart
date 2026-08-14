import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { currentDateFor } from '../../worker/services/today'
import { refreshWeather } from '../../worker/services/weather'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * When a trip learns what time zone it is in — and what reads it too early sees.
 *
 * A trip is created with `timezone` NULL. The zone arrives free with the first
 * forecast: `services/weather.ts` writes the stop's zone out of the Open-Meteo
 * response, and `routes/trips.ts` starts that fetch in `waitUntil` so saving a
 * trip does not wait on a network round trip. Both halves are deliberate, and
 * together they mean a trip is briefly a trip that does not know what day it is
 * — it answers with the phone's date until the zone lands, then with Cape
 * Town's.
 *
 * From 22:00 UTC those are different days, and that gap cost this repository an
 * evening twice. Most recently `today.spec.ts:848` failed on WebKit CI at 22:28
 * with `Received array: []`: the fixture read the date, wrote the day's two
 * activities onto it, and by the time the screen rendered, the zone had landed
 * and the screen was showing the next day — which had no plan on it at all.
 *
 * The fix is on the fixture's side (`tests/e2e/fixtures.ts`, `todayForTrip`
 * settles the forecast in the foreground before it answers), so this proves the
 * PROPERTY that fix depends on: awaiting `refreshWeather` is enough, because the
 * zone is stored before it resolves. Nothing here can be satisfied by the
 * fixture change itself — it exercises the worker directly.
 *
 * This environment cannot reach Open-Meteo (09_IMPLEMENTATION_NOTES.md §5), so
 * `fetch` is stubbed with the shapes the API documents. That is the same
 * constraint `tests/unit/worker/weather.test.ts` works under and the same
 * answer.
 */

/** 2026-08-14 22:28 UTC — the minute the CI failure happened. */
const AT = new Date('2026-08-14T22:28:00Z')
const NOW = Math.floor(AT.getTime() / 1000)

const GEOCODING = {
  results: [{ name: 'Cape Town', country: 'South Africa', latitude: -33.92, longitude: 18.42 }],
}

/**
 * A forecast carrying a zone two hours ahead of UTC.
 *
 * `timezone: 'auto'` is what the worker asks for, so the response naming the
 * destination's own zone is the documented behaviour rather than a convenience.
 */
const FORECAST = {
  timezone: 'Africa/Johannesburg',
  daily: {
    time: ['2026-08-14', '2026-08-15', '2026-08-16'],
    temperature_2m_max: [18.4, 21.1, 19.0],
    temperature_2m_min: [9.2, 11.8, 10.5],
    precipitation_probability_max: [10, 20, 15],
    wind_speed_10m_max: [22.5, 18.0, 20.2],
  },
}

let db: TestDatabase
const realFetch = globalThis.fetch

beforeEach(() => {
  db = createTestDatabase()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('geocoding-api') ? GEOCODING : FORECAST
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  db.close()
})

async function capeTownTrip() {
  return createTrip(
    db.binding,
    {
      name: 'Zone Race',
      startDate: '2026-08-12',
      endDate: '2026-08-19',
      destinations: [{ name: 'Cape Town', country: 'South Africa' }],
      activities: [],
    },
    NOW,
  )
}

describe('the date a trip is on, before and after its forecast lands', () => {
  it('answers with UTC while the trip has no zone, and Cape Town once it does', async () => {
    const created = await capeTownTrip()

    // Before: nothing has been fetched, so there is no zone to read it in.
    expect(created.timezone).toBeNull()
    expect(currentDateFor(created, null, AT).date).toBe('2026-08-14')

    await refreshWeather(db.binding, created, '2026-08-14', NOW)

    const settled = await getTrip(db.binding, created.id)
    expect(settled).not.toBeNull()

    /*
     * The whole point, in one line: the SAME instant, read through the zone the
     * forecast brought, is the next day. Not a bug — 00:28 in Cape Town really
     * is the 15th, and a travel app being on the traveller's day is the product
     * decision `shared/today.ts` documents. It is only a hazard for anything
     * that read the date before this moment and assumed it would keep.
     */
    expect(currentDateFor(settled!, null, AT).date).toBe('2026-08-15')
  })

  it('has stored the zone by the time the refresh resolves', async () => {
    const created = await capeTownTrip()

    await refreshWeather(db.binding, created, '2026-08-14', NOW)

    /*
     * This is the property `todayForTrip` relies on: the refresh does not
     * resolve owing a write.
     *
     * What it catches, checked by mutation: removing the write fails this and
     * the test above. What it does NOT catch, also checked: dropping the `await`
     * in front of `saveTimezone` still passes here, because `node:sqlite` is
     * synchronous and the promise is already settled by the time this line runs.
     * A real deferral — moving the write into a `waitUntil`, or behind a queue —
     * would fail this; a merely unawaited one would not, and this environment
     * cannot tell the difference. Said plainly rather than left as an implied
     * guarantee.
     */
    const settled = await getTrip(db.binding, created.id)
    expect(settled?.destinations[0]?.timezone).toBe('Africa/Johannesburg')
  })

  it('leaves the trip on the phone’s date when the service cannot be reached', async () => {
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.open-meteo.com')
    }) as typeof fetch

    const created = await capeTownTrip()
    const outcome = await refreshWeather(db.binding, created, '2026-08-14', NOW)

    /*
     * The other half of the settle being safe. A blocked service is this
     * sandbox's normal condition, and it has to resolve — reporting what
     * happened — rather than hang or throw, or every fixture that waits on it
     * would be waiting on nothing.
     */
    expect(outcome.status).toBe('unavailable')

    const settled = await getTrip(db.binding, created.id)
    expect(settled?.destinations[0]?.timezone).toBeNull()
    // And with no zone stored, both the fixture and the screen read UTC. They
    // agree — which is exactly why this never reproduced locally.
    expect(currentDateFor(settled!, null, AT).date).toBe('2026-08-14')
  })
})
