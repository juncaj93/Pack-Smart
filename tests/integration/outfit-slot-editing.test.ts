import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { excludeEntry, listChecklist } from '../../worker/repos/checklist'
import {
  generateOutfits,
  listOutfits,
  outfitConflicts,
  removeSlot,
  reorderSlots,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { tripRoutes } from '../../worker/routes/trips'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * Taking a garment out of any outfit, and putting the rest in order (§0y).
 *
 * Two capabilities the product did not have. `removeSlot` existed as the undo
 * for having ADDED a garment by hand; nothing could take a garment out of an
 * outfit the planner wrote, and nothing could change the order they read in at
 * all.
 *
 * The case that asked for it is the one asserted first: an approved outfit
 * standing on a garment Alex has moved to Not bringing. Doc 04 §8 offered him a
 * replacement, and a replacement is the wrong answer when the outfit simply
 * does not need that piece.
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

const POOL_TRIP: TripInput = { ...TRIP }

/** A trip whose Nice dinners outfit is approved and on the checklist. */
async function dinnerApproved() {
  const trip = await createTrip(db.binding, POOL_TRIP, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  const dinner = groups.find((g) => g.name === 'Nice dinners')!

  await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  return { trip, dinner }
}

const groupNow = async (tripId: string, groupId: string) =>
  (await listOutfits(db.binding, tripId)).find((g) => g.id === groupId)!

describe('taking a garment out of a planner outfit', () => {
  /*
   * The whole reason this slice exists, end to end: set a garment aside, and
   * the conflict it leaves is answerable without naming a replacement.
   */
  it('ends the conflict a set-aside garment leaves behind', async () => {
    const { trip } = await dinnerApproved()
    const shirt = (await listChecklist(db.binding, trip.id)).find((e) => e.itemId === 'shirt')!

    await excludeEntry(db.binding, shirt.id, NOW)
    const conflict = (await outfitConflicts(db.binding, trip.id))[0]!
    expect(conflict).toMatchObject({ groupName: 'Nice dinners', itemName: 'White Oxford' })

    await removeSlot(db.binding, conflict.slotId, NOW + 1)

    expect(await outfitConflicts(db.binding, trip.id)).toEqual([])
  })

  /*
   * Gone, not blank — the distinction `setSlotItem(null)` keeps on the other
   * side. An emptied slot says the outfit is short of a top; a removed one says
   * the outfit does not have one, and only the second is true here.
   */
  it('leaves no empty row behind, and no claim that the outfit is short', async () => {
    const { trip, dinner } = await dinnerApproved()
    const top = dinner.slots.find((s) => s.role === 'top')!
    const emptyBefore = dinner.slots.filter((s) => s.itemId === null).length

    await removeSlot(db.binding, top.id, NOW + 1)

    const after = await groupNow(trip.id, dinner.id)
    expect(after.slots.some((s) => s.id === top.id)).toBe(false)
    expect(after.slots).toHaveLength(dinner.slots.length - 1)
    // The gaps the outfit already had, and not one more. A removal that emptied
    // the slot instead would show up here as an extra unfilled row.
    expect(after.slots.filter((s) => s.itemId === null)).toHaveLength(emptyBefore)
    // And approval survives the edit, exactly as it survives a swap.
    expect(after.status).toBe('approved')
  })

  /*
   * And the packing list follows, through the same synchroniser everything else
   * goes through. A garment no approved outfit wears any more is not in the bag.
   */
  it('takes the garment off the packing list when no outfit wears it', async () => {
    const { trip, dinner } = await dinnerApproved()
    const top = dinner.slots.find((s) => s.role === 'top')!

    const onList = async (itemId: string) =>
      (await listChecklist(db.binding, trip.id)).some(
        (row) => row.itemId === itemId && row.excludedAt === null,
      )

    expect(await onList(top.itemId!)).toBe(true)

    await removeSlot(db.binding, top.id, NOW + 1)
    await syncChecklistFromOutfits(db.binding, trip, NOW + 1)

    expect(await onList(top.itemId!)).toBe(false)
  })

  it('says nothing was removed for a slot that is not there', async () => {
    await dinnerApproved()
    expect(await removeSlot(db.binding, 'no-such-slot', NOW)).toBeNull()
  })
})

describe('putting an outfit’s garments in order', () => {
  it('stores the order Alex asked for', async () => {
    const { trip, dinner } = await dinnerApproved()
    const ids = dinner.slots.map((s) => s.id)
    const reversed = [...ids].reverse()

    expect(await reorderSlots(db.binding, dinner.id, reversed, NOW + 1)).toBe(true)

    expect((await groupNow(trip.id, dinner.id)).slots.map((s) => s.id)).toEqual(reversed)
  })

  /*
   * `sort_order` is not decoration: `redistributeWearings` walks a role's slots
   * in it and spends each garment's reuse capacity in turn, so a duplicate
   * position silently gives two garments one wearing count. Consecutive from
   * zero is what makes that impossible.
   */
  it('leaves the positions consecutive from zero, never duplicated', async () => {
    const { trip, dinner } = await dinnerApproved()
    const ids = dinner.slots.map((s) => s.id)

    await reorderSlots(db.binding, dinner.id, [...ids].reverse(), NOW + 1)

    const orders = (await groupNow(trip.id, dinner.id)).slots.map((s) => s.sortOrder)
    expect(orders).toEqual(orders.map((_, index) => index))
  })

  /*
   * All of them or none. A partial list would have to invent positions for the
   * slots it was not told about — and a list that arrived from a screen whose
   * outfit has changed underneath it is the same failure in different clothes.
   */
  it('refuses a partial list rather than filling in the rest', async () => {
    const { trip, dinner } = await dinnerApproved()
    const ids = dinner.slots.map((s) => s.id)
    const before = ids

    expect(await reorderSlots(db.binding, dinner.id, ids.slice(0, 2), NOW + 1)).toBe(false)

    expect((await groupNow(trip.id, dinner.id)).slots.map((s) => s.id)).toEqual(before)
  })

  it('refuses a list naming a slot from another outfit', async () => {
    const { trip, dinner } = await dinnerApproved()
    const other = (await listOutfits(db.binding, trip.id)).find((g) => g.id !== dinner.id)!
    const ids = dinner.slots.map((s) => s.id)

    const intruder = [...ids.slice(0, -1), other.slots[0]!.id]
    expect(await reorderSlots(db.binding, dinner.id, intruder, NOW + 1)).toBe(false)

    expect((await groupNow(trip.id, dinner.id)).slots.map((s) => s.id)).toEqual(ids)
  })

  it('refuses a list that names one slot twice', async () => {
    const { dinner } = await dinnerApproved()
    const ids = dinner.slots.map((s) => s.id)

    expect(await reorderSlots(db.binding, dinner.id, [ids[0]!, ...ids.slice(0, -1)], NOW + 1))
      .toBe(false)
  })

  it('refuses an outfit that is not there', async () => {
    await dinnerApproved()
    expect(await reorderSlots(db.binding, 'no-such-group', [], NOW)).toBe(false)
  })

  /*
   * The order is not a packing decision, and the response says so. Reordering
   * moves no garment in or out of any bag, so there is no checklist consequence
   * to report and none is reported.
   */
  it('changes nothing on the packing list', async () => {
    const { trip, dinner } = await dinnerApproved()
    const before = (await listChecklist(db.binding, trip.id)).map((e) => [e.itemId, e.requiredQty])

    await reorderSlots(db.binding, dinner.id, dinner.slots.map((s) => s.id).reverse(), NOW + 1)
    await syncChecklistFromOutfits(db.binding, trip, NOW + 1)

    expect((await listChecklist(db.binding, trip.id)).map((e) => [e.itemId, e.requiredQty]))
      .toEqual(before)
  })
})

/**
 * The route, because the repository being right is not the same as the phone
 * being able to reach it.
 */
describe('the reorder endpoint', () => {
  async function put(tripId: string, groupId: string, body: unknown) {
    return tripRoutes.request(
      new Request(`https://example.test/${tripId}/outfits/${groupId}/slot-order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      undefined,
      { DB: db.binding } as never,
    )
  }

  it('answers with the groups in their new order', async () => {
    const { trip, dinner } = await dinnerApproved()
    const reversed = dinner.slots.map((s) => s.id).reverse()

    const response = await put(trip.id, dinner.id, { slotIds: reversed })
    expect(response.status).toBe(200)

    const body = (await response.json()) as { groups: Array<{ id: string; slots: Array<{ id: string }> }> }
    expect(body.groups.find((g) => g.id === dinner.id)!.slots.map((s) => s.id)).toEqual(reversed)
  })

  it('says what is wrong rather than reporting success for a no-op', async () => {
    const { trip, dinner } = await dinnerApproved()

    const stale = await put(trip.id, dinner.id, { slotIds: [dinner.slots[0]!.id] })
    expect(stale.status).toBe(409)

    const nonsense = await put(trip.id, dinner.id, { slotIds: 'everything' })
    expect(nonsense.status).toBe(400)
  })
})
