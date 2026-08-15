import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME_LOCATION,
  daysForPlace,
  hasStoredWeather,
  shouldRefreshHome,
  HOME_WEATHER_RETRY_SECONDS,
  type HomeWeatherCache,
} from '@shared/home-location'
import { FORECAST_FRESH_FOR_SECONDS, type WeatherDay } from '@shared/weather'

/**
 * When Pack Smart goes and looks at the weather where Alex lives.
 *
 * The whole of this decision is one pure function, which is the point: in this
 * build environment Open-Meteo is unreachable, so every path that actually
 * fetches is unprovable here. What CAN be proved is when a fetch is asked for —
 * and that is the half with the failure mode, because the trip path's rule
 * ("never fetch when nothing is stored") is exactly wrong for a home location
 * and would mean it never fetched at all.
 */

const NOW = 1_786_000_000
const DAY: WeatherDay = {
  date: '2026-08-15',
  tempMinC: 14,
  tempMaxC: 18,
  precipitationProbability: 10,
  windKph: 9,
  source: 'forecast',
}

function cache(overrides: Partial<HomeWeatherCache> = {}): HomeWeatherCache {
  return {
    place: 'Wixom, Michigan',
    latitude: 42.52,
    longitude: -83.53,
    timezone: 'America/Detroit',
    days: [DAY],
    fetchedAt: NOW - 60,
    attemptedAt: NOW - 60,
    ...overrides,
  }
}

describe('where Pack Smart assumes Alex is', () => {
  it('is Wixom until he says otherwise', () => {
    expect(DEFAULT_HOME_LOCATION.name).toBe('Wixom, Michigan')
  })

  /*
   * A constant, not a seeded row. A `preference` row would ride along in the
   * backup export claiming to be a preference he expressed, and writing one on
   * first read would make a GET a write.
   */
  it('carries no coordinates, so the first read geocodes rather than trusting a guess', () => {
    expect(DEFAULT_HOME_LOCATION.latitude ?? null).toBeNull()
    expect(DEFAULT_HOME_LOCATION.longitude ?? null).toBeNull()
  })
})

describe('when to go and look again', () => {
  /**
   * The case the trip path gets right by getting it wrong.
   *
   * `shouldRefresh` in `services/weather.ts` returns false when nothing has ever
   * been stored, so an unfindable destination costs nothing per screen open. A
   * home location has no create event to fetch on, so the same rule would mean
   * it never fetched at all — and the status row would be permanently empty.
   */
  it('fetches on first sight, because nothing else ever will', () => {
    expect(shouldRefreshHome(null, 'Wixom, Michigan', NOW)).toBe(true)
  })

  it('leaves a fresh forecast alone', () => {
    expect(shouldRefreshHome(cache(), 'Wixom, Michigan', NOW)).toBe(false)
  })

  it('goes back once the forecast has aged out', () => {
    const old = cache({
      fetchedAt: NOW - FORECAST_FRESH_FOR_SECONDS - 1,
      attemptedAt: NOW - FORECAST_FRESH_FOR_SECONDS - 1,
    })
    expect(shouldRefreshHome(old, 'Wixom, Michigan', NOW)).toBe(true)
  })

  /**
   * The backoff, and the reason it exists.
   *
   * A place Open-Meteo cannot find stores no days at all. Without this the next
   * Home open would try again, and so would the one after it — a network call
   * per screen open, for ever, to be told the same thing.
   */
  it('waits after a failure rather than trying on every open', () => {
    const failed = cache({ days: [], fetchedAt: null, attemptedAt: NOW - 60 })
    expect(shouldRefreshHome(failed, 'Wixom, Michigan', NOW)).toBe(false)
  })

  it('tries again once the backoff has passed', () => {
    const failed = cache({
      days: [],
      fetchedAt: null,
      attemptedAt: NOW - HOME_WEATHER_RETRY_SECONDS - 1,
    })
    expect(shouldRefreshHome(failed, 'Wixom, Michigan', NOW)).toBe(true)
  })

  /*
   * Shorter than the freshness window on purpose. A twelve-hour backoff would
   * match tidily and would mean a connection coming back in the morning stayed
   * invisible until the evening.
   */
  it('backs off for less time than a good forecast stays fresh', () => {
    expect(HOME_WEATHER_RETRY_SECONDS).toBeLessThan(FORECAST_FRESH_FOR_SECONDS)
  })

  /**
   * The mutation: comparing only the timestamps and not the place.
   *
   * Alex moves, or corrects a spelling. Everything stored — including the
   * coordinates — is about somewhere else, and a fresh-looking cache would keep
   * the old town's forecast on screen under the new town's name for twelve
   * hours. This is what makes a location change self-invalidating with no delete
   * on the write path.
   */
  it('refetches when the place has changed, however fresh the numbers are', () => {
    expect(shouldRefreshHome(cache(), 'Ann Arbor, Michigan', NOW)).toBe(true)
  })
})

describe('whether there is anything worth showing', () => {
  it('is false with no cache and with an empty one', () => {
    expect(hasStoredWeather(null)).toBe(false)
    expect(hasStoredWeather(cache({ days: [] }))).toBe(false)
  })

  it('is true once a day has been stored', () => {
    expect(hasStoredWeather(cache())).toBe(true)
  })
})

describe('whose forecast the stored days are', () => {
  /**
   * The moment this matters is one no integration test can stage reliably.
   *
   * A refresh normally replaces the cache before anything reads it, so the old
   * town's rows are only still in hand when a first fetch has been raced and
   * lost — a slow network on the open right after Alex changes where he lives.
   * Serving what is left would put Wixom's forecast under Reykjavik's name:
   * confidently, invisibly wrong, which is worse than showing nothing.
   */
  it('refuses days belonging to somewhere else', () => {
    expect(daysForPlace(cache(), 'Reykjavik, Iceland')).toEqual([])
  })

  it('returns them for the place they were fetched for', () => {
    expect(daysForPlace(cache(), 'Wixom, Michigan')).toEqual([DAY])
  })

  it('has nothing to return with no cache at all', () => {
    expect(daysForPlace(null, 'Wixom, Michigan')).toEqual([])
  })
})
