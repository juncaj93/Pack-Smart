import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { describeTodayWeather, recoveryActions, type CarryGroup } from '@shared/today'
import {
  excludeEntry,
  generateChecklist,
  listChecklist,
  setPackedQty,
} from '../../worker/repos/checklist'
import { ensureDailyPlans, getDayPlan } from '../../worker/repos/during-trip'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { buildBriefing } from '../../worker/services/today'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The Today briefing, against real SQL.
 *
 * `today.test.ts` proves the model; this proves the wiring — that the checklist
 * row behind a missing garment is actually found, that a Not bringing row is
 * told apart from an unticked one, and that the whole briefing comes back from
 * data the request already had to read.
 *
 * The rule from doc 04 §10 is asserted here too, at the level it can actually be
 * broken: nothing the briefing offers may be a garment that is not packed.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-08-01',
  endDate: '2026-08-08',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
const AT = new Date('2026-08-03T09:00:00Z')
let db: TestDatabase

function garment(id: string, name: string, subcategory: string) {
  const category =
    subcategory === 'Shoes'
      ? 'Footwear'
      : subcategory === 'Pants'
        ? 'Bottoms & Swimwear'
        : 'Tops & Outerwear'
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, favorite, usage_frequency,
                         dressiness, typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'clothing',?,?,?,0,'sometimes',1,'["casual"]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, name, category, subcategory)
  return id
}

function gear(
  id: string,
  name: string,
  category: string,
  options: { critical?: boolean; weatherTags?: string[] } = {},
) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency, is_critical,
                         requires_final_check, default_packing_timing, always_include,
                         never_include, weather_tags, source, created_at, updated_at)
       VALUES (?,'gear',?,?,0,'sometimes',?,0,'anytime',1,0,?,'seed_import',1,1)`,
    )
    .run(id, name, category, options.critical ? 1 : 0, JSON.stringify(options.weatherTags ?? []))

  // A row only reaches the checklist through a rule, the same as every real one.
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, created_at)
       VALUES (?,?,'fixed_per_trip',1,NULL,1,0,1)`,
    )
    .run(crypto.randomUUID(), id)

  return id
}

beforeEach(() => {
  db = createTestDatabase()
  for (let i = 1; i <= 14; i += 1) garment(`tee${i}`, `Tee ${i}`, 'T-Shirt')
  for (let i = 1; i <= 5; i += 1) garment(`pants${i}`, `Pants ${i}`, 'Pants')
  garment('shoes', 'Walking Shoes', 'Shoes')
  gear('passport', 'Passport', 'Documents')
  gear('pills', 'Antihistamines', 'Medication')
  gear('toothpaste', 'Toothpaste', 'Toiletries')
})

afterEach(() => {
  db.close()
})

async function packedTrip(options: { packEverything?: boolean } = {}) {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  await generateOutfits(db.binding, trip, NOW)

  for (const group of await listOutfits(db.binding, trip.id)) {
    if (group.status !== 'incomplete') await setGroupStatus(db.binding, group.id, 'approved', NOW)
  }
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  if (options.packEverything !== false) {
    for (const entry of await listChecklist(db.binding, trip.id)) {
      await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
    }
  }

  await ensureDailyPlans(db.binding, trip, NOW)
  return (await getTrip(db.binding, trip.id))!
}

/** Every name the carry section puts on the screen, across its groups. */
const named = (groups: CarryGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))

/** Writes one day of stored weather, the way `replaceWeather` would have. */
function forecastFor(
  tripId: string,
  date: string,
  options: { rain?: number; source?: 'forecast' | 'climate_normal' } = {},
) {
  db.raw
    .prepare(
      `INSERT INTO trip_weather (id, trip_id, destination_id, weather_date, temp_min_c,
                                 temp_max_c, precipitation, wind_kph, source, fetched_at)
       VALUES (?,?,NULL,?,12,24,?,8,?,?)`,
    )
    .run(crypto.randomUUID(), tripId, date, options.rain ?? 10, options.source ?? 'forecast', NOW)
}

async function briefingFor(trip: Awaited<ReturnType<typeof packedTrip>>, date: string) {
  const [plan, entries] = await Promise.all([
    getDayPlan(db.binding, trip, date),
    listChecklist(db.binding, trip.id),
  ])
  return {
    plan,
    entries,
    briefing: await buildBriefing(db.binding, {
      trip,
      date,
      plan,
      entries,
      deviceDate: '2026-08-03',
      at: AT,
    }),
  }
}

