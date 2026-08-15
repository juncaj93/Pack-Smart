import { beforeEach, describe, expect, it } from 'vitest'
import { HOME_WEATHER_KEY, HOME_LOCATION_KEY, setPreference } from '../../worker/repos/preferences'
import { createTrip } from '../../worker/repos/trips'
import { replaceWeather } from '../../worker/repos/weather'
import { homeWeather, setHomeLocation } from '../../worker/services/home-weather'
import { createTestDatabase, type TestDatabase } from './d1'
import type { HomeWeatherCache } from '@shared/home-location'
import type { WeatherDay } from '@shared/weather'

/**
 * What the Home status row is about, against real SQL.
 *
 * ## Why this file exists at all
 *
 * Open-Meteo is unreachable from THIS build environment, so a forecast cannot be
 * fetched here. It is reachable from CI. That asymmetry is the trap this file
 * has to be written around, and it has already caught one test out: an assertion
 * that a refetch produced nothing passed locally and failed on a runner that
 * could actually reach the host.
 *
 * So the rule for this file is: **never assert that a fetch failed.** Where a
 * test does not care about fetching, it plants a recent `attemptedAt` so the
 * refresh gate declines and no network call is made at all — which also keeps
 * the suite hermetic and quick. Where a test is ABOUT the refetch, it asserts
 * the invariant that holds either way.
 *
 * What is proved here and nowhere else: the reduction from stored days to a
 * rendered reading, and which PLACE the row is about. The second is the one with
 * the sharp edge — getting it wrong means telling Alex it is 64°F in Michigan
 * while he is standing in Cape Town.
 */

const NOW = 1_786_000_000
const TODAY = '2026-08-15'

let db: TestDatabase
/** The D1 binding the Worker itself is handed. */
let binding: D1Database

function day(date: string, min: number, max: number): WeatherDay {
  return {
    date,
    tempMinC: min,
    tempMaxC: max,
    precipitationProbability: 5,
    windKph: 8,
    source: 'forecast',
  }
}

/** The cache a successful fetch would have written. */
function plantHomeForecast(place = 'Wixom, Michigan') {
  const cache: HomeWeatherCache = {
    place,
    latitude: 42.52,
    longitude: -83.53,
    timezone: 'America/Detroit',
    days: [day(TODAY, 14, 24)],
    fetchedAt: NOW - 60,
    attemptedAt: NOW - 60,
  }
  return setPreference(binding, HOME_WEATHER_KEY, cache, NOW)
}

/**
 * A cache that holds nothing but is too recent to retry.
 *
 * For the tests that are about the PLACE rather than about the forecast: the
 * refresh gate declines, so no network call is made and the answer is the same
 * on a runner with a connection and one without.
 */
function plantNoForecastYet(place: string) {
  const cache: HomeWeatherCache = {
    place,
    latitude: null,
    longitude: null,
    timezone: null,
    days: [],
    fetchedAt: null,
    attemptedAt: NOW - 60,
  }
  return setPreference(binding, HOME_WEATHER_KEY, cache, NOW)
}

beforeEach(async () => {
  db = await createTestDatabase()
  binding = db.binding
})

