import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { daysFromTemplate, toTemplate, tripStatusOn, type TripInput } from '@shared/trips'
import { NO_TRIP_CONTEXT, bagFor } from '@shared/bags'
import { generateOutfits } from '../../worker/repos/outfits'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { replaceWeather } from '../../worker/repos/weather'
import { setPackedQty, generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Reusing a finished trip.
 *
 * The load-bearing tests are the ones about what is NOT carried across.
 * A trip is two different things at once — a plan, and a record of what
 * happened — and copying the second produces a new trip that claims to be half
 * packed before Alex has touched it.
 */

const NOW = 1_780_000_000

const LAST_YEAR: TripInput = {
  name: 'South Africa',
  emoji: '🦁',
  startDate: '2025-08-01',
  endDate: '2025-08-08',
  destinations: [
    { name: 'Cape Town', country: 'South Africa', arriveDate: '2025-08-01', departDate: '2025-08-04' },
    { name: 'Kruger', country: 'South Africa', arriveDate: '2025-08-05', departDate: '2025-08-08' },
  ],
  activities: ['safari', 'winery'],
  international: true,
  laundryAvailable: false,
  maxDressiness: 2,
  flightHours: 14,
  notes: 'the good one',
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('what a trip carries into the next one', () => {
  it('brings across everything that describes the trip', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const template = toTemplate(trip)

    expect(template).toMatchObject({
      name: 'South Africa',
      emoji: '🦁',
      activities: ['safari', 'winery'],
      international: true,
      laundryAvailable: false,
      maxDressiness: 2,
      flightHours: 14,
      notes: 'the good one',
    })
    expect(template.destinations.map((d) => d.name)).toEqual(['Cape Town', 'Kruger'])
  })

  /*
   * Dates become offsets. A safari on the third day should be the third day of
   * the new trip, whatever its dates — copying 2025-08-03 verbatim would land
   * outside the new trip, where setTripDays drops it without comment.
   */
  it('turns the day plan into offsets and places it on the new dates', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2025-08-03', activityTag: 'safari' },
      { date: '2025-08-06', activityTag: 'winery' },
    ], NOW))!

    const template = toTemplate(withDays)
    expect(template.dayOffsets).toEqual([
      { offset: 2, activityTag: 'safari' },
      { offset: 5, activityTag: 'winery' },
    ])

    // Placed on a trip a year later, starting on a different weekday.
    expect(daysFromTemplate(template, '2026-09-10', '2026-09-17')).toEqual([
      { date: '2026-09-12', activityTag: 'safari' },
      { date: '2026-09-15', activityTag: 'winery' },
    ])
  })

  it('drops an offset that does not fit a shorter trip', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2025-08-07', activityTag: 'safari' },
    ], NOW))!

    // A three-day trip has no seventh day, so that plan simply does not apply.
    expect(daysFromTemplate(toTemplate(withDays), '2026-09-10', '2026-09-12')).toEqual([])
  })

  /*
   * Stop dates are re-derived rather than copied. Last year's arrive/depart are
   * as wrong as last year's trip dates.
   */
  it('does not carry last year’s stop dates', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const template = toTemplate(trip)

    expect(template.destinations.every((d) => d.arriveDate === null)).toBe(true)
    expect(template.destinations.every((d) => d.departDate === null)).toBe(true)
  })
})

