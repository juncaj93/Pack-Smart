import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { assignDays } from '@shared/during-trip'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { listActiveCandidates } from '../../worker/repos/items'
import {
  addSlotToGroup,
  createManualGroup,
  deleteManualGroup,
  generateOutfits,
  listOutfits,
  removeSlot,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Outfits Alex writes himself, against real SQL (§29, §30, §45, §46).
 *
 * ## Why this file is about the DELETE statement
 *
 * Everything that could go wrong here goes wrong in the replan, and it goes
 * wrong silently. `generateOutfits` deletes every group that is not approved
 * and plans the trip again, and it matches surviving groups to templates BY
 * NAME because ids are minted fresh on each run. Both of those are correct for
 * a planner group. For a group Alex wrote:
 *
 *   - the delete would remove `Lounging at hotel` the next time anything
 *     replanned, and nothing on any screen would say why;
 *   - the name match would merge a manual `Travel days` into the planner's own,
 *     so one author's garments would appear in the other's outfit.
 *
 * Neither is visible in a unit test of a pure function, because neither is in
 * one — they are in a `WHERE` clause. So every assertion below is made against
 * rows, after a real regeneration.
 *
 * Measured over the real workbook for the reason `smart-replan.test.ts` is: a
 * synthetic wardrobe with one garment per slot never produces the interference
 * these rules are about.
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'
const NOW = 1_780_000_000

const TRIP: TripInput = {
  name: 'Lisbon',
  startDate: '2026-09-10',
  endDate: '2026-09-14',
  destinations: [{ name: 'Lisbon', country: 'Portugal' }],
  activities: ['nice_dinner', 'casual_day'],
  international: true,
  laundryAvailable: false,
}

let db: TestDatabase

async function importWorkbook(): Promise<void> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((s) => /clothing/i.test(s.name))?.rows
  const gear = sheets.find((s) => /non-?clothing|rules|gear/i.test(s.name))?.rows
  expect(clothing && gear).toBeTruthy()

  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'seed.xlsx', clothing, gear }),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
}

/** A trip with a plan, ready for Alex to add an outfit of his own to. */
async function planned() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  await generateOutfits(db.binding, trip, NOW)
  return trip
}

/** Two garments Alex owns, for a lounging outfit that is a top and a bottom. */
async function loungewear() {
  const wardrobe = await listActiveCandidates(db.binding, 'clothing')
  const top = wardrobe.find((item) => item.subcategory?.toLowerCase() === 't-shirt')
  const bottom = wardrobe.find((item) => item.subcategory?.toLowerCase() === 'shorts')
  expect(top && bottom, 'the workbook has no t-shirt and shorts to build one from').toBeTruthy()
  return { top: top!, bottom: bottom! }
}

beforeEach(async () => {
  db = createTestDatabase()
  await importWorkbook()
})

afterEach(() => {
  db.close()
})

