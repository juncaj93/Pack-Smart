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

/* ------------------------------------------------------------------ */
/* how old the answer is                                               */
/* ------------------------------------------------------------------ */

/**
 * Half a day. A forecast does not move fast enough to be worth chasing harder,
 * and this is the one number that decides both when a refresh is attempted and
 * when the screen starts calling what it has stale. Two numbers would drift, and
 * the drift would be invisible: the screen would say `live` about something the
 * refresher had already given up on.
 */
export const FORECAST_FRESH_FOR_SECONDS = 12 * 60 * 60

/**
 * The four states weather can be in, and they must never look alike (E2).
 *
 * `01_ARCHITECTURE.md` §6 already forbids a climate normal reading as a
 * forecast. This adds the other half of the same rule: a forecast fetched four
 * days ago must not read as one fetched this morning, and "we could not find
 * out" must not read as either. The same `62–78°F` is true, useful and honest in
 * one of these states and misleading in the others, so the state travels with
 * the number rather than beside it.
 */
export type WeatherFreshness = 'live' | 'stale' | 'seasonal' | 'unavailable'

export function freshnessOf(
  days: WeatherDay[],
  fetchedAt: number | null,
  now: number,
): WeatherFreshness {
  if (days.length === 0) return 'unavailable'
  if (days.every((day) => day.source === 'climate_normal')) return 'seasonal'
  if (fetchedAt === null) return 'stale'
  return now - fetchedAt < FORECAST_FRESH_FOR_SECONDS ? 'live' : 'stale'
}

/**
 * How old, in the fewest words that are still true.
 *
 * Returns null for `live`, because "checked 20 minutes ago" is noise on a
 * forecast nobody is doubting. The label earns its place exactly when the number
 * above it might be wrong.
 */
