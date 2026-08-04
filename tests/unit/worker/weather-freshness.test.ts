import { describe, expect, it } from 'vitest'
import { describeTodayWeather, weatherForDay } from '@shared/today'
import {
  FORECAST_FRESH_FOR_SECONDS,
  describeAge,
  freshnessOf,
  parseTimezone,
  type WeatherDay,
} from '@shared/weather'

/**
 * How old the weather is, and why the number alone cannot say (E2).
 *
 * `01_ARCHITECTURE.md` §6 forbids a climate normal reading as a forecast. This
 * is the other half of the same rule: `62–78°F` fetched four days ago is a
 * different claim from `62–78°F` fetched this morning, and neither the digits
 * nor the degree sign says which. So the state travels with the number, and the
 * four states are asserted to look different.
 *
 * `fetched_at` has been stored since migration 0003 and was surfaced nowhere at
 * all before E2 — the screens could not have told these apart if they had tried.
 */

const NOW = 1_780_000_000

function day(overrides: Partial<WeatherDay> = {}): WeatherDay {
  return {
    destinationId: null,
    date: '2026-08-04',
    tempMinC: 12,
    tempMaxC: 24,
    precipitationProbability: 10,
    windKph: 8,
    source: 'forecast',
    ...overrides,
  }
}

describe('the four states weather can be in', () => {
  it('is unavailable when there is nothing stored', () => {
    expect(freshnessOf([], null, NOW)).toBe('unavailable')
    expect(freshnessOf([], NOW, NOW)).toBe('unavailable')
  })

  it('is seasonal when everything stored is a climate normal', () => {
    expect(freshnessOf([day({ source: 'climate_normal' })], NOW, NOW)).toBe('seasonal')
  })

  it('is live inside the freshness window and stale outside it', () => {
    expect(freshnessOf([day()], NOW - 60, NOW)).toBe('live')
    expect(freshnessOf([day()], NOW - FORECAST_FRESH_FOR_SECONDS + 1, NOW)).toBe('live')
    expect(freshnessOf([day()], NOW - FORECAST_FRESH_FOR_SECONDS, NOW)).toBe('stale')
    expect(freshnessOf([day()], NOW - 5 * 86_400, NOW)).toBe('stale')
  })

  it('is stale rather than live when nothing recorded when it was fetched', () => {
    expect(freshnessOf([day()], null, NOW)).toBe('stale')
  })

  /**
   * One number, two jobs, and they must not drift.
   *
   * The same constant decides when `refreshWeather` bothers going to look and
   * when the screen starts calling what it has stale. Two would let the screen
   * say `live` about something the refresher had already given up on.
   */
  it('uses the same window the refresher does', () => {
    expect(FORECAST_FRESH_FOR_SECONDS).toBe(12 * 60 * 60)
  })
})

describe('saying how old', () => {
  it('counts in the largest unit that is still true', () => {
    expect(describeAge(NOW - 600, NOW)).toBe('Checked less than an hour ago')
    expect(describeAge(NOW - 3 * 3600, NOW)).toBe('Checked 3 hours ago')
    expect(describeAge(NOW - 3600, NOW)).toBe('Checked 1 hour ago')
    expect(describeAge(NOW - 2 * 86_400, NOW)).toBe('Checked 2 days ago')
    expect(describeAge(NOW - 86_400, NOW)).toBe('Checked 1 day ago')
  })

  it('says nothing when nothing was ever fetched', () => {
    expect(describeAge(null, NOW)).toBeNull()
  })
})

describe('the line the Today screen reads', () => {
  const forecast = [day()]

  /**
   * The assertion that matters: **the same temperature must not produce the
   * same line in two different states.**
   */
  it('never looks the same across live, stale and seasonal', () => {
    const live = describeTodayWeather(weatherForDay(forecast, '2026-08-04', null), 'live', NOW, NOW)!
    const stale = describeTodayWeather(
      weatherForDay(forecast, '2026-08-04', null),
      'stale',
      NOW - 3 * 86_400,
      NOW,
    )!
    const seasonal = describeTodayWeather(
      weatherForDay([day({ source: 'climate_normal' })], '2026-08-04', null),
      'seasonal',
      NOW,
      NOW,
    )!

    // Same numbers underneath all three.
    expect(live.text).toContain('°F')
    expect(stale.text).toContain('°F')

    // And three distinguishable readings.
    const readings = new Set([
      `${live.text}|${live.age ?? ''}|${live.freshness}`,
      `${stale.text}|${stale.age ?? ''}|${stale.freshness}`,
      `${seasonal.text}|${seasonal.age ?? ''}|${seasonal.freshness}`,
    ])
    expect(readings.size).toBe(3)
  })

  it('shows the age only when it can change a reading', () => {
    const live = describeTodayWeather(weatherForDay(forecast, '2026-08-04', null), 'live', NOW, NOW)!
    expect(live.age).toBeNull()

    const stale = describeTodayWeather(
      weatherForDay(forecast, '2026-08-04', null),
      'stale',
      NOW - 3 * 86_400,
      NOW,
    )!
    expect(stale.age).toBe('Checked 3 days ago')
  })

  it('still refuses to let a normal read as a forecast', () => {
    const seasonal = describeTodayWeather(
      weatherForDay([day({ source: 'climate_normal' })], '2026-08-04', null),
      'seasonal',
      NOW,
      NOW,
    )!
    expect(seasonal.seasonal).toBe(true)
    expect(seasonal.text).toMatch(/^Usually /)
  })

  it('carries the Celsius the conflict rules are defined in', () => {
    const today = weatherForDay(forecast, '2026-08-04', null)!
    expect(today.tempMinC).toBe(12)
    expect(today.tempMaxC).toBe(24)
    expect(today.windKph).toBe(8)
    // And the Fahrenheit the screen reads, unchanged.
    expect(today.lowF).toBe(54)
    expect(today.highF).toBe(75)
  })
})

describe('the zone Open-Meteo already tells us', () => {
  it('reads a plausible IANA name out of the response', () => {
    expect(parseTimezone({ timezone: 'Africa/Johannesburg' })).toBe('Africa/Johannesburg')
    expect(parseTimezone({ timezone: 'America/New_York' })).toBe('America/New_York')
    expect(parseTimezone({ timezone: 'America/Argentina/Buenos_Aires' })).toBe(
      'America/Argentina/Buenos_Aires',
    )
    expect(parseTimezone({ timezone: 'UTC' })).toBe('UTC')
  })

  it('drops anything that is not one rather than storing a guess', () => {
    expect(parseTimezone({ timezone: 'GMT+2' })).toBeNull()
    expect(parseTimezone({ timezone: '' })).toBeNull()
    expect(parseTimezone({ timezone: 42 })).toBeNull()
    expect(parseTimezone({})).toBeNull()
    expect(parseTimezone(null)).toBeNull()
    expect(parseTimezone('Africa/Johannesburg')).toBeNull()
  })
})