describe('an outfit Alex writes himself', () => {
  it('is two garments if he says so, and is not incomplete for it', async () => {
    const trip = await planned()
    const { top, bottom } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await addSlotToGroup(db.binding, groupId, bottom, NOW)

    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!
    expect(group.source).toBe('user')
    expect(group.slots).toHaveLength(2)

    /*
     * §28. A planner template would have demanded shoes and marked this
     * `incomplete` until it got them — which for an outfit Alex composed would
     * be the app inventing a requirement he never stated and then refusing to
     * let him approve it. Every slot he adds is one he chose to add, so none of
     * them can be missing.
     */
    expect(group.slots.every((slot) => slot.required)).toBe(false)
    expect(group.status).toBe('draft')

    // And it can be approved, which is the whole point of not being incomplete.
    await setGroupStatus(db.binding, groupId, 'approved', NOW)
    expect(
      (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!.status,
    ).toBe('approved')
  })

  it('takes the role from the garment rather than asking for it', async () => {
    const trip = await planned()
    const { top, bottom } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await addSlotToGroup(db.binding, groupId, bottom, NOW)

    // §21: the catalog already calls one a t-shirt and the other shorts, so
    // asking Alex which is the top would be a question about a fact the app has.
    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!
    expect(group.slots.map((slot) => slot.role)).toEqual(['top', 'bottom'])
  })

  it('puts its garments on the packing list when it is approved, like any other', async () => {
    const trip = await planned()
    const { top, bottom } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await addSlotToGroup(db.binding, groupId, bottom, NOW)
    await setGroupStatus(db.binding, groupId, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    /*
     * Through the SAME synchroniser, which is what §44 means by living in the
     * same authoritative domain. A manual outfit that maintained its own
     * clothing rows would be the second conflicting plan doc 04 §8 exists to
     * prevent.
     */
    const packed = new Set(
      (await listChecklist(db.binding, trip.id))
        .filter((entry) => entry.excludedAt === null)
        .map((entry) => entry.itemId),
    )
    expect(packed.has(top.id)).toBe(true)
    expect(packed.has(bottom.id)).toBe(true)
  })

  it('takes no day of the trip until Alex assigns one', async () => {
    const trip = await planned()
    const { top } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await setGroupStatus(db.binding, groupId, 'approved', NOW)

    const groups = await listOutfits(db.binding, trip.id)
    const spread = assignDays(
      trip.startDate,
      trip.endDate,
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        occurrences: g.occurrences,
        activityTag: g.activityTag,
        source: g.source,
      })),
      trip.days,
    )

    /*
     * §31. Left in the automatic spread it would consume a date and displace a
     * planned outfit off the end of the trip — so Today would dress him in
     * lounge clothes on a Tuesday he never nominated.
     */
    expect(spread.some((day) => day.outfitGroupId === groupId)).toBe(false)
    // And the planner's own outfits still get their days.
    expect(spread.some((day) => day.outfitGroupId !== null)).toBe(true)
  })
})

describe('what a replan is allowed to do to it', () => {
  it('does not delete it', async () => {
    const trip = await planned()
    const { top, bottom } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await addSlotToGroup(db.binding, groupId, bottom, NOW)

    // Never approved, so `status <> 'approved'` — the exact row the replan's
    // delete statement used to take out.
    await generateOutfits(db.binding, trip, NOW)

    const after = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)
    expect(after, 'the replan deleted an outfit Alex wrote').toBeTruthy()
    expect(after!.name).toBe('Lounging at hotel')
    expect(after!.slots.map((s) => s.itemId).sort()).toEqual([top.id, bottom.id].sort())
  })

  it('does not regenerate its garments, and does not duplicate it', async () => {
    const trip = await planned()
    const { top, bottom } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await addSlotToGroup(db.binding, groupId, bottom, NOW)

    await generateOutfits(db.binding, trip, NOW)
    await generateOutfits(db.binding, trip, NOW)

    const mine = (await listOutfits(db.binding, trip.id)).filter((g) => g.source === 'user')
    expect(mine, 'a replan duplicated a manual outfit').toHaveLength(1)
    expect(mine[0]!.slots).toHaveLength(2)
  })

  /*
   * §45, and the failure it names. This is the one that would have shipped
   * looking fine: two groups with the same display name, one authored by each
   * side, and a replan that identifies groups by name.
   */
  it('does not collide with a planner outfit that shares its name', async () => {
    const trip = await planned()
    const { top } = await loungewear()

    const planner = (await listOutfits(db.binding, trip.id)).find((g) => g.slots.length > 0)!
    const plannerGarments = planner.slots.map((s) => s.itemId)

    // The same display name as one the planner produced, which is exactly what
    // Alex would type if he wanted his own version of that occasion.
    const groupId = await createManualGroup(db.binding, trip.id, planner.name, NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)

    await generateOutfits(db.binding, trip, NOW)

    const groups = await listOutfits(db.binding, trip.id)
    const mine = groups.find((g) => g.id === groupId)
    expect(mine, 'the manual outfit was lost to a name collision').toBeTruthy()
    expect(mine!.slots.map((s) => s.itemId)).toEqual([top.id])

    /*
     * And the planner's own group of that name still exists, with the planner's
     * garments in it. The collision could destroy either side; both halves are
     * asserted because fixing one direction and not the other looks identical
     * from the screen.
     */
    const theirs = groups.filter((g) => g.name === planner.name && g.source === 'generated')
    expect(theirs, 'the planner lost its own outfit to the manual one').toHaveLength(1)
    expect(theirs[0]!.slots.some((s) => plannerGarments.includes(s.itemId))).toBe(true)
  })

  it('keeps a garment Alex chose out of the planner’s reach', async () => {
    const trip = await planned()
    const { top } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)

    await generateOutfits(db.binding, trip, NOW)

    /*
     * The garment is reserved rather than merely preserved. A planner outfit
     * that also chose it would produce a plan Alex cannot wear — two outfits,
     * one shirt, on days that may be the same day — and he never asked for his
     * choice to be reconsidered.
     */
    const others = (await listOutfits(db.binding, trip.id)).filter((g) => g.id !== groupId)
    expect(others.some((g) => g.slots.some((s) => s.itemId === top.id))).toBe(false)
  })

  it('still replans the drafts around it', async () => {
    const trip = await planned()
    const { top } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging at hotel', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)

    const before = (await listOutfits(db.binding, trip.id))
      .filter((g) => g.source === 'generated')
      .map((g) => g.id)

    await generateOutfits(db.binding, trip, NOW)

    /*
     * The other half of the guarantee, and the half a too-broad fix would
     * break: planner drafts are still deleted and made again, so their ids
     * change. A pass that protected manual outfits by refusing to replan
     * anything would satisfy every assertion above and this one alone catches
     * it.
     */
    const after = (await listOutfits(db.binding, trip.id))
      .filter((g) => g.source === 'generated')
      .map((g) => g.id)
    expect(after.length).toBeGreaterThan(0)
    expect(after.some((id) => before.includes(id))).toBe(false)
  })
})

