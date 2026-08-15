import { describe, expect, it } from 'vitest'
import {
  formatHeroDate,
  heroAgenda,
  heroInsight,
  heroLines,
  heroOutfits,
  heroTomorrow,
  homeHero,
  nextThingFor,
  HERO_LINE_BUDGET,
  TOMORROW_FROM_HOUR,
  type HeroInput,
  type HeroPlan,
} from '@shared/home'
import { readiness, type Readiness } from '@shared/readiness'
import type { Trip } from '@shared/trips'
import type { TodayWeather } from '@shared/today'

/**
 * What Home says above the trip card.
 *
 * Every case here is a state a real trip passes through, and the model is pure,
 * so each one is a value in and a value out — no clock, no network, no render.
 * The pass this belongs to asked for a specific list of things that must NOT be
 * possible, and each of them is a test below:
 *
 *   - the pre-trip hero showing during an active trip
 *   - trip weather read on the wrong day
 *   - a two-event day showing only the first outfit
 *   - the no-trip state rendering a trip card's worth of anything
 *   - an insight appearing when no replan flagged anything
 *   - the hero repeating the packing progress that is on the card
 *
 * Each was applied as a mutation to `shared/home.ts` and confirmed to turn one
 * of these red before the mutation was reverted.
 */

const TRIP: Trip = {
  id: 't1',
  name: 'Up North Labor Day',
  emoji: '🌲',
  startDate: '2026-09-04',
  endDate: '2026-09-08',
  status: 'planned',
  notes: null,
  luggageMode: null,
  bags: null,
  laundryAvailable: true,
  maxDressiness: 3,
  flightHours: 0,
  international: false,
  timezone: 'America/Detroit',
  destinations: [
    {
      id: 'd1',
      name: 'Traverse City',
      country: 'United States',
      arriveDate: null,
      departDate: null,
      timezone: 'America/Detroit',
      latitude: null,
      longitude: null,
      sortOrder: 0,
    },
  ],
  activities: ['beach', 'nice_dinner'],
  days: [
    { id: 'e1', date: '2026-09-05', activityTag: 'beach', sortOrder: 0 },
    { id: 'e2', date: '2026-09-05', activityTag: 'nice_dinner', sortOrder: 1 },
    { id: 'e3', date: '2026-09-06', activityTag: 'hiking', sortOrder: 0 },
  ],
  facts: [],
  archivedAt: null,
  reviewedAt: null,
} as unknown as Trip

const WEATHER: TodayWeather = {
  source: 'forecast',
  lowF: 58,
  highF: 64,
  rainLikely: false,
  precipitationProbability: 10,
  tempMinC: 14,
  tempMaxC: 18,
  windKph: 9,
}

function plan(name: string | null, garments: string[], missingCount = 0): HeroPlan {
  return {
    groupName: name,
    wear: garments.map((garment) => ({ itemId: garment, name: garment, color: 'Navy' })),
    missingCount,
  }
}

/** Readiness for this trip on a given day, from the real model rather than a stub. */
function readyOn(today: string, overrides: Partial<Parameters<typeof readiness>[0]> = {}) {
  return readiness({
    trip: TRIP,
    entries: [],
    outfits: [],
    today,
    ...overrides,
  })
}

function input(overrides: Partial<HeroInput> = {}): HeroInput {
  return {
    trip: TRIP,
    readiness: readyOn('2026-08-14'),
    today: null,
    tripWeather: null,
    outfitGroups: [],
    localDate: '2026-08-14',
    now: 1_786_000_000,
    hour: 9,
    ...overrides,
  }
}

/** The on-trip briefing, with today as the trip's second day. */
function onTrip(overrides: Partial<NonNullable<HeroInput['today']>> = {}) {
  return {
    todayDate: '2026-09-05',
    place: { name: 'Traverse City' },
    weather: WEATHER,
    freshness: 'live' as const,
    weatherFetchedAt: 1_785_999_000,
    conflicts: [],
    plans: [plan('Beach', ['T-Shirt', 'Everyday Pants', 'Sneakers'])],
    tomorrow: null,
    ...overrides,
  }
}

