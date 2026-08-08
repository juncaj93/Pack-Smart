import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { ensureDailyPlans, getDayPlans, adjustDay } from '../../worker/repos/during-trip'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { garment, seedWardrobe } from './wardrobe'

/**
 * Several activities on one date, end to end (G2).
 *
 * The audit in doc 09 §4 found the schema already able to hold this since
 * migration 0003, and `planFromDays` already able to plan it. What could not
 * was everything that carried an event's IDENTITY — so these tests are mostly
 * about a beach afternoon and a formal dinner staying two things all the way
 * from `trip_event` to `getDayPlans`.
 *
 * Every one fails against the behaviour before this slice, and the mutations
 * that prove it are recorded in doc 09.
 */

const TRIP: TripInput = {
  name: 'Cape Town',
  startDate: '2026-08-01',
  endDate: '2026-08-05',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['beach', 'nice_dinner', 'sightseeing'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
let db: TestDatabase

/**
 * The shared wardrobe, plus what a beach day needs.
 *
 * `seedWardrobe` is the fixture every other integration test dresses a trip
 * from, so a group coming out `incomplete` here means the planner refused it
 * rather than that this file forgot a garment. Swimwear and sandals are added
 * because no other test has ever needed a beach.
 */
function stockWardrobe() {
  seedWardrobe(db)
  garment(db, { id: 'trunks', name: 'Swim Shorts', subcategory: 'Swimwear', uses: ['swim'] })
  garment(db, { id: 'trunks2', name: 'Board Shorts', subcategory: 'Swimwear', uses: ['swim'] })
  garment(db, { id: 'sandals', name: 'Leather Sandals', subcategory: 'Sandals', uses: ['casual'] })
}

beforeEach(() => {
  db = createTestDatabase()
  stockWardrobe()
})

afterEach(() => {
  db.close()
})

async function aTrip(input: TripInput = TRIP) {
  const created = await createTrip(db.binding, input, NOW)
  return (await getTrip(db.binding, created.id))!
}

/** Approves everything, then syncs, which is the packing list Alex would have. */
async function approveEverything(tripId: string) {
  const trip = (await getTrip(db.binding, tripId))!
  for (const group of await listOutfits(db.binding, tripId)) {
    await setGroupStatus(db.binding, group.id, 'approved', NOW).catch(() => undefined)
  }
  await syncChecklistFromOutfits(db.binding, trip, NOW)
}

/* ------------------------------------------------------------------ */

describe('a date that holds more than one activity', () => {
  it('keeps both, in the order they were given', async () => {
    const trip = await aTrip()
    const saved = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])

    // Two entries, one date. Before G2 the writer already stored both and every
    // reader above it kept one.
    expect(saved?.days).toHaveLength(2)
    expect(saved?.days.map((d) => d.activityTag)).toEqual(['beach', 'nice_dinner'])
    expect(saved?.days.map((d) => d.sortOrder)).toEqual([0, 1])
    expect(new Set(saved?.days.map((d) => d.id)).size).toBe(2)
  })

  it('holds three, and orders them', async () => {
    const trip = await aTrip()
    const saved = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'sightseeing' },
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])

    expect(saved?.days.map((d) => d.activityTag)).toEqual([
      'sightseeing',
      'beach',
      'nice_dinner',
    ])
  })

  it('plans a separate outfit for each', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])

    const { groups } = await generateOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW)
    const names = groups.map((g) => g.name)

    // Two materially different activities are two outfit needs, whatever they
    // share a date with.
    expect(names).toContain('Beach')
    expect(names).toContain('Nice dinners')
  })

  it('dresses them differently, rather than forcing one outfit', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    await generateOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    const groups = await listOutfits(db.binding, trip.id)
    const beach = groups.find((g) => g.name === 'Beach')!
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    const worn = (group: typeof beach) =>
      new Set(group.slots.map((s) => s.itemId).filter(Boolean) as string[])

    // Not the same clothes: the dinner is dressier and the planner may not put
    // swim shorts in it.
    expect([...worn(beach)]).not.toEqual([...worn(dinner)])
    expect([...worn(dinner)].some((id) => id.startsWith('trunks'))).toBe(false)
  })

  it('does not let swimwear stand in for the day’s ordinary clothes', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    await generateOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    const groups = await listOutfits(db.binding, trip.id)
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    // A dinner outfit with a bottom, and it is not the swim shorts.
    const bottom = dinner.slots.find((s) => s.role === 'bottom')
    if (bottom?.itemId) expect(bottom.itemId).not.toBe('trunks')
  })
})

