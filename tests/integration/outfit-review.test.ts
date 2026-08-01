import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listChecklist } from '../../worker/repos/checklist'
import {
  generateOutfits,
  listOutfits,
  setGroupDeferred,
  setGroupStatus,
  setSlotItem,
  swapCandidates,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { tripRoutes } from '../../worker/routes/trips'
import { outfitCoverage, coverageSentence } from '@shared/outfits'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * C2's guarantees, against real SQL.
 *
 * The unit tests prove the review's vocabulary is right. These prove the things
 * that vocabulary describes are actually true of the database: that a deferral
 * survives, that it changes nothing else, that an incomplete outfit still
 * cannot be approved, and — the one worth the most — that none of this moved a
 * garment on or off the packing list by accident.
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

async function planned() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  return { trip, groups }
}

/* ------------------------------------------------------------------ */
/* decide later                                                        */
/* ------------------------------------------------------------------ */

describe('deciding later', () => {
  it('survives a reload, because a decision held in a screen is not a decision', async () => {
    const { trip, groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!

    await setGroupDeferred(db.binding, safari.id, true, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === safari.id)!
    expect(after.deferredAt).toBe(NOW)
  })

  it('changes nothing else about the outfit', async () => {
    const { trip, groups } = await planned()
    const safari = groups.find((g) => g.name === 'Safari')!
    const before = safari.slots.map((s) => `${s.role}=${s.itemId}`)

    await setGroupDeferred(db.binding, safari.id, true, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === safari.id)!
    // Doc 09 §7: the draft must be preserved exactly as it was.
    expect(after.slots.map((s) => `${s.role}=${s.itemId}`)).toEqual(before)
    expect(after.status).toBe(safari.status)
  })

  /*
   * The clause the whole feature turns on. "Decide later" must never read as
   * "yes" — not to the summary, not to the readiness model, and not to the
   * packing list.
   */
  it('never approves anything, and puts nothing in the bag', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const shirt = dinner.slots.find((s) => s.role === 'top')!.itemId!

    await setGroupDeferred(db.binding, dinner.id, true, NOW)
    await syncChecklistFromOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === dinner.id)!
    expect(after.status).not.toBe('approved')

    const entries = await listChecklist(db.binding, trip.id)
    expect(entries.some((e) => e.itemId === shirt && e.source === 'outfit_generated')).toBe(false)
  })

  it('stays unresolved in the coverage summary rather than counting as covered', async () => {
    const { trip, groups } = await planned()
    for (const group of groups) await setGroupDeferred(db.binding, group.id, true, NOW)

    const coverage = outfitCoverage(await listOutfits(db.binding, trip.id))
    expect(coverage.covered).toBe(0)
    expect(coverage.unresolved).toBe(groups.length)
    // Reviewed, but honestly: every outfit answered, no need covered.
    expect(coverage.reviewed).toBe(groups.length)
    expect(coverageSentence(coverage)).toMatch(/none approved yet/)
  })

  it('is taken back by approving, so the two markers cannot contradict each other', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupDeferred(db.binding, dinner.id, true, NOW)
    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === dinner.id)!
    expect(after.status).toBe('approved')
    expect(after.deferredAt).toBeNull()
  })

  /*
   * An approval the server refuses is not an approval, so it must not clear the
   * deferral either — the outfit is exactly as undecided as it was a moment ago.
   */
  it('keeps the deferral when an approval is refused', async () => {
    const { trip, groups } = await planned()
    const group = groups[0]!
    const required = group.slots.find((s) => s.required)!

    await setSlotItem(db.binding, required.id, null, NOW)
    await setGroupDeferred(db.binding, group.id, true, NOW)
    const outcome = await setGroupStatus(db.binding, group.id, 'approved', NOW)

    expect(outcome.status).toBe('incomplete')
    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === group.id)!
    expect(after.deferredAt).toBe(NOW)
  })

  /*
   * Through the real router, not the repo.
   *
   * `outfitRoutes` is mounted at `/:id/outfits` inside `tripRoutes`, so the trip
   * id is a path parameter the endpoint reads — calling the sub-router directly
   * would exercise a path production never serves and would pass with the trip
   * lookup returning nothing.
   */
  async function deferVia(tripId: string, groupId: string, deferred: unknown) {
    return tripRoutes.request(
      new Request(`https://example.test/${tripId}/outfits/${groupId}/defer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deferred }),
      }),
      undefined,
      { DB: db.binding } as never,
    )
  }

  it('is set and cleared through the endpoint the screen actually calls', async () => {
    const { trip, groups } = await planned()
    const group = groups[0]!

    const on = await deferVia(trip.id, group.id, true)
    expect(on.status).toBe(200)
    const set = (await on.json()) as { groups: Array<{ id: string; deferredAt: number | null }> }
    expect(set.groups.find((g) => g.id === group.id)?.deferredAt).not.toBeNull()

    const off = await deferVia(trip.id, group.id, false)
    expect(off.status).toBe(200)
    const cleared = (await off.json()) as {
      groups: Array<{ id: string; deferredAt: number | null }>
    }
    expect(cleared.groups.find((g) => g.id === group.id)?.deferredAt).toBeNull()
  })

  it('refuses a request that does not say which way', async () => {
    const { trip, groups } = await planned()
    const response = await deferVia(trip.id, groups[0]!.id, 'maybe')
    expect(response.status).toBe(400)
  })
})

/* ------------------------------------------------------------------ */
/* incomplete outfits                                                  */
/* ------------------------------------------------------------------ */

/**
 * The existing guarantee, re-asserted where the review can reach it.
 *
 * Doc 09 §7's "never silently approve incomplete" was already true before C2 —
 * `refreshGroupStatus` recomputes from the slots and vetoes the request. The
 * review adds three new ways to arrive at that moment, so the guarantee is
 * tested from each of them rather than assumed to have survived.
 */
describe('an outfit missing a required piece', () => {
  async function emptied(role: 'top' | 'bottom' | 'footwear' = 'top') {
    const { trip, groups } = await planned()
    const group = groups.find((g) => g.name === 'Nice dinners')!
    const slot = group.slots.find((s) => s.role === role && s.required)!
    await setSlotItem(db.binding, slot.id, null, NOW)
    return { trip, groupId: group.id }
  }

  it('cannot be approved, however the request arrives', async () => {
    const { trip, groupId } = await emptied()
    const outcome = await setGroupStatus(db.binding, groupId, 'approved', NOW)

    expect(outcome.status).toBe('incomplete')
    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!
    expect(after.status).toBe('incomplete')
  })

  it('puts nothing on the packing list when approval is refused', async () => {
    const { trip, groupId } = await emptied()
    const stored = (await getTrip(db.binding, trip.id))!

    await setGroupStatus(db.binding, groupId, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const entries = await listChecklist(db.binding, trip.id)
    expect(entries.filter((e) => e.source === 'outfit_generated')).toHaveLength(0)
  })

  it('can be deferred, so a gap Alex cannot fix does not block the review', async () => {
    const { trip, groupId } = await emptied()
    await setGroupDeferred(db.binding, groupId, true, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!
    // Deferred AND still incomplete: both facts stay true, neither hides the other.
    expect(after.deferredAt).toBe(NOW)
    expect(after.status).toBe('incomplete')
  })

  it('becomes approvable once the gap is filled, and only then', async () => {
    const { trip, groupId } = await emptied()

    const refused = await setGroupStatus(db.binding, groupId, 'approved', NOW)
    expect(refused.status).toBe('incomplete')

    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!
    const empty = group.slots.find((s) => s.required && s.itemId === null)!
    await setSlotItem(db.binding, empty.id, 'shirt', NOW)

    const accepted = await setGroupStatus(db.binding, groupId, 'approved', NOW)
    expect(accepted.status).toBe('approved')
  })

  /*
   * The case doc 09 §7 asks about by name: no eligible replacement at all. The
   * slot stays empty and says why — it is never filled with an approximation,
   * and the outfit is never quietly approved around it.
   */
  it('says what is missing rather than substituting something that does not fit', async () => {
    db.close()
    db = createTestDatabase()
    // A wardrobe with tops and bottoms but nothing to put on his feet.
    garment(db, { id: 'only-tee', name: 'Grey Tee', subcategory: 'T-Shirt' })
    garment(db, { id: 'only-shorts', name: 'Shorts', subcategory: 'Shorts' })

    const trip = await createTrip(db.binding, { ...TRIP, activities: [] }, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)

    const shoeless = groups.find((g) => g.slots.some((s) => s.role === 'footwear'))!
    const footwear = shoeless.slots.find((s) => s.role === 'footwear')!

    expect(footwear.itemId).toBeNull()
    expect(footwear.unmetReason).toMatch(/no shoes in your wardrobe/i)
    expect(shoeless.status).toBe('incomplete')

    const outcome = await setGroupStatus(db.binding, shoeless.id, 'approved', NOW)
    expect(outcome.status).toBe('incomplete')
  })
})

/* ------------------------------------------------------------------ */
/* change something                                                    */
/* ------------------------------------------------------------------ */

describe('changing one piece of an outfit', () => {
  it('leaves the rest of the outfit exactly as it was', async () => {
    const { trip, groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!
    const others = dinner.slots.filter((s) => s.id !== top.id).map((s) => `${s.role}=${s.itemId}`)

    await setSlotItem(db.binding, top.id, 'tee', NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === dinner.id)!
    expect(after.slots.find((s) => s.id === top.id)?.itemId).toBe('tee')
    expect(after.slots.filter((s) => s.id !== top.id).map((s) => `${s.role}=${s.itemId}`)).toEqual(
      others,
    )
  })

  it('keeps the packing list in step with the change', async () => {
    const { trip, groups } = await planned()
    const stored = (await getTrip(db.binding, trip.id))!
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const top = dinner.slots.find((s) => s.role === 'top')!
    const wasPacked = top.itemId!
    await setSlotItem(db.binding, top.id, 'tee', NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const entries = await listChecklist(db.binding, trip.id)
    const outfitRows = entries.filter((e) => e.source === 'outfit_generated')
    expect(outfitRows.some((e) => e.itemId === 'tee')).toBe(true)
    expect(outfitRows.some((e) => e.itemId === wasPacked)).toBe(false)
  })

  /*
   * Measured during C2 and found wrong: the swap sheet judged suitability from
   * the role and the template alone, so a garment the PLANNER had ruled out on
   * the trip's dressiness ceiling came back labelled suitable. The sheet and the
   * plan disagreeing about what fits makes the card's explanation look arbitrary.
   */
  it('offers only what the planner itself would accept', async () => {
    const { groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const unrestricted = await swapCandidates(db.binding, dinner.id, top.id, null)
    const capped = await swapCandidates(db.binding, dinner.id, top.id, 2)

    const suitableUnder = (list: typeof capped) =>
      list.filter((c) => c.suitable).map((c) => c.item.id)

    // The dressy shirt is dressiness 3; a trip capped at Smart casual excludes it.
    expect(suitableUnder(unrestricted)).toContain('shirt')
    expect(suitableUnder(capped)).not.toContain('shirt')
    // Still listed, still explained — the sheet says why, it does not hide it.
    expect(capped.some((c) => c.item.id === 'shirt' && !c.suitable)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* synchronisation, unchanged                                          */
/* ------------------------------------------------------------------ */

/**
 * Doc 09 §7 asks for the existing synchronisation to be PRESERVED, which is a
 * different claim from "the new screen works". These are the six checks it
 * names, run after the review's own writes rather than in isolation.
 */
describe('the packing list, after a review', () => {
  it('gains an approved outfit’s clothes and loses them on undo', async () => {
    const { trip, groups } = await planned()
    const stored = (await getTrip(db.binding, trip.id))!
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    const added = await syncChecklistFromOutfits(db.binding, stored, NOW)
    expect(added.added).toBeGreaterThan(0)

    await setGroupStatus(db.binding, dinner.id, 'draft', NOW)
    const removed = await syncChecklistFromOutfits(db.binding, stored, NOW)
    expect(removed.removed).toBeGreaterThan(0)

    const entries = await listChecklist(db.binding, trip.id)
    expect(entries.filter((e) => e.source === 'outfit_generated')).toHaveLength(0)
  })

  it('leaves a hand-set quantity alone through a deferral and an approval', async () => {
    const { trip, groups } = await planned()
    const stored = (await getTrip(db.binding, trip.id))!
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const row = (await listChecklist(db.binding, trip.id)).find(
      (e) => e.source === 'outfit_generated',
    )!
    db.raw.prepare('UPDATE checklist_entry SET qty_override = 9 WHERE id = ?').run(row.id)

    const safari = groups.find((g) => g.name === 'Safari')!
    await setGroupDeferred(db.binding, safari.id, true, NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.id === row.id)!
    expect(after.requiredQty).toBe(9)
  })

  it('does not resurrect something set aside', async () => {
    const { trip, groups } = await planned()
    const stored = (await getTrip(db.binding, trip.id))!
    const dinner = groups.find((g) => g.name === 'Nice dinners')!

    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const row = (await listChecklist(db.binding, trip.id)).find(
      (e) => e.source === 'outfit_generated',
    )!
    db.raw.prepare('UPDATE checklist_entry SET excluded_at = ? WHERE id = ?').run(NOW, row.id)

    await syncChecklistFromOutfits(db.binding, stored, NOW)

    const after = (await listChecklist(db.binding, trip.id)).find((e) => e.id === row.id)!
    expect(after.excludedAt).not.toBeNull()
  })
})
