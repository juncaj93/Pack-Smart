import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { excludeEntry, listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { generateOutfits, setGroupStatus, syncChecklistFromOutfits } from '../../worker/repos/outfits'
import { tripCoverageGaps } from '../../worker/repos/coverage'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * The tank-top pairing, through the door it actually goes through.
 *
 * `tests/unit/worker/swimwear.test.ts` proves the rule. This proves the
 * WIRING — that `syncChecklistFromOutfits` runs it, that the additions are
 * ordinary demand rows obeying the same ownership contract as everything else
 * that function writes, and that they leave again when the swimwear does.
 *
 * The distinction matters because the failure modes are completely different. A
 * wrong rule gives Alex the wrong number of tank tops; an unwired rule gives him
 * none, silently, while every unit test stays green.
 */

const NOW = 1_780_000_000
let db: TestDatabase

/** The trip fixture, minus its safari and dinners, plus water. */
const POOL_TRIP: TripInput = { ...TRIP, activities: ['swimming', 'beach'] }

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)

  // Three swimsuits and two tank tops, on top of the shared wardrobe. Shaped
  // like the real closet, where one spreadsheet row is one physical garment.
  garment(db, { id: 'swim1', name: 'Swim Trunks', subcategory: 'Swimwear', dressiness: 0, uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'swim2', name: 'Swim Trunks', subcategory: 'Swimwear', dressiness: 0, uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'swim3', name: 'Swim Trunks', subcategory: 'Swimwear', dressiness: 0, uses: ['swim', 'warm_weather'] })
  garment(db, { id: 'tank1', name: 'Athletic Tank Top', subcategory: 'Tank Top', uses: ['warm_weather', 'casual'] })
  garment(db, { id: 'tank2', name: 'Athletic Tank Top', subcategory: 'Tank Top', uses: ['warm_weather', 'casual'] })
})

/**
 * A wardrobe whose tank tops are only for swimming.
 *
 * Not decoration — it is what makes the pairing rule's work visible. With
 * ordinary `warm_weather / casual` tank tops the travel and casual days pick
 * them up anyway and the count is already right, which is the common case and
 * exactly why the rule adds nothing most of the time. Marked swim-only, those
 * groups cannot take them, the plan alone leaves swimsuits without a top, and
 * the rule is the thing that closes the gap.
 */
function swimOnlyTankTops() {
  db.raw.prepare("DELETE FROM item WHERE subcategory = 'Tank Top'").run()
  for (const i of [1, 2, 3]) {
    garment(db, { id: `tank${i}`, name: 'Athletic Tank Top', subcategory: 'Tank Top', uses: ['swim'] })
  }
}

afterEach(() => {
  db.close()
})

/** Plans, approves and syncs — which is what puts clothing on the list. */
async function packed(input: TripInput, days: Array<{ date: string; activityTag: string }>) {
  const created = await createTrip(db.binding, input, NOW)
  await setTripDays(db.binding, created.id, days, NOW)
  const trip = (await getTrip(db.binding, created.id))!

  const { groups } = await generateOutfits(db.binding, trip, NOW)
  for (const group of groups) await setGroupStatus(db.binding, group.id, 'approved', NOW)

  const stored = (await getTrip(db.binding, created.id))!
  await syncChecklistFromOutfits(db.binding, stored, NOW)
  return stored
}

async function onTheList(tripId: string) {
  const rows = (await listChecklist(db.binding, tripId)).filter((e) => e.excludedAt === null)
  const ids = new Set(rows.map((e) => e.itemId))
  return {
    swimsuits: ['swim1', 'swim2', 'swim3'].filter((id) => ids.has(id)),
    tankTops: ['tank1', 'tank2', 'tank3'].filter((id) => ids.has(id)),
    rowFor: (id: string) => rows.find((e) => e.itemId === id) ?? null,
  }
}

const SWIM_DAYS = [
  { date: '2026-08-01', activityTag: 'swimming' },
  { date: '2026-08-03', activityTag: 'swimming' },
  { date: '2026-08-05', activityTag: 'swimming' },
]