/* ------------------------------------------------------------------ */

describe('the day, the place and the activity', () => {
  it('names the city on a single-destination trip', async () => {
    const trip = await packedTrip()
    const { briefing } = await briefingFor(trip, '2026-08-03')
    expect(briefing.place).toEqual({ name: 'Cape Town', country: 'South Africa' })
  })

  it('reads the day in the trip’s own time zone when it has one', async () => {
    const trip = await packedTrip()
    db.raw.prepare('UPDATE trip SET timezone = ? WHERE id = ?').run('Africa/Johannesburg', trip.id)
    const withZone = (await getTrip(db.binding, trip.id))!

    const [plan, entries] = await Promise.all([
      getDayPlan(db.binding, withZone, '2026-08-03'),
      listChecklist(db.binding, withZone.id),
    ])
    const briefing = await buildBriefing(db.binding, {
      trip: withZone,
      date: '2026-08-03',
      plan,
      entries,
      deviceDate: '2026-08-03',
      // 22:30 in New York on the 3rd is already the 4th in Johannesburg.
      at: new Date('2026-08-04T02:30:00Z'),
    })

    expect(briefing.dateBasis).toBe('destination')
    expect(briefing.todayDate).toBe('2026-08-04')
    expect(briefing.dateCaveat).toBe(false)
  })

  it('falls back to the phone and says so when no time zone is recorded', async () => {
    const trip = await packedTrip()
    const { briefing } = await briefingFor(trip, '2026-08-03')

    expect(trip.timezone).toBeNull()
    expect(briefing.dateBasis).toBe('device')
    expect(briefing.todayDate).toBe('2026-08-03')
    // International, so a phone still on home time could genuinely be a day out.
    expect(briefing.dateCaveat).toBe(true)
  })

  it('names the day’s activity once Alex has stated one', async () => {
    const trip = await packedTrip()
    db.raw
      .prepare(
        `INSERT INTO trip_event (id, trip_id, event_date, title, activity_tag, sort_order)
         VALUES (?,?,?,?,?,0)`,
      )
      .run(crypto.randomUUID(), trip.id, '2026-08-03', 'Safari', 'safari')

    const stated = (await getTrip(db.binding, trip.id))!
    const [plan, entries] = await Promise.all([
      getDayPlan(db.binding, stated, '2026-08-03'),
      listChecklist(db.binding, stated.id),
    ])
    const briefing = await buildBriefing(db.binding, {
      trip: stated,
      date: '2026-08-03',
      plan,
      entries,
      deviceDate: '2026-08-03',
      at: AT,
    })

    expect(briefing.activity).toEqual({ tag: 'safari', label: 'Safari' })
  })
})

/* ------------------------------------------------------------------ */

