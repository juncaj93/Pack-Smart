import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateOutfits, listOutfits, setGroupStatus, undoRemembered } from '../../worker/repos/outfits'
import { loadPairings } from '../../worker/repos/pairings'
import { createTrip } from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The saved-outfit ledger, against real SQL.
 *
 * Counts that drift are the failure mode here: an approval counted twice, or an
 * un-approval that leaves its pairing behind, would quietly bias every future
 * trip with something Alex never did. Nothing on screen would say so.
 */

const NOW = 1_780_000_000

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-08-01',
  endDate: '2026-08-03',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
}

let db: TestDatabase

function garment(id: string, subcategory: string) {
  const category =
    subcategory === 'Shoes' ? 'Footwear' : subcategory === 'Pants' ? 'Bottoms & Swimwear' : 'Tops & Outerwear'
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, favorite, usage_frequency,
                         warmth, dressiness, typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'clothing',?,?,?,0,'sometimes',NULL,1,'["casual"]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, id, category, subcategory)
  return id
}

function stockWardrobe() {
  for (let i = 1; i <= 4; i += 1) garment(`tee${i}`, 'T-Shirt')
  garment('pants', 'Pants')
  garment('shoes', 'Shoes')
}

/** Every pairing row, for asserting on the ledger directly. */
function rows() {
  return db.raw
    .prepare('SELECT item_a_id, item_b_id, times_approved FROM outfit_pairing ORDER BY item_a_id, item_b_id')
    .all() as Array<{ item_a_id: string; item_b_id: string; times_approved: number }>
}