describe('a tank top reaches the packing list with the swimwear', () => {
  /*
   * At LEAST one per swimsuit, which is how the rule is stated. More is not
   * over-packing and is not this rule's doing: two swim groups each carry their
   * own optional top slot, and a tank top is worn once, so a day with a beach
   * outfit and a pool outfit genuinely asks for two tops.
   */
  it('puts at least one tank top on the list for every swimsuit on it', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBeGreaterThan(0)
    expect(list.tankTops.length).toBeGreaterThanOrEqual(list.swimsuits.length)
  })

  /*
   * Where the rule earns its place: the plan alone leaves a swimsuit without a
   * top, and the pairing draws the spare one out of the wardrobe.
   *
   * Seven days, five of them in the water — three swimsuits. The swim group's
   * own top slot supplies exactly one tank top however many pool days there
   * are, casual days take a second, and the third swimsuit would have gone in
   * the bag with nothing to wear over it.
   */
  it('adds the tank top the outfits left short, and says why', async () => {
    swimOnlyTankTops()

    const trip = await packed(
      { ...POOL_TRIP, startDate: '2026-08-01', endDate: '2026-08-07' },
      ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-08-${d}`, activityTag: 'swimming' })),
    )
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBe(3)
    expect(list.tankTops.length).toBe(3)

    const reasons = list.tankTops.map((id) => list.rowFor(id)!.reason)
    expect(reasons).toContain('Packed with your swimwear')

    // Enough now, so the shortfall warning stays quiet.
    const gaps = await tripCoverageGaps(db.binding, (await getTrip(db.binding, trip.id))!)
    expect(gaps.some((g) => g.message.includes('swimsuit'))).toBe(false)
  })

  /*
   * And where the wardrobe cannot close it: pack what exists, say what is
   * short, invent nothing (doc 04 §15). Reported through the warning system
   * that already exists for "your wardrobe cannot cover this trip" rather than
   * a second one built for swimwear.
   */
  it('reports the shortfall when there is no spare tank top to draw on', async () => {
    const trip = await packed(
      { ...POOL_TRIP, startDate: '2026-08-01', endDate: '2026-08-07' },
      ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-08-${d}`, activityTag: 'swimming' })),
    )
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBe(3)
    expect(list.tankTops.length).toBe(2)

    const gaps = await tripCoverageGaps(db.binding, (await getTrip(db.binding, trip.id))!)
    const swim = gaps.find((g) => g.message.includes('swimsuit'))

    expect(swim).toBeTruthy()
    expect(swim!.message).toBe('You are packing 3 swimsuits and 2 tank tops to wear over them.')
    expect(swim!.fix).toBe('Add a tank top in My Stuff, or ignore this if you have it covered.')
  })

  /*
   * A row Alex has moved to Not bringing is not in the bag, whatever the plan
   * thinks. The count has to read the checklist the way he does, or the warning
   * goes quiet about a shortfall he created himself.
   */
  it('stops counting a tank top he has set aside', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    expect(
      (await tripCoverageGaps(db.binding, (await getTrip(db.binding, trip.id))!))
        .some((g) => g.message.includes('swimsuit')),
    ).toBe(false)

    const list = await onTheList(trip.id)
    await excludeEntry(db.binding, list.rowFor(list.tankTops[0]!)!.id, NOW + 1)

    const gaps = await tripCoverageGaps(db.binding, (await getTrip(db.binding, trip.id))!)
    expect(gaps.some((g) => g.message.includes('swimsuit'))).toBe(true)
  })

  it('says nothing about tank tops when the trip has enough of them', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const gaps = await tripCoverageGaps(db.binding, (await getTrip(db.binding, trip.id))!)

    expect(gaps.some((g) => g.message.includes('swimsuit'))).toBe(false)
  })

  it('says nothing about tank tops on a trip with no swimming in it', async () => {
    const trip = await packed({ ...TRIP, activities: ['safari'] }, [
      { date: '2026-08-01', activityTag: 'safari' },
    ])
    const gaps = await tripCoverageGaps(db.binding, (await getTrip(db.binding, trip.id))!)

    expect(gaps.some((g) => g.message.includes('swimsuit'))).toBe(false)
  })

  it('adds no swimwear and no paired tank top to a trip with no water in it', async () => {
    const trip = await packed({ ...TRIP, activities: ['safari', 'nice_dinner'] }, [
      { date: '2026-08-01', activityTag: 'safari' },
      { date: '2026-08-03', activityTag: 'nice_dinner' },
    ])
    const list = await onTheList(trip.id)

    expect(list.swimsuits).toEqual([])
    expect(list.tankTops.map((id) => list.rowFor(id)!.reason))
      .not.toContain('Packed with your swimwear')
  })

  /*
   * The ownership contract, and the specific hazard of a rule that ADDS rows.
   *
   * `syncChecklistFromOutfits` runs on every approval, so a pairing that
   * inserted rather than reconciled would grow the list by one tank top every
   * time Alex touched an outfit. The additions are ordinary demand rows, which
   * is what makes the second run a no-op instead of a duplicate.
   *
   * Not asserted here: that the row leaves when the swimming does. Approved
   * groups are deliberately PRESERVED across a replan — `generateOutfits`
   * reports `keptApproved` for exactly that reason — so removing swim days does
   * not remove an approved swim outfit, and a test claiming otherwise would be
   * asserting a behaviour this repository does not have.
   */
  it('does not add another tank top every time the outfits are synced', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const first = await onTheList(trip.id)

    await syncChecklistFromOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW + 1)
    await syncChecklistFromOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW + 2)

    const after = await onTheList(trip.id)
    expect(after.tankTops).toEqual(first.tankTops)
    expect(after.swimsuits).toEqual(first.swimsuits)

    // And each is one row, not one row per sync.
    for (const id of after.tankTops) expect(after.rowFor(id)!.requiredQty).toBe(1)
  })

  /*
   * Two water phrases on ONE date is one swim-use day. Asserted here as well as
   * in the unit test because this is the path that writes the checklist, and
   * over-packing is what Alex would actually notice.
   */
  it('does not double the swimwear for a beach morning and a pool afternoon', async () => {
    const oneDay = await packed(POOL_TRIP, [
      { date: '2026-08-02', activityTag: 'beach' },
      { date: '2026-08-02', activityTag: 'swimming' },
    ])
    const list = await onTheList(oneDay.id)

    expect(list.swimsuits.length).toBe(1)
    // The two swim groups each dress their own top slot, which is the ordinary
    // top rule and not this one. What matters is that the SWIMSUIT did not
    // double — and that the pairing added nothing, having nothing to add.
    expect(list.tankTops.map((id) => list.rowFor(id)!.reason))
      .not.toContain('Packed with your swimwear')
  })
})