describe('what is unresolved, and the way out of it', () => {
  it('is silent on a day whose outfit is entirely in the bag', async () => {
    const trip = await packedTrip()
    const { plan, briefing } = await briefingFor(trip, '2026-08-03')

    expect(plan.wear.length).toBeGreaterThan(0)
    expect(briefing.issue.kind).toBe('none')
    expect(briefing.issue.slots).toEqual([])
  })

  it('says nothing is packed rather than naming four things it cannot suggest', async () => {
    const trip = await packedTrip({ packEverything: false })
    const { briefing } = await briefingFor(trip, '2026-08-03')

    expect(briefing.issue.kind).toBe('nothing_packed')
    expect(briefing.issue.slots).toEqual([])
  })

  it('names one unpacked garment, and hands back the row that fixes it', async () => {
    const trip = await packedTrip()
    const before = await getDayPlan(db.binding, trip, '2026-08-03')
    const worn = before.wear.find((w) => w.role === 'footwear')!

    const entries = await listChecklist(db.binding, trip.id)
    const row = entries.find((e) => e.itemId === worn.itemId)!
    await setPackedQty(db.binding, row.id, 0, NOW)

    const { briefing } = await briefingFor(trip, '2026-08-03')
    expect(briefing.issue.kind).toBe('not_packed')
    expect(briefing.issue.slots).toHaveLength(1)

    const [slot] = briefing.issue.slots
    expect(slot!.plannedName).toBe(worn.name)
    expect(slot!.entryId).toBe(row.id)
    expect(slot!.excluded).toBe(false)
    expect(recoveryActions(slot!)).toContain('mark_packed')
  })

  /**
   * The defect this slice exists to remove.
   *
   * Four unfilled slots used to render four sentences of apology and nothing to
   * tap. One explanation, four rows, and a way out of every one of them.
   */
  it('explains several unpacked garments once, and leaves none of them a dead end', async () => {
    const trip = await packedTrip()
    const before = await getDayPlan(db.binding, trip, '2026-08-03')
    const entries = await listChecklist(db.binding, trip.id)

    // Unpack every garment the day's outfit uses, plus everything that could
    // stand in for one — the shape of the original capture.
    for (const entry of entries) {
      if (entry.itemId === null) continue
      if (entry.category === 'Toiletries') continue
      if (entry.itemId.startsWith('tee') || entry.itemId.startsWith('pants') || entry.itemId === 'shoes') {
        await setPackedQty(db.binding, entry.id, 0, NOW)
      }
    }

    const { briefing } = await briefingFor(trip, '2026-08-03')

    expect(before.wear.length).toBeGreaterThan(1)
    expect(briefing.issue.kind).toBe('not_packed')
    expect(briefing.issue.slots.length).toBeGreaterThan(1)
    // ONE headline, however many slots.
    expect(typeof briefing.issue.headline).toBe('string')
    expect(briefing.issue.headline).toMatch(/Not in your bag|unresolved/)
    // And not one of them is a sentence with nothing to do about it.
    for (const slot of briefing.issue.slots) {
      expect(recoveryActions(slot).length).toBeGreaterThan(0)
    }
  })

  it('offers a packed alternative when one exists, and never an unpacked one', async () => {
    const trip = await packedTrip()
    const before = await getDayPlan(db.binding, trip, '2026-08-03')
    const worn = before.wear.find((w) => w.role === 'top')!

    const entries = await listChecklist(db.binding, trip.id)
    await setPackedQty(db.binding, entries.find((e) => e.itemId === worn.itemId)!.id, 0, NOW)

    const { briefing } = await briefingFor(trip, '2026-08-03')
    const slot = briefing.issue.slots.find((s) => s.role === 'top')!

    expect(slot.alternatives.length).toBeGreaterThan(0)
    expect(recoveryActions(slot)).toContain('wear_instead')

    const packedIds = new Set(
      (await listChecklist(db.binding, trip.id))
        .filter((e) => e.excludedAt === null && e.packedQty > 0)
        .map((e) => e.itemId),
    )
    for (const option of slot.alternatives) expect(packedIds.has(option.itemId)).toBe(true)
  })

  it('is honest when no packed alternative exists, and still leads somewhere', async () => {
    const trip = await packedTrip()
    const entries = await listChecklist(db.binding, trip.id)

    // Every top out of the bag: the planned one and everything that could replace it.
    for (const entry of entries) {
      if (entry.itemId?.startsWith('tee')) await setPackedQty(db.binding, entry.id, 0, NOW)
    }

    const { briefing } = await briefingFor(trip, '2026-08-03')
    const slot = briefing.issue.slots.find((s) => s.role === 'top')!

    expect(slot.alternatives).toEqual([])
    expect(recoveryActions(slot)).toContain('mark_packed')
    expect(recoveryActions(slot)).toContain('review_outfit')
  })

  it('tells a Not bringing row apart from one Alex simply has not ticked', async () => {
    const trip = await packedTrip()
    const before = await getDayPlan(db.binding, trip, '2026-08-03')
    const worn = before.wear.find((w) => w.role === 'footwear')!

    const entries = await listChecklist(db.binding, trip.id)
    await excludeEntry(db.binding, entries.find((e) => e.itemId === worn.itemId)!.id, NOW)

    const { briefing } = await briefingFor(trip, '2026-08-03')
    const slot = briefing.issue.slots.find((s) => s.role === 'footwear')!

    expect(slot.excluded).toBe(true)
    // Offering "mark it packed" for something he deliberately left behind would
    // be the app arguing with him.
    expect(recoveryActions(slot)).toContain('put_back')
    expect(recoveryActions(slot)).not.toContain('mark_packed')
  })

  it('leaves the approved outfit exactly as it was when a garment goes missing', async () => {
    const trip = await packedTrip()
    const groupsBefore = await listOutfits(db.binding, trip.id)
    const snapshot = groupsBefore.map((g) => ({
      id: g.id,
      status: g.status,
      slots: g.slots.map((s) => s.itemId),
    }))

    const before = await getDayPlan(db.binding, trip, '2026-08-03')
    const entries = await listChecklist(db.binding, trip.id)
    await setPackedQty(
      db.binding,
      entries.find((e) => e.itemId === before.wear[0]!.itemId)!.id,
      0,
      NOW,
    )

    await briefingFor(trip, '2026-08-03')

    const after = (await listOutfits(db.binding, trip.id)).map((g) => ({
      id: g.id,
      status: g.status,
      slots: g.slots.map((s) => s.itemId),
    }))
    expect(after).toEqual(snapshot)
  })
})

