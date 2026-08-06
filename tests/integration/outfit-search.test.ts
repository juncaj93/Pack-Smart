import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  setSlotItem,
  swapCandidates,
} from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, garment, seedWardrobe } from './wardrobe'

/**
 * G3 — the replacement sheet must reach the whole wardrobe.
 *
 * The complaint that produced this slice: replacing a `Layer` never offered a
 * jacket, because `swapCandidates` filtered the wardrobe down to the one
 * subcategory group the slot maps to and Alex never saw the rest of what he
 * owns. Doc 09 §6a asks for the recommendation to stay first and for a
 * deliberate way past it — "the app's job is to say a linen shirt is wrong for
 * the cold, not to make it unchoosable" (doc 04 §7).
 *
 * Two separate facts are proved here, and both were measured as broken first:
 *
 * 1. a garment from another slot is **absent**, not merely marked unsuitable;
 * 2. an explicit swap on a draft outfit is **discarded** by the next replan,
 *    even though the row already records `filled_by = 'user_swap'`.
 *
 * The second one is worth saying plainly, because doc 09 §6a's acceptance line
 * assumed it already held. It did not: `generateOutfits` deletes every group
 * that is not `approved` and plans it again from scratch, so the only choice
 * that survived a trip edit was one inside an outfit Alex had approved.
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)
  /*
   * A jacket and a mid-layer, added here rather than to the shared wardrobe.
   *
   * `seedWardrobe` is what several other files plan against, and an outer layer
   * appearing in it would change what the safari group comes out holding. The
   * garments this slice is about belong to this slice.
   */
  garment(db, { id: 'field-jacket', name: 'Field Jacket', subcategory: 'Outerwear', warmth: 3 })
  // Dressy, so it is what the Nice dinners template actually recommends for its
  // Layer — the slot has to have a right answer for "Alex overruled it" to mean
  // anything.
  garment(db, {
    id: 'fleece', name: 'Grey Fleece', subcategory: 'Mid-Layer',
    warmth: 2, dressiness: 3, uses: ['dressy'],
  })
})

afterEach(() => {
  db.close()
})

async function planned() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  return { trip, groups }
}

/** The Nice dinners group is the one whose template carries an optional `mid`. */
async function layerSlot() {
  const { trip, groups } = await planned()
  const dinner = groups.find((g) => g.name === 'Nice dinners')!
  const slot = dinner.slots.find((s) => s.role === 'mid')!
  return { trip, dinner, slot }
}

describe('searching the whole wardrobe from one slot', () => {
  it('finds a jacket from the Layer slot', async () => {
    const { dinner, slot } = await layerSlot()

    const { candidates } = await swapCandidates(db.binding, dinner.id, slot.id)
    const jacket = candidates.find((c) => c.item.id === 'field-jacket')

    // Present at all — this is the defect. Before G3 the list held only
    // mid-layers and the jacket could not be reached from here by any path.
    expect(jacket).toBeTruthy()
    // And honest about why it is not the recommendation.
    expect(jacket!.suitable).toBe(false)
    expect(jacket!.reason).toBeTruthy()
    expect(jacket!.inSlot).toBe(false)
  })

  it('says what a garment from another slot actually is', async () => {
    const { dinner, slot } = await layerSlot()

    const { candidates } = await swapCandidates(db.binding, dinner.id, slot.id)
    const jacket = candidates.find((c) => c.item.id === 'field-jacket')!
    const shoes = candidates.find((c) => c.item.id === 'shoes')!

    /*
     * The reason names the kind of garment, not the internal word for the slot.
     * "wrong kind of garment" is what `passesFilters` says to the planner and it
     * is useless on a screen: it does not tell Alex what the thing IS.
     */
    expect(jacket.reason).toMatch(/jacket/i)
    expect(jacket.reason).toMatch(/layer/i)
    expect(shoes.reason).toMatch(/shoes/i)
  })

  it('keeps the recommendation first', async () => {
    const { dinner, slot } = await layerSlot()

    const { candidates } = await swapCandidates(db.binding, dinner.id, slot.id)

    // Suitable first, then anything that belongs in this slot, then the rest.
    const rank = (c: (typeof candidates)[number]) =>
      c.suitable ? 0 : c.inSlot ? 1 : 2
    const ranks = candidates.map(rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))

    expect(candidates[0]?.item.id).toBe('fleece')
    expect(candidates[0]?.suitable).toBe(true)
    expect(candidates[0]?.inSlot).toBe(true)
  })

  it('still marks a garment that belongs in this slot as belonging in it', async () => {
    const { groups } = await planned()
    const dinner = groups.find((g) => g.name === 'Nice dinners')!
    const top = dinner.slots.find((s) => s.role === 'top')!

    const { candidates } = await swapCandidates(db.binding, dinner.id, top.id)

    // C2b's behaviour, unchanged: the casual tee is in the slot and unsuitable.
    const tee = candidates.find((c) => c.item.id === 'tee')!
    expect(tee.inSlot).toBe(true)
    expect(tee.suitable).toBe(false)
    expect(tee.reason).toBe('wrong level of dress')
    // And the dressy shirt is still the recommendation.
    expect(candidates[0]?.item.id).toBe('shirt')
  })

  it('never offers an archived garment, from any slot', async () => {
    db.raw.prepare('UPDATE item SET archived_at = ? WHERE id = ?').run(NOW, 'field-jacket')

    const { dinner, slot } = await layerSlot()
    const { candidates } = await swapCandidates(db.binding, dinner.id, slot.id)

    expect(candidates.find((c) => c.item.id === 'field-jacket')).toBeUndefined()
    // Reaching the whole wardrobe does not mean reaching the archive: the one
    // filter in `listActiveCandidates` still governs everything here.
    expect(candidates.every((c) => c.item.archivedAt === null)).toBe(true)
  })

  it('never offers something Alex said he never packs', async () => {
    db.raw.prepare('UPDATE item SET never_include = 1 WHERE id = ?').run('field-jacket')

    const { dinner, slot } = await layerSlot()
    const { candidates } = await swapCandidates(db.binding, dinner.id, slot.id)

    expect(candidates.find((c) => c.item.id === 'field-jacket')).toBeUndefined()
  })

  it('offers nothing that is not clothing', async () => {
    const { dinner, slot } = await layerSlot()
    const { candidates } = await swapCandidates(db.binding, dinner.id, slot.id)

    expect(candidates.every((c) => c.item.kind === 'clothing')).toBe(true)
  })
})

