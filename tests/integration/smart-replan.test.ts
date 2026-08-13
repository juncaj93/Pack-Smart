import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { tripDateRange, type Trip, type TripInput } from '@shared/trips'
import { planChanges, planSignals } from '@shared/replan'
import { generateChecklist } from '../../worker/repos/checklist'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  type OutfitGroupView,
} from '../../worker/repos/outfits'
import { createTrip, storedPlanSignals } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import { getWeather } from '../../worker/services/weather'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * `Plan again`, as a response to what changed rather than a regenerate button.
 *
 * ## The four cases, and why they are asserted against real SQL
 *
 * The rules are about what a replan is allowed to TOUCH, and every one of them
 * is a statement about rows:
 *
 *   A. an approved outfit that is still legal — untouched, silent
 *   B. an approved outfit that is merely out-ranked now — untouched, silent
 *   C. an approved outfit that has become ineligible — flagged, NOT rewritten
 *   D. a draft — replanned from current truth
 *
 * C is the one worth the whole file. "Do not silently overwrite Alex's
 * decision" is easy to assert in a unit test of a pure function and easy to
 * break in the repository, because the replan's delete statement is what
 * decides it. So the garments are compared before and after, out of the
 * database.
 *
 * Measured against the real workbook, like `rain-approval.test.ts`, because
 * these behaviours depend on what Alex actually owns — a synthetic wardrobe
 * with a jacket for every temperature never reaches case C at all.
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'

const TRIP: TripInput = {
  name: 'Traverse City',
  startDate: '2026-09-10',
  endDate: '2026-09-14',
  destinations: [{ name: 'Traverse City', country: 'United States' }],
  activities: ['nice_dinner', 'casual_day'],
  international: false,
  laundryAvailable: false,
}

const NOW = 1_780_000_000

/** Mild: 11–19°C, which is the band the first plan is made against. */
const MILD = { min: 11, max: 19 }
/** Cold: 5–9°C. A different warmth band, so a real change. */
const COLD = { min: 5, max: 9 }
/** Two degrees off mild — a visible number, the same band, no change. */
const MILD_ISH = { min: 12, max: 18 }

const DRY = 5
const RAINY = 80

let db: TestDatabase

async function importWorkbook(): Promise<void> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((s) => /clothing/i.test(s.name))?.rows
  const gear = sheets.find((s) => /non-?clothing|rules|gear/i.test(s.name))?.rows
  expect(clothing && gear).toBeTruthy()

  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'seed.xlsx', clothing, gear }),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
}

/** Replaces the stored forecast, as a refresh would. */
function storeForecast(tripId: string, temps: { min: number; max: number }, rain = DRY) {
  const destination = db.raw
    .prepare('SELECT id FROM trip_destination WHERE trip_id = ?')
    .get(tripId) as { id: string }

  db.raw.prepare('DELETE FROM trip_weather WHERE trip_id = ?').run(tripId)

  for (const date of tripDateRange(TRIP.startDate, TRIP.endDate)) {
    db.raw
      .prepare(
        `INSERT INTO trip_weather (id, trip_id, destination_id, weather_date, temp_min_c,
                                   temp_max_c, precipitation, wind_kph, source, fetched_at)
         VALUES (?,?,?,?,?,?,?,12,'forecast',?)`,
      )
      .run(crypto.randomUUID(), tripId, destination.id, date, temps.min, temps.max, rain, NOW)
  }
}

async function replan(trip: Trip) {
  const { days } = await getWeather(db.binding, trip.id, NOW)
  return generateOutfits(db.binding, trip, NOW, days)
}

/**
 * A trip with a plan, one outfit approved, made against mild dry weather.
 *
 * `pick` chooses WHICH outfit is approved. Most tests do not care and take the
 * first one carrying garments; the warmth test needs one with an outer slot,
 * because a template without a jacket cannot fail a warmth filter and a test
 * that quietly returned early on that case would be green for the wrong reason.
 */
async function planned(pick?: (group: OutfitGroupView) => boolean) {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  storeForecast(trip.id, MILD)
  await replan(trip)

  const groups = await listOutfits(db.binding, trip.id)
  const target = pick
    ? groups.find(pick)
    : (groups.find((g) => g.slots.some((s) => s.itemId)) ?? groups[0])
  expect(target, 'no outfit in this plan matched what the test needs').toBeTruthy()
  await setGroupStatus(db.binding, target!.id, 'approved', NOW)

  return { trip, approvedId: target!.id }
}

/** The garments in one group, as ids, straight out of the database. */
function garmentsOf(groupId: string): Array<string | null> {
  return (
    db.raw
      .prepare('SELECT item_id FROM outfit_slot WHERE outfit_group_id = ? ORDER BY sort_order')
      .all(groupId) as Array<{ item_id: string | null }>
  ).map((row) => row.item_id)
}

beforeEach(async () => {
  db = createTestDatabase()
  await importWorkbook()
})

afterEach(() => db.close())

describe('what a plan remembers about the trip it was made for', () => {
  it('records the planner’s inputs, so the next run can compare', async () => {
    const { trip } = await planned()

    const stored = await storedPlanSignals(db.binding, trip.id)
    expect(stored).not.toBeNull()
    expect(stored!.activities).toEqual(['casual_day', 'nice_dinner'])
    expect(stored!.warmth).not.toBeNull()
  })

  it('finds nothing changed when nothing changed', async () => {
    const { trip } = await planned()
    const { days } = await getWeather(db.binding, trip.id, NOW)

    expect(planChanges(await storedPlanSignals(db.binding, trip.id), planSignals(trip, days)))
      .toEqual([])
  })

  it('finds nothing changed when the forecast moved but the band did not', async () => {
    const { trip } = await planned()
    storeForecast(trip.id, MILD_ISH)

    const { days } = await getWeather(db.binding, trip.id, NOW)
    expect(planChanges(await storedPlanSignals(db.binding, trip.id), planSignals(trip, days)))
      .toEqual([])
  })

  it('finds the change when the forecast crosses a band', async () => {
    const { trip } = await planned()
    storeForecast(trip.id, COLD)

    const { days } = await getWeather(db.binding, trip.id, NOW)
    const changes = planChanges(
      await storedPlanSignals(db.binding, trip.id),
      planSignals(trip, days),
    )
    expect(changes.map((c) => c.kind)).toContain('weather_colder')
  })
})

