import { tripDateRange, type Trip } from '@shared/trips'
import {
  FORECAST_FRESH_FOR_SECONDS,
  freshnessOf,
  type WeatherDay,
  type WeatherFreshness,
} from '@shared/weather'
import { climateNormals, forecast, geocode, withinForecastHorizon } from '../weather'
import {
  listWeather,
  replaceWeather,
  saveCoordinates,
  saveTimezone,
  tripStops,
  weatherFetchedAt,
  type StopRow,
} from '../repos/weather'

/**
 * Getting a trip's weather, whichever way that has to happen.
 *
 * Order of preference: what is already stored and still fresh, then a fresh
 * fetch, then what is stored and stale, then nothing. The last step is a real
 * outcome, not an error — this build environment cannot reach Open-Meteo at all,
 * and a trip with no weather plans exactly as trips did before weather existed.
 */

export type WeatherStatus =
  | 'ok'
  | 'too_far_out'
  | 'no_destination'
  | 'unavailable'

export interface WeatherResult {
  days: WeatherDay[]
  status: WeatherStatus
  /**
   * When the stored forecast was last fetched, or null if none ever was.
   *
   * Carried out of the service rather than left inside it because E2's whole
   * first half is that a four-day-old forecast must not read like this
   * morning's. It was already being read here to decide whether to re-fetch;
   * every screen was simply never told.
   */
  fetchedAt: number | null
  freshness: WeatherFreshness
}

/** Everything a caller needs to say how old the answer is, in one place. */
function result(
  days: WeatherDay[],
  status: WeatherStatus,
  fetchedAt: number | null,
  now: number,
): WeatherResult {
  return { days, status, fetchedAt, freshness: freshnessOf(days, fetchedAt, now) }
}

/** What Alex reads when there is no forecast. Never blames him, never lies. */
export const WEATHER_STATUS_TEXT: Record<WeatherStatus, string | null> = {
  ok: null,
  too_far_out:
    'Too far ahead for a forecast, and Pack Smart could not reach the records of what it is usually like either. Nothing about the weather is being assumed.',
  no_destination: 'Add a destination and Pack Smart can check the weather for it.',
  unavailable:
    'Could not reach the weather service. Nothing about the weather is being assumed.',
}

export async function getWeather(
  db: D1Database,
  tripId: string,
  now: number,
): Promise<WeatherResult> {
  const [days, fetchedAt] = await Promise.all([
    listWeather(db, tripId),
    weatherFetchedAt(db, tripId),
  ])
  return result(days, days.length > 0 ? 'ok' : 'unavailable', fetchedAt, now)
}

/**
 * Whether it is worth going and looking again.
 *
 * Only when something IS stored and has gone stale. A trip with no weather at
 * all is deliberately not a reason to reach out on every screen open: the trip
 * itself already fires a refresh when it is created or its dates change, and a
 * destination Open-Meteo cannot find would otherwise cost a network round trip
 * every time Alex looked at Today, forever, to be told the same thing.
 *
 * The manual control is the answer for that case, because a person asking is a
 * reason and a screen opening is not.
 */
export function shouldRefresh(fetchedAt: number | null, now: number): boolean {
  return fetchedAt !== null && now - fetchedAt >= FORECAST_FRESH_FOR_SECONDS
}

/**
 * Refreshes a trip's weather, and says honestly what happened.
 *
 * Geocoding is done once per destination and the coordinates are kept, so the
 * common path is a single request. A failure at any step leaves whatever was
 * stored before untouched.
 */
