import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateOutfits, swapCandidates } from '../../worker/repos/outfits'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'
import type { WeatherDay } from '@shared/weather'

/**
 * C2b: the replacement sheet judges by the same facts the planner judged by.
 *
 * It did not. The planner narrowed a jacket by the warmth and rain of that
 * group's **own days**; the sheet had no idea which days a group covered and so
 * applied no weather filter at all. A garment the planner had rejected for
 * being the wrong warmth came back offered as suitable, and a jacket that keeps
 * nothing out could be presented as the replacement for a rain layer.
 *
 * **The audit proposed a `dates_json` column. There is no migration here, and
 * that is the finding.** `assignDays` is a pure function of the trip's dates,
 * the trip's named days, and the groups — all of which the Worker already has.
 * Storing the result would be caching a pure function: it goes stale on every
 * trip edit and every re-plan, and a stale cache of which days an outfit covers
 * is exactly the second source of truth doc 04 §8 exists to prevent. Deriving
 * also guarantees the sheet, the review panel and During Trip cannot disagree,
 * because all three call the same function on the same inputs.
 *
 * The tests below are the nine cases the C2b brief names.
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)
  /*
   * A jacket that keeps rain out, and one that does not.
   *
   * Identical in every recorded respect — same slot, same warmth, same
   * dressiness, and neither name carrying a word `weather-fit.ts` treats as
   * evidence — so that `weather_tags` is the ONLY thing that can separate them.
   *
   * Two earlier versions of this pair were quietly untestable. The first gave
   * the plain jacket less warmth, so the rain assertion passed on a WARMTH
   * rejection and would have gone on passing with the rain filter deleted. The
   * second called them "Rain Shell" and "Summer Shell" — and "shell" is one of
   * the words Alex's own spreadsheet uses to mean waterproof, so the untagged
   * one was correctly read as a rain layer and the test was asserting against
   * documented behaviour.
   */
  garment(db, { id: 'rain-jacket', name: 'Field Jacket', subcategory: 'Outerwear', warmth: 1 })
  garment(db, { id: 'plain-jacket', name: 'Linen Jacket', subcategory: 'Outerwear', warmth: 1 })
  db.raw.prepare("UPDATE item SET weather_tags = '[\"rain\"]' WHERE id = 'rain-jacket'").run()
})

afterEach(() => {
  db.close()
})

/**
 * Stored forecast rows, as `trip_weather` holds them.
 *
 * Deliberately NOT cast. An earlier version ended `as WeatherDay[]`, and under
 * that cast the rows carried a `precipitationChance` field the engine has never
 * read — so "rain likely" was never true and the rain assertions passed on an
 * unrelated warmth rejection.
 */
function forecast(dates: string[], over: Partial<WeatherDay> = {}): WeatherDay[] {
  return dates.map((date) => ({
    date,
    destinationId: null,
    tempMinC: 8,
    tempMaxC: 14,
    precipitationProbability: 0,
    windKph: 5,
    source: 'forecast' as const,
    ...over,
  }))
}

/** Above `RAIN_THRESHOLD`, so `rainOutlook` calls it likely. */
const WET = { precipitationProbability: 80 }

async function planned(days?: Array<{ date: string; activityTag: string | null }>) {
  const trip = await createTrip(db.binding, TRIP, NOW)
  // Days are their own write — `updateTrip` takes a `TripInput`, which does not
  // carry them, so setting them through it would silently do nothing.
  if (days) {
    await setTripDays(db.binding, trip.id, days)
  }
  const stored = (await getTrip(db.binding, trip.id))!
  const { groups } = await generateOutfits(db.binding, stored, NOW)
  return { trip: (await getTrip(db.binding, trip.id))!, groups }
}

type Groups = Awaited<ReturnType<typeof planned>>['groups']

/*
 * Throws rather than returning null.
 *
 * The first draft of these tests wrote `if (!found?.slot) return`, which is a
 * test that passes when the thing it is about does not exist — rename the
 * group, or stop planning an outer layer, and every rain assertion below would
 * go green without running.
 */
function slotIn(groups: Groups, name: string, role: string) {
  const group = groups.find((g) => g.name === name)
  if (!group) throw new Error(`the plan has no "${name}" group; the fixture changed`)
  const slot = group.slots.find((s) => s.role === role)
  if (!slot) throw new Error(`"${name}" has no ${role} slot; the fixture changed`)
  return { group, slot }
}