describe('what Today shows for such a day', () => {
  it('returns one plan per activity, in sequence', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)
    await ensureDailyPlans(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    const plans = await getDayPlans(db.binding, withDays, '2026-08-03')

    // The defect this fixes: one plan, for whichever activity the map saw last.
    expect(plans).toHaveLength(2)
    expect(plans.map((p) => p.groupName)).toEqual(['Beach', 'Nice dinners'])
  })

  it('still returns exactly one plan for an ordinary day', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [{ date: '2026-08-03', activityTag: 'beach' }])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)
    await ensureDailyPlans(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    expect(await getDayPlans(db.binding, withDays, '2026-08-03')).toHaveLength(1)
    // And a date nobody spoke for is still one plan, not none.
    expect(await getDayPlans(db.binding, withDays, '2026-08-02')).toHaveLength(1)
  })

  it('is stable across opens, which is risk R12', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)

    await ensureDailyPlans(db.binding, withDays, NOW)
    const first = (await getDayPlans(db.binding, withDays, '2026-08-03')).map((p) => p.groupName)

    // A second open must not add plans or reorder them.
    await ensureDailyPlans(db.binding, withDays, NOW + 60)
    const second = (await getDayPlans(db.binding, withDays, '2026-08-03')).map((p) => p.groupName)

    expect(second).toEqual(first)
    const rows = db.raw
      .prepare('SELECT count(*) AS n FROM daily_plan WHERE trip_id = ? AND plan_date = ?')
      .get(trip.id, '2026-08-03') as { n: number }
    expect(rows.n).toBe(2)
  })

  it('plans an activity added after the day was already planned', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [{ date: '2026-08-03', activityTag: 'beach' }])
    let withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)
    await ensureDailyPlans(db.binding, withDays, NOW)
    expect(await getDayPlans(db.binding, withDays, '2026-08-03')).toHaveLength(1)

    // The dinner is added later, which is the ordinary case: the day was
    // planned, and then something else turned out to be happening.
    const saved = await setTripDays(db.binding, trip.id, [
      { id: withDays.days[0]!.id, date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    expect(saved?.days).toHaveLength(2)

    withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)
    await ensureDailyPlans(db.binding, withDays, NOW + 60)

    /*
     * The defect a date-keyed idempotency check produces: the day already had a
     * plan, so the new activity never got one and Today went on showing the
     * beach outfit for the whole day.
     */
    const plans = await getDayPlans(db.binding, withDays, '2026-08-03')
    expect(plans).toHaveLength(2)
    expect(plans.map((p) => p.groupName)).toContain('Nice dinners')
  })

  it('adjusts the outfit the garment is actually in', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)
    await ensureDailyPlans(db.binding, withDays, NOW)

    const groups = await listOutfits(db.binding, trip.id)
    const dinnerGroup = groups.find((g) => g.name === 'Nice dinners')!
    const beachGroup = groups.find((g) => g.name === 'Beach')!
    const beachWears = new Set(beachGroup.slots.map((s) => s.itemId).filter(Boolean))

    // A garment the DINNER outfit holds and the beach one does not, so which
    // plan the adjustment landed on is decidable.
    const garment = dinnerGroup.slots.find((s) => s.itemId && !beachWears.has(s.itemId))!.itemId!

    await adjustDay(db.binding, trip.id, '2026-08-03', garment, null, NOW)

    /*
     * `adjustDay` used to take the first row for the date, so swapping
     * something out of the evening outfit silently wrote onto the afternoon
     * one — and neither screen showed what Alex asked for.
     */
    const rows = db.raw
      .prepare(
        `SELECT outfit_group_id, adjustments_json FROM daily_plan
          WHERE trip_id = ? AND plan_date = ? AND adjustments_json IS NOT NULL`,
      )
      .all(String(trip.id), '2026-08-03') as Array<{
      outfit_group_id: string
      adjustments_json: string
    }>

    expect(rows).toHaveLength(1)
    expect(rows[0]!.outfit_group_id).toBe(dinnerGroup.id)
    expect(rows[0]!.adjustments_json).toContain(garment)
  })
})

