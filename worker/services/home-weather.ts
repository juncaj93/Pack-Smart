import {
  DEFAULT_HOME_LOCATION,
  hasStoredWeather,
  shouldRefreshHome,
  type HomeLocation,
  type HomeWeatherCache,
} from '@shared/home-location'
import { destinationForDate, type Trip } from '@shared/trips'
import { weatherForDay, type TodayWeather } from '@shared/today'
import { freshnessOf, type WeatherFreshness } from '@shared/weather'
import { getTrip } from '../repos/trips'
import { listWeather, weatherFetchedAt } from '../repos/weather'
import {
  getPreference,
  setPreference,
  HOME_LOCATION_KEY,
  HOME_WEATHER_KEY,
} from '../repos/preferences'
import { forecast, geocode } from '../weather'

/**
 * What the Home status row is about, decided HERE rather than on the client.
 *
 * ## Why the server answers this
 *
 * The row says "what is it like where I am". Where Alex is depends on whether a
 * trip is underway, and the client does not know that until `/api/trips` has
 * come back — so a client that asked for home weather and swapped afterwards
 * would put Wixom's forecast on the app's front door for one round trip while he
 * was standing in Cape Town. The server settles it in one indexed query, and the
 * screen asks one question and gets a true answer in one rung.
 *
 * ## Two places, one shape
 *
 * Both branches reduce to the same `TodayWeather` the day's briefing produces, so
 * the status row and the trip card call the identical `describeTodayWeather` and
 * cannot word one forecast two ways.
 */

export interface HomeWeatherResult {
  place: {
    name: string
    timezone: string | null
    /** Which question was answered: where he lives, or where he has gone. */
    source: 'home' | 'trip'
  }
  weather: TodayWeather | null
  fetchedAt: number | null
  freshness: WeatherFreshness
}

/** Where Alex says he lives, or Wixom until he says otherwise. */
export async function homeLocation(db: D1Database): Promise<HomeLocation> {
  const stored = await getPreference<HomeLocation>(db, HOME_LOCATION_KEY)
  return stored?.name ? stored : DEFAULT_HOME_LOCATION
}

export async function setHomeLocation(
  db: D1Database,
  name: string,
  now: number,
): Promise<HomeLocation> {
  /*
   * The coordinates are deliberately NOT carried over from the old location.
   *
   * A rename that kept them would leave Pack Smart fetching the old town's
   * forecast under the new town's name for twelve hours, which is the one
   * failure this whole feature must not have. The cache invalidates itself on
   * the name mismatch and the next read geocodes.
   */
  const location: HomeLocation = { name }
  await setPreference(db, HOME_LOCATION_KEY, location, now)
  return location
}

/**
 * The trip Alex is on today, if he is on one.
 *
 * A narrow query rather than `listTrips`, because this runs beside `/api/trips`
 * on every Home load and hydrating every trip twice for one boolean would be
 * work nobody reads.
 *
 * **This must agree with which trip Home features**, or the status row and the
 * card underneath it would be about different places. Home features the
 * earliest-starting trip that has not finished; a trip that is underway started
 * on or before today, so it sorts ahead of every trip that has not started. The
 * earliest-starting underway trip is therefore always the featured one.
 * `tests/integration/home-weather.test.ts` pins that rather than leaving it as a
 * coincidence two sort orders happen to share.
 */
async function tripUnderway(db: D1Database, today: string): Promise<Trip | null> {
  const row = await db
    .prepare(
      `SELECT id FROM trip
        WHERE archived_at IS NULL
          AND status != 'completed'
          AND start_date <= ?
          AND ? <= end_date
        ORDER BY start_date
        LIMIT 1`,
    )
    .bind(today, today)
    .first<{ id: string }>()

  return row ? getTrip(db, row.id) : null
}

/**
 * How long to wait for a first-ever forecast before answering without one.
 *
 * A fresh database has nothing stored, and a status row with no weather in it on
 * the very first open reads as broken rather than as loading — so this one case
 * races the fetch instead of backgrounding it. Bounded, because the alternative
 * is Home sitting on `AbortSignal.timeout(3_000)` on a host that cannot reach
 * Open-Meteo at all, which is exactly this build environment.
 *
 * It cannot cost a request rung: `waterfallDepth` in the performance spec counts
 * when requests START, and this one starts in the same tick as `/api/trips`.
 */
const FIRST_FETCH_DEADLINE_MS = 700

export interface HomeWeatherInput {
  db: D1Database
  /** The traveller's own day, from the `X-Client-Date` header. */
  today: string
  now: number
  /** Keeps a background refresh alive past the response. Absent in route tests. */
  waitUntil?: (work: Promise<unknown>) => void
}