describe('which hero this is', () => {
  it('is the no-trip hero when there is no trip, and carries nothing but the date', () => {
    const hero = homeHero(input({ trip: null, readiness: null }))

    expect(hero.mode).toBe('no_trip')
    expect(hero.dateLabel).toMatch(/^Fri 14 Aug/)
    /*
     * §29: no empty trip card skeleton. Every field that would need a trip
     * behind it is null, so there is nothing for a screen to render half of.
     */
    expect(hero.place).toBeNull()
    expect(hero.weather).toBeNull()
    expect(hero.outfits).toEqual([])
    expect(hero.nextThing).toBeNull()
    expect(hero.insight).toBeNull()
  })

  it('is the upcoming hero before departure', () => {
    expect(homeHero(input()).mode).toBe('upcoming')
  })

  /**
   * The mutation: `homeHero` ignoring `today` and returning the upcoming shape.
   *
   * That is the single most damaging thing that could happen to this screen —
   * Home would go on counting down to a trip Alex is standing in the middle of —
   * so it is asserted on the day rather than only on the mode.
   */
  it('is the on-trip hero once the trip has started, and is about today', () => {
    const hero = homeHero(
      input({ readiness: readyOn('2026-09-05'), today: onTrip(), localDate: '2026-09-05' }),
    )

    expect(hero.mode).toBe('on_trip')
    expect(hero.place).toBe('Traverse City')
    expect(hero.dateLabel).toMatch(/^Sat 5 Sep/)
    expect(hero.outfits).toHaveLength(1)
  })

  it('is the post-trip hero once the trip is over, and leaves the review to the card', () => {
    const finished = { ...TRIP, endDate: '2026-08-01', startDate: '2026-07-25' } as Trip
    const hero = homeHero(
      input({ trip: finished, readiness: readiness({ trip: finished, entries: [], outfits: [], today: '2026-08-14' }) }),
    )

    expect(hero.mode).toBe('post_trip')
    // "Review the trip" is `readiness.next`, which is the trip card's button.
    // A hero that also offered it would be the same action twice.
    expect(hero.nextThing).toBeNull()
    expect(hero.outfits).toEqual([])
  })
})

describe('the day, and whose day it is', () => {
  /**
   * The mutation: reading the date off `localDate` while the trip is underway.
   *
   * The device is on home time; `todayDate` is the traveller's own calendar day,
   * resolved by `resolveTodayDate` against the destination's zone. Preferring the
   * device would put Alex on the wrong day of his own trip — which is the whole
   * reason that resolution exists.
   */
  it('uses the trip’s own day during a trip, not the device’s', () => {
    const hero = homeHero(
      input({
        readiness: readyOn('2026-09-05'),
        today: onTrip({ todayDate: '2026-09-05' }),
        // The phone, still a day behind in another time zone.
        localDate: '2026-09-04',
      }),
    )

    expect(hero.dateLabel).toMatch(/^Sat 5 Sep/)
  })

  it('uses the device’s day before the trip starts, because there is no other', () => {
    expect(homeHero(input({ localDate: '2026-08-14' })).dateLabel).toMatch(/^Fri 14 Aug/)
  })

  it('spells a date without letting a time zone move it', () => {
    // The classic off-by-one: a date parsed as local midnight in a negative
    // offset renders as the previous day.
    // Matched loosely on the month, because ICU spells September `Sep` in one
    // Node release and `Sept` in the next, and this test is about the DAY.
    expect(formatHeroDate('2026-01-01')).toMatch(/^Thu 1 Jan/)
    expect(formatHeroDate('2026-12-31')).toMatch(/^Thu 31 Dec/)
  })
})

