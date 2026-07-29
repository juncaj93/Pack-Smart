import type { WeatherDay } from '@shared/weather'

/**
 * Stored weather for a trip.
 *
 * Cached rather than fetched per request, for two reasons that both matter on
 * the free plan: every outfit generation would otherwise spend a network round
 * trip inside the 10 ms CPU budget, and a forecast that changed between two
 * screens would make the app look like it had changed its mind (risk R12).
 */

interface WeatherRow {
  destination_id: string | null
  weather_date: string
  temp_min_c: number | null
  temp_max_c: number | null
  precipitation: number | null
  wind_kph: number | null
  source: string
  fetched_at: number
}

function toDay(row: WeatherRow): WeatherDay {
  return {
    destinationId: row.destination_id,
    date: row.weather_date,
    tempMinC: row.temp_min_c,
    tempMaxC: row.temp_max_c,
    precipitationProbability: row.precipitation,
    windKph: row.wind_kph,
    source: row.source === 'climate_normal' ? 'climate_normal' : 'forecast',
  }
}

export async function listWeather(db: D1Database, tripId: string): Promise<WeatherDay[]> {
  const result = await db
    .prepare(
      `SELECT destination_id, weather_date, temp_min_c, temp_max_c, precipitation,
              wind_kph, source, fetched_at
         FROM trip_weather WHERE trip_id = ? ORDER BY weather_date`,
    )
    .bind(tripId)
    .all<WeatherRow>()

  return (result.results ?? []).map(toDay)
}

/** When the stored forecast was last refreshed, or null if there is none. */
export async function weatherFetchedAt(db: D1Database, tripId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT MAX(fetched_at) AS fetched FROM trip_weather WHERE trip_id = ?')
    .bind(tripId)
    .first<{ fetched: number | null }>()
  return row?.fetched ?? null
}

/**
 * Replaces a trip's stored weather.
 *
 * A no-op when there is nothing to store. That guard is the difference between
 * "the forecast could not be fetched, keep what we had" and "the forecast could
 * not be fetched, so throw away the one from yesterday" — the second would make
 * a blocked network actively destroy usable information.
 */
export async function replaceWeather(
  db: D1Database,
  tripId: string,
  days: WeatherDay[],
  now: number,
): Promise<void> {
  if (days.length === 0) return

  await db.prepare('DELETE FROM trip_weather WHERE trip_id = ?').bind(tripId).run()

  for (const day of days) {
    await db
      .prepare(
        `INSERT INTO trip_weather (id, trip_id, destination_id, weather_date, temp_min_c,
                                   temp_max_c, precipitation, wind_kph, source, fetched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(), tripId, day.destinationId ?? null, day.date,
        day.tempMinC, day.tempMaxC,
        day.precipitationProbability, day.windKph, day.source, now,
      )
      .run()
  }
}

/** Remembers where a destination is, so the next refresh skips geocoding. */
export async function saveCoordinates(
  db: D1Database,
  destinationId: string,
  latitude: number,
  longitude: number,
): Promise<void> {
  await db
    .prepare('UPDATE trip_destination SET latitude = ?, longitude = ? WHERE id = ?')
    .bind(latitude, longitude, destinationId)
    .run()
}

export interface StopRow {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  arrive_date: string | null
  depart_date: string | null
}

/** Every stop on the trip, in order. One-stop trips are just the short case. */
export async function tripStops(db: D1Database, tripId: string): Promise<StopRow[]> {
  const result = await db
    .prepare(
      `SELECT id, name, latitude, longitude, arrive_date, depart_date
         FROM trip_destination WHERE trip_id = ? ORDER BY sort_order`,
    )
    .bind(tripId)
    .all<StopRow>()
  return result.results ?? []
}