async function approvedGroup() {
  stockWardrobe()
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateOutfits(db.binding, trip, NOW)
  const group = (await listOutfits(db.binding, trip.id))[0]!
  return { trip, group }
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('approving records what was worn together', () => {
  it('writes a row per pair of garments in the outfit', async () => {
    const { group } = await approvedGroup()
    expect(rows()).toHaveLength(0)

    const result = await setGroupStatus(db.binding, group.id, 'approved', NOW)

    expect(result.remembered).toBe(true)
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().every((r) => r.times_approved === 1)).toBe(true)
  })

  // Canonical ordering: one row per pair, however it is looked up.
  it('stores each pair once, with the lower id first', async () => {
    const { group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    for (const row of rows()) {
      expect(row.item_a_id < row.item_b_id).toBe(true)
    }
    const keys = rows().map((r) => `${r.item_a_id} ${r.item_b_id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  /*
   * The transition, not the requested status. Tapping approve on something
   * already approved is a no-op, and must not inflate the counts — that would
   * let Alex manufacture a strong preference by tapping twice.
   */
  it('does not count a second time when the outfit is already approved', async () => {
    const { group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)
    const first = rows()

    const again = await setGroupStatus(db.binding, group.id, 'approved', NOW)

    expect(again.remembered).toBe(false)
    expect(rows()).toEqual(first)
  })

  it('says nothing was remembered when it was not', async () => {
    const { group } = await approvedGroup()
    const result = await setGroupStatus(db.binding, group.id, 'draft', NOW)
    expect(result.remembered).toBe(false)
  })
})

describe('what is taken back', () => {
  /*
   * The record must not outlive the approval it came from. Leaving the pairing
   * behind would mean Pack Smart kept acting on something Alex withdrew.
   */
  it('un-approving forgets exactly what approving learned', async () => {
    const { group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)
    expect(rows().length).toBeGreaterThan(0)

    await setGroupStatus(db.binding, group.id, 'draft', NOW)

    expect(rows()).toHaveLength(0)
  })

  it('un-approving one approval of two leaves the other standing', async () => {
    const { group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)
    await setGroupStatus(db.binding, group.id, 'draft', NOW)
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    expect(rows().every((r) => r.times_approved === 1)).toBe(true)
  })

  it('Undo removes the pairing without touching the approval', async () => {
    const { trip, group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    await undoRemembered(db.binding, group.id)

    expect(rows()).toHaveLength(0)
    // The outfit is still approved — Alex kept the outfit, declined the habit.
    expect((await listOutfits(db.binding, trip.id)).find((g) => g.id === group.id)?.status).toBe(
      'approved',
    )
  })

  /*
   * A count cannot go negative. Undo twice — a double tap, a retried request —
   * must not invert a pairing into something that quietly repels two garments.
   */
  it('cannot be driven below zero by undoing twice', async () => {
    const { group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    await undoRemembered(db.binding, group.id)
    await undoRemembered(db.binding, group.id)

    expect(rows()).toHaveLength(0)
    const index = await loadPairings(db.binding)
    expect(index.count('tee1', 'pants')).toBe(0)
  })
})

describe('the index handed to the planner', () => {
  it('reads back what approving wrote, in both directions', async () => {
    const { group } = await approvedGroup()
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    const index = await loadPairings(db.binding)
    const [first] = rows()

    expect(index.count(first!.item_a_id, first!.item_b_id)).toBe(1)
    expect(index.count(first!.item_b_id, first!.item_a_id)).toBe(1)
  })

  it('is empty and harmless before anything has been approved', async () => {
    const index = await loadPairings(db.binding)
    expect(index.count('tee1', 'pants')).toBe(0)
  })
})

/*
 * The claim the whole feature makes, end to end: what Alex approved on one trip
 * changes what a LATER trip suggests. Everything above tests a piece; this tests
 * the promise.
 */
describe('one trip teaching the next', () => {
  const SECOND: TripInput = { ...TRIP, name: 'Namibia', startDate: '2026-10-01', endDate: '2026-10-03' }

  /** The trousers chosen for a trip's first outfit. */
  async function chosenBottom(trip: Awaited<ReturnType<typeof createTrip>>) {
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    return groups[0]!.slots.find((s) => s.role === 'bottom')?.itemId ?? null
  }

  /*
   * Constructed so the answer CHANGES, and aimed at a slot the pairing can
   * actually reach.
   *
   * Slots fill in order and the FIRST garment has nothing to pair with yet
   * (doc 04 §5, "anchor first, then coordinate"), so a pairing never decides the
   * top. It decides what is chosen to go WITH the top. An earlier version of
   * this test asserted on the tee and failed for exactly that reason — the test
   * was wrong, not the engine.
   *
   * Making a rival pair of trousers the ones Alex wears MOST gives the second
   * trip a reason to switch. Only the recorded pairing stops it.
   *
   * That rival used to be a favourite. Favorite is retired (H1d), so the test
   * now leans on `You wear it often` — which sits in exactly the same place
   * relative to `You wear these together`, one rung below it, and is therefore
   * the same measurement of the same precedence.
   */
  it('overrides how often he wears it, in a slot chosen after the anchor', async () => {
    stockWardrobe()
    garment('chinos', 'Pants') // a second bottom, so the slot has a choice

    const first = await createTrip(db.binding, TRIP, NOW)
    await generateOutfits(db.binding, first, NOW)
    const group = (await listOutfits(db.binding, first.id))[0]!
    const approvedBottom = group.slots.find((s) => s.role === 'bottom')!.itemId!
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    const anchorTee = group.slots.find((s) => s.role === 'top')!.itemId!
    expect((await loadPairings(db.binding)).count(anchorTee, approvedBottom)).toBe(1)

    // The other trousers become the frequently worn ones — normally enough to win.
    const rival = approvedBottom === 'pants' ? 'chinos' : 'pants'
    db.raw.prepare("UPDATE item SET usage_frequency = 'frequent' WHERE id = ?").run(rival)

    // Control: with no pairing on record, the frequently worn pair does win.
    db.raw.prepare('DELETE FROM outfit_pairing').run()
    const control = await createTrip(db.binding, { ...SECOND, name: 'Control' }, NOW)
    expect(await chosenBottom(control)).toBe(rival)

    // Restore the pairing, and the approved partner beats the frequent one.
    await setGroupStatus(db.binding, group.id, 'draft', NOW)
    await setGroupStatus(db.binding, group.id, 'approved', NOW)

    const second = await createTrip(db.binding, SECOND, NOW)
    expect(await chosenBottom(second)).toBe(approvedBottom)
  })

  /*
   * The counterpart, and the one that proves the effect above came from the
   * pairing rather than from the ranking being deterministic anyway: take the
   * pairing back, and the second trip stops being influenced by it.
   */
  it('stops influencing later trips once the approval is withdrawn', async () => {
    stockWardrobe()

    const first = await createTrip(db.binding, TRIP, NOW)
    await generateOutfits(db.binding, first, NOW)
    const group = (await listOutfits(db.binding, first.id))[0]!

    await setGroupStatus(db.binding, group.id, 'approved', NOW)
    expect((await loadPairings(db.binding)).count('tee1', 'pants')).toBeGreaterThanOrEqual(0)

    await setGroupStatus(db.binding, group.id, 'draft', NOW)

    // Nothing on record means nothing to apply — the index is empty again.
    const index = await loadPairings(db.binding)
    for (const tee of ['tee1', 'tee2', 'tee3', 'tee4']) {
      expect(index.count(tee, 'pants')).toBe(0)
      expect(index.count(tee, 'shoes')).toBe(0)
    }
  })
})
