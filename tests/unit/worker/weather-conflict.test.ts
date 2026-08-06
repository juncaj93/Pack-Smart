import { describe, expect, it } from 'vitest'
import type { TodayWeather } from '@shared/today'
import {
  weatherConflicts,
  type ConflictInput,
  type PackedOption,
  type WornGarment,
} from '@shared/weather-conflict'

/**
 * When today's weather disagrees with today's approved outfit (E2).
 *
 * Two properties are under test and they pull against each other, which is the
 * whole difficulty of this feature:
 *
 *   - it must **notice** a day that has become a different clothing problem;
 *   - it must **stay quiet** about a day that has merely moved two degrees.
 *
 * So every assertion below is about a band boundary rather than a temperature.
 * The third property is absolute and cheaper to state: **nothing here changes an
 * approved outfit.** It returns sentences and options; a swap only ever happens
 * because Alex tapped one.
 */

function weather(overrides: Partial<TodayWeather> = {}): TodayWeather {
  return {
    source: 'forecast',
    lowF: 60,
    highF: 72,
    rainLikely: false,
    precipitationProbability: 10,
    tempMinC: 16,
    tempMaxC: 22,
    windKph: 8,
    ...overrides,
  }
}

function worn(overrides: Partial<WornGarment> = {}): WornGarment {
  return {
    itemId: 'w1',
    name: 'Linen shirt',
    detail: null,
    role: 'top',
    roleLabel: 'Top',
    warmth: 1,
    keepsRainOff: false,
    keepsWindOff: false,
    ...overrides,
  }
}

function option(overrides: Partial<PackedOption> = {}): PackedOption {
  return { ...worn({ itemId: 'p1', name: 'Packed thing' }), ...overrides }
}

function input(overrides: Partial<ConflictInput> = {}): ConflictInput {
  return {
    weather: weather(),
    freshness: 'live',
    hadForecast: true,
    worn: [worn()],
    options: [],
    dismissed: {},
    fetchedAt: 1_780_000_000,
    ...overrides,
  }
}

const kinds = (result: ReturnType<typeof weatherConflicts>) => result.map((c) => c.kind)

/* ------------------------------------------------------------------ */

describe('a day that agrees with its outfit', () => {
  it('says nothing at all', () => {
    expect(weatherConflicts(input())).toEqual([])
  })

  /**
   * The property that keeps this feature worth reading.
   *
   * A forecast that moves within a band changes no clothing decision, and an
   * alert for it teaches Alex to ignore the ones that matter.
   */
  it('says nothing when the forecast moves without crossing a band', () => {
    // 16→18°C and 22→21°C are both inside the same warmth bands as the baseline.
    const nudged = weatherConflicts(input({ weather: weather({ tempMinC: 18, tempMaxC: 21 }) }))
    expect(nudged).toEqual([])
  })

  it('says nothing when there is no forecast and there never was one', () => {
    expect(
      weatherConflicts(input({ weather: null, freshness: 'unavailable', hadForecast: false })),
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ */

describe('rain', () => {
  it('is raised when nothing worn is recorded as keeping it off', () => {
    const result = weatherConflicts(
      input({ weather: weather({ rainLikely: true, precipitationProbability: 80 }) }),
    )
    expect(kinds(result)).toEqual(['rain'])
  })

  it('is not raised when something worn is', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ rainLikely: true }),
        worn: [worn({ role: 'outer', roleLabel: 'Jacket', keepsRainOff: true })],
      }),
    )
    expect(kinds(result)).toEqual([])
  })

  /**
   * The refusal `weather-fit.ts` exists for, restated where it can be broken.
   *
   * A jacket is not rain protection because it is a jacket. Telling Alex his
   * quilted jacket will keep him dry is exactly the confident wrong answer this
   * product is built to avoid — he would find out on a wet safari morning.
   */
  it('is still raised when the outfit HAS an outer layer with nothing recorded', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ rainLikely: true }),
        worn: [worn({ itemId: 'quilt', name: 'Quilted jacket', role: 'outer', roleLabel: 'Jacket' })],
      }),
    )

    expect(kinds(result)).toEqual(['rain'])
    // And it names the jacket as the slot in question rather than ignoring it.
    expect(result[0]!.itemName).toBe('Quilted jacket')
  })

  it('offers only packed garments recorded as keeping rain off', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ rainLikely: true }),
        options: [
          option({ itemId: 'shell', name: 'Gore-Tex shell', keepsRainOff: true }),
          option({ itemId: 'quilt', name: 'Quilted jacket' }),
        ],
      }),
    )

    expect(result[0]!.alternatives.map((a) => a.name)).toEqual(['Gore-Tex shell'])
  })

  /**
   * The honest empty case, which E1 established and E2 inherits.
   *
   * `weather-fit.ts` will not call a jacket waterproof because it is a jacket,
   * so a wet morning with nothing recorded is common rather than hypothetical —
   * and it is still worth saying, because knowing costs nothing and finding out
   * on a safari morning costs the day.
   */
  it('says so honestly when nothing packed would answer it', () => {
    const result = weatherConflicts(input({ weather: weather({ rainLikely: true }) }))

    expect(result[0]!.alternatives).toEqual([])
    expect(result[0]!.detail).toContain('Nothing you packed')
    expect(result[0]!.detail).toContain('has not changed')
  })
})

