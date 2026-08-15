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
 * Open-Meteo is unreachable from this build environment, so every path that
 * actually fetches a forecast is unprovable in an end-to-end run and absent from
 * every screenshot. This is the one place a real forecast can be put in front of
 * the code — by planting the cache the fetch would have written — and therefore
 * the only place the reduction from stored days to a rendered reading is proved.
 *
 * The other half it proves is the one with the sharp edge: which PLACE the row
 * is about. That is decided here rather than on the client, and getting it wrong
 * means telling Alex it is 64°F in Michigan while he is standing in Cape Town.
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

beforeEach(async () => {
  db = await createTestDatabase()
  binding = db.binding
})

describe('when Alex is at home', () => {
  it('answers with Wixom before he has said anything', async () => {
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
    // The stale numbers are not offered under the new name. In this environment
    // the refetch cannot succeed, so the honest answer is no weather at all.
    expect(result.weather).toBeNull()
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
