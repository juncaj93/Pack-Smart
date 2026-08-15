import { FORECAST_FRESH_FOR_SECONDS, type WeatherDay } from './weather'

/**
 * Where Alex is when he is not travelling, and when it is worth asking again.
 *
 * ## Why this exists at all
 *
 * Every forecast Pack Smart held was fetched for a trip's stops, so the screen
 * the app opens on could say what the weather would be like in Cape Town in
 * three weeks and nothing at all about the window Alex was standing next to.
 * That was a deliberate omission once — a second weather path for one line
 * looked like over-engineering — and it stopped being the right call the moment
 * Home grew a status row whose whole job is *what is it like right now*.
 *
 * ## What it is NOT
 *
 * Not geolocation. There is no permission prompt, no `navigator.geolocation`,
 * and no reverse lookup. This is a place Alex names once, which is the honest
 * shape for a private app on one person's phone: it is right every day he is at
 * home, and on the days he is not, the trip already knows better and says so.
 */

/**
 * Where Pack Smart assumes Alex is until he says otherwise.
 *
 * A constant rather than a seeded `preference` row, and the difference matters
 * three ways: a seeded row would ride along in the backup export claiming to be
 * a preference he expressed; writing one on first read would make a GET a write,
 * which this codebase calls out by name where it happens; and a constant is
 * diffable and testable where an `INSERT OR IGNORE` in a migration is neither.
 */
export const DEFAULT_HOME_LOCATION: HomeLocation = { name: 'Wixom, Michigan' }

export interface HomeLocation {
  /** As Alex would write it, and as the geocoder is asked for it. */
  name: string
  /** Remembered after the first successful geocode, so the common path is one request. */
  latitude?: number | null
  longitude?: number | null
  /** The IANA zone Open-Meteo reported for those coordinates. */
  timezone?: string | null
}

/**
 * The stored forecast for that place — a cache, and discardable.
 *
 * Separate from the location itself because they have different lifetimes and
 * different owners: the location is Alex's data and survives everything, this is
 * derived and may be thrown away at any time without losing anything he said.
 */
export interface HomeWeatherCache {
  /**
   * The place this was fetched FOR.
   *
   * What makes a location change self-invalidating: a cache whose name no longer
   * matches the effective location is ignored whole — coordinates included —
   * rather than needing a delete on the write path that changed it.
   */
  place: string
  latitude: number | null
  longitude: number | null
  timezone: string | null
  /** Today and tomorrow only. This row is in every backup; sixteen days is not. */
  days: WeatherDay[]
  /** When a forecast was last successfully stored, or null if never. */
  fetchedAt: number | null
  /** When one was last ATTEMPTED, successfully or not. See `shouldRefreshHome`. */
  attemptedAt: number
}

/**
 * How long a failed attempt keeps Pack Smart from trying again.
 *
 * One hour, and the number is the whole of the difference between this and the
 * trip path. `shouldRefresh` in `worker/services/weather.ts` returns false when
 * nothing has ever been stored, precisely so a destination Open-Meteo cannot
 * find does not cost a network round trip every time a screen opens — and it can
 * afford that, because a trip refreshes when it is created and when its dates
 * change. A home location has no such event: if the first fetch does not happen
 * on sight, it never happens at all.
 *
 * So home weather must fetch on first sight, which reintroduces exactly the cost
 * that rule was protecting against — and this is what bounds it. A place that
 * can never be found costs one geocode an hour rather than one per Home open.
 *
 * Deliberately shorter than `FORECAST_FRESH_FOR_SECONDS`. A twelve-hour backoff
 * would match the freshness window tidily and would mean that a connection
 * coming back in the morning stayed invisible until the evening.
 */
export const HOME_WEATHER_RETRY_SECONDS = 60 * 60

/**
 * Whether it is worth going and looking again.
 *
 * Pure, and the only place the question is answered — the route reads this and
 * does as it is told, so "when do we call Open-Meteo" is one testable function
 * rather than a condition spread across a handler.
 */
export function shouldRefreshHome(
  cache: HomeWeatherCache | null,
  place: string,
  now: number,
): boolean {
  // Never asked. This is the case the whole backoff exists to make safe.
  if (!cache) return true

  // He moved, or corrected a spelling. Everything stored is about somewhere else.
  if (cache.place !== place) return true

  // A real forecast, still inside its window.
  if (
    cache.days.length > 0 &&
    cache.fetchedAt !== null &&
    now - cache.fetchedAt < FORECAST_FRESH_FOR_SECONDS
  ) {
    return false
  }

  // Something was tried recently and did not produce a forecast. Wait.
  if (now - cache.attemptedAt < HOME_WEATHER_RETRY_SECONDS) return false

  return true
}

/**
 * The stored days, but only if they are about the place being asked for.
 *
 * A function rather than an inline check, because the moment it matters is one
 * a test cannot easily stage: the refresh normally replaces the cache before
 * anything is read, so the stale rows are only still in hand when a first fetch
 * has been raced and lost. That is a real path — a slow network on the open
 * after Alex changes where he lives — and it is the one where serving what is
 * left would put the old town's forecast under the new town's name.
 *
 * Pure, exported, and tested directly, so the rule does not depend on being able
 * to reproduce the race.
 */
export function daysForPlace(cache: HomeWeatherCache | null, place: string): WeatherDay[] {
  return cache && cache.place === place ? cache.days : []
}

/**
 * Whether the cache holds anything worth showing at all.
 *
 * The route uses this to decide whether to WAIT for a refresh or answer from
 * store and refresh behind the response: an empty cache means Alex would
 * otherwise see a row with no weather in it on the first open of a fresh
 * database, which reads as broken rather than as loading.
 */
export function hasStoredWeather(cache: HomeWeatherCache | null): boolean {
  return (cache?.days.length ?? 0) > 0
}
