import { tripDateRange, type Trip } from '@shared/trips'
import type { WeatherDay } from '@shared/weather'
import { climateNormals, forecast, geocode, withinForecastHorizon } from '../weather'
import {
  listWeather,
  replaceWeather,
  saveCoordinates,
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

/** Half a day. A forecast does not move fast enough to be worth chasing harder. */
const FRESH_FOR_SECONDS = 12 * 60 * 60

export type WeatherStatus =
  | 'ok'
  | 'too_far_out'
  | 'no_destination'
  | 'unavailable'

export interface WeatherResult {
  days: WeatherDay[]
  status: WeatherStatus
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

export async function getWeather(db: D1Database, tripId: string): Promise<WeatherResult> {
  const days = await listWeather(db, tripId)
  return { days, status: days.length > 0 ? 'ok' : 'unavailable' }
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
): Promise<WeatherResult> {
  const stored = await listWeather(db, trip.id)
  const fetchedAt = await weatherFetchedAt(db, trip.id)

  if (stored.length > 0 && fetchedAt !== null && now - fetchedAt < FRESH_FOR_SECONDS) {
    return { days: stored, status: 'ok' }
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
  if (stops.length === 0) return { days: stored, status: 'no_destination' }

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

    const days = beyondHorizon
      ? await climateNormals(
          coordinates.lat,
          coordinates.lon,
          window.from,
          window.to,
          tripDateRange(window.from, window.to),
        )
      : await forecast(coordinates.lat, coordinates.lon, window.from, window.to)

    for (const day of days) fresh.push({ ...day, destinationId: stop.id })
  }

  if (fresh.length === 0) {
    if (stored.length > 0) return { days: stored, status: 'ok' }
    return { days: [], status: beyondHorizon ? 'too_far_out' : 'unavailable' }
  }

  await replaceWeather(db, trip.id, fresh, now)
  return { days: fresh, status: 'ok' }
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
