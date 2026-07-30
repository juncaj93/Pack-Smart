import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  excludeEntry,
  generateChecklist,
  listChecklist,
  setPackedQty,
  setQtyOverride,
} from '../../worker/repos/checklist'
import { packedTripCounts } from '../../worker/repos/items'
import { createTrip, deleteTrip } from '../../worker/repos/trips'
import { isPacked } from '../../shared/rules'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * "Most packed" counts what Alex actually put in a bag.
 *
 * The distinction this file exists to hold is the one from PR #15 §5: **confirmed
 * packing per trip, not inclusion on a generated list.** The easy query — count
 * the checklist rows an item appears on — measures what the rules *suggest*, so
 * the top of the sort would be whatever the engine proposes most often. Alex
 * already knows what Pack Smart suggests; that is the rest of the product. The
 * only interesting question this sort can answer is what he keeps taking.
 *
 * Every test below is really the same test: something appeared on a packing list
 * and did not travel, and must not be counted.
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)
})

afterEach(() => {
  db.close()
})

/** A trip with a generated checklist, ready to be packed. */
async function tripWithChecklist(name: string) {
  const trip = await createTrip(db.binding, { ...TRIP, name }, NOW)
  await generateChecklist(db.binding, trip, NOW)
  return trip
}

/** Marks one row fully packed and returns the item it belongs to. */
async function packFirstRow(tripId: string, index = 0) {
  const entries = await listChecklist(db.binding, tripId)
  const row = entries.filter((e) => e.itemId !== null)[index]
  if (!row) throw new Error('most-packed: the generated checklist has no wardrobe rows')
  await setPackedQty(db.binding, row.id, row.requiredQty, NOW)
  return row
}

describe('what counts as packed', () => {
  it('counts an item once per trip it was packed on', async () => {
    const first = await tripWithChecklist('Lisbon')
    const packed = await packFirstRow(first.id)

    expect((await packedTripCounts(db.binding))[packed.itemId!]).toBe(1)

    const second = await tripWithChecklist('Porto')
    const entries = await listChecklist(db.binding, second.id)
    const same = entries.find((e) => e.itemId === packed.itemId)
    if (!same) throw new Error('most-packed: the second trip did not suggest the same item')
    await setPackedQty(db.binding, same.id, same.requiredQty, NOW)

    expect((await packedTripCounts(db.binding))[packed.itemId!]).toBe(2)
  })

  it('does not count an item that was only suggested', async () => {
    /*
     * The whole point. A freshly generated checklist is a list of suggestions
     * with nothing packed, so the counts must be empty — not "every item, once".
     */
    await tripWithChecklist('Lisbon')
    expect(await packedTripCounts(db.binding)).toEqual({})
  })

  it('does not count a row that is only part packed', async () => {
    const trip = await tripWithChecklist('Lisbon')
    const entries = await listChecklist(db.binding, trip.id)
    const row = entries.find((e) => e.itemId !== null)
    if (!row) throw new Error('most-packed: the generated checklist has no wardrobe rows')

    // Three of something, two of them in the bag.
    await setQtyOverride(db.binding, row.id, 3, NOW)
    await setPackedQty(db.binding, row.id, 2, NOW)
    expect((await packedTripCounts(db.binding))[row.itemId!]).toBeUndefined()

    await setPackedQty(db.binding, row.id, 3, NOW)
    expect((await packedTripCounts(db.binding))[row.itemId!]).toBe(1)
  })

  it('counts against the quantity Alex set, not the one that was suggested', async () => {
    /*
     * The trap in this query, and the reason it says `COALESCE`.
     *
     * `ChecklistEntry.requiredQty` resolves the override before anything sees it,
     * and `isPacked` compares against the resolved value — so a row where Alex
     * said "two is enough" and packed two shows a full tick on the screen. A
     * count that compared against the raw column would call the same row unpacked
     * and disagree with the tick he is looking at.
     */
    const trip = await tripWithChecklist('Lisbon')
    const entries = await listChecklist(db.binding, trip.id)
    const row = entries.find((e) => e.itemId !== null)
    if (!row) throw new Error('most-packed: the generated checklist has no wardrobe rows')

    await setQtyOverride(db.binding, row.id, 2, NOW)
    await setPackedQty(db.binding, row.id, 2, NOW)

    const resolved = (await listChecklist(db.binding, trip.id)).find((e) => e.id === row.id)
    expect(resolved && isPacked(resolved)).toBe(true)
    expect((await packedTripCounts(db.binding))[row.itemId!]).toBe(1)
  })

  it('stops counting a row that was packed and then taken off the trip', async () => {
    /*
     * Packing something and then changing your mind is not a trip it went on.
     * `excluded_at` survives the removal — that is what lets it be restored — so
     * a query that only looked at quantities would keep counting it forever.
     */
    const trip = await tripWithChecklist('Lisbon')
    const packed = await packFirstRow(trip.id)
    expect((await packedTripCounts(db.binding))[packed.itemId!]).toBe(1)

    await excludeEntry(db.binding, packed.id, NOW)
    expect((await packedTripCounts(db.binding))[packed.itemId!]).toBeUndefined()
  })
})

describe('the count follows the trips, because that is what it is about', () => {
  it('drops when a trip is deleted', async () => {
    /*
     * Stated rather than assumed. Doc 08 §9 is explicit that a deleted trip stops
     * counting toward the learning it contributed, and this is the same rule: the
     * count is derived from `checklist_entry`, those rows go with the trip, and
     * so the number goes down. Correct, and worth having written down somewhere
     * other than a comment.
     */
    const keep = await tripWithChecklist('Lisbon')
    const kept = await packFirstRow(keep.id)

    const doomed = await tripWithChecklist('Porto')
    const entries = await listChecklist(db.binding, doomed.id)
    const same = entries.find((e) => e.itemId === kept.itemId)
    if (!same) throw new Error('most-packed: the second trip did not suggest the same item')
    await setPackedQty(db.binding, same.id, same.requiredQty, NOW)

    expect((await packedTripCounts(db.binding))[kept.itemId!]).toBe(2)

    await deleteTrip(db.binding, doomed.id)
    expect((await packedTripCounts(db.binding))[kept.itemId!]).toBe(1)
  })
})

describe('it reports nothing rather than zeroes', () => {
  it('returns an empty object for a wardrobe that has never travelled', async () => {
    // 119 keys of `0` would be most of the payload of the My Stuff request, to
    // say nothing at all. Absent means zero, and the client reads it that way.
    expect(await packedTripCounts(db.binding)).toEqual({})
  })

  it('names only the items that have been packed', async () => {
    const trip = await tripWithChecklist('Lisbon')
    const packed = await packFirstRow(trip.id)

    const counts = await packedTripCounts(db.binding)
    expect(Object.keys(counts)).toEqual([packed.itemId])
  })
})