describe('replanning against a materially changed trip', () => {
  /*
   * Case C, and the reason this file is an integration test.
   *
   * The garments are read out of `outfit_slot` before and after, because "his
   * approval is safe" is a fact about what the DELETE statement covers — not
   * something a comment can promise.
   */
  it('never rewrites an approved outfit, however much the weather moved', async () => {
    const { trip, approvedId } = await planned()
    const before = garmentsOf(approvedId)

    storeForecast(trip.id, COLD, RAINY)
    await replan(trip)

    expect(garmentsOf(approvedId)).toEqual(before)
    const after = await listOutfits(db.binding, trip.id)
    expect(after.find((g) => g.id === approvedId)?.status).toBe('approved')
  })

  /*
   * Case A/B. An unchanged trip must leave no trace at all — no flag, no
   * churn — because a control that reports work on every press is the noise
   * this whole slice removes.
   */
  it('leaves an unchanged trip completely alone', async () => {
    const { trip, approvedId } = await planned()
    const before = garmentsOf(approvedId)

    const result = await replan(trip)

    expect(garmentsOf(approvedId)).toEqual(before)
    expect(result.flagged).toEqual([])
    expect(
      (await listOutfits(db.binding, trip.id)).every((g) => g.reviewReason === null),
    ).toBe(true)
  })

  it('is idempotent: replanning twice over the same inputs changes nothing', async () => {
    const { trip } = await planned()

    await replan(trip)
    const first = (await listOutfits(db.binding, trip.id)).map((g) =>
      g.slots.map((s) => s.itemId).join(','),
    )
    await replan(trip)
    const second = (await listOutfits(db.binding, trip.id)).map((g) =>
      g.slots.map((s) => s.itemId).join(','),
    )

    expect(second).toEqual(first)
  })

  /*
   * Case C's other half: the flag has to actually appear, or "we will tell
   * you" is a promise nothing keeps. Whether any given wardrobe reaches it
   * depends on what Alex owns, so this asserts the mechanism rather than
   * demanding the real closet produce a conflict: a garment is forced into an
   * approved slot that the cold cannot admit, and the replan must notice.
   */
  it('flags an approved outfit whose garment the new forecast has ruled out', async () => {
    /*
     * A layer or a jacket — `passesFilters` gates warmth on both roles and on
     * no others, so either will do and neither can be assumed present: which
     * templates carry an outer slot depends on the activity and the forecast.
     */
    const warmthGated = (role: string) => role === 'outer' || role === 'mid'
    const { trip, approvedId } = await planned((g) => g.slots.some((s) => warmthGated(s.role)))

    // The lightest jacket in the wardrobe, put into the approved outfit's
    // outer slot by hand — which is exactly what a user swap does.
    const slot = (
      db.raw
        .prepare('SELECT id, slot_role FROM outfit_slot WHERE outfit_group_id = ?')
        .all(approvedId) as Array<{ id: string; slot_role: string }>
    ).find((row) => warmthGated(row.slot_role))!

    // The lightest garment of that kind in the wardrobe, put into the approved
    // outfit's slot by hand — which is exactly what a user swap does.
    const subcategory = slot.slot_role === 'outer' ? 'Outerwear' : 'Mid-Layer'
    const summer = db.raw
      .prepare(
        `SELECT id FROM item
          WHERE subcategory = ? AND warmth IS NOT NULL AND archived_at IS NULL
          ORDER BY warmth ASC LIMIT 1`,
      )
      .get(subcategory) as { id: string } | undefined
    expect(summer, `the workbook has no ${subcategory} to test with`).toBeTruthy()

    const outer: { id: string } | undefined = slot

    /*
     * Asserted, not skipped.
     *
     * A `return` here would make this test pass on a plan with no outer slot
     * at all — which is the shape of green that hides a broken feature. If the
     * approved outfit stops having a jacket the fixture is wrong and this
     * should say so.
     */
    expect(outer, 'the approved outfit has no outer slot to test with').toBeTruthy()

    db.raw
      .prepare("UPDATE outfit_slot SET item_id = ?, filled_by = 'user_swap' WHERE id = ?")
      .run(summer!.id, outer!.id)

    storeForecast(trip.id, { min: -8, max: -2 })
    const result = await replan(trip)

    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.id === approvedId)!
    expect(group.slots.find((s) => s.id === slot.id)?.itemId).toBe(summer!.id)
    expect(group.reviewReason).not.toBeNull()
    expect(result.flagged.map((f) => f.id)).toContain(approvedId)
  })

  /*
   * A flag that only ever went ON would outlive the weather that produced it:
   * the forecast recovers, and the outfit is still asking to be looked at.
   */
  it('clears the flag when the conditions come back', async () => {
    const { trip, approvedId } = await planned()

    db.raw
      .prepare('UPDATE outfit_group SET review_reason = ? WHERE id = ?')
      .run('something from an earlier forecast', approvedId)

    await replan(trip)

    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.id === approvedId)!
    expect(group.reviewReason).toBeNull()
  })
})
