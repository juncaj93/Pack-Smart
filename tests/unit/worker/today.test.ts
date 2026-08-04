import { describe, expect, it } from 'vitest'
import type { DayPlan } from '@shared/during-trip'
import {
  CARRY_VISIBLE,
  carryGroups,
  carryItemCount,
  dateInZone,
  dateNeedsCaveat,
  describeTodayWeather,
  isTravelDay,
  placeForDate,
  recoveryActions,
  resolveTodayDate,
  todayIssue,
  weatherForDay,
  type CarryCandidate,
  type CarryGroup,
  type UnresolvedSlot,
} from '@shared/today'
import type { WeatherDay } from '@shared/weather'

/**
 * The Today briefing (E1).
 *
 * The defect these are written against is specific and was on the screen: four
 * identical `No suitable packed X found.` sentences, stacked, with nothing to do
 * about any of them. So the assertions below are about the two properties that
 * defect violated — **one explanation however many slots are affected**, and
 * **every unresolved slot leads somewhere** — rather than about copy.
 *
 * Everything else here is the other half of `.visual/390/today.png`: a date that
 * is the destination's day rather than UTC's, a place, a weather line that
 * cannot pass a climate normal off as a forecast, and a carry list where every
 * entry can say why it is being said today.
 */

const NO_PLAN: DayPlan = {
  date: '2026-08-04',
  groupName: null,
  wear: [],
  bring: [],
  missing: [],
}

