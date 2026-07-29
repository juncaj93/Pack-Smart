/**
 * Weather, from Open-Meteo.
 *
 * Free, no key, no account, no rate-limit registration — which is the whole
 * reason it was chosen. CLAUDE.md rules out paid APIs and ongoing paid services,
 * and this stays inside both.
 *
 * Everything in this file is a pure function over already-fetched JSON. The
 * fetching lives in the Worker (`worker/weather.ts`) so that this half can be
 * tested exhaustively without a network, which matters more than usual here:
 * the build environment cannot reach api.open-meteo.com at all, so the live call
 * is verifiable only in production. See `09_IMPLEMENTATION_NOTES.md` §5.
 *
 * The design consequence of that gap is deliberate: every parser below returns
 * NOTHING rather than a guess when the payload is not what it expects. A trip
 * with no usable forecast plans exactly as it did before weather existed. The
 * failure mode is "Pack Smart does not know the weather", which it says out
 * loud — never "Pack Smart is confident about the wrong weather".
 */

import { WIND_THRESHOLD_KPH, type ConditionDemand } from './weather-fit'

export type WeatherSource = 'forecast' | 'climate_normal'

export interface WeatherDay {
  /**
   * Which stop this forecast is for. Null on a single-destination trip, and on
   * every row written before multi-city existed — both mean "the trip's one
   * place", which is what `weatherOn` falls back to.
   */
  destinationId?: string | null
  date: string
  tempMinC: number | null
  tempMaxC: number | null
  /** Chance of rain, 0-100. Null when the payload did not carry it. */
  precipitationProbability: number | null
  windKph: number | null
  source: WeatherSource
}

export interface GeocodedPlace {
  name: string
  country: string | null
  latitude: number
  longitude: number
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

function firstNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads the first hit out of an Open-Meteo geocoding response.
 *
 * Only the first: the search takes a place name Alex typed, and offering him a
 * disambiguation list for "Cape Town" would be a screen's worth of friction for
 * a value that only shifts a temperature band. If the first hit is wrong the
 * forecast is wrong and visibly so, and he can correct the destination name.
 */
export function parseGeocoding(payload: unknown): GeocodedPlace | null {
  if (typeof payload !== 'object' || payload === null) return null
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results) || results.length === 0) return null

  const hit = results[0] as Record<string, unknown>
  const latitude = firstNumber(hit.latitude)
  const longitude = firstNumber(hit.longitude)
  if (latitude === null || longitude === null) return null

  return {
    name: typeof hit.name === 'string' ? hit.name : '',
    country: typeof hit.country === 'string' ? hit.country : null,
    latitude,
    longitude,
  }
}

/**
 * Reads Open-Meteo's daily block into one row per date.
 *
 * The API returns parallel arrays keyed by `daily.time`. A row is kept only when
 * it has at least one real temperature — a date present in `time` with nulls
 * beside it carries no information, and storing it would let the UI claim a
 * forecast exists for a day it knows nothing about.
 */
export function parseForecast(payload: unknown, source: WeatherSource = 'forecast'): WeatherDay[] {
  if (typeof payload !== 'object' || payload === null) return []
  const daily = (payload as { daily?: unknown }).daily
  if (typeof daily !== 'object' || daily === null) return []

  const block = daily as Record<string, unknown>
  const dates = block.time
  if (!Array.isArray(dates)) return []

  const mins = Array.isArray(block.temperature_2m_min) ? block.temperature_2m_min : []
  const maxes = Array.isArray(block.temperature_2m_max) ? block.temperature_2m_max : []
  const rain = Array.isArray(block.precipitation_probability_max)
    ? block.precipitation_probability_max
    : []
  const wind = Array.isArray(block.wind_speed_10m_max) ? block.wind_speed_10m_max : []

  const out: WeatherDay[] = []

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue

    const tempMinC = firstNumber(mins[i])
    const tempMaxC = firstNumber(maxes[i])
    if (tempMinC === null && tempMaxC === null) continue

    out.push({
      date,
      tempMinC,
      tempMaxC,
      precipitationProbability: firstNumber(rain[i]),
      windKph: firstNumber(wind[i]),
      source,
    })
  }

  return out
}

/* ------------------------------------------------------------------ */
/* what the forecast means for clothing                                */
/* ------------------------------------------------------------------ */

/**
 * Temperature to the 0-3 warmth scale garments are recorded on.
 *
 * The scale is `WARMTH_LABELS` in `items.ts`: Cool, Light, Warm, Very warm —
 * how much warmth the GARMENT provides, not how warm the day is. So the mapping
 * runs the other way round: a cold day needs a very warm layer.
 *
 * The boundaries are ordinary-clothing boundaries rather than anything derived:
 * below 5 °C wants the warmest thing you own, above 22 °C wants the lightest.
 * They are stated here rather than buried so they can be argued with.
 */
export function warmthNeededFor(tempC: number): number {
  if (tempC < 5) return 3
  if (tempC < 14) return 2
  if (tempC < 22) return 1
  return 0
}

/**
 * The band of garment warmth that suits a day.
 *
 * A band, not a point: an evening at 8 °C and an afternoon at 18 °C are the same
 * day, and a filter that admitted only one of them would empty the jacket slot
 * on a trip where Alex owns a perfectly good jacket. The band runs from what the
 * warmest part of the day needs to what the coldest part needs.
 */
export function warmthBandForDay(day: WeatherDay): [number, number] | null {
  const min = day.tempMinC ?? day.tempMaxC
  const max = day.tempMaxC ?? day.tempMinC
  if (min === null || max === null) return null

  const low = warmthNeededFor(max)
  const high = warmthNeededFor(min)
  return low <= high ? [low, high] : [high, low]
}

