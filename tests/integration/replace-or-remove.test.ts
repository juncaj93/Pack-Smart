import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { excludeEntry, listChecklist, restoreEntry } from '../../worker/repos/checklist'
import {
  generateOutfits,
  listOutfits,
  outfitConflicts,
  outfitsUsingItem,
  setGroupStatus,
  setSlotItem,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import type { ChecklistEntry } from '@shared/checklist'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * Doc 04 §8: taking clothing off the packing list must name the outfits that
 * relied on it, offer a replacement, and leave anything still unresolved marked
 * incomplete — because "the user must never maintain two conflicting clothing
 * plans".
 *
 * The tests below were written before the feature, and the one that mattered
 * most was the undo. An implementation that answers §8 by *editing* the approved
 * outfit — clearing the slot when the garment leaves the list — has to put that
 * slot back on restore, from state it has already thrown away. Every test here
 * that exercises exclude also exercises restore, and asserts the stored plan was
 * never touched at all: the marking is derived from the checklist, so the two
 * halves cannot disagree and undo has nothing to miss.
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

/** A trip whose Nice dinners outfit is approved and on the checklist. */
async function dinnerApproved() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  const dinner = groups.find((g) => g.name === 'Nice dinners')!

  await setGroupStatus(db.binding, dinner.id, 'approved', NOW)
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  return { trip, dinner, entries: await listChecklist(db.binding, trip.id) }
}

const row = (entries: ChecklistEntry[], name: string) => entries.find((e) => e.name === name)!

const storedStatus = (groupId: string) =>
  (db.raw.prepare('SELECT status FROM outfit_group WHERE id = ?').get(groupId) as { status: string })
    .status

const storedSlotItem = (slotId: string) =>
  (db.raw.prepare('SELECT item_id FROM outfit_slot WHERE id = ?').get(slotId) as {
    item_id: string | null
  }).item_id

describe('naming the outfits that rely on a garment', () => {
  it('names the outfit and the slot a replacement would fill', async () => {
    const { trip, dinner } = await dinnerApproved()
    const top = dinner.slots.find((s) => s.role === 'top')!

    const affected = await outfitsUsingItem(db.binding, trip.id, 'shirt')

    expect(affected).toHaveLength(1)
    expect(affected[0]).toMatchObject({
      groupId: dinner.id,
      name: 'Nice dinners',
      slotId: top.id,
      roleLabel: 'Top',
    })
  })

  /*
   * The defect this slice opened with.
   *
   * The query carried no status filter while its own comment said "approved", so
   * a plan Alex had not signed off on was reported as depending on the garment —
   * and a draft outfit is not on the checklist at all, so there is nothing to
   * conflict with.
   */
  it('says nothing while the outfit is still a draft', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateOutfits(db.binding, trip, NOW)

    expect(await outfitsUsingItem(db.binding, trip.id, 'shirt')).toEqual([])
  })

  it('says nothing about a garment no outfit uses', async () => {
    const { trip } = await dinnerApproved()
    garment(db, {
      id: 'spare-shirt', name: 'Blue Oxford', subcategory: 'Shirt',
      dressiness: 3, uses: ['dressy'],
    })

    expect(await outfitsUsingItem(db.binding, trip.id, 'spare-shirt')).toEqual([])
  })
})