export function describeAge(fetchedAt: number | null, now: number): string | null {
  if (fetchedAt === null) return null

  const seconds = Math.max(0, now - fetchedAt)
  const hours = Math.floor(seconds / 3600)
  if (hours < 1) return 'Checked less than an hour ago'
  if (hours < 24) return `Checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

  const days = Math.floor(hours / 24)
  return `Checked ${days} ${days === 1 ? 'day' : 'days'} ago`
}

/**
 * Reads the IANA zone out of an Open-Meteo response.
 *
 * The forecast is asked for with `timezone=auto`, so the answer comes back
 * carrying the zone of the coordinates it was asked about — which is the only
 * no-cost source of "what time is it where Alex is" this product has. It was
 * being thrown away.
 *
 * Validated by SHAPE rather than against a list: `Region/City`, letters,
 * underscores and hyphens, plus the bare `UTC` the API returns for a few places.
 * A value that does not match is dropped, because `dateInZone` refuses an
 * unknown zone anyway and storing a bad one would only move the failure.
 */
export function parseTimezone(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as { timezone?: unknown }).timezone
  if (typeof value !== 'string') return null
  return /^(UTC|[A-Za-z_-]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?)$/.test(value) ? value : null
}

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

/**
 * Celsius in, Fahrenheit out. **Display only.**
 *
 * Pack Smart is Alex's, Alex is in the United States, and every temperature he
 * reads should be the one he thinks in.
 *
 * What is deliberately NOT converted is everything upstream of this line. The
 * forecast is stored exactly as Open-Meteo returns it, and `warmthNeededFor`
 * keeps its Celsius thresholds — 5 °C wants the warmest thing you own, 22 °C the
 * lightest. Converting the stored values would mean restating those thresholds,
 * re-deriving every warmth band, and re-checking a filter that decides which
 * jackets are admissible at all. That is a packing-intelligence change dressed up
 * as a units change, and the units change is the one that was asked for.
 *
 * So: one unit in the database and in the engine, another on the screen, and this
 * function is the only bridge.
 */
export function toFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32)
}

/**
 * The one-line summary shown on the trip.
 *
 * Says what was actually fetched and no more. A climate normal is labelled as a
 * normal, because presenting one as a forecast is called out specifically in
 * `01_ARCHITECTURE.md` §6 and in the `trip_weather` schema.
 */
interface WeatherFacts {
  /** "54° to 74°F", or "around 61°F" when the range collapses. */
  range: string
  /** The same range with nothing spare in it, for a metadata line. */
  compactRange: string
  /** ", rain likely on 2 days", or empty. Never dropped: it changes packing. */
  rainPhrase: string
  /** True when every day came from a climate normal rather than a forecast. */
  normal: boolean
}

/**
 * The one reading of the days that both the sentence and the compact line use.
 *
 * They said the same thing in two places before there was a compact line, and
 * the moment there were two composers there were two chances to drift about
 * what "typical" means or whether rain is worth mentioning. There is one.
 */
function weatherFacts(days: WeatherDay[]): WeatherFacts | null {
  if (days.length === 0) return null

  const mins = days.map((d) => d.tempMinC).filter((t): t is number => t !== null)
  const maxes = days.map((d) => d.tempMaxC).filter((t): t is number => t !== null)
  if (mins.length === 0 || maxes.length === 0) return null

  const low = toFahrenheit(Math.min(...mins))
  const high = toFahrenheit(Math.max(...maxes))
  const rain = rainOutlook(days)

  return {
    range: low === high ? `around ${low}°F` : `${low}° to ${high}°F`,
    compactRange: low === high ? `${low}°F` : `${low}–${high}°F`,
    rainPhrase: rain.likely
      ? `, rain likely on ${rain.dates.length} ${rain.dates.length === 1 ? 'day' : 'days'}`
      : '',
    normal: days.every((d) => d.source === 'climate_normal'),
  }
}

export function describeWeather(days: WeatherDay[]): string | null {
  const facts = weatherFacts(days)
  if (!facts) return null

  return facts.normal
    ? `Typically ${facts.range} at this time of year${facts.rainPhrase}. This is the usual weather, not a forecast.`
    : `${facts.range} while you are there${facts.rainPhrase}.`
}

/**
 * What a metadata line says, and what the disclosure behind it says.
 *
 * The sentence above is right and it is too prominent for the trip screen. On a
 * 390px iPhone "Typically 54° to 74°F at this time of year. This is the usual
 * weather, not a forecast." is three lines of a tinted panel, permanently, above
 * the packing list — for a fact that is context rather than a decision (§12 of
 * the V1.1 visual pass).
 *
 * So it splits, and the split is the point of the split: `short` keeps
 * everything that could change what goes in the bag — the range, and rain — and
 * `note` carries only the honesty about where the numbers came from. The
 * distinction between a climate normal and a forecast is NOT hidden; it is the
 * first word of `short` in both cases, and the whole of `note` says it again in
 * full for anyone who taps.
 */
export interface WeatherHeadline {
  short: string
  note: string | null
}

export function weatherHeadline(days: WeatherDay[]): WeatherHeadline | null {
  const facts = weatherFacts(days)
  if (!facts) return null

  return facts.normal
    ? {
        short: `Typical weather · ${facts.compactRange}${facts.rainPhrase}`,
        note: 'These are the usual conditions for these dates, not a forecast.',
      }
    : { short: `Forecast · ${facts.compactRange}${facts.rainPhrase}`, note: null }
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

/**
 * The weather for the days one outfit actually covers, in a few words.
 *
 * Deliberately shorter than `describeWeather`: that sentence is the trip's
 * headline and has room to explain itself, this sits under an outfit's name where
 * anything longer competes with the garments. `48–75°F` and `rain` is what changes
 * a decision about what to wear on that day.
 *
 * **A climate normal is never rendered as a forecast.** `describeWeather` says so
 * in a full sentence; there is no room for that here, so a normal is prefixed
 * `Usually` and a forecast is not prefixed at all. Doc 03 and
 * `01_ARCHITECTURE.md` §6 both single this out as the one way weather can
 * mislead, and a two-word line is not an excuse to drop the distinction.
 *
 * Returns null rather than a placeholder when there is nothing recorded for those
 * dates — most trips have no forecast at all, and an empty weather slot on every
 * outfit card would be noise on the screen doc 04 cares most about.
 */
export function weatherForDates(
  days: WeatherDay[],
  dates: string[],
  destinationId?: string | null,
): string | null {
  if (dates.length === 0) return null
  const wanted = new Set(dates)

  /*
   * Matched by destination as well as by date. A multi-city trip stores a row per
   * stop per day, and showing Cape Town's temperature above the Kruger outfit
   * would be worse than showing none — it is the same failure as a normal
   * presented as a forecast, just with geography instead of time.
   *
   * A null `destinationId` on the row means "the trip's one place", which is what
   * every row written before multi-city existed carries.
   */
  const relevant = days.filter(
    (day) =>
      wanted.has(day.date) &&
      (destinationId == null || day.destinationId == null || day.destinationId === destinationId),
  )
  if (relevant.length === 0) return null

  const mins = relevant.map((d) => d.tempMinC).filter((t): t is number => t !== null)
  const maxes = relevant.map((d) => d.tempMaxC).filter((t): t is number => t !== null)
  if (mins.length === 0 || maxes.length === 0) return null

  const low = toFahrenheit(Math.min(...mins))
  const high = toFahrenheit(Math.max(...maxes))
  const range = low === high ? `${low}°F` : `${low}–${high}°F`

  const parts = [relevant.every((d) => d.source === 'climate_normal') ? `Usually ${range}` : range]
  if (rainOutlook(relevant).likely) parts.push('rain likely')

  return parts.join(' · ')
}
