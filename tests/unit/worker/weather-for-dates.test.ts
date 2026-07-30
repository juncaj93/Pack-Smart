import { describe, expect, it } from 'vitest'
import { weatherForDates } from '@shared/weather'
import type { WeatherDay } from '@shared/weather'

/**
 * The conditions shown on an outfit card, for that outfit's own days.
 *
 * These matter more than most unit tests here because **no automated run has ever
 * seen a real forecast** — Open-Meteo is unreachable from CI and from the agent
 * environment (`09_IMPLEMENTATION_NOTES.md` §5), so the screenshots show this line
 * absent and cannot show it present. Everything the line promises is proven here
 * or nowhere.
 *
 * The one that matters most is the last group: a climate normal must never be
 * rendered as a forecast. Doc 03 and `01_ARCHITECTURE.md` §6 both name it as the
 * single way weather can mislead, and a short line is not an excuse to drop the
 * distinction.
 */

function day(overrides: Partial<WeatherDay> & { date: string }): WeatherDay {
  return {
    destinationId: null,
    tempMinC: 10,
    tempMaxC: 20,
    precipitationProbability: 0,
    windKph: 5,
    source: 'forecast',
    ...overrides,
  }
}

describe('the days an outfit covers', () => {
  it('reports the range across just those days', () => {
    const days = [
      day({ date: '2026-08-08', tempMinC: 9, tempMaxC: 19 }),
      day({ date: '2026-08-09', tempMinC: 12, tempMaxC: 24 }),
      // Not one of this outfit's days, and must not widen the range.
      day({ date: '2026-08-15', tempMinC: -4, tempMaxC: 40 }),
    ]
    expect(weatherForDates(days, ['2026-08-08', '2026-08-09'])).toBe('9–24°C')
  })

  it('says one temperature when the range collapses', () => {
    const days = [day({ date: '2026-08-08', tempMinC: 18, tempMaxC: 18 })]
    expect(weatherForDates(days, ['2026-08-08'])).toBe('18°C')
  })

  it('mentions rain when it is likely', () => {
    const days = [
      day({ date: '2026-08-08', precipitationProbability: 80 }),
      day({ date: '2026-08-09', precipitationProbability: 90 }),
    ]
    expect(weatherForDates(days, ['2026-08-08', '2026-08-09'])).toContain('rain likely')
  })

  it('does not mention rain when it is not likely', () => {
    const days = [day({ date: '2026-08-08', precipitationProbability: 5 })]
    expect(weatherForDates(days, ['2026-08-08'])).not.toContain('rain')
  })
})

describe('it says nothing rather than something wrong', () => {
  it('renders nothing when the outfit has no dates', () => {
    expect(weatherForDates([day({ date: '2026-08-08' })], [])).toBeNull()
  })

  it('renders nothing when no day was recorded for those dates', () => {
    expect(weatherForDates([day({ date: '2026-08-08' })], ['2026-08-20'])).toBeNull()
  })

  it('renders nothing when there is no forecast at all', () => {
    // The normal case. An empty weather slot on every card would be noise.
    expect(weatherForDates([], ['2026-08-08'])).toBeNull()
  })

  it('renders nothing when the temperatures are missing', () => {
    const days = [day({ date: '2026-08-08', tempMinC: null, tempMaxC: null })]
    expect(weatherForDates(days, ['2026-08-08'])).toBeNull()
  })
})

describe('the right place, on a multi-city trip', () => {
  const days = [
    day({ date: '2026-08-08', destinationId: 'cape-town', tempMinC: 9, tempMaxC: 19 }),
    day({ date: '2026-08-08', destinationId: 'kruger', tempMinC: 22, tempMaxC: 34 }),
  ]

  it('reports the stop those days belong to, not the other one', () => {
    /*
     * Showing Cape Town's temperature above the Kruger outfit is the same class of
     * failure as a normal presented as a forecast — a confident number about the
     * wrong thing — so the match is on destination as well as date.
     */
    expect(weatherForDates(days, ['2026-08-08'], 'kruger')).toBe('22–34°C')
    expect(weatherForDates(days, ['2026-08-08'], 'cape-town')).toBe('9–19°C')
  })

  it('treats a row with no destination as the trip’s one place', () => {
    // Every row written before multi-city existed carries a null destination.
    const legacy = [day({ date: '2026-08-08', destinationId: null, tempMinC: 5, tempMaxC: 15 })]
    expect(weatherForDates(legacy, ['2026-08-08'], 'anywhere')).toBe('5–15°C')
  })
})

describe('a climate normal is never dressed up as a forecast', () => {
  const normals = [
    day({ date: '2026-11-27', source: 'climate_normal', tempMinC: 6, tempMaxC: 14 }),
    day({ date: '2026-11-28', source: 'climate_normal', tempMinC: 7, tempMaxC: 15 }),
  ]

  it('marks it as usual weather', () => {
    expect(weatherForDates(normals, ['2026-11-27', '2026-11-28'])).toBe('Usually 6–15°C')
  })

  it('does not mark a real forecast', () => {
    const forecast = [day({ date: '2026-08-08', tempMinC: 9, tempMaxC: 19 })]
    expect(weatherForDates(forecast, ['2026-08-08'])).not.toContain('Usually')
  })

  it('does not claim usual weather when only some of it is a normal', () => {
    /*
     * A mixed window is a forecast that runs out. Labelling the whole line
     * "Usually" would understate the days that ARE forecast, and labelling none of
     * it would overstate the days that are not — so the prefix requires every day
     * to be a normal, and the honest fallback is the plainer of the two.
     */
    const mixed = [
      day({ date: '2026-08-08', source: 'forecast', tempMinC: 9, tempMaxC: 19 }),
      day({ date: '2026-08-09', source: 'climate_normal', tempMinC: 10, tempMaxC: 21 }),
    ]
    expect(weatherForDates(mixed, ['2026-08-08', '2026-08-09'])).toBe('9–21°C')
  })
})
