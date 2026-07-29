import { describe, expect, it } from 'vitest'
import {
  RAIN_THRESHOLD,
  describeWeather,
  parseForecast,
  parseGeocoding,
  rainOutlook,
  warmthBandForDay,
  warmthBandForDays,
  warmthNeededFor,
  type WeatherDay,
} from '../../../shared/weather'
import { daysAway, withinForecastHorizon } from '../../../worker/weather'

/**
 * Weather, tested where it can be tested.
 *
 * The build environment cannot reach api.open-meteo.com, so the live call is
 * exercised only in production (09_IMPLEMENTATION_NOTES.md §5). That makes these
 * tests more load-bearing than usual, not less: everything that DECIDES anything
 * is a pure function over a payload, and the payloads below are the shapes
 * Open-Meteo documents — including the malformed ones, because "the response was
 * not what we expected" is the outcome this environment guarantees will happen
 * at least once.
 */

/** A trimmed but structurally faithful Open-Meteo daily response. */
const FORECAST = {
  latitude: -33.9,
  longitude: 18.4,
  daily: {
    time: ['2026-08-01', '2026-08-02', '2026-08-03'],
    temperature_2m_max: [18.4, 21.1, 12.0],
    temperature_2m_min: [9.2, 11.8, 4.5],
    precipitation_probability_max: [10, 65, 80],
    wind_speed_10m_max: [22.5, 31.0, 40.2],
  },
}

describe('reading an Open-Meteo forecast', () => {
  it('turns the parallel arrays into one row per date', () => {
    const days = parseForecast(FORECAST)

    expect(days).toHaveLength(3)
    expect(days[0]).toEqual({
      date: '2026-08-01',
      tempMinC: 9.2,
      tempMaxC: 18.4,
      precipitationProbability: 10,
      windKph: 22.5,
      source: 'forecast',
    })
  })

  /*
   * The important half. This environment cannot prove the happy path against
   * the live API, so the guarantee that has to hold is the other one: a payload
   * that is not what we expect produces NOTHING, never a half-invented day.
   */
  it('returns nothing rather than guessing at a payload it does not recognise', () => {
    for (const payload of [
      null,
      undefined,
      'not json',
      42,
      {},
      { daily: null },
      { daily: {} },
      { daily: { time: 'today' } },
      { error: true, reason: 'No matching location found.' },
    ]) {
      expect(parseForecast(payload)).toEqual([])
    }
  })

  it('drops a date with no temperature beside it', () => {
    const days = parseForecast({
      daily: {
        time: ['2026-08-01', '2026-08-02'],
        temperature_2m_max: [18.4, null],
        temperature_2m_min: [9.2, null],
      },
    })

    expect(days.map((d) => d.date)).toEqual(['2026-08-01'])
  })

  it('keeps a date that has only one of the two temperatures', () => {
    const days = parseForecast({
      daily: { time: ['2026-08-01'], temperature_2m_max: [18.4], temperature_2m_min: [null] },
    })

    expect(days[0]).toMatchObject({ tempMaxC: 18.4, tempMinC: null })
  })

  it('ignores a row whose date is not a date', () => {
    const days = parseForecast({
      daily: { time: ['tomorrow', '2026-08-02'], temperature_2m_max: [18, 19], temperature_2m_min: [9, 10] },
    })

    expect(days.map((d) => d.date)).toEqual(['2026-08-02'])
  })
})

describe('reading a geocoding result', () => {
  it('takes the first hit', () => {
    const place = parseGeocoding({
      results: [
        { name: 'Cape Town', country: 'South Africa', latitude: -33.92584, longitude: 18.42322 },
        { name: 'Cape Town', country: 'United States', latitude: 40.1, longitude: -74.8 },
      ],
    })

    expect(place).toEqual({
      name: 'Cape Town',
      country: 'South Africa',
      latitude: -33.92584,
      longitude: 18.42322,
    })
  })

  it('returns nothing for a place that does not exist', () => {
    // Open-Meteo answers 200 with no `results` key at all for an unknown name.
    expect(parseGeocoding({ generationtime_ms: 0.7 })).toBeNull()
    expect(parseGeocoding({ results: [] })).toBeNull()
    expect(parseGeocoding(null)).toBeNull()
  })

  it('refuses a hit with no coordinates rather than defaulting to zero', () => {
    // 0,0 is a real place in the Atlantic. Silently forecasting for it would be
    // worse than having no forecast.
    expect(parseGeocoding({ results: [{ name: 'Nowhere' }] })).toBeNull()
  })
})