describe('what it refuses to carry', () => {
  /*
   * The point. A completed trip is a record of what happened; a new trip is a
   * plan. Carrying the record across would show Alex a trip already half
   * packed, with a forecast for a week that is over.
   */
  it('brings no packed state, no outfits, and no old forecast', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)

    // Make the old trip look thoroughly lived-in.
    await generateChecklist(db.binding, trip, NOW)
    const entries = await listChecklist(db.binding, trip.id)
    if (entries[0]) await setPackedQty(db.binding, entries[0].id, 1, NOW)
    await generateOutfits(db.binding, trip, NOW)
    await replaceWeather(
      db.binding,
      trip.id,
      [{ date: '2025-08-02', tempMinC: 8, tempMaxC: 16, precipitationProbability: 90, windKph: 10, source: 'forecast' }],
      NOW,
    )

    const template = toTemplate((await getTrip(db.binding, trip.id))!)
    const carried = JSON.stringify(template)

    for (const leak of ['packedQty', 'checklist', 'outfit', 'wear', 'tempMin', 'precipitation']) {
      expect(carried, `template leaked ${leak}`).not.toContain(leak)
    }
  })

  /*
   * The dates are the one thing that is certainly wrong, and the template must
   * not carry them in ANY form.
   *
   * Asserted on the object rather than on the sheet, because the sheet is only
   * the first consumer: a `startDate` smuggled onto the template would be
   * invisible until something downstream started reading it, and by then it
   * would be a trip saved in the past. The existing leak test looks for packed
   * state; this looks for time.
   */
  it('carries no dates at all, its own or its stops', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2025-08-03', activityTag: 'safari' },
    ], NOW))!

    const template = toTemplate(withDays)
    for (const key of ['startDate', 'endDate', 'date']) {
      expect(Object.keys(template), `template carries ${key}`).not.toContain(key)
    }

    // The stops keep their names and lose their dates, which are as wrong as
    // the trip's own — and `null` rather than absent, because the field exists.
    for (const stop of template.destinations) {
      expect(stop.arriveDate).toBeNull()
      expect(stop.departDate).toBeNull()
    }

    // The day plan survives as an OFFSET, which is the whole point: structure
    // without time. Nothing in it is a date.
    expect(template.dayOffsets).toEqual([{ offset: 2, activityTag: 'safari' }])
    expect(JSON.stringify(template)).not.toContain('2025-')
  })

  /*
   * Reading a template must not create anything, the same guarantee the
   * itinerary parser gives. Alex can tap "Plan again", change his mind, and
   * leave nothing behind.
   */
  it('creates nothing by being read', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const before = db.raw.prepare('SELECT COUNT(*) AS n FROM trip').get() as { n: number }

    toTemplate((await getTrip(db.binding, trip.id))!)

    const after = db.raw.prepare('SELECT COUNT(*) AS n FROM trip').get() as { n: number }
    expect(after.n).toBe(before.n)
  })
})

describe('a trip’s status is what the dates say', () => {
  it('calls a finished trip finished, whatever was last written', () => {
    const past = { startDate: '2025-08-01', endDate: '2025-08-08', status: 'planning' as const }
    expect(tripStatusOn(past, '2026-07-29')).toBe('completed')
  })

  it('calls a trip under way active', () => {
    const now = { startDate: '2026-07-28', endDate: '2026-08-04', status: 'planning' as const }
    expect(tripStatusOn(now, '2026-07-29')).toBe('active')
  })

  it('leaves a future trip alone', () => {
    const soon = { startDate: '2026-09-01', endDate: '2026-09-08', status: 'packing' as const }
    expect(tripStatusOn(soon, '2026-07-29')).toBe('packing')
  })

  it('reads through from the database', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    // LAST_YEAR ended in 2025 and the stored status is 'planning'.
    expect((await getTrip(db.binding, trip.id))?.status).toBe('completed')
  })
})

/**
 * What a reused trip is generated FROM (P4e).
 *
 * The tests above prove that the template carries structure and refuses to
 * carry output. These prove the other half, which is easy to assume and was
 * never asserted: the new trip is planned against the world as it is TODAY, not
 * as it was when the old trip happened.
 *
 * The claims are the handoff's own list — current wardrobe, current rules,
 * current learned preferences, new dates — and each one is a thing that would
 * silently regress if reuse ever started cloning rows instead of regenerating.
 */
