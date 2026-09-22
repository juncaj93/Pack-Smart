import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { excludeEntry, listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { generateOutfits, setGroupStatus, syncChecklistFromOutfits } from '../../worker/repos/outfits'
import { tripCoverageGaps } from '../../worker/repos/coverage'
import { tripRoutes } from '../../worker/routes/trips'
import { countRoundTrips, createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * The swim companion rule, through the door it actually goes through.
 *
 * `tests/unit/worker/swimwear.test.ts` proves the rule. This proves the
 * WIRING — that `syncChecklistFromOutfits` runs it, that the addition is an
 * ordinary demand row obeying the same ownership contract as everything else
 * that function writes.
 *
 * The distinction matters because the failure modes are completely different. A
 * wrong rule gives Alex the wrong sandals; an unwired rule gives him none,
 * silently, while every unit test stays green.
 *
 * There used to be two rules here: a pair of sandals, and one tank top for
 * every swimsuit. Alex retired the tank top (doc 09 §0x) — a t-shirt over a
 * swimsuit is as often what he wears — so the first block below asserts the
 * retirement rather than the rule.
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
  // The two pairs the swim-footwear rule is about, as the workbook records them:
  // one subcategory, told apart by brand, and neither identified by its name.
  garment(db, { id: 'birks', name: 'Sandals', subcategory: 'Sandals', uses: ['casual'] })
  garment(db, { id: 'slides', name: 'Slides', subcategory: 'Sandals', dressiness: 0, uses: ['casual', 'loungewear'] })
})

/**
 * A wardrobe whose tank tops are only for swimming.
 *
 * Not decoration — it is what made the retired pairing rule's work visible.
 * With ordinary `warm_weather / casual` tank tops the travel and casual days
 * pick them up anyway. Marked swim-only, those groups cannot take them, and the
 * plan alone leaves swimsuits without a top: exactly the gap the old rule
 * closed, and the case that proves nothing closes it now.
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
    sandals: ['birks', 'slides'].filter((id) => ids.has(id)),
    rowFor: (id: string) => rows.find((e) => e.itemId === id) ?? null,
  }
}

/**
 * Coverage the way the route asks for it — with the checklist it already has.
 *
 * `tripCoverageGaps` takes the entries rather than re-reading them, so that the
 * warning and the list it is a warning ABOUT come from one read. A test that
 * omitted them would be asserting against a coverage call no screen makes.
 */
async function gapsFor(tripId: string) {
  const trip = (await getTrip(db.binding, tripId))!
  return tripCoverageGaps(db.binding, trip, await listChecklist(db.binding, tripId))
}

const SWIM_DAYS = [
  { date: '2026-08-01', activityTag: 'swimming' },
  { date: '2026-08-03', activityTag: 'swimming' },
  { date: '2026-08-05', activityTag: 'swimming' },
]

describe('nothing pairs a tank top with a swimsuit any more', () => {
  /*
   * The retired rule, asserted as retired — and asserted on the wardrobe that
   * used to make it bite. Tank tops no ordinary group can wear, five swim days,
   * three swimsuits: the planner's own top slots take what they take and
   * nothing tops the count up behind them.
   */
  it('adds no tank top the outfits did not ask for', async () => {
    swimOnlyTankTops()

    const trip = await packed(
      { ...POOL_TRIP, startDate: '2026-08-01', endDate: '2026-08-07' },
      ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-08-${d}`, activityTag: 'swimming' })),
    )
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBe(3)
    expect(list.tankTops.map((id) => list.rowFor(id)!.reason))
      .not.toContain('Packed with your swimwear')
  })

  /*
   * The warning that went with the rule, gone with it. Three swimsuits and two
   * tank tops used to produce a sentence about being one short; owning fewer
   * tank tops than swimsuits is now simply not a fact the app has an opinion
   * about.
   */
  it('says nothing about being short of tank tops', async () => {
    const trip = await packed(
      { ...POOL_TRIP, startDate: '2026-08-01', endDate: '2026-08-07' },
      ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-08-${d}`, activityTag: 'swimming' })),
    )
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBe(3)
    expect(list.tankTops.length).toBeLessThan(3)

    const gaps = await gapsFor(trip.id)
    expect(gaps.some((g) => g.message.includes('tank top'))).toBe(false)
  })

  /*
   * And it stays quiet when he sets one aside, which is the case the old rule
   * was most eager to speak up about.
   */
  it('stays quiet when a tank top is moved to Not bringing', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const list = await onTheList(trip.id)
    expect(list.tankTops.length).toBeGreaterThan(0)

    await excludeEntry(db.binding, list.rowFor(list.tankTops[0]!)!.id, NOW + 1)

    const gaps = await gapsFor(trip.id)
    expect(gaps.some((g) => g.message.includes('tank top'))).toBe(false)
  })

  it('adds no swimwear at all to a trip with no water in it', async () => {
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
  })
})