describe('weather', () => {
  it('shows today’s numbers during a trip, with no place in front of them', () => {
    const hero = homeHero(input({ readiness: readyOn('2026-09-05'), today: onTrip() }))

    expect(hero.weather).toBe('58–64°F')
    // Not labelled with a destination: this IS where Alex is standing.
    expect(hero.weatherPlace).toBeNull()
  })

  it('says rain when rain is likely', () => {
    const hero = homeHero(
      input({
        readiness: readyOn('2026-09-05'),
        today: onTrip({ weather: { ...WEATHER, rainLikely: true } }),
      }),
    )

    expect(hero.weather).toBe('58–64°F · rain likely')
  })

  it('names the destination before departure, so the numbers cannot be misread', () => {
    const hero = homeHero(
      input({
        tripWeather: {
          days: [
            { date: '2026-09-04', tempMinC: 14, tempMaxC: 22, precipitationProbability: 10, windKph: 8, source: 'forecast' },
            { date: '2026-09-05', tempMinC: 15, tempMaxC: 23, precipitationProbability: 5, windKph: 8, source: 'forecast' },
          ],
        },
      }),
    )

    expect(hero.weatherPlace).toBe('Traverse City')
    expect(hero.weather).toContain('Forecast')
  })

  it('says a climate normal is a climate normal', () => {
    const hero = homeHero(
      input({
        tripWeather: {
          days: [
            { date: '2026-09-04', tempMinC: 12, tempMaxC: 24, precipitationProbability: 20, windKph: 8, source: 'climate_normal' },
          ],
        },
      }),
    )

    expect(hero.weather).toContain('Typical weather')
    expect(hero.weatherNote).toBeTruthy()
  })

  it('says nothing at all when there is no forecast', () => {
    expect(homeHero(input({ tripWeather: { days: [] } })).weather).toBeNull()
    expect(homeHero(input()).weather).toBeNull()
  })

  /**
   * The mutation: generating a consequence line rather than repeating one.
   *
   * `weatherConflicts` is the authority on when today's forecast disagrees with
   * today's outfit, and it produces the sentence. The hero must never have an
   * opinion of its own here — a line that appears because it is warmer than
   * yesterday, or because it is raining at all, is the generic advice §9 rules
   * out.
   */
  it('carries a consequence only when there is a real conflict, and only one', () => {
    expect(homeHero(input({ readiness: readyOn('2026-09-05'), today: onTrip() })).consequence).toBeNull()

    const hero = homeHero(
      input({
        readiness: readyOn('2026-09-05'),
        today: onTrip({
          conflicts: [
            { headline: 'Colder today than this outfit was planned for' },
            { headline: 'Windy today, and nothing in this outfit is recorded for it' },
          ],
        }),
      }),
    )

    expect(hero.consequence).toBe('Colder today than this outfit was planned for')
  })
})

describe('today’s outfits', () => {
  /**
   * The mutation: `heroOutfits` returning `plans.slice(0, 1)`.
   *
   * A beach afternoon and a formal dinner are two outfits, and showing only the
   * first tells Alex to wear his swimming trunks to dinner.
   */
  it('shows both outfits on a two-event day', () => {
    const outfits = heroOutfits([
      plan('Sightseeing', ['T-Shirt', 'Everyday Pants', 'Sneakers']),
      plan('Nice dinners', ['Button-Up', 'Pants', 'Sneakers']),
    ])

    expect(outfits.map((outfit) => outfit.title)).toEqual(['Sightseeing', 'Nice dinners'])
    expect(outfits[0]!.garments.map((g) => g.name)).toEqual([
      'T-Shirt',
      'Everyday Pants',
      'Sneakers',
    ])
  })

  it('does not print the same outfit twice when two events share one', () => {
    const same = ['T-Shirt', 'Everyday Pants', 'Sneakers']
    const outfits = heroOutfits([plan('Beach', same), plan('Casual days', same)])

    expect(outfits).toHaveLength(1)
  })

  it('stops at two, however many the day holds', () => {
    const outfits = heroOutfits([
      plan('One', ['A']),
      plan('Two', ['B']),
      plan('Three', ['C']),
    ])

    expect(outfits).toHaveLength(2)
  })

  it('names at most four garments, so a summary stays one line', () => {
    const outfits = heroOutfits([plan('Beach', ['A', 'B', 'C', 'D', 'E', 'F'])])

    expect(outfits[0]!.garments).toHaveLength(4)
  })

  /**
   * An outfit the bag cannot dress.
   *
   * `getDayPlans` returns only what is confirmed packed (doc 04 §10), so an
   * unpacked outfit arrives with no garments. Rendering an empty row would be
   * Home hiding the problem; the note names it.
   */
  it('says so when the day calls for an outfit nothing is packed for', () => {
    const outfits = heroOutfits([plan('Nice dinners', [], 3)])

    expect(outfits[0]!.garments).toEqual([])
    expect(outfits[0]!.note).toBe('3 things for this are not packed')
  })

  it('offers no outfit row at all when there is nothing to say about one', () => {
    expect(heroOutfits([plan(null, [], 0)])).toEqual([])
  })

  it('carries the colour through, so the summary can draw its swatches', () => {
    expect(heroOutfits([plan('Beach', ['T-Shirt'])])[0]!.garments[0]!.color).toBe('Navy')
  })
})