describe('the replacement sheet knows which days it is filtering for', () => {
  it('applies the rain filter when rain is forecast on the outfit’s own days', async () => {
    const { trip, groups } = await planned()
    const found = slotIn(groups, 'Safari', 'outer')

    const wet = forecast(['2026-07-31', '2026-08-01'], WET)

    const dry = await swapCandidates(db.binding, found.group.id, found.slot.id, trip, [])
    const rainy = await swapCandidates(db.binding, found.group.id, found.slot.id, trip, wet)

    const suitable = (r: typeof rainy) => r.candidates.filter((c) => c.suitable).map((c) => c.item.id)

    // Without a forecast nothing is rejected for rain.
    expect(suitable(dry)).toContain('plain-jacket')
    // With rain on those days, only what is RECORDED as keeping it out survives.
    expect(suitable(rainy)).not.toContain('plain-jacket')
    expect(
      rainy.candidates.find((c) => c.item.id === 'plain-jacket')?.reason,
    ).toMatch(/keeping rain out/i)
  })

  /*
   * Capability is never inferred from the KIND of garment. Both of these are
   * Outerwear, both are called "… Jacket", and they differ only in
   * `weather_tags`; if being a jacket were enough, both would pass together.
   *
   * Alex's own words in a name ARE evidence — `weather-fit.ts` says so, and it
   * is why neither name here contains one.
   */
  it('never infers waterproofing from a garment’s name', async () => {
    const { trip, groups } = await planned()
    const found = slotIn(groups, 'Safari', 'outer')

    const wet = forecast(['2026-07-31'], WET)
    const { candidates } = await swapCandidates(db.binding, found.group.id, found.slot.id, trip, wet)

    const byId = new Map(candidates.map((c) => [c.item.id, c]))
    // Both are called "… Jacket". Only the tagged one is accepted.
    expect(byId.get('rain-jacket')?.suitable).toBe(true)
    expect(byId.get('plain-jacket')?.suitable).toBe(false)
  })

  /*
   * The other half of the filter, and the half the C2 audit actually caught: a
   * jacket the planner had rejected for being the wrong warmth came back
   * offered as a suitable replacement, because the sheet applied no warmth band
   * at all.
   *
   * The same parka, the same slot, the same wardrobe — only the forecast for
   * those days differs.
   */
  it('applies the warmth band of the outfit’s own days', async () => {
    garment(db, { id: 'parka', name: 'Down Parka', subcategory: 'Outerwear', warmth: 3 })

    const { trip, groups } = await planned()
    const found = slotIn(groups, 'Safari', 'outer')
    const ask = async (weather: WeatherDay[]) => {
      const { candidates } = await swapCandidates(db.binding, found.group.id, found.slot.id, trip, weather)
      return candidates.find((c) => c.item.id === 'parka')
    }

    const mild = await ask(forecast(['2026-07-31', '2026-08-01']))
    expect(mild?.suitable).toBe(false)
    expect(mild?.reason).toMatch(/warmth/i)

    const freezing = await ask(
      forecast(['2026-07-31', '2026-08-01'], { tempMinC: -6, tempMaxC: 1 }),
    )
    expect(freezing?.suitable).toBe(true)
  })

  it('says what it filtered by, so a short list is an answer rather than a fault', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { context } = await swapCandidates(
      db.binding,
      dinner.id,
      top.id,
      trip,
      forecast(['2026-07-31']),
    )

    expect(context).not.toBeNull()
    expect(context!.roleLabel).toBe('Top')
    expect(context!.place).toBe('Cape Town')
    expect(context!.activity).toBe('Nice dinners')
    expect(context!.formality).toBe('Smart casual to Formal')
    expect(context!.travelDay).toBe(false)
  })
})

