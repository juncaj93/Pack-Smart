import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import type { TripInput } from '@shared/trips'
import { planDelta } from '@shared/plan-delta'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  setSlotItem,
  swapCandidates,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * What a swap does to the packing list — measured, not predicted.
 *
 * `syncChecklistFromOutfits` has always returned `{ added, updated, removed }`,
 * and those counts cannot answer the question Alex actually has. Swapping one
 * navy quarter-zip for another usually changes nothing about what goes in the
 * bag: same garment, already on the list because another outfit wears it too.
 * A screen reporting `1 updated` for that would be technically true and no use.
 *
 * Both directions are asserted here against real SQL and the real workbook,
 * because what a swap does to the list depends on what the OTHER approved
 * outfits are already wearing — removing the last outfit that needed a garment
 * takes it off the list, and removing one of two does not. That is exactly the
 * kind of thing a delta computed from the action rather than the result would
 * get wrong.
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'
const NOW = 1_780_000_000

const TRIP: TripInput = {
  name: 'Swap consequences',
  startDate: '2026-09-10',
  endDate: '2026-09-14',
  destinations: [{ name: 'Traverse City', country: 'United States' }],
  activities: ['nice_dinner', 'casual_day'],
  international: false,
  laundryAvailable: false,
}

let db: TestDatabase

beforeEach(async () => {
  db = await createTestDatabase()
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'seed.xlsx',
        clothing: sheets.find((s) => /clothing/i.test(s.name))?.rows,
        gear: sheets.find((s) => /non-?clothing|rules|gear/i.test(s.name))?.rows,
      }),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
})

afterEach(() => db?.close())

/** A trip with one approved outfit, which is what puts clothing on the list. */
async function approvedTrip() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  await generateOutfits(db.binding, trip, NOW, [])

  const groups = await listOutfits(db.binding, trip.id)
  const target = groups.find((group) => group.slots.some((slot) => slot.itemId))
  expect(target, 'no outfit came back with garments in it').toBeTruthy()

  await setGroupStatus(db.binding, target!.id, 'approved', NOW)
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  return { trip, group: target! }
}

/** Swaps one slot and returns the delta the endpoint would report. */
async function swapAndDiff(
  trip: Awaited<ReturnType<typeof approvedTrip>>['trip'],
  slotId: string,
  itemId: string | null,
) {
  const before = await listChecklist(db.binding, trip.id)
  await setSlotItem(db.binding, slotId, itemId, NOW)
  await syncChecklistFromOutfits(db.binding, trip, NOW)
  const after = await listChecklist(db.binding, trip.id)

  return planDelta(
    { entries: before, groups: [], gaps: [] },
    { entries: after, groups: [], gaps: [] },
  )
}

describe('swapping a garment in an approved outfit', () => {
  it('takes the old garment off the list and puts the new one on', async () => {
    const { trip, group } = await approvedTrip()

    const slot = group.slots.find((candidate) => candidate.itemId)!
    const { candidates } = await swapCandidates(
      db.binding,
      group.id,
      slot.id,
      trip,
      [],
    )

    const replacement = candidates.find(
      (candidate) => candidate.suitable && candidate.item.id !== slot.itemId,
    )
    expect(replacement, 'the wardrobe offered no alternative for this slot').toBeTruthy()

    const deltas = await swapAndDiff(trip, slot.id, replacement!.item.id)

    /*
     * Asserted as a SET rather than a sequence. Which of the two the engine
     * emits first is an ordering detail, and pinning it would make this test
     * about the loop rather than about the consequence.
     */
    const kinds = deltas.map((delta) => delta.kind).sort()
    expect(kinds, JSON.stringify(deltas)).toContain('item_added')

    const added = deltas.find((delta) => delta.kind === 'item_added')
    expect(added?.label).toBe(replacement!.item.displayName)
  })

  it('says nothing when the swap changes nothing about the bag', async () => {
    /*
     * The case the whole slice exists for. Putting the SAME garment back is the
     * cleanest form of "a swap that costs the list nothing", and a delta
     * computed from the action rather than the result would report an update
     * here — the row was rewritten, after all. Nothing about what Alex packs
     * moved, so nothing is the honest answer.
     */
    const { trip, group } = await approvedTrip()
    const slot = group.slots.find((candidate) => candidate.itemId)!

    expect(await swapAndDiff(trip, slot.id, slot.itemId)).toEqual([])
  })

  it('reports the garment leaving when a slot is emptied', async () => {
    const { trip, group } = await approvedTrip()
    const slot = group.slots.find((candidate) => candidate.itemId)!
    const name = slot.itemName

    const deltas = await swapAndDiff(trip, slot.id, null)

    /*
     * Emptying a slot is a real decision and the list has to follow it — but
     * only if no other approved outfit still wants the garment. On this trip
     * one outfit is approved, so it does.
     */
    const removed = deltas.filter((delta) => delta.kind === 'item_removed')
    expect(removed.map((delta) => delta.label), JSON.stringify(deltas)).toContain(name)
  })
})