/* ------------------------------------------------------------------ */

describe('what to carry', () => {
  it('names documents on a travel day and leaves them alone on the others', async () => {
    const trip = await packedTrip()

    const travel = named((await briefingFor(trip, '2026-08-01')).briefing.carry)
    const middle = named((await briefingFor(trip, '2026-08-03')).briefing.carry)

    expect(travel).toContain('Passport')
    expect(middle).not.toContain('Passport')
  })

  it('names medication every day', async () => {
    const trip = await packedTrip()
    const middle = named((await briefingFor(trip, '2026-08-03')).briefing.carry)
    expect(middle).toContain('Antihistamines')
  })

  it('never names something that is not in the bag', async () => {
    const trip = await packedTrip()
    const entries = await listChecklist(db.binding, trip.id)
    await setPackedQty(db.binding, entries.find((e) => e.itemId === 'passport')!.id, 0, NOW)

    const travel = named((await briefingFor(trip, '2026-08-01')).briefing.carry)
    expect(travel).not.toContain('Passport')
  })

  it('gives every group a reason, and says it once', async () => {
    const trip = await packedTrip()
    const { briefing } = await briefingFor(trip, '2026-08-01')

    expect(briefing.carry.length).toBeGreaterThan(0)
    for (const group of briefing.carry) expect(group.why.length).toBeGreaterThan(0)
  })

  it('says nothing about rain when there is no forecast to say it from', async () => {
    const trip = await packedTrip()
    const { briefing } = await briefingFor(trip, '2026-08-03')

    expect(briefing.weather).toBeNull()
    expect(briefing.carry.some((g) => g.kind === 'rain')).toBe(false)
  })

  it('names the packed garment Alex recorded as waterproof when rain is likely', async () => {
    gear('shell', 'Hiking Shell', 'Travel Gear', { weatherTags: ['waterproof'] })
    const trip = await packedTrip()
    forecastFor(trip.id, '2026-08-03', { rain: 80 })

    const { briefing } = await briefingFor(trip, '2026-08-03')
    const rain = briefing.carry.filter((g) => g.kind === 'rain')

    expect(briefing.weather?.rainLikely).toBe(true)
    expect(rain.flatMap((g) => g.items.map((i) => i.label))).toEqual(['Hiking Shell'])
  })

  /**
   * The other half of the rain reminder, and the more useful one.
   *
   * `weather-fit.ts` will not call a jacket waterproof because it is a jacket.
   * So a wet morning with nothing recorded as keeping rain off is a real state,
   * and saying nothing about it would be Pack Smart knowing something worth
   * knowing and keeping quiet.
   */
  it('says so when rain is likely and nothing packed is recorded as keeping it off', async () => {
    const trip = await packedTrip()
    forecastFor(trip.id, '2026-08-03', { rain: 80 })

    const { briefing } = await briefingFor(trip, '2026-08-03')
    const rain = briefing.carry.filter((g) => g.kind === 'rain')

    expect(rain).toHaveLength(1)
    expect(rain[0]!.items).toEqual([])
    expect(rain[0]!.why).toContain('Nothing you packed')
  })

  it('never presents a climate normal as a forecast', async () => {
    const trip = await packedTrip()
    forecastFor(trip.id, '2026-08-03', { source: 'climate_normal' })

    const { briefing } = await briefingFor(trip, '2026-08-03')
    expect(briefing.weather?.source).toBe('climate_normal')
    expect(describeTodayWeather(briefing.weather)!.seasonal).toBe(true)
    expect(describeTodayWeather(briefing.weather)!.text).toMatch(/^Usually /)
  })
})
