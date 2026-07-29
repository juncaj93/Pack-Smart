import type { Trip } from '@shared/trips'
import type { WeatherDay } from '@shared/weather'
import { forecast, geocode, withinForecastHorizon } from '../weather'
import {
  firstDestination,
  listWeather,
  replaceWeather,
  saveCoordinates,
  weatherFetchedAt,
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
    'Too far ahead for a forecast yet. Pack Smart will pick it up nearer the time, and is not assuming anything about the weather until then.',
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

  if (!withinForecastHorizon(trip.startDate, today)) {
    // Climate normals would belong here (03_INTELLIGENCE_DESIGN.md §9). Until
    // they exist, saying the dates are too far out beats showing nothing with no
    // explanation, and beats presenting a normal as a forecast.
    return { days: stored, status: stored.length > 0 ? 'ok' : 'too_far_out' }
  }

  const destination = await firstDestination(db, trip.id)
  if (!destination) return { days: stored, status: 'no_destination' }

  let { latitude, longitude } = destination

  if (latitude === null || longitude === null) {
    const place = await geocode(destination.name)
    if (!place) return { days: stored, status: stored.length > 0 ? 'ok' : 'unavailable' }
    latitude = place.latitude
    longitude = place.longitude
    await saveCoordinates(db, destination.id, latitude, longitude)
  }

  const fresh = await forecast(latitude, longitude, trip.startDate, trip.endDate)
  if (fresh.length === 0) {
    return { days: stored, status: stored.length > 0 ? 'ok' : 'unavailable' }
  }

  await replaceWeather(db, trip.id, fresh, now)
  return { days: fresh, status: 'ok' }
}