function slot(overrides: Partial<UnresolvedSlot> = {}): UnresolvedSlot {
  return {
    role: 'top',
    roleLabel: 'Top',
    plannedName: 'Linen shirt',
    entryId: 'entry-1',
    excluded: false,
    alternatives: [],
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */

describe('what day it is, and where', () => {
  it('reads the day in the destination time zone, not in UTC', () => {
    // 01:30 UTC on the 5th is still the 4th in New York and already the 5th in
    // Cape Town. A screen that answers "what am I wearing today" has to pick.
    const at = new Date('2026-08-05T01:30:00Z')

    expect(dateInZone(at, 'America/New_York')).toBe('2026-08-04')
    expect(dateInZone(at, 'Africa/Johannesburg')).toBe('2026-08-05')
  })

  it('refuses a time zone it does not recognise rather than guessing one', () => {
    expect(dateInZone(new Date('2026-08-05T01:30:00Z'), 'Middle/Earth')).toBeNull()
  })

  it('prefers the destination, then the phone, then UTC', () => {
    const at = new Date('2026-08-05T01:30:00Z')

    expect(resolveTodayDate({ at, timezone: 'America/New_York', deviceDate: '2026-08-04' })).toEqual(
      { date: '2026-08-04', basis: 'destination', timezone: 'America/New_York' },
    )

    expect(resolveTodayDate({ at, timezone: null, deviceDate: '2026-08-04' })).toEqual({
      date: '2026-08-04',
      basis: 'device',
      timezone: null,
    })

    expect(resolveTodayDate({ at, timezone: null, deviceDate: null })).toEqual({
      date: '2026-08-05',
      basis: 'utc',
      timezone: null,
    })
  })

  it('falls through to the phone when the recorded zone is unusable', () => {
    const at = new Date('2026-08-05T01:30:00Z')
    expect(resolveTodayDate({ at, timezone: 'Not/AZone', deviceDate: '2026-08-04' })).toEqual({
      date: '2026-08-04',
      basis: 'device',
      timezone: null,
    })
  })

  it('labels the fallback where it can be wrong, and stays quiet where it cannot', () => {
    // A domestic trip read off the phone is the right day by any measure.
    expect(dateNeedsCaveat('device', { international: false })).toBe(false)
    // Crossing a border with no recorded zone is exactly when a phone still on
    // home time puts Alex on the wrong day.
    expect(dateNeedsCaveat('device', { international: true })).toBe(true)
    // UTC is nobody's day.
    expect(dateNeedsCaveat('utc', { international: false })).toBe(true)
    // And a zone that was actually read needs no caveat at all.
    expect(dateNeedsCaveat('destination', { international: true })).toBe(false)
  })

  it('inherits the refusal to guess which city a multi-stop day is in', () => {
    const stops = [
      { id: 'a', name: 'Cape Town', country: 'South Africa', arriveDate: null, departDate: null },
      { id: 'b', name: 'Reykjavik', country: 'Iceland', arriveDate: null, departDate: null },
    ]
    expect(placeForDate(stops, '2026-08-04')).toBeNull()
    expect(placeForDate([stops[0]!], '2026-08-04')).toEqual({
      name: 'Cape Town',
      country: 'South Africa',
    })
  })

  it('knows which days are travel days', () => {
    const trip = { startDate: '2026-08-01', endDate: '2026-08-10' }
    const stops = [
      { id: 'a', name: 'Cape Town', country: null, arriveDate: '2026-08-01', departDate: '2026-08-05' },
      { id: 'b', name: 'Kruger', country: null, arriveDate: '2026-08-05', departDate: '2026-08-10' },
    ]

    expect(isTravelDay('2026-08-01', trip, stops)).toBe(true)
    expect(isTravelDay('2026-08-05', trip, stops)).toBe(true)
    expect(isTravelDay('2026-08-10', trip, stops)).toBe(true)
    expect(isTravelDay('2026-08-03', trip, stops)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */

describe('the weather line', () => {
  const forecast: WeatherDay = {
    destinationId: 'stop-a',
    date: '2026-08-04',
    tempMinC: 12,
    tempMaxC: 24,
    precipitationProbability: 10,
    windKph: 8,
    source: 'forecast',
  }

  it('reads only the day and the place asked for', () => {
    const days: WeatherDay[] = [
      forecast,
      { ...forecast, destinationId: 'stop-b', tempMinC: -4, tempMaxC: 1 },
      { ...forecast, date: '2026-08-05', tempMinC: 30, tempMaxC: 34 },
    ]

    const today = weatherForDay(days, '2026-08-04', 'stop-a')
    expect(today).toMatchObject({ lowF: 54, highF: 75, source: 'forecast' })
  })

  it('returns nothing for a day with no recorded weather', () => {
    expect(weatherForDay([forecast], '2026-08-09', 'stop-a')).toBeNull()
    expect(describeTodayWeather(null)).toBeNull()
  })

  it('never lets a climate normal read as a forecast', () => {
    const live = describeTodayWeather(weatherForDay([forecast], '2026-08-04', null))
    const normal = describeTodayWeather(
      weatherForDay([{ ...forecast, source: 'climate_normal' }], '2026-08-04', null),
    )

    expect(live).toEqual({ text: '54–75°F', seasonal: false })
    expect(normal!.seasonal).toBe(true)
    expect(normal!.text).toMatch(/^Usually /)
  })

  it('says rain is likely only above the packing threshold', () => {
    const wet = weatherForDay([{ ...forecast, precipitationProbability: 80 }], '2026-08-04', null)
    const dry = weatherForDay([{ ...forecast, precipitationProbability: 20 }], '2026-08-04', null)

    expect(describeTodayWeather(wet)!.text).toContain('rain likely')
    expect(describeTodayWeather(dry)!.text).not.toContain('rain')
  })
})

/* ------------------------------------------------------------------ */

describe('what is unresolved', () => {
  it('says nothing is packed rather than listing four things it cannot suggest', () => {
    const issue = todayIssue({ plan: NO_PLAN, slots: [], anythingPacked: false })
    expect(issue.kind).toBe('nothing_packed')
    expect(issue.slots).toEqual([])
  })

  it('says no outfit is approved rather than inventing one', () => {
    const issue = todayIssue({ plan: NO_PLAN, slots: [], anythingPacked: true })
    expect(issue.kind).toBe('no_outfit')
  })

  it('is silent when the day resolves', () => {
    const plan: DayPlan = {
      ...NO_PLAN,
      groupName: 'Safari days',
      wear: [{ itemId: 'i1', name: 'Linen shirt', role: 'top', roleLabel: 'Top', reason: null }],
    }
    expect(todayIssue({ plan, slots: [], anythingPacked: true }).kind).toBe('none')
  })

  /**
   * The defect, stated as a property.
   *
   * Four unfilled slots used to produce four sentences. One explanation is not a
   * copy preference — it is the difference between a screen that tells Alex what
   * is wrong and a screen that apologises once per slot and then stops.
   */
  it('explains once, however many slots are affected', () => {
    const plan: DayPlan = { ...NO_PLAN, groupName: 'Travel days' }
    const four = todayIssue({
      plan,
      slots: [
        slot({ role: 'top', roleLabel: 'Top', plannedName: 'Linen shirt' }),
        slot({ role: 'bottom', roleLabel: 'Bottoms', plannedName: 'Chinos' }),
        slot({ role: 'footwear', roleLabel: 'Shoes', plannedName: 'Boots' }),
        slot({ role: 'mid', roleLabel: 'Layer', plannedName: 'Fleece' }),
      ],
      anythingPacked: true,
    })

    expect(four.kind).toBe('not_packed')
    expect(four.headline).toBe('Not in your bag: 4 things from today’s outfit')
    expect(four.slots).toHaveLength(4)
    // One explanation, not one per slot.
    expect(four.detail.split('.').filter(Boolean).length).toBeLessThanOrEqual(2)
  })

  it('names the garment when only one is missing', () => {
    const issue = todayIssue({
      plan: { ...NO_PLAN, groupName: 'Travel days' },
      slots: [slot({ plannedName: 'Linen shirt' })],
      anythingPacked: true,
    })
    expect(issue.headline).toBe('Not in your bag: Linen shirt')
  })

  it('says so honestly when the slot never named a garment', () => {
    const issue = todayIssue({
      plan: { ...NO_PLAN, groupName: 'Travel days' },
      slots: [slot({ plannedName: null, entryId: null })],
      anythingPacked: true,
    })
    expect(issue.headline).toBe('Nothing you packed fits today’s top')
  })

  it('promises the approved outfit is untouched, in every unresolved case', () => {
    const issue = todayIssue({
      plan: { ...NO_PLAN, groupName: 'Travel days' },
      slots: [slot()],
      anythingPacked: true,
    })
    expect(issue.detail).toContain('has not changed')
  })
})

/* ------------------------------------------------------------------ */

describe('the way out of an unresolved slot', () => {
  it('always offers one — a slot with nothing else is never a dead end', () => {
    const bare = recoveryActions(
      slot({ plannedName: null, entryId: null, alternatives: [] }),
    )
    expect(bare.length).toBeGreaterThan(0)
    expect(bare).toContain('review_outfit')
    expect(bare).toContain('open_list')
  })

  it('offers marking it packed when the garment is on the list and simply unticked', () => {
    expect(recoveryActions(slot())).toContain('mark_packed')
  })

  it('offers putting it back rather than marking it packed when Alex excluded it', () => {
    const actions = recoveryActions(slot({ excluded: true }))
    expect(actions).toContain('put_back')
    expect(actions).not.toContain('mark_packed')
  })

  it('offers a packed alternative only when there is one', () => {
    expect(recoveryActions(slot({ alternatives: [] }))).not.toContain('wear_instead')
    expect(
      recoveryActions(slot({ alternatives: [{ itemId: 'i2', name: 'Chambray shirt' }] })),
    ).toContain('wear_instead')
  })
})

/* ------------------------------------------------------------------ */

describe('what to carry', () => {
  function candidate(overrides: Partial<CarryCandidate> = {}): CarryCandidate {
    return {
      itemId: 'i1',
      name: 'Passport',
      category: 'Documents',
      kind: 'gear',
      keepsRainOff: false,
      tripTriggered: false,
      ...overrides,
    }
  }

  const labels = (groups: CarryGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))

  it('names documents on the days Alex is moving, and not on the others', () => {
    const packed = [candidate()]

    expect(labels(carryGroups({ packed, travelDay: true, weather: null }))).toEqual(['Passport'])
    expect(carryGroups({ packed, travelDay: false, weather: null })).toEqual([])
  })

  it('names medication every day, because that is what medication is', () => {
    const packed = [candidate({ itemId: 'm1', name: 'Antihistamines', category: 'Medication' })]
    expect(labels(carryGroups({ packed, travelDay: false, weather: null }))).toEqual([
      'Antihistamines',
    ])
  })

  /**
   * The failure the first version of this section shipped with.
   *
   * Four medications each carried their own copy of `Keep it with you rather
   * than in a bag.` The reason belongs to the group; four identical lines is
   * wallpaper, which is UX-04 and which the packing list already learned.
   */
  it('gives each group ONE reason, however many things are in it', () => {
    const packed = ['Bite Guard', 'Gas-X', 'Ibuprofen', 'Synthroid'].map((name, i) =>
      candidate({ itemId: `m${i}`, name, category: 'Medication' }),
    )

    const groups = carryGroups({ packed, travelDay: false, weather: null })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items).toHaveLength(4)
    expect(typeof groups[0]!.why).toBe('string')
    expect(groups[0]!.why.length).toBeGreaterThan(0)
  })

  /**
   * `is_critical` is deliberately not a carry reason.
   *
   * Every essential Alex has flagged is on the trip every day of it, so folding
   * them in turned this into the packing list again — twenty rows behind a
   * `Show more`, none of which said anything a Tuesday did not also say.
   */
  it('does not repeat the essentials list, which does not change by the day', () => {
    const packed = [
      candidate({ itemId: 'e1', name: 'Sunglasses', category: 'Vision' }),
      candidate({ itemId: 'e2', name: 'Charger', category: 'Electronics' }),
    ]
    expect(carryGroups({ packed, travelDay: true, weather: null })).toEqual([])
  })

  it('names rain protection only when rain is likely, and only what is recorded as such', () => {
    const packed = [
      candidate({ itemId: 'j1', name: 'Gore-Tex shell', category: 'Tops & Outerwear', kind: 'clothing', keepsRainOff: true }),
      candidate({ itemId: 'j2', name: 'Quilted jacket', category: 'Tops & Outerwear', kind: 'clothing' }),
    ]

    const dry = carryGroups({
      packed,
      travelDay: false,
      weather: { source: 'forecast', lowF: 60, highF: 70, rainLikely: false, precipitationProbability: 10 },
    })
    expect(dry).toEqual([])

    const wet = carryGroups({
      packed,
      travelDay: false,
      weather: { source: 'forecast', lowF: 60, highF: 70, rainLikely: true, precipitationProbability: 80 },
    })
    expect(labels(wet)).toEqual(['Gore-Tex shell'])
  })

  it('says so when rain is likely and nothing packed is recorded as keeping it off', () => {
    const wet = carryGroups({
      packed: [candidate({ itemId: 'j2', name: 'Quilted jacket', category: 'Tops & Outerwear', kind: 'clothing' })],
      travelDay: false,
      weather: { source: 'forecast', lowF: 60, highF: 70, rainLikely: true, precipitationProbability: 80 },
    })

    expect(wet).toHaveLength(1)
    expect(wet[0]!.kind).toBe('rain')
    expect(wet[0]!.items).toEqual([])
    expect(wet[0]!.why).toContain('Nothing you packed')
  })

  it('names the gear this trip triggered, and never says the same thing twice', () => {
    const groups = carryGroups({
      packed: [
        candidate({ itemId: 'p1', name: 'Passport', tripTriggered: true }),
        candidate({ itemId: 'b1', name: 'Binoculars', category: 'Travel Gear', tripTriggered: true }),
        candidate({ itemId: 't1', name: 'Toothpaste', category: 'Toiletries' }),
      ],
      travelDay: true,
      weather: null,
    })

    // The passport is claimed by Documents and does not reappear under gear.
    expect(labels(groups)).toEqual(['Passport', 'Binoculars'])
    for (const group of groups) expect(group.why.length).toBeGreaterThan(0)
  })

  it('counts across the groups, so the section is a fixed size on the screen', () => {
    const groups = carryGroups({
      packed: [
        candidate({ itemId: 'p1', name: 'Passport' }),
        candidate({ itemId: 'm1', name: 'Ibuprofen', category: 'Medication' }),
      ],
      travelDay: true,
      weather: null,
    })

    expect(carryItemCount(groups)).toBe(2)
    expect(CARRY_VISIBLE).toBeGreaterThan(0)
  })
})