describe('the agenda', () => {
  it('names only what the outfits above have not already named', () => {
    const outfits = heroOutfits([plan('Nice dinners', ['Button-Up'])])

    // "Nice dinner" and "Nice dinners" are the same thing said twice.
    expect(heroAgenda(['Nice dinner', 'Beach'], outfits)).toEqual(['Beach'])
  })

  it('keeps everything when no outfit names it', () => {
    expect(heroAgenda(['Beach', 'Hiking'], [])).toEqual(['Beach', 'Hiking'])
  })

  it('reads today’s activities in the order they were arranged', () => {
    const hero = homeHero(
      input({
        readiness: readyOn('2026-09-05'),
        // No outfits, so nothing is absorbed into an outfit heading.
        today: onTrip({ plans: [] }),
      }),
    )

    expect(hero.agenda).toEqual(['Beach', 'Nice dinners'])
  })
})

describe('the one next thing', () => {
  /**
   * The mutation: `nextThingFor` returning `readiness.issues[0]` unfiltered.
   *
   * The trip card's primary button already IS the recommendation. A hero line
   * pointing at the same screen is two controls for one job in one viewport,
   * which is what `VISUAL_ACCEPTANCE.md` §2 calls competing actions.
   */
  it('never repeats what the trip card’s own button already leads to', () => {
    const ready = {
      next: { label: 'Review 2 outfits', detail: null, route: 'outfits' },
      issues: [{ label: '2 outfits need attention', route: 'outfits' }],
    } as unknown as Readiness

    expect(nextThingFor(ready)).toBeNull()
  })

  it('names an outstanding thing the button does not lead to', () => {
    const ready = {
      next: { label: 'Keep packing', detail: null, route: 'checklist' },
      issues: [{ label: '1 outfit needs attention', route: 'outfits' }],
    } as unknown as Readiness

    expect(nextThingFor(ready)).toEqual({ label: '1 outfit needs attention', route: 'outfits' })
  })

  it('says nothing when nothing is outstanding', () => {
    const ready = { next: null, issues: [] } as unknown as Readiness
    expect(nextThingFor(ready)).toBeNull()
    expect(nextThingFor(null)).toBeNull()
  })

  /**
   * The mutation: the hero carrying `readiness.progress`.
   *
   * "0 of 43 packed" is on the trip card, which is where a packing count belongs.
   * §19 and §21 both forbid it appearing twice, and this is the assertion that
   * makes a reinstated copy fail rather than merely look wrong.
   */
  it('never carries the packing progress that is on the card', () => {
    const ready = readyOn('2026-08-14')
    const hero = homeHero(input({ readiness: ready }))
    const printed = JSON.stringify(hero)

    expect(printed).not.toContain('packed')
    expect(printed).not.toContain('of 43')
    // And it never restates the countdown either, which is the card's headline.
    expect(printed).not.toContain(ready.headline)
  })
})

describe('what a replan caught', () => {
  /**
   * The mutation: an insight built from anything other than `reviewReason`.
   *
   * `review_reason` is written by a replan that compared an APPROVED outfit
   * against the trip as it now stands and found a specific garment no longer
   * passes, and it is cleared the moment that stops being true. Anything else —
   * a count of changes, a "we updated your plan" — is the app announcing work
   * rather than reporting a consequence.
   */
  it('says nothing when no replan flagged anything', () => {
    expect(heroInsight([])).toBeNull()
    expect(heroInsight([{ name: 'Beach', status: 'approved', reviewReason: null }])).toBeNull()
    expect(heroInsight([{ name: 'Beach', status: 'draft', reviewReason: null }])).toBeNull()
  })

  it('ignores an unapproved outfit, which is already counted as outstanding', () => {
    expect(
      heroInsight([{ name: 'Beach', status: 'draft', reviewReason: 'The fleece is not warm enough.' }]),
    ).toBeNull()
  })

  it('reports the flagged approved outfit, naming it and the reason', () => {
    expect(
      heroInsight([
        { name: 'Nice dinners', status: 'approved', reviewReason: 'The fleece is not warm enough for the new forecast.' },
      ]),
    ).toBe('Nice dinners · The fleece is not warm enough for the new forecast.')
  })
})

