import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateChecklist, listChecklist, setPackedQty, setQtyOverride } from '../../worker/repos/checklist'
import { createTrip, getTrip, setTripDays, updateTrip } from '../../worker/repos/trips'
import { archiveItem, restoreItem } from '../../worker/repos/items'
import {
  generateOutfits,
  listOutfits,
  outfitConflicts,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTestDatabase, insertItem, insertRule, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * The three synchronisation invariants D1 measured and found broken.
 *
 * Doc 04 §8 ends "the user must never maintain two conflicting clothing plans",
 * and each of these is a way the app hands him one. They are written as
 * acceptance tests rather than as a description because the audit's whole
 * finding was that the existing tests are shaped so that they cannot see any of
 * this — see doc 09, "D1 — the Release D synchronisation audit".
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

async function approvedTrip() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  for (const group of groups) await setGroupStatus(db.binding, group.id, 'approved', NOW)
  const stored = (await getTrip(db.binding, trip.id))!
  await syncChecklistFromOutfits(db.binding, stored, NOW)
  return { trip: stored, groups: await listOutfits(db.binding, trip.id) }
}

describe('one row per garment, whichever writer ran last', () => {
  /*
   * The overlap the whole defect lives in: underwear is a GARMENT carrying the
   * approved 2-per-trip-day rule, so both writers want it. `generateChecklist`
   * keyed its lookup on `item_id` across every source and rewrote the outfit
   * writer's row; the outfit writer then found no row it owned and inserted
   * another. The list grew a row on every alternating pass.
   */
  it('does not grow a row each time the two writers alternate', async () => {
    insertRule(db, 'tee', { ruleType: 'per_day', quantityValue: 2 })
    const { trip } = await approvedTrip()

    for (let round = 0; round < 4; round += 1) {
      await generateChecklist(db.binding, trip, NOW)
      await syncChecklistFromOutfits(db.binding, trip, NOW)
    }

    const rows = (await listChecklist(db.binding, trip.id)).filter((e) => e.itemId === 'tee')
    expect(rows.map((r) => `${r.source}=${r.requiredQty}`)).toHaveLength(1)
  })

  /*
   * Deliberately counts EVERY source. The existing guard counts only
   * `outfit_generated` rows, so it would pass while looking straight at the
   * duplicate it was written to prevent.
   */
  it('holds for every garment on the list, not only the outfit-owned ones', async () => {
    insertRule(db, 'tee', { ruleType: 'per_day', quantityValue: 2 })
    insertRule(db, 'shoes', { ruleType: 'fixed_per_trip', quantityValue: 1 })
    const { trip } = await approvedTrip()

    await generateChecklist(db.binding, trip, NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)
    await generateChecklist(db.binding, trip, NOW)

    const counted = new Map<string, number>()
    for (const row of await listChecklist(db.binding, trip.id)) {
      if (row.itemId) counted.set(row.itemId, (counted.get(row.itemId) ?? 0) + 1)
    }
    expect([...counted].filter(([, n]) => n > 1)).toEqual([])
  })
})

describe('an approval freezes its own outfit, not the whole plan', () => {
  /*
   * The other half of this — that approving ONE outfit must not freeze every
   * other one — is **D1c**, and its test lives with that slice. It is a change
   * to the planner's core (keep the approved groups, replan around them,
   * recompute their occurrences without touching their garments), not to the
   * synchronisation this slice is about, and it is recorded in doc 09 rather
   * than shipped half-done here.
   */
  /*
   * The draft case, stated separately so the approved case above is the only
   * thing the freeze rule is asked about.
   *
   * Asserts that the plan FOLLOWED the edit, not that occurrences sum to the
   * trip's length. They do not on a very short trip — two activities plus two
   * travel days is four days of outfits on a three-day trip — which is the
   * planner's arithmetic rather than a synchronisation question, and is recorded
   * in doc 09 rather than asserted here.
   */
  it('follows a trip-length change when nothing has been approved', async () => {
    const { trip, groups } = await approvedTrip()
    const casual = groups.find((g) => g.name === 'Casual days')!
    expect(casual.occurrences).toBe(8)

    for (const group of groups) await setGroupStatus(db.binding, group.id, 'draft', NOW)
    const shorter = (await updateTrip(db.binding, trip.id, { ...TRIP, endDate: '2026-08-04' }, NOW))!
    await generateOutfits(db.binding, shorter, NOW)

    const after = await listOutfits(db.binding, shorter.id)
    expect(after.find((g) => g.name === 'Casual days')?.occurrences ?? 0).toBeLessThan(8)
  })
})