describe('an explicit choice, once made', () => {
  it('is not undone by the next replan of a draft outfit', async () => {
    const { trip, dinner, slot } = await layerSlot()

    // A deliberately unconventional choice: a jacket in the Layer slot.
    await setSlotItem(db.binding, slot.id, 'field-jacket', NOW)

    const before = (await listOutfits(db.binding, trip.id)).find((g) => g.id === dinner.id)!
    expect(before.slots.find((s) => s.role === 'mid')?.itemId).toBe('field-jacket')

    // Anything that edits the trip replans its drafts.
    await generateOutfits(db.binding, trip, NOW + 60)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Nice dinners')!
    const mid = after.slots.find((s) => s.role === 'mid')!
    expect(mid.itemId).toBe('field-jacket')
    expect(mid.reason).toBe('You chose this')
  })

  it('survives a replan that changes how many days the outfit covers', async () => {
    const { trip, slot } = await layerSlot()
    await setSlotItem(db.binding, slot.id, 'field-jacket', NOW)

    const longer = { ...trip, endDate: '2026-08-15' }
    await generateOutfits(db.binding, longer, NOW + 60)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Nice dinners')!
    expect(after.slots.find((s) => s.role === 'mid')?.itemId).toBe('field-jacket')
  })

  it('keeps a slot Alex deliberately emptied empty', async () => {
    const { trip, dinner } = await layerSlot()
    const top = dinner.slots.find((s) => s.role === 'top')!

    await setSlotItem(db.binding, top.id, null, NOW)
    await generateOutfits(db.binding, trip, NOW + 60)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Nice dinners')!
    // Emptying a required slot is a choice too, and the group says it is
    // incomplete rather than quietly refilling itself.
    expect(after.slots.find((s) => s.role === 'top')?.itemId).toBeNull()
    expect(after.status).toBe('incomplete')
  })

  it('gives the slot back to the planner when the chosen garment is archived', async () => {
    const { trip, slot } = await layerSlot()
    await setSlotItem(db.binding, slot.id, 'field-jacket', NOW)

    db.raw.prepare('UPDATE item SET archived_at = ? WHERE id = ?').run(NOW, 'field-jacket')
    await generateOutfits(db.binding, trip, NOW + 60)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Nice dinners')!
    const mid = after.slots.find((s) => s.role === 'mid')!
    /*
     * Restoring a choice Alex can no longer act on would put a garment he has
     * archived back into a plan. The planner's answer is used instead, and it is
     * never the archived one.
     */
    expect(mid.itemId).not.toBe('field-jacket')
  })

  it('does not resurrect a choice from an outfit that has left the plan', async () => {
    const { trip, slot } = await layerSlot()
    await setSlotItem(db.binding, slot.id, 'field-jacket', NOW)

    // The dinners are off. The group goes; so does the choice inside it.
    const withoutDinners = { ...trip, activities: ['safari'] }
    await generateOutfits(db.binding, withoutDinners, NOW + 60)

    const groups = await listOutfits(db.binding, trip.id)
    expect(groups.find((g) => g.name === 'Nice dinners')).toBeUndefined()
    expect(
      groups.some((g) => g.slots.some((s) => s.itemId === 'field-jacket' && s.role === 'mid')),
    ).toBe(false)
  })

  it('still leaves an approved outfit entirely alone', async () => {
    const { trip, dinner, slot } = await layerSlot()
    await setSlotItem(db.binding, slot.id, 'field-jacket', NOW)
    await setGroupStatus(db.binding, dinner.id, 'approved', NOW)

    await generateOutfits(db.binding, trip, NOW + 60)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.name === 'Nice dinners')!
    // D1c's rule, unchanged: the approved group's own row survives, id included.
    expect(after.id).toBe(dinner.id)
    expect(after.slots.find((s) => s.role === 'mid')?.itemId).toBe('field-jacket')
  })
})