describe('one covered date, and several', () => {
  it('names a single day as a day', async () => {
    const { trip, groups } = await planned([{ date: '2026-08-03', activityTag: 'nice_dinner' }])
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { context } = await swapCandidates(db.binding, dinner.id, top.id, trip, [])
    expect(context!.when).toBe('3 Aug')
  })

  it('names several consecutive days as a range', async () => {
    const { trip, groups } = await planned([
      { date: '2026-08-03', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
      { date: '2026-08-05', activityTag: 'safari' },
    ])
    const safari = groups.find((g) => g.name === 'Safari')!
    const top = safari.slots.find((s) => s.role === 'top')!

    const { context } = await swapCandidates(db.binding, safari.id, top.id, trip, [])
    expect(context!.when).toBe('3–5 Aug')
  })
})

describe('the two groups that carry no activity tag', () => {
  /*
   * The C2 defect, at the replacement layer. `activity_tag` is NULL for both
   * untagged templates, so before `templateFor` resolved them by name a travel
   * outfit and an ordinary day were indistinguishable — and the sheet drew from
   * `EVERYDAY_TEMPLATE`, a looser filter than the one that planned the travel
   * outfit.
   */
  it('knows a travel outfit is one, and says so', async () => {
    const { trip, groups } = await planned()
    const { group: travel, slot: top } = slotIn(groups, 'Travel days', 'top')

    const { context } = await swapCandidates(db.binding, travel.id, top.id, trip, [])
    expect(context!.travelDay).toBe(true)
    // No activity tag, so no activity is claimed — the name is the answer.
    expect(context!.activity).toBeNull()
    expect(context!.formality).toBe('Loungewear to Smart casual')
  })

  it('does not call an ordinary day a travel day', async () => {
    const { trip, groups } = await planned()
    const { group: casual, slot: top } = slotIn(groups, 'Casual days', 'top')

    const { context } = await swapCandidates(db.binding, casual.id, top.id, trip, [])
    expect(context!.travelDay).toBe(false)
    expect(context!.activity).toBeNull()
  })
})

describe('when the weather is not what the sheet would like', () => {
  it('is honest when there is no forecast at all', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { candidates, context } = await swapCandidates(db.binding, dinner.id, top.id, trip, [])

    // Nothing invented — no conditions line at all rather than a guess.
    expect(context!.conditions).toBeNull()
    // And nothing rejected for weather, because nothing is known about it.
    expect(candidates.some((c) => c.suitable)).toBe(true)
  })

  /*
   * Seasonal guidance is LABELLED, never dressed up as a forecast. The
   * distinction is doc 09 §14's, and `weatherForDates` carries it in the copy
   * — "Usually 46–57°F" rather than "46–57°F".
   */
  it('labels climate normals as usual rather than as a forecast', async () => {
    const { trip, groups } = await planned([{ date: '2026-08-03', activityTag: 'nice_dinner' }])
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const normals = forecast(['2026-08-03'], { source: 'climate_normal' })
    const { context } = await swapCandidates(db.binding, dinner.id, top.id, trip, normals)

    expect(context!.conditions).toMatch(/^Usually /)
  })

  it('works on a trip that has no named days at all', async () => {
    // The legacy shape: nothing in `trip_event`, so no group has stated dates.
    const { trip, groups } = await planned()
    expect(trip.days).toHaveLength(0)

    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { candidates, context } = await swapCandidates(db.binding, dinner.id, top.id, trip, [])

    // A count, not an invented calendar.
    expect(context!.when).toMatch(/^(Once|\d+ days)$/)
    expect(candidates.length).toBeGreaterThan(0)
  })

  /*
   * The pre-C2b caller shape. `swapCandidates` is still callable with no trip
   * and no weather — every existing test does — and must not throw or start
   * inventing a filter it has no basis for.
   */
  it('still answers when it is given no trip at all', async () => {
    const { groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { candidates, context } = await swapCandidates(db.binding, dinner.id, top.id)

    expect(candidates.length).toBeGreaterThan(0)
    expect(context!.place).toBeNull()
    expect(context!.conditions).toBeNull()
  })
})

describe('what the replacement flow must not do', () => {
  it('offers nothing that could not fill the slot at all', async () => {
    const { trip, groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!
    const footwear = safari.slots.find((s) => s.role === 'footwear')!

    const { candidates } = await swapCandidates(db.binding, safari.id, footwear.id, trip, [])
    expect(candidates.every((c) => ['shoes', 'dress-shoes'].includes(c.item.id))).toBe(true)
  })

  it('says why, for every garment it sets aside', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { candidates } = await swapCandidates(db.binding, dinner.id, top.id, trip, [])
    for (const rejected of candidates.filter((c) => !c.suitable)) {
      expect(rejected.reason, rejected.item.displayName).toBeTruthy()
    }
  })

  /*
   * Reading the list must not touch the plan. It is the sheet Alex opens most
   * often on this screen, and it is a QUERY.
   */
  it('changes nothing about the outfit it is asked about', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!
    const before = dinner.slots.map((s) => `${s.role}=${s.itemId}`)
    const statuses = groups.map((g) => `${g.name}=${g.status}`)

    await swapCandidates(db.binding, dinner.id, top.id, trip, forecast(['2026-07-31']))

    const { groups: after } = await generateOutfits(db.binding, trip, NOW)
    const dinnerAfter = after.find((g) => g.name === 'Nice dinners')!
    expect(dinnerAfter.slots.map((s) => `${s.role}=${s.itemId}`)).toEqual(before)
    expect(after.map((g) => `${g.name}=${g.status}`)).toEqual(statuses)
  })
})