/**
 * The swim footwear shortfall, through the HTTP route Alex's phone actually calls.
 *
 * `tripCoverageGaps` takes the checklist as an argument, which means the route
 * has to hand it over — and a route that forgets simply reports no swim gap, on
 * every trip, for ever, with every other test still green. That is the "unwired
 * rule" failure: not a wrong answer, an absent one.
 *
 * The round-trip count is asserted for a second reason. This coverage check used
 * to read the checklist itself, which made the hottest GET in the app load the
 * same forty rows twice — and the two reads could disagree, so the warning and
 * the list it warns about would come from different moments.
 */
describe('the checklist route serves the swim shortfall', () => {
  const routed = new Hono().route('/:id/checklist', tripRoutes)

  async function checklistResponse(binding: D1Database, tripId: string) {
    const response = await tripRoutes.request(
      new Request(`https://example.test/${tripId}/checklist`),
      undefined,
      { DB: binding } as never,
    )
    expect(response.status).toBe(200)
    return (await response.json()) as { coverage: Array<{ message: string; fix: string }> }
  }

  it('says the shortfall out loud in the response, not only in the repo', async () => {
    db.raw.prepare("DELETE FROM item WHERE subcategory = 'Sandals'").run()

    const trip = await packed(
      { ...POOL_TRIP, startDate: '2026-08-01', endDate: '2026-08-07' },
      ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-08-${d}`, activityTag: 'swimming' })),
    )

    const body = await checklistResponse(db.binding, trip.id)
    const swim = body.coverage.find((g) => g.message.includes('Birkenstocks'))

    expect(swim).toBeTruthy()
    expect(swim!.message).toBe('You have nothing recorded as slides or Birkenstocks.')
  })

  it('says nothing about swimwear on a trip that has none', async () => {
    db.raw.prepare("DELETE FROM item WHERE subcategory = 'Sandals'").run()

    const trip = await packed({ ...TRIP, activities: ['safari'] }, [
      { date: '2026-08-01', activityTag: 'safari' },
    ])

    const body = await checklistResponse(db.binding, trip.id)
    expect(body.coverage.some((g) => g.message.includes('Birkenstocks'))).toBe(false)
  })

  it('reads the checklist once, not once for the list and again for the warning', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)

    const counted = countRoundTrips(db.binding)
    await checklistResponse(counted.db, trip.id)

    /*
     * `listChecklist`'s own statement, not merely any SQL naming the table —
     * `outfitConflicts` legitimately mentions `checklist_entry` in a subquery,
     * and counting that would make this assert something it does not mean.
     */
    const listReads = counted
      .executed()
      .filter((sql) => /FROM checklist_entry e LEFT JOIN item i/i.test(sql))

    expect(listReads.length, listReads.join('\n')).toBe(1)
  })

  void routed
})

describe('a pair of sandals reaches the packing list with the swimwear', () => {
  /*
   * The common case, and the reason the rule usually does nothing: the swim
   * template carries an optional `footwear` slot, so the planner picks the
   * slides for Pool and downtime on its own and the requirement is met before
   * this rule looks. One pair, however many swimsuits.
   */
  it('puts exactly one qualifying pair on the list, however many swimsuits', async () => {
    const trip = await packed(
      { ...POOL_TRIP, startDate: '2026-08-01', endDate: '2026-08-07' },
      ['01', '02', '03', '04', '05'].map((d) => ({ date: `2026-08-${d}`, activityTag: 'swimming' })),
    )
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBe(3)
    expect(list.sandals.length).toBe(1)
    // ONE PAIR, not one per swimsuit — asserted on the quantity, because a
    // per-swimsuit rewrite would keep the row count at one and put a 3 on it.
    expect(list.rowFor(list.sandals[0]!)!.requiredQty).toBe(1)
  })

  /*
   * And where the rule earns its place: sandals Alex owns that no outfit group
   * would choose — dressy leather ones, on a trip with nothing dressy in it.
   * The planner leaves them behind, and he still needs something to walk to the
   * pool in.
   */
  it('adds the pair the outfits passed over, and says why', async () => {
    db.raw.prepare("DELETE FROM item WHERE subcategory = 'Sandals'").run()
    garment(db, { id: 'birks', name: 'Sandals', subcategory: 'Sandals', dressiness: 3, uses: ['dressy'] })

    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const list = await onTheList(trip.id)

    expect(list.swimsuits.length).toBeGreaterThan(0)
    expect(list.sandals).toEqual(['birks'])

    const row = list.rowFor('birks')!
    expect(row.reason).toBe('Packed with your swimwear')
    expect(row.requiredQty).toBe(1)

    // Covered now, so the warning stays quiet.
    expect((await gapsFor(trip.id)).some((g) => g.message.includes('Birkenstocks'))).toBe(false)
  })

  it('adds none to a trip with no swimming in it', async () => {
    const trip = await packed({ ...TRIP, activities: ['safari'] }, [
      { date: '2026-08-01', activityTag: 'safari' },
    ])
    const list = await onTheList(trip.id)

    expect(list.swimsuits).toEqual([])
    expect(list.sandals.map((id) => list.rowFor(id)!.reason))
      .not.toContain('Packed with your swimwear')
  })

  it('does not add a second pair every time the outfits are synced', async () => {
    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const first = await onTheList(trip.id)

    await syncChecklistFromOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW + 1)
    await syncChecklistFromOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW + 2)

    expect((await onTheList(trip.id)).sandals).toEqual(first.sandals)
  })

  /*
   * Owning neither is the case that must not invent a pair. The warning names
   * both kinds, because either will do and naming one would read as an
   * instruction to buy that one.
   */
  it('says what is missing when he owns no qualifying pair at all', async () => {
    db.raw.prepare("DELETE FROM item WHERE subcategory = 'Sandals'").run()

    const trip = await packed(POOL_TRIP, SWIM_DAYS)
    const list = await onTheList(trip.id)
    expect(list.swimsuits.length).toBeGreaterThan(0)
    expect(list.sandals).toEqual([])

    const gaps = await gapsFor(trip.id)
    const footwear = gaps.find((g) => g.message.includes('Birkenstocks'))

    expect(footwear).toBeTruthy()
    expect(footwear!.message).toBe('You have nothing recorded as slides or Birkenstocks.')
  })

  it('says nothing about footwear on a trip with no swimwear, even owning none', async () => {
    db.raw.prepare("DELETE FROM item WHERE subcategory = 'Sandals'").run()

    const trip = await packed({ ...TRIP, activities: ['safari'] }, [
      { date: '2026-08-01', activityTag: 'safari' },
    ])

    expect((await gapsFor(trip.id)).some((g) => g.message.includes('Birkenstocks'))).toBe(false)
  })
})