/**
 * One band covering several days.
 *
 * The union, deliberately, not the intersection. This feeds a HARD filter on
 * jackets and mid-layers, and an intersection across a week of varied weather is
 * frequently empty — which would not mean "nothing suits", it would mean the
 * filter had eaten the wardrobe. The union excludes only garments that suit no
 * day of the group at all, which is the claim the data actually supports.
 */
export function warmthBandForDays(days: WeatherDay[]): [number, number] | null {
  let low: number | null = null
  let high: number | null = null

  for (const day of days) {
    const band = warmthBandForDay(day)
    if (!band) continue
    low = low === null ? band[0] : Math.min(low, band[0])
    high = high === null ? band[1] : Math.max(high, band[1])
  }

  return low === null || high === null ? null : [low, high]
}

/** Above this, "it might rain" stops being noise and becomes a packing decision. */
export const RAIN_THRESHOLD = 50

export interface RainOutlook {
  /** Dates where rain is likely enough to pack for. */
  dates: string[]
  likely: boolean
}

export function rainOutlook(days: WeatherDay[]): RainOutlook {
  const dates = days
    .filter((d) => d.precipitationProbability !== null && d.precipitationProbability >= RAIN_THRESHOLD)
    .map((d) => d.date)
  return { dates, likely: dates.length > 0 }
}

/* ------------------------------------------------------------------ */
/* saying it in plain words                                            */
/* ------------------------------------------------------------------ */

function round(value: number): number {
  return Math.round(value)
}

/**
 * The one-line summary shown on the trip.
 *
 * Says what was actually fetched and no more. A climate normal is labelled as a
 * normal, because presenting one as a forecast is called out specifically in
 * `01_ARCHITECTURE.md` §6 and in the `trip_weather` schema.
 */
export function describeWeather(days: WeatherDay[]): string | null {
  if (days.length === 0) return null

  const mins = days.map((d) => d.tempMinC).filter((t): t is number => t !== null)
  const maxes = days.map((d) => d.tempMaxC).filter((t): t is number => t !== null)
  if (mins.length === 0 || maxes.length === 0) return null

  const low = round(Math.min(...mins))
  const high = round(Math.max(...maxes))
  const normal = days.every((d) => d.source === 'climate_normal')

  const range = low === high ? `around ${low}°C` : `${low}° to ${high}°C`
  const rain = rainOutlook(days)

  const rainPhrase = rain.likely
    ? `, rain likely on ${rain.dates.length} ${rain.dates.length === 1 ? 'day' : 'days'}`
    : ''

  return normal
    ? `Typically ${range} at this time of year${rainPhrase}. This is the usual weather, not a forecast.`
    : `${range} while you are there${rainPhrase}.`
}

/**
 * What a set of days demands of the wardrobe.
 *
 * Separate from `describeWeather` on purpose: that one produces a sentence,
 * this one produces a decision. Until now `rainOutlook` fed only the sentence,
 * so a wet trip read "rain likely on 2 days" and changed nothing about what was
 * packed — the forecast was decoration.
 */
export function demandFor(days: WeatherDay[]): ConditionDemand {
  const rain = rainOutlook(days)
  const windy = days.some((d) => d.windKph !== null && d.windKph >= WIND_THRESHOLD_KPH)
  return { rain: rain.likely, wind: windy, rainDates: rain.dates }
}

/* ------------------------------------------------------------------ */
/* climate normals                                                     */
/* ------------------------------------------------------------------ */

/** How many past years to average. Enough to smooth one odd year, not a study. */
export const NORMAL_YEARS = 5

/**
 * Averages several past years of the same calendar window into one normal.
 *
 * Keyed by month-day, so 2 August across five years becomes one row for 2
 * August. The output is marked `climate_normal`, which is what stops it being
 * presented as a forecast anywhere downstream — `describeWeather` already
 * branches on it, and `01_ARCHITECTURE.md` §6 calls out that confusion by name.
 *
 * A month-day with no usable readings is dropped rather than interpolated. Half
 * an average is not a weaker answer, it is a different one.
 */
export function averageToNormals(years: WeatherDay[][], targetDates: string[]): WeatherDay[] {
  const byMonthDay = new Map<string, WeatherDay[]>()

  for (const year of years) {
    for (const day of year) {
      const key = day.date.slice(5)
      byMonthDay.set(key, [...(byMonthDay.get(key) ?? []), day])
    }
  }

  const mean = (values: Array<number | null>): number | null => {
    const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
    return real.length === 0 ? null : real.reduce((a, b) => a + b, 0) / real.length
  }

  const out: WeatherDay[] = []

  for (const date of targetDates) {
    const samples = byMonthDay.get(date.slice(5))
    if (!samples || samples.length === 0) continue

    const tempMinC = mean(samples.map((s) => s.tempMinC))
    const tempMaxC = mean(samples.map((s) => s.tempMaxC))
    if (tempMinC === null && tempMaxC === null) continue

    out.push({
      date,
      tempMinC,
      tempMaxC,
      /*
       * Historical rainfall is a millimetre total, not a chance of rain, so it
       * cannot honestly become a probability. A normal therefore carries no
       * rain figure and drives no rain demand — Pack Smart does not claim to
       * know whether it will rain in three months.
       */
      precipitationProbability: null,
      windKph: mean(samples.map((s) => s.windKph)),
      source: 'climate_normal',
    })
  }

  return out
}