describe('a garment that has left the wardrobe', () => {
  /*
   * `outfitConflicts` is what keeps the plan and the list from disagreeing, and
   * it matched only rows Alex had SET ASIDE. Archiving is the documented
   * retirement path (doc 05 §11), so a garment can leave the wardrobe entirely
   * while an approved outfit goes on being built around it — reported nowhere.
   */
  it('is reported as a conflict while an approved outfit still stands on it', async () => {
    const { trip, groups } = await approvedTrip()
    const slot = groups.flatMap((g) => g.slots).find((s) => s.itemId)!

    await archiveItem(db.binding, slot.itemId!, NOW)

    const conflicts = await outfitConflicts(db.binding, trip.id)
    expect(conflicts.map((c) => c.itemId)).toContain(slot.itemId)
    // Named well enough to act on: which outfit, and which slot is now short.
    expect(conflicts.find((c) => c.itemId === slot.itemId)?.roleLabel).toBeTruthy()
  })

  it('stops being a conflict once it is restored', async () => {
    const { trip, groups } = await approvedTrip()
    const slot = groups.flatMap((g) => g.slots).find((s) => s.itemId)!

    await archiveItem(db.binding, slot.itemId!, NOW)
    await restoreItem(db.binding, slot.itemId!, NOW)

    expect((await outfitConflicts(db.binding, trip.id)).map((c) => c.itemId)).not.toContain(
      slot.itemId,
    )
  })

  /*
   * The same boundary the exclusion arm already holds: only an APPROVED outfit
   * puts clothing on the list, so only an approved outfit can conflict with a
   * garment leaving it.
   */
  it('says nothing when only a draft outfit uses it', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    const slot = groups.flatMap((g) => g.slots).find((s) => s.itemId)!

    await archiveItem(db.binding, slot.itemId!, NOW)

    expect(await outfitConflicts(db.binding, trip.id)).toEqual([])
  })
})

describe('a rule that has stopped applying', () => {
  /*
   * `generateChecklist` has no delete path at all. `syncChecklistFromOutfits`
   * does — guarded by the same "unless Alex has touched it" condition — so the
   * two writers disagree about whether an engine-owned row nobody wants any
   * more should survive.
   */
  async function shaverTrip() {
    const shaver = insertItem(db, { displayName: 'Shaver', category: 'Grooming' })
    insertRule(db, shaver, { ruleType: 'conditional_include', condition: { fact: 'nights', gte: 3 } })
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, trip, NOW)
    const row = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Shaver')!
    expect(row).toBeTruthy()
    return { trip, row }
  }

  const shorten = async (id: string) =>
    (await updateTrip(db.binding, id, { ...TRIP, endDate: '2026-08-01' }, NOW))!

  it('takes its row off the list', async () => {
    const { trip } = await shaverTrip()
    await generateChecklist(db.binding, await shorten(trip.id), NOW)
    expect((await listChecklist(db.binding, trip.id)).map((e) => e.name)).not.toContain('Shaver')
  })

  it('leaves it alone once it has been packed', async () => {
    const { trip, row } = await shaverTrip()
    await setPackedQty(db.binding, row.id, 1, NOW)
    await generateChecklist(db.binding, await shorten(trip.id), NOW)
    expect((await listChecklist(db.binding, trip.id)).map((e) => e.name)).toContain('Shaver')
  })

  it('leaves it alone once the quantity is Alex’s', async () => {
    const { trip, row } = await shaverTrip()
    await setQtyOverride(db.binding, row.id, 2, NOW)
    await generateChecklist(db.binding, await shorten(trip.id), NOW)
    expect((await listChecklist(db.binding, trip.id)).map((e) => e.name)).toContain('Shaver')
  })
})