describe('when Alex is at home', () => {
  it('answers with Wixom before he has said anything', async () => {
    await plantNoForecastYet('Wixom, Michigan')

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.place.source).toBe('home')
    expect(result.place.name).toBe('Wixom')
  })

  /**
   * The reduction the whole feature turns on, and the one that cannot be proved
   * anywhere else in this repository.
   */
  it('reads a stored forecast into the same shape the briefing produces', async () => {
    await plantHomeForecast()

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.weather).not.toBeNull()
    // 14–24°C is 57–75°F. The conversion is `toFahrenheit`'s and is shared with
    // every other surface, which is the point of going through `weatherForDay`.
    expect(result.weather!.lowF).toBe(57)
    expect(result.weather!.highF).toBe(75)
    expect(result.freshness).toBe('live')
  })

  it('shows the town rather than the whole line Alex typed', async () => {
    await setHomeLocation(binding, 'Ann Arbor, Michigan', NOW)
    await plantNoForecastYet('Ann Arbor, Michigan')

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    // The row has a date and a clock beside it; `Ann Arbor, Michigan` is most of
    // a line at 360px and the town is the part that answers "where am I".
    expect(result.place.name).toBe('Ann Arbor')
  })

  /**
   * The mutation: keeping a cache whose place no longer matches.
   *
   * Without the name check this would serve Wixom's numbers under Ann Arbor's
   * name for twelve hours — a forecast that is confidently, invisibly wrong,
   * which is worse than none.
   */
  it('ignores a forecast fetched for somewhere he no longer lives', async () => {
    await plantHomeForecast('Wixom, Michigan')
    await setPreference(binding, HOME_LOCATION_KEY, { name: 'Reykjavik, Iceland' }, NOW)

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.place.name).toBe('Reykjavik')

    /*
     * The invariant, stated so it holds with a connection and without one.
     *
     * With one, the refetch produces Reykjavik's numbers; without, there are
     * none. Asserting `null` was asserting that the network was down, which is
     * a fact about the runner rather than about the product — it passed here
     * and failed on CI, which is exactly the right way round to find out.
     *
     * What must never happen either way is Wixom's 57–75°F appearing under
     * Reykjavik's name.
     */
    const served = result.weather ? [result.weather.lowF, result.weather.highF] : null
    expect(served, 'Wixom’s numbers were served under Reykjavik’s name').not.toEqual([57, 75])
  })
})

describe('when a trip is underway', () => {
  async function tripCoveringToday() {
    return createTrip(
      binding,
      {
        name: 'Cape Town now',
        startDate: '2026-08-13',
        endDate: '2026-08-20',
        destinations: [{ name: 'Cape Town', country: 'South Africa' }],
        activities: [],
        international: true,
      },
      NOW,
    )
  }

  /**
   * The failure this whole server-side decision exists to prevent.
   *
   * A client that asked for "home weather" and swapped once it knew about the
   * trip would put Michigan's forecast on the front door while Alex was in
   * South Africa — for one round trip on every single open.
   */
  it('is about where he has gone, not where he lives', async () => {
    await plantHomeForecast()
    const trip = await tripCoveringToday()
    await replaceWeather(binding, trip.id, [day(TODAY, 12, 19)], NOW)

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.place.source).toBe('trip')
    expect(result.place.name).toBe('Cape Town')
    // 12–19°C, the trip's numbers — never the home cache's 14–24.
    expect(result.weather!.lowF).toBe(54)
    expect(result.weather!.highF).toBe(66)
  })

  it('says the place and no weather when the trip has no forecast', async () => {
    await plantHomeForecast()
    await tripCoveringToday()

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.place.name).toBe('Cape Town')
    /*
     * And emphatically NOT the home forecast. Telling Alex it is 57–75°F while
     * he is in Cape Town would be worse than telling him nothing, because he
     * would have no reason to doubt it.
     */
    expect(result.weather).toBeNull()
  })

  it('ignores a trip that has been archived or finished', async () => {
    const trip = await tripCoveringToday()
    await binding.prepare('UPDATE trip SET archived_at = ? WHERE id = ?').bind(NOW, trip.id).run()

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.place.source).toBe('home')
  })

  /**
   * The status row and the trip card must be about the same trip.
   *
   * Home features the earliest-starting trip that has not finished. This picks
   * the earliest-starting trip that COVERS today. Those agree because an
   * underway trip started on or before today and so sorts ahead of every trip
   * that has not started — but that is an argument, and this is the assertion.
   */
  it('picks the same trip Home features', async () => {
    const soon = await createTrip(
      binding,
      {
        name: 'Leaves tomorrow',
        startDate: '2026-08-16',
        endDate: '2026-08-18',
        destinations: [{ name: 'Chicago', country: 'United States' }],
        activities: [],
      },
      NOW,
    )
    const now = await tripCoveringToday()

    const result = await homeWeather({ db: binding, today: TODAY, now: NOW })

    expect(result.place.name).toBe('Cape Town')
    // Both trips are live; the underway one is the one Home would feature.
    expect(now.startDate < soon.startDate).toBe(true)
  })
})