/* ------------------------------------------------------------------ */

describe('temperature', () => {
  it('is raised when the day needs a warmer band than anything worn', () => {
    // 2°C needs the warmest band (3); the outfit's warmest garment is a 1.
    const result = weatherConflicts(input({ weather: weather({ tempMinC: 2, tempMaxC: 6 }) }))
    expect(kinds(result)).toContain('colder')
  })

  it('offers only packed garments that actually reach the band', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ tempMinC: 2, tempMaxC: 6 }),
        options: [
          option({ itemId: 'parka', name: 'Down parka', warmth: 3 }),
          option({ itemId: 'tee', name: 'Cotton tee', warmth: 0 }),
        ],
      }),
    )

    const colder = result.find((c) => c.kind === 'colder')!
    expect(colder.alternatives.map((a) => a.name)).toEqual(['Down parka'])
  })

  it('is honest when nothing warmer is in the bag, and still says the outfit is untouched', () => {
    const result = weatherConflicts(input({ weather: weather({ tempMinC: 2, tempMaxC: 6 }) }))
    const colder = result.find((c) => c.kind === 'colder')!

    expect(colder.alternatives).toEqual([])
    expect(colder.detail).toContain('has not changed')
  })

  it('is raised for heat only when something lighter is actually packed', () => {
    const hot = weather({ tempMinC: 26, tempMaxC: 30 })

    // Nothing lighter in the bag: no banner, because there is no next action.
    const alone = weatherConflicts(
      input({ weather: hot, worn: [worn({ warmth: 2 })], options: [] }),
    )
    expect(kinds(alone)).not.toContain('hotter')

    const withOption = weatherConflicts(
      input({
        weather: hot,
        worn: [worn({ warmth: 2 })],
        options: [option({ itemId: 'tee', name: 'Cotton tee', warmth: 0 })],
      }),
    )
    expect(kinds(withOption)).toContain('hotter')
  })

  it('ignores garments whose warmth Alex never recorded', () => {
    // Nothing recorded means nothing to compare — not "assume it is thin".
    const result = weatherConflicts(
      input({ weather: weather({ tempMinC: 2 }), worn: [worn({ warmth: null })] }),
    )
    expect(kinds(result)).not.toContain('colder')
  })
})

/* ------------------------------------------------------------------ */