describe('tomorrow', () => {
  it('says nothing before the evening', () => {
    expect(
      heroTomorrow({ hour: TOMORROW_FROM_HOUR - 1, activity: 'Hiking', weather: WEATHER }),
    ).toBeNull()
  })

  it('says nothing about a day with nothing in it', () => {
    expect(heroTomorrow({ hour: 20, activity: null, weather: WEATHER })).toBeNull()
  })

  it('names the activity and the forecast once the evening has come', () => {
    expect(heroTomorrow({ hour: 20, activity: 'Hiking', weather: WEATHER })).toBe(
      'Tomorrow · Hiking · 58–64°F',
    )
  })

  it('speaks up for rain even with nothing planned', () => {
    expect(
      heroTomorrow({ hour: 20, activity: null, weather: { ...WEATHER, rainLikely: true } }),
    ).toBe('Tomorrow · 58–64°F · rain likely')
  })

  it('is absent on the last day of the trip, because there is no tomorrow on it', () => {
    const hero = homeHero(
      input({ readiness: readyOn('2026-09-08'), today: onTrip({ tomorrow: null }), hour: 21 }),
    )

    expect(hero.tomorrow).toBeNull()
  })

  it('reads tomorrow’s activity from the itinerary', () => {
    const hero = homeHero(
      input({
        readiness: readyOn('2026-09-05'),
        today: onTrip({ tomorrow: { date: '2026-09-06', weather: WEATHER } }),
        hour: 19,
      }),
    )

    expect(hero.tomorrow).toBe('Tomorrow · Hiking · 58–64°F')
  })
})

describe('the height guard', () => {
  /**
   * The hero has to leave room for the trip card.
   *
   * §46 asks for the card to remain visible, or nearly visible, in the first
   * viewport at 390px — so the things at the bottom of §45's ordering are
   * dropped rather than the day, the weather and the outfits, which are what the
   * hero is for.
   */
  it('drops the tail rather than the day when everything is true at once', () => {
    const hero = homeHero(
      input({
        readiness: {
          stage: 'underway',
          next: { label: "Today's outfit", detail: null, route: 'today' },
          issues: [{ label: '1 outfit needs attention', route: 'outfits' }],
        } as unknown as Readiness,
        today: onTrip({
          conflicts: [{ headline: 'Colder today than this outfit was planned for' }],
          plans: [
            plan('Beach', ['T-Shirt', 'Shorts', 'Sandals']),
            plan('Nice dinners', ['Button-Up', 'Pants', 'Loafers']),
          ],
          tomorrow: { date: '2026-09-06', weather: WEATHER },
        }),
        outfitGroups: [
          { name: 'Beach', status: 'approved', reviewReason: 'The fleece is not warm enough.' },
        ],
        hour: 21,
      }),
    )

    expect(heroLines(hero)).toBeLessThanOrEqual(HERO_LINE_BUDGET)
    // Everything above the line survived.
    expect(hero.place).toBe('Traverse City')
    expect(hero.weather).toBeTruthy()
    expect(hero.consequence).toBeTruthy()
    expect(hero.outfits).toHaveLength(2)
    /*
     * And the whole tail went, in §45's order. A day this full has no room for
     * a note about tomorrow, and the trip card is what the room is for.
     */
    expect(hero.tomorrow).toBeNull()
    expect(hero.insight).toBeNull()
    expect(hero.nextThing).toBeNull()
  })

  it('keeps the quiet lines on a day that has room for them', () => {
    const hero = homeHero(
      input({
        readiness: {
          stage: 'underway',
          next: { label: "Today's outfit", detail: null, route: 'today' },
          issues: [{ label: '1 outfit needs attention', route: 'outfits' }],
        } as unknown as Readiness,
        today: onTrip({ plans: [] }),
      }),
    )

    expect(hero.nextThing).not.toBeNull()
  })
})