export async function refreshWeather(
  db: D1Database,
  trip: Trip,
  today: string,
  now: number,
  options: { force?: boolean } = {},
): Promise<WeatherResult> {
  const stored = await listWeather(db, trip.id)
  const fetchedAt = await weatherFetchedAt(db, trip.id)

  /*
   * The freshness short-circuit, and the one thing allowed past it.
   *
   * Every automatic caller wants it: a forecast does not move fast enough to be
   * worth a network round trip twice in twelve hours. A PERSON tapping
   * `Check again` is the exception, because handing them the same numbers they
   * were already looking at answers nothing — see `force` in the Today route.
   */
  if (
    !options.force &&
    stored.length > 0 &&
    fetchedAt !== null &&
    now - fetchedAt < FORECAST_FRESH_FOR_SECONDS
  ) {
    return result(stored, 'ok', fetchedAt, now)
  }

  /*
   * Beyond the forecast horizon, fall back to what it is usually like.
   *
   * Marked `climate_normal` all the way through, so `describeWeather` says "this
   * is the usual weather, not a forecast" rather than letting an average of five
   * Augusts read like Tuesday's forecast — the confusion `01_ARCHITECTURE.md` §6
   * names specifically.
   */
  const beyondHorizon = !withinForecastHorizon(trip.startDate, today)

  const stops = await tripStops(db, trip.id)
  if (stops.length === 0) return result(stored, 'no_destination', fetchedAt, now)

  /*
   * One fetch per stop, each for its OWN dates.
   *
   * A trip that flies Cape Town to Reykjavik has two forecasts, and asking for
   * the whole trip range at one of them would plan the Reykjavik days against
   * Cape Town's weather — a confident answer for the wrong continent, which is
   * worse than no weather at all.
   */
  const fresh: WeatherDay[] = []

  for (const stop of stops) {
    const window = windowFor(stop, trip, stops.length)
    if (!window) continue

    const coordinates = await locate(db, stop)
    if (!coordinates) continue

    if (beyondHorizon) {
      const days = await climateNormals(
        coordinates.lat,
        coordinates.lon,
        window.from,
        window.to,
        tripDateRange(window.from, window.to),
      )
      for (const day of days) fresh.push({ ...day, destinationId: stop.id })
      continue
    }

    const answer = await forecast(coordinates.lat, coordinates.lon, window.from, window.to)
    for (const day of answer.days) fresh.push({ ...day, destinationId: stop.id })

    /*
     * The stop's own time zone, free, from a request already being made.
     *
     * Written only when the response actually carried one and the stop does not
     * already have it — a zone does not change, and rewriting it on every
     * refresh would be a write per stop per twelve hours for no reason.
     */
    if (answer.timezone && stop.timezone !== answer.timezone) {
      await saveTimezone(db, stop.id, answer.timezone)
    }
  }

  if (fresh.length === 0) {
    if (stored.length > 0) return result(stored, 'ok', fetchedAt, now)
    return result([], beyondHorizon ? 'too_far_out' : 'unavailable', null, now)
  }

  await replaceWeather(db, trip.id, fresh, now)
  return result(fresh, 'ok', now, now)
}

/**
 * The dates to fetch for one stop.
 *
 * A stop with its own dates gets exactly those, clamped to the trip. A trip
 * with a single stop and no dates gets the whole trip — the common case, which
 * must not require Alex to type dates he has already given once.
 *
 * A stop on a MULTI-stop trip with no dates gets nothing. There is no honest
 * answer to "which days is this one for", and inventing a split would be the
 * same guess `destinationForDate` refuses to make.
 */
function windowFor(
  stop: StopRow,
  trip: Trip,
  stopCount: number,
): { from: string; to: string } | null {
  if (!stop.arrive_date && !stop.depart_date) {
    return stopCount === 1 ? { from: trip.startDate, to: trip.endDate } : null
  }

  const from = stop.arrive_date && stop.arrive_date > trip.startDate ? stop.arrive_date : trip.startDate
  const to = stop.depart_date && stop.depart_date < trip.endDate ? stop.depart_date : trip.endDate
  return from <= to ? { from, to } : null
}

/** Coordinates, geocoding once and remembering them on the row. */
async function locate(
  db: D1Database,
  stop: StopRow,
): Promise<{ lat: number; lon: number } | null> {
  if (stop.latitude !== null && stop.longitude !== null) {
    return { lat: stop.latitude, lon: stop.longitude }
  }

  const place = await geocode(stop.name)
  if (!place) return null

  await saveCoordinates(db, stop.id, place.latitude, place.longitude)
  return { lat: place.latitude, lon: place.longitude }
}