describe('setting a garment aside, and undoing it', () => {
  it('marks the approved outfit incomplete, naming the garment', async () => {
    const { trip, dinner, entries } = await dinnerApproved()
    await excludeEntry(db.binding, row(entries, 'White Oxford').id, NOW)

    const conflicts = await outfitConflicts(db.binding, trip.id)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      groupId: dinner.id,
      groupName: 'Nice dinners',
      itemId: 'shirt',
      itemName: 'White Oxford',
      roleLabel: 'Top',
    })
  })

  it('shows the slot itself as one Alex is not bringing', async () => {
    const { trip, dinner, entries } = await dinnerApproved()
    await excludeEntry(db.binding, row(entries, 'White Oxford').id, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === dinner.id)!
    expect(after.slots.find((s) => s.itemId === 'shirt')?.setAside).toBe(true)
    expect(after.slots.find((s) => s.itemId === 'dress-pants')?.setAside).toBe(false)
  })

  /*
   * The test this slice was told to write first.
   *
   * Exclude and restore are single flag flips on the checklist row. Nothing in
   * the outfit is edited, so undo cannot leave the two plans disagreeing — this
   * asserts that end to end rather than trusting it.
   */
  it('puts both plans back in step when the removal is undone', async () => {
    const { trip, dinner, entries } = await dinnerApproved()
    const oxford = row(entries, 'White Oxford')

    await excludeEntry(db.binding, oxford.id, NOW)
    expect(await outfitConflicts(db.binding, trip.id)).toHaveLength(1)

    await restoreEntry(db.binding, oxford.id, NOW)

    expect(await outfitConflicts(db.binding, trip.id)).toEqual([])

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === dinner.id)!
    expect(after.slots.every((s) => !s.setAside)).toBe(true)
    expect(after.slots.find((s) => s.role === 'top')?.itemId).toBe('shirt')
    expect(after.status).toBe('approved')

    const back = row(await listChecklist(db.binding, trip.id), 'White Oxford')
    expect(back.excludedAt).toBeNull()
  })

  it('never rewrites the approval or the slot it was standing on', async () => {
    const { dinner, entries } = await dinnerApproved()
    const top = dinner.slots.find((s) => s.role === 'top')!

    await excludeEntry(db.binding, row(entries, 'White Oxford').id, NOW)

    // Approval is Alex's decision. Taking a garment off the list is a statement
    // about the suitcase, not a withdrawal of the plan.
    expect(storedStatus(dinner.id)).toBe('approved')
    expect(storedSlotItem(top.id)).toBe('shirt')
  })

  /*
   * The cascade this design exists to avoid.
   *
   * `syncChecklistFromOutfits` rebuilds the clothing rows from the groups it
   * finds approved, and runs on every later approval or swap. Had the exclusion
   * flipped the group's stored status to `incomplete`, that sync would have
   * quietly taken the trousers and the loafers off the list too — a garment
   * removed on Tuesday emptying the rest of the outfit on Thursday.
   */
  it('never takes the outfit’s other garments off the list', async () => {
    const { trip, entries } = await dinnerApproved()
    await excludeEntry(db.binding, row(entries, 'White Oxford').id, NOW)

    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const after = await listChecklist(db.binding, trip.id)
    expect(row(after, 'Charcoal Trousers').excludedAt).toBeNull()
    expect(row(after, 'Leather Loafers').excludedAt).toBeNull()
  })

  it('clears the conflict when the garment is replaced rather than restored', async () => {
    const { trip, dinner, entries } = await dinnerApproved()
    const top = dinner.slots.find((s) => s.role === 'top')!
    garment(db, {
      id: 'spare-shirt', name: 'Blue Oxford', subcategory: 'Shirt',
      dressiness: 3, uses: ['dressy'],
    })

    await excludeEntry(db.binding, row(entries, 'White Oxford').id, NOW)
    await setSlotItem(db.binding, top.id, 'spare-shirt', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    expect(await outfitConflicts(db.binding, trip.id)).toEqual([])

    const after = await listChecklist(db.binding, trip.id)
    expect(row(after, 'Blue Oxford').excludedAt).toBeNull()
    // Still not bringing it. Replacing the garment in the outfit does not
    // reverse the decision that started this.
    expect(row(after, 'White Oxford').excludedAt).toBe(NOW)
    expect(storedStatus(dinner.id)).toBe('approved')
  })

  it('says nothing when the garment belongs only to a draft outfit', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    const safari = groups.find((g) => g.name === 'Safari')!
    const top = safari.slots.find((s) => s.role === 'top' && s.itemId)!

    // A garment with a packing rule of its own reaches the list without any
    // outfit approving it. Setting that aside conflicts with nothing.
    db.raw
      .prepare(
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                      required_qty, packed_qty, packing_timing, requires_final_check,
                                      source, is_critical, trip_only, sort_order, created_at, updated_at)
         VALUES ('rule-row',?,?,?,'Tops & Outerwear',1,0,'anytime',0,'trip_triggered',0,0,0,1,1)`,
      )
      .run(trip.id, top.itemId, top.itemName)

    await excludeEntry(db.binding, 'rule-row', NOW)

    expect(await outfitConflicts(db.binding, trip.id)).toEqual([])
    expect(await outfitsUsingItem(db.binding, trip.id, top.itemId!)).toEqual([])
  })
})