describe('temperature to garment warmth', () => {
  it('asks for more warmth as it gets colder', () => {
    expect(warmthNeededFor(28)).toBe(0)
    expect(warmthNeededFor(18)).toBe(1)
    expect(warmthNeededFor(9)).toBe(2)
    expect(warmthNeededFor(-2)).toBe(3)
  })

  it('spans a day from its warmest need to its coldest', () => {
    const day: WeatherDay = {
      date: '2026-08-01',
      tempMinC: 4,
      tempMaxC: 24,
      precipitationProbability: null,
      windKph: null,
      source: 'forecast',
    }
    // 24° wants the lightest thing, 4° wants the warmest. Both are the same day.
    expect(warmthBandForDay(day)).toEqual([0, 3])
  })

  it('has no band at all when it has no temperature', () => {
    expect(
      warmthBandForDay({
        date: '2026-08-01',
        tempMinC: null,
        tempMaxC: null,
        precipitationProbability: null,
        windKph: null,
        source: 'forecast',
      }),
    ).toBeNull()
    expect(warmthBandForDays([])).toBeNull()
  })

  /*
   * The union, not the intersection. This band is a HARD filter on jackets, and
   * an intersection across a varied week is routinely empty — which would empty
   * the jacket slot on a trip where Alex owns a perfectly good jacket.
   */
  it('widens to cover every day of a group rather than narrowing to none', () => {
    const days = parseForecast(FORECAST)
    // 21° wants the lightest; 4.5° wants the warmest. Nothing in between is excluded.
    expect(warmthBandForDays(days)).toEqual([1, 3])
  })
})

describe('rain', () => {
  it('names only the days worth packing for', () => {
    const outlook = rainOutlook(parseForecast(FORECAST))
    expect(outlook.likely).toBe(true)
    expect(outlook.dates).toEqual(['2026-08-02', '2026-08-03'])
  })

  it('says nothing when rain is merely possible', () => {
    const days = parseForecast({
      daily: {
        time: ['2026-08-01'],
        temperature_2m_max: [20],
        temperature_2m_min: [10],
        precipitation_probability_max: [RAIN_THRESHOLD - 1],
      },
    })
    expect(rainOutlook(days).likely).toBe(false)
  })
})

describe('saying it in plain words', () => {
  it('gives a range and the rainy days', () => {
    expect(describeWeather(parseForecast(FORECAST))).toBe(
      '5° to 21°C while you are there, rain likely on 2 days.',
    )
  })

  it('labels a climate normal as a normal, never as a forecast', () => {
    const normals = parseForecast(FORECAST, 'climate_normal')
    const text = describeWeather(normals)!

    expect(text).toContain('not a forecast')
    expect(text).toContain('Typically')
  })

  it('says nothing when it knows nothing', () => {
    expect(describeWeather([])).toBeNull()
  })
})

describe('the forecast horizon', () => {
  it('counts days between two dates', () => {
    expect(daysAway('2026-08-11', '2026-07-29')).toBe(13)
    expect(daysAway('2026-07-29', '2026-07-29')).toBe(0)
    expect(daysAway('2026-07-20', '2026-07-29')).toBe(-9)
  })

  it('will not ask for a forecast Open-Meteo does not have', () => {
    expect(withinForecastHorizon('2026-08-11', '2026-07-29')).toBe(true)
    expect(withinForecastHorizon('2026-09-30', '2026-07-29')).toBe(false)
  })

  it('still asks for a trip already under way', () => {
    expect(withinForecastHorizon('2026-07-20', '2026-07-29')).toBe(true)
  })
})
