import {
  NORMAL_YEARS,
  averageToNormals,
  parseForecast,
  parseGeocoding,
  parseTimezone,
  type GeocodedPlace,
  type WeatherDay,
} from '@shared/weather'

/**
 * The two Open-Meteo calls, and nothing else.
 *
 * Kept separate from `shared/weather.ts` on purpose. Everything that decides
 * anything is a pure function over the parsed payload and is unit-tested; this
 * file is the part that talks to the network, and the part this build
 * environment cannot exercise — outbound requests to open-meteo.com are blocked
 * here, while a deployed Cloudflare Worker has no such restriction.
 *
 * So the contract of every function below is: return the data, or return
 * nothing. Never throw into a request handler, never invent a value. A trip
 * whose forecast could not be fetched plans exactly as trips did before weather
 * existed, and the screen says the weather is not known rather than going quiet.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

/** Open-Meteo's own limit. Past this the daily block simply stops. */
export const FORECAST_HORIZON_DAYS = 16

/**
 * A hard ceiling on each call.
 *
 * These run in the background after a save, so nobody is watching a spinner —
 * but a Worker held open on a blocked host is still worth bounding, and this
 * environment proves a blocked host is not hypothetical.
 */
const TIMEOUT_MS = 3_000

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    // Blocked, offline, timed out, or answering something that is not JSON.
    // All of them mean the same thing to the caller: no weather this time.
    return null
  }
}

export async function geocode(place: string): Promise<GeocodedPlace | null> {
  const name = place.trim()
  if (!name) return null

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`
  return parseGeocoding(await getJson(url))
}

/**
 * The daily forecast for a place across a date range.
 *
 * `start_date`/`end_date` rather than a day count, so the response lines up with
 * the trip's own dates and no arithmetic is needed to match them up. Dates
 * beyond the horizon simply do not come back, which is the honest outcome — the
 * caller reports the gap instead of filling it.
 */
export interface Forecast {
  days: WeatherDay[]
  /**
   * The IANA zone of the coordinates asked about, when the response carried one.
   *
   * Free, and it was being discarded. `timezone=auto` below has always been
   * sent — it is what makes the daily buckets line up with local days rather
   * than with UTC — so the answer has always come back naming the zone. E2
   * keeps it, which is what makes "what day is it in Cape Town" answerable
   * without a paid service or a bundled zone database.
   */
  timezone: string | null
}

export async function forecast(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
): Promise<Forecast> {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto',
  })

  const payload = await getJson(`${FORECAST_URL}?${query.toString()}`)
  return { days: parseForecast(payload), timezone: parseTimezone(payload) }
}

/** Days from today, negative for a date already past. */
export function daysAway(date: string, today: string): number {
  const [ay, am, ad] = date.split('-').map(Number) as [number, number, number]
  const [by, bm, bd] = today.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000)
}

/**
 * Whether a forecast is worth asking for at all.
 *
 * Beyond sixteen days Open-Meteo has nothing, and asking anyway spends a request
 * to be told so. `03_INTELLIGENCE_DESIGN.md` §9 says climate normals should fill
 * that gap and be labelled as normals; they are not implemented yet, so the trip
 * says the dates are too far out instead of quietly showing nothing. Recorded as
 * a known gap in `09_IMPLEMENTATION_NOTES.md` §5.
 */
export function withinForecastHorizon(startDate: string, today: string): boolean {
  return daysAway(startDate, today) <= FORECAST_HORIZON_DAYS
}

/**
 * What the weather is usually like, when the trip is too far out to forecast.
 *
 * Open-Meteo's archive endpoint — same family, same free terms, no key — asked
 * for the same calendar window in each of the previous `NORMAL_YEARS` years and
 * averaged. `03_INTELLIGENCE_DESIGN.md` §9 has always required this; until now
 * a distant trip simply had no weather at all.
 *
 * The result is marked `climate_normal`, and every surface that shows it must
 * say so. Presenting a normal as a forecast is called out by name in
 * `01_ARCHITECTURE.md` §6, and it is the specific way this feature could
 * mislead: "18°C" reads identically whether it is Tuesday's forecast or an
 * average of five Augusts.
 *
 * Fails to nothing, like every other call here.
 */
export async function climateNormals(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  targetDates: string[],
): Promise<WeatherDay[]> {
  const startYear = Number(startDate.slice(0, 4))
  const years: WeatherDay[][] = []

  for (let back = 1; back <= NORMAL_YEARS; back += 1) {
    const year = startYear - back
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      start_date: `${year}${startDate.slice(4)}`,
      end_date: `${year}${endDate.slice(4)}`,
      daily: 'temperature_2m_max,temperature_2m_min,wind_speed_10m_max',
      timezone: 'auto',
    })

    const parsed = parseForecast(await getJson(`${ARCHIVE_URL}?${query.toString()}`), 'climate_normal')
    if (parsed.length > 0) years.push(parsed)
  }

  return years.length === 0 ? [] : averageToNormals(years, targetDates)
}