export async function homeWeather(input: HomeWeatherInput): Promise<HomeWeatherResult> {
  const { db, today, now } = input

  const trip = await tripUnderway(db, today)

  /* --- on a trip: the destination is where he is ---------------------- */

  if (trip) {
    const stop = destinationForDate(trip.destinations, today)
    const [days, fetchedAt] = await Promise.all([
      listWeather(db, trip.id),
      weatherFetchedAt(db, trip.id),
    ])

    /*
     * Read only. `worker/routes/today.ts` already owns refreshing a trip's
     * forecast, and refreshing here as well would double Open-Meteo's traffic
     * every time Home opened during a trip.
     *
     * A trip with nothing stored answers with the place and no weather. It never
     * falls back to the home forecast: telling Alex it is 64°F in Wixom while he
     * is in Cape Town would be worse than telling him nothing.
     */
    const relevant = weatherForDay(days, today, stop?.id ?? null)
    return {
      place: {
        name: stop?.name ?? trip.name,
        timezone: stop?.timezone ?? trip.timezone,
        source: 'trip',
      },
      weather: relevant,
      fetchedAt,
      freshness: freshnessOf(days.filter((day) => day.date === today), fetchedAt, now),
    }
  }

  /* --- at home ------------------------------------------------------- */

  const location = await homeLocation(db)
  let cache = await getPreference<HomeWeatherCache>(db, HOME_WEATHER_KEY)

  if (shouldRefreshHome(cache, location.name, now)) {
    const work = refreshHomeWeather(db, location, cache, today, now)

    if (hasStoredWeather(cache) && cache?.place === location.name) {
      // Something usable is already on hand. Answer with it and let the fresh
      // one land for the next open.
      input.waitUntil?.(work.catch(() => undefined))
    } else {
      // Nothing to show. Wait, but not for long.
      const raced = await Promise.race([
        work.catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIRST_FETCH_DEADLINE_MS)),
      ])
      // Kept alive either way, so a fetch that lost the race still finishes and
      // stores — the next open reads it rather than starting again.
      input.waitUntil?.(work.catch(() => undefined))
      if (raced) cache = raced
    }
  }

  const days = cache?.place === location.name ? (cache?.days ?? []) : []
  return {
    place: {
      name: displayName(location.name),
      timezone: cache?.timezone ?? location.timezone ?? null,
      source: 'home',
    },
    weather: weatherForDay(days, today, null),
    fetchedAt: cache?.fetchedAt ?? null,
    freshness: freshnessOf(days.filter((day) => day.date === today), cache?.fetchedAt ?? null, now),
  }
}

/**
 * The short form, for a row that has a date and a clock beside it.
 *
 * `Wixom, Michigan` is what Alex types and what the geocoder is asked for; the
 * status row has about half a line for it at 360px. The part before the first
 * comma is the town, which is the part that answers "where am I".
 */
function displayName(name: string): string {
  return name.split(',')[0]!.trim() || name
}

/**
 * Goes and looks, and records that it tried whatever happened.
 *
 * `attemptedAt` is written on every path — success, no geocode, no forecast —
 * which is what stops a place Open-Meteo cannot find from costing a network call
 * on every single Home open. A failure never clobbers good days: the previous
 * forecast is carried forward, exactly as `replaceWeather` refuses to write an
 * empty set over a good one.
 */
async function refreshHomeWeather(
  db: D1Database,
  location: HomeLocation,
  previous: HomeWeatherCache | null,
  today: string,
  now: number,
): Promise<HomeWeatherCache> {
  const samePlace = previous?.place === location.name ? previous : null

  let latitude = samePlace?.latitude ?? location.latitude ?? null
  let longitude = samePlace?.longitude ?? location.longitude ?? null
  let timezone = samePlace?.timezone ?? location.timezone ?? null

  // Geocoded once and remembered, so the ordinary path is a single request —
  // the same trade `saveCoordinates` makes for a trip's stops.
  if (latitude === null || longitude === null) {
    const found = await geocode(location.name)
    if (found) {
      latitude = found.latitude
      longitude = found.longitude
    }
  }

  let days = samePlace?.days ?? []
  let fetchedAt = samePlace?.fetchedAt ?? null

  if (latitude !== null && longitude !== null) {
    // Today and tomorrow only. This row travels in every backup, and the status
    // row shows one day.
    const result = await forecast(latitude, longitude, today, nextDay(today))
    if (result.days.length > 0) {
      days = result.days
      fetchedAt = now
      timezone = result.timezone ?? timezone
    }
  }

  const cache: HomeWeatherCache = {
    place: location.name,
    latitude,
    longitude,
    timezone,
    days,
    fetchedAt,
    attemptedAt: now,
  }

  await setPreference(db, HOME_WEATHER_KEY, cache, now)
  return cache
}

/** The day after a `YYYY-MM-DD`, in UTC so a daylight-saving change cannot move it. */
function nextDay(date: string): string {
  const at = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)) + 1,
  )
  return new Date(at).toISOString().slice(0, 10)
}