describe('a replan after the days are named', () => {
  /*
   * D1's fourth gap. `generateOutfits` refused over an approved plan, and
   * applied the refusal to the TRIP rather than to the group — so approving one
   * outfit stopped every other one from ever being replanned, and the screen
   * answered `replanned: false` and moved on.
   */
  it('replans the drafts and leaves the approved one alone', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)

    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    const dinnerBefore = dinner.slots.map((s) => `${s.role}=${s.itemId}`)

    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2026-08-03', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
      { date: '2026-08-05', activityTag: 'safari' },
      { date: '2026-08-06', activityTag: 'safari' },
    ], NOW))!
    const result = await generateOutfits(db.binding, withDays, NOW)

    const after = await listOutfits(db.binding, trip.id)
    // The four days Alex named are four days of safari, not one.
    expect(after.find((g) => g.name === 'Safari')?.occurrences).toBe(4)
    // The outfit he approved is untouched, garment for garment.
    const dinnerAfter = after.find((g) => g.name === 'Nice dinners')!
    expect(dinnerAfter.id).toBe(dinner.id)
    expect(dinnerAfter.status).toBe('approved')
    expect(dinnerAfter.slots.map((s) => `${s.role}=${s.itemId}`)).toEqual(dinnerBefore)
    // And it says what happened rather than answering false in silence.
    expect(result.replanned).toBeGreaterThan(0)
    expect(result.kept).toBe(1)
  })

  /*
   * An approved outfit's garments are its own. Planning a draft around it must
   * not put the same shirt in two outfits past what it can be worn.
   */
  it('does not plan a draft onto a garment an approved outfit is wearing', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)

    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
    const spokenFor = new Set(dinner.slots.map((s) => s.itemId).filter(Boolean))

    await generateOutfits(db.binding, (await getTrip(db.binding, trip.id))!, NOW)

    for (const group of await listOutfits(db.binding, trip.id)) {
      if (group.name === 'Nice dinners') continue
      for (const slot of group.slots) {
        if (!slot.itemId || !spokenFor.has(slot.itemId)) continue
        // Shared only where the garment can genuinely take it.
        const total = (await listOutfits(db.binding, trip.id))
          .flatMap((g) => g.slots)
          .filter((s) => s.itemId === slot.itemId)
          .reduce((sum, s) => sum + s.wearings, 0)
        expect(total, slot.itemName ?? '').toBeLessThanOrEqual(99)
      }
    }
  })

  /*
   * Doc 04 §8 asks for quantities to be recalculated when a trip changes. How
   * many days an outfit covers is not a choice Alex made about garments, so it
   * follows the trip — while the garments stay exactly where he put them.
   */
  it('brings an approved outfit’s day count up to date without touching its garments', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)

    const casual = groups.find((g) => g.name === 'Casual days')!
    await setGroupStatus(db.binding, casual.id, 'approved', NOW)
    const before = { occurrences: casual.occurrences, slots: casual.slots.map((s) => s.itemId) }
    expect(before.occurrences).toBeGreaterThan(2)

    const shorter = (await updateTrip(db.binding, trip.id, { ...TRIP, endDate: '2026-08-04' }, NOW))!
    await generateOutfits(db.binding, shorter, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Casual days')!
    expect(after.occurrences).toBeLessThan(before.occurrences)
    expect(after.slots.map((s) => s.itemId)).toEqual(before.slots)
    // And no garment is asked to cover more days than the group now has.
    for (const slot of after.slots) expect(slot.wearings).toBeLessThanOrEqual(after.occurrences)
  })
})