describe('undoing it', () => {
  it('removes a slot without emptying it', async () => {
    const trip = await planned()
    const { top, bottom } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    const slotId = await addSlotToGroup(db.binding, groupId, bottom, NOW)

    await removeSlot(db.binding, slotId, NOW)

    /*
     * Gone, not blank. `setSlotItem(null)` empties a slot and keeps it, which
     * is right for a template slot — an empty `Shoes` on a planner outfit is a
     * gap worth showing. A slot Alex added has no template behind it, so a row
     * saying the outfit is short of something he never asked for would be the
     * app inventing a gap.
     */
    const group = (await listOutfits(db.binding, trip.id)).find((g) => g.id === groupId)!
    expect(group.slots).toHaveLength(1)
    expect(group.slots[0]!.itemId).toBe(top.id)
  })

  it('deletes an outfit Alex wrote, and refuses one the planner did', async () => {
    const trip = await planned()
    const { top } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    const planner = (await listOutfits(db.binding, trip.id)).find((g) => g.source === 'generated')!

    expect(await deleteManualGroup(db.binding, planner.id)).toBe(false)
    expect(await deleteManualGroup(db.binding, groupId)).toBe(true)

    const groups = await listOutfits(db.binding, trip.id)
    expect(groups.some((g) => g.id === groupId)).toBe(false)
    expect(groups.some((g) => g.id === planner.id)).toBe(true)
    // And no orphaned slots behind it.
    expect(
      (db.raw.prepare('SELECT count(*) AS n FROM outfit_slot WHERE outfit_group_id = ?').get(groupId) as { n: number })
        .n,
    ).toBe(0)
  })

  it('takes a garment off the packing list when the last outfit wearing it goes', async () => {
    const trip = await planned()
    const { top } = await loungewear()

    const groupId = await createManualGroup(db.binding, trip.id, 'Lounging', NOW)
    await addSlotToGroup(db.binding, groupId, top, NOW)
    await setGroupStatus(db.binding, groupId, 'approved', NOW)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const onList = (itemId: string) =>
      listChecklist(db.binding, trip.id).then((rows) =>
        rows.some((row) => row.itemId === itemId && row.excludedAt === null),
      )

    expect(await onList(top.id)).toBe(true)

    await deleteManualGroup(db.binding, groupId)
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    /*
     * Through the same synchroniser and the same ownership rules — a row Alex
     * had overridden or set aside would be left alone. This is the consequence
     * §23 asks to be REPORTED rather than a second removal path.
     */
    expect(await onList(top.id)).toBe(false)
  })
})