describe('what the reused trip is planned against', () => {
  /** A gear item with a rule, so it reaches a list at all. */
  function gear(id: string, quantity = 1) {
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES (?,'gear',?,'Travel Gear',0,'sometimes','[]',0,0,'anytime',0,0,'seed_import',1,1)`,
      )
      .run(id, id)
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                   enabled, needs_review, original_text, created_at)
         VALUES (?,?,'fixed_per_trip',?,NULL,1,0,'test',1)`,
      )
      .run(`rule-${id}`, id, quantity)
  }

  /** Plans the template onto new dates, exactly as `POST /api/trips` would. */
  async function reuse(template: ReturnType<typeof toTemplate>, start: string, end: string) {
    const made = await createTrip(
      db.binding,
      {
        name: template.name,
        emoji: template.emoji,
        startDate: start,
        endDate: end,
        destinations: template.destinations,
        activities: template.activities,
        international: template.international,
        laundryAvailable: template.laundryAvailable,
        maxDressiness: template.maxDressiness,
        luggageMode: template.luggageMode,
        bags: template.bags,
        flightHours: template.flightHours,
        notes: template.notes,
      },
      NOW,
    )
    await generateChecklist(db.binding, made, NOW)
    return { trip: made, entries: await listChecklist(db.binding, made.id) }
  }

  it('leaves behind a garment that has since been archived', async () => {
    gear('Head Torch')
    const old = await createTrip(db.binding, LAST_YEAR, NOW)
    await generateChecklist(db.binding, old, NOW)
    expect((await listChecklist(db.binding, old.id)).map((e) => e.name)).toContain('Head Torch')

    // Out of the wardrobe between the two trips.
    db.raw.prepare('UPDATE item SET archived_at = ? WHERE id = ?').run(NOW, 'Head Torch')

    const { entries } = await reuse(toTemplate(old), '2026-09-10', '2026-09-17')
    expect(entries.map((e) => e.name)).not.toContain('Head Torch')
  })

  it('picks up a rule written since the old trip', async () => {
    const old = await createTrip(db.binding, LAST_YEAR, NOW)
    await generateChecklist(db.binding, old, NOW)
    expect((await listChecklist(db.binding, old.id)).map((e) => e.name)).not.toContain('Sunscreen')

    gear('Sunscreen')

    const { entries } = await reuse(toTemplate(old), '2026-09-10', '2026-09-17')
    expect(entries.map((e) => e.name)).toContain('Sunscreen')
  })

  /*
   * The one that would have regressed silently the moment P4c shipped: a
   * preference learned AFTER the old trip has to reach the new one, and it does
   * only because the plan is generated rather than copied.
   */
  it('applies a preference learned since the old trip', async () => {
    gear('Sunglasses')
    const old = await createTrip(db.binding, LAST_YEAR, NOW)
    await generateChecklist(db.binding, old, NOW)

    db.raw.prepare("UPDATE item SET default_bag = 'personal_item' WHERE id = 'Sunglasses'").run()

    const { entries } = await reuse(toTemplate(old), '2026-09-10', '2026-09-17')
    const row = entries.find((e) => e.name === 'Sunglasses')!
    expect(row.learnedBag).toBe('personal_item')
    expect(bagFor(row, NO_TRIP_CONTEXT, row.traits).bag).toBe('personal_item')
  })

  /*
   * A quantity that scales with the trip has to be recomputed from the NEW
   * dates. Carrying last year's number across is the "stale quantities" the
   * handoff names, and it is invisible unless the two trips differ in length.
   */
  it('counts against the new dates rather than the old ones', async () => {
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('Socks','clothing','Socks','Accessories & Undergarments',0,'frequent','[]',0,0,
                 'anytime',0,0,'seed_import',1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                   enabled, needs_review, original_text, created_at)
         VALUES ('rule-socks','Socks','per_night',1,NULL,1,0,'test',1)`,
      )
      .run()

    // LAST_YEAR is 2025-08-01 → 2025-08-08: seven nights.
    const old = await createTrip(db.binding, LAST_YEAR, NOW)
    await generateChecklist(db.binding, old, NOW)
    const before = (await listChecklist(db.binding, old.id)).find((e) => e.name === 'Socks')!
    expect(before.requiredQty).toBe(7)

    // Three nights this time.
    const { entries } = await reuse(toTemplate(old), '2026-09-10', '2026-09-13')
    expect(entries.find((e) => e.name === 'Socks')!.requiredQty).toBe(3)
  })

  /* Nothing of the old trip's own record comes with it. */
  it('starts with nothing packed', async () => {
    gear('Head Torch')
    const old = await createTrip(db.binding, LAST_YEAR, NOW)
    await generateChecklist(db.binding, old, NOW)
    for (const entry of await listChecklist(db.binding, old.id)) {
      await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
    }

    const { entries } = await reuse(toTemplate(old), '2026-09-10', '2026-09-17')
    expect(entries.every((entry) => entry.packedQty === 0)).toBe(true)
  })
})