describe('wind', () => {
  it('is a preference, so it is raised only when something packed would answer it', () => {
    const windy = weather({ windKph: 50 })

    expect(kinds(weatherConflicts(input({ weather: windy })))).not.toContain('wind')

    const withOption = weatherConflicts(
      input({
        weather: windy,
        options: [option({ itemId: 'shell', name: 'Windbreaker', keepsWindOff: true })],
      }),
    )
    expect(kinds(withOption)).toContain('wind')
  })

  it('stays quiet below the threshold', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ windKph: 20 }),
        options: [option({ itemId: 'shell', name: 'Windbreaker', keepsWindOff: true })],
      }),
    )
    expect(kinds(result)).not.toContain('wind')
  })
})

/* ------------------------------------------------------------------ */

describe('a forecast that was there and is not any more', () => {
  it('says so, and says nothing else', () => {
    const result = weatherConflicts(
      input({ weather: null, freshness: 'unavailable', hadForecast: true }),
    )

    expect(kinds(result)).toEqual(['forecast_lost'])
    expect(result[0]!.detail).toContain('has not been changed')
  })

  it('treats seasonal guidance as a lost forecast rather than as one', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ source: 'climate_normal', rainLikely: true }),
        freshness: 'seasonal',
        hadForecast: true,
      }),
    )

    // Not a rain conflict: a five-August average is not a claim about today.
    expect(kinds(result)).toEqual(['forecast_lost'])
    expect(result[0]!.detail).toContain('not a forecast')
  })
})

/* ------------------------------------------------------------------ */

describe('keeping the outfit', () => {
  it('silences the conflict for the forecast it was answered about', () => {
    const wet = { weather: weather({ rainLikely: true }) }

    expect(kinds(weatherConflicts(input(wet)))).toEqual(['rain'])
    expect(
      kinds(weatherConflicts(input({ ...wet, dismissed: { rain: 1_780_000_000 } }))),
    ).toEqual([])
  })

  /**
   * The reason a dismissal stores a timestamp rather than a boolean.
   *
   * A decision made about this morning's weather must not suppress a warning
   * raised by tomorrow's. That is the silent failure this feature is most prone
   * to, and a bare flag would have shipped it.
   */
  it('does not silence it for a newer forecast', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ rainLikely: true }),
        dismissed: { rain: 1_780_000_000 },
        fetchedAt: 1_780_100_000,
      }),
    )
    expect(kinds(result)).toEqual(['rain'])
  })

  it('silences only the kind it answered', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ rainLikely: true, tempMinC: 2 }),
        dismissed: { rain: 1_780_000_000 },
      }),
    )
    expect(kinds(result)).toEqual(['colder'])
  })
})

/* ------------------------------------------------------------------ */

describe('what it never does', () => {
  /**
   * The rule the whole file exists to obey (doc 04 §12).
   *
   * Stated as a test because it is the kind of thing a later refactor breaks
   * without noticing: a conflict is a sentence and a list of options, and there
   * is nowhere in its output for "and I have applied it".
   */
  it('never offers a garment that is already being worn', () => {
    const result = weatherConflicts(
      input({
        weather: weather({ rainLikely: true }),
        worn: [worn({ itemId: 'shell', name: 'Gore-Tex shell', keepsRainOff: false })],
        options: [option({ itemId: 'shell', name: 'Gore-Tex shell', keepsRainOff: true })],
      }),
    )
    expect(result[0]!.alternatives).toEqual([])
  })

  it('always says the approved outfit is unchanged', () => {
    const all = [
      weatherConflicts(input({ weather: weather({ rainLikely: true }) })),
      weatherConflicts(input({ weather: weather({ tempMinC: 2 }) })),
      weatherConflicts(input({ weather: null, freshness: 'unavailable', hadForecast: true })),
    ].flat()

    expect(all.length).toBeGreaterThan(0)
    for (const conflict of all) {
      expect(conflict.detail).toMatch(/has not changed|has not been changed/)
    }
  })
})