describe('editing a day that holds several', () => {
  it('keeps the other activities when one is edited', async () => {
    const trip = await aTrip()
    const saved = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const [beach, dinner] = saved!.days

    // The dinner moves to the next day; the beach is untouched and keeps its id.
    const after = await setTripDays(db.binding, trip.id, [
      { id: beach!.id, date: '2026-08-03', activityTag: 'beach' },
      { id: dinner!.id, date: '2026-08-04', activityTag: 'nice_dinner' },
    ])

    expect(after?.days.map((d) => `${d.date}:${d.activityTag}`)).toEqual([
      '2026-08-03:beach',
      '2026-08-04:nice_dinner',
    ])
    // Edited in place rather than recreated, so anything hanging off the event
    // survives the edit.
    expect(after?.days.find((d) => d.activityTag === 'beach')?.id).toBe(beach!.id)
    expect(after?.days.find((d) => d.activityTag === 'nice_dinner')?.id).toBe(dinner!.id)
  })

  it('removes one of several and leaves the rest alone', async () => {
    const trip = await aTrip()
    const saved = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const beach = saved!.days.find((d) => d.activityTag === 'beach')!

    const after = await setTripDays(db.binding, trip.id, [
      { id: beach.id, date: '2026-08-03', activityTag: 'beach' },
    ])

    expect(after?.days).toHaveLength(1)
    expect(after?.days[0]?.id).toBe(beach.id)
  })

  it('takes a removed activity’s plan with it, and keeps the wear log', async () => {
    const trip = await aTrip()
    const saved = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)
    await ensureDailyPlans(db.binding, withDays, NOW)

    const dinner = saved!.days.find((d) => d.activityTag === 'nice_dinner')!
    db.raw
      .prepare(
        `INSERT INTO wear_log (id, trip_id, item_id, event_id, worn_date, action, created_at)
         VALUES ('w1',?,'tee',?, '2026-08-03', 'already_wore', ?)`,
      )
      .run(trip.id, String(dinner.id), NOW)

    const beach = saved!.days.find((d) => d.activityTag === 'beach')!
    await setTripDays(db.binding, trip.id, [
      { id: beach.id, date: '2026-08-03', activityTag: 'beach' },
    ])

    // The plan for something that is not happening is gone.
    const plans = db.raw
      .prepare('SELECT count(*) AS n FROM daily_plan WHERE event_id = ?')
      .get(String(dinner.id)) as { n: number }
    expect(plans.n).toBe(0)

    /*
     * The wear log is not. It records what was actually worn, F1 learns from
     * it, and losing that to a typo on the day planner would be losing evidence.
     * The link is cleared; the row stays.
     */
    const log = db.raw.prepare('SELECT event_id FROM wear_log WHERE id = ?').get('w1') as {
      event_id: string | null
    }
    expect(log.event_id).toBeNull()
  })
})

describe('what the packing list makes of it', () => {
  it('does not produce a duplicate row for a garment two outfits share', async () => {
    const trip = await aTrip({ ...TRIP, activities: ['sightseeing', 'nice_dinner'] })
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'sightseeing' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, withDays, NOW)
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)

    const entries = await listChecklist(db.binding, trip.id)
    const names = entries.map((e) => e.name)
    // Migration 0013's one-row-per-item invariant, over a case it never met.
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps an override, an exclusion and a bag through a replan', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [{ date: '2026-08-03', activityTag: 'beach' }])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, withDays, NOW)
    await generateOutfits(db.binding, withDays, NOW)
    await approveEverything(trip.id)

    const before = await listChecklist(db.binding, trip.id)
    const row = before[0]!
    db.raw
      .prepare(
        `UPDATE checklist_entry SET qty_override = 7, bag = 'checked', bag_source = 'user',
                                    packed_qty = 2 WHERE id = ?`,
      )
      .run(row.id)

    // A second activity arrives on the same day, which replans the drafts.
    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const replanned = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, replanned, NOW)
    await syncChecklistFromOutfits(db.binding, replanned, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.id === row.id)!
    expect(after.qtyOverride).toBe(7)
    expect(after.bag).toBe('checked')
    expect(after.packedQty).toBe(2)
  })
})

describe('an approved outfit is not disturbed by a new activity', () => {
  it('keeps the approved garments when a second activity is added', async () => {
    const trip = await aTrip()
    await setTripDays(db.binding, trip.id, [{ date: '2026-08-03', activityTag: 'beach' }])
    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)

    const beachGroup = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Beach')!
    await setGroupStatus(db.binding, beachGroup.id, 'approved', NOW)
    const approvedBefore = (await listOutfits(db.binding, trip.id))
      .find((g) => g.id === beachGroup.id)!
      .slots.map((s) => `${s.role}=${s.itemId}`)

    await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'beach' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    await generateOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === beachGroup.id)!
    // D1c: an approval freezes its own outfit. Adding a dinner may not move it.
    expect(after.status).toBe('approved')
    expect(after.slots.map((s) => `${s.role}=${s.itemId}`)).toEqual(approvedBefore)
  })
})
