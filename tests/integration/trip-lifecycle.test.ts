import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { generateOutfits, setGroupStatus } from '../../worker/repos/outfits'
import {
  archiveTrip,
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  restoreTrip,
} from '../../worker/repos/trips'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * Archiving and deleting a trip.
 *
 * Deletion is the **only** thing in Pack Smart that destroys anything, so most of
 * this file is about what it does NOT touch. The rule it has to keep is that a
 * trip is a container, not an owner: the wardrobe, and what Pack Smart has learned
 * about which garments go together, belong to Alex rather than to any one trip.
 *
 * The `outfit_pairing` assertion is the load-bearing one. That table references
 * `item` and never `trip`, deliberately — but "deliberately" is a comment, and a
 * comment does not stop the next person adding a cascade.
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

/** A trip with a checklist, outfits, one approved, and a wear log entry. */
async function fullTrip(name = TRIP.name) {
  const trip = await createTrip(db.binding, { ...TRIP, name }, NOW)
  // `createTrip` stores the trip; the list is generated separately.
  await generateChecklist(db.binding, trip, NOW)
  const { groups } = await generateOutfits(db.binding, trip, NOW)
  const complete = groups.find((g) => g.status !== 'incomplete')
  if (complete) await setGroupStatus(db.binding, complete.id, 'approved', NOW)

  // A wear log row, which nothing else in this file creates.
  db.raw
    .prepare(
      `INSERT INTO wear_log (id, trip_id, item_id, worn_date, action, created_at)
       SELECT ?, ?, id, '2026-08-01', 'already_wore', ? FROM item LIMIT 1`,
    )
    .run(crypto.randomUUID(), trip.id, NOW)

  return trip
}

const count = (table: string, where = '', ...args: unknown[]) =>
  (
    db.raw.prepare(`SELECT count(*) c FROM ${table} ${where}`).get(...(args as never[])) as {
      c: number
    }
  ).c

describe('archiving puts a trip away without changing it', () => {
  it('marks it archived and leaves everything inside alone', async () => {
    const trip = await fullTrip()
    const before = {
      entries: count('checklist_entry', 'WHERE trip_id = ?', trip.id),
      groups: count('outfit_group', 'WHERE trip_id = ?', trip.id),
      slots: count('outfit_slot'),
      facts: count('trip_fact', 'WHERE trip_id = ?', trip.id),
    }
    expect(before.entries).toBeGreaterThan(0)

    const archived = await archiveTrip(db.binding, trip.id, NOW + 10)
    expect(archived?.archivedAt).toBe(NOW + 10)

    expect(count('checklist_entry', 'WHERE trip_id = ?', trip.id)).toBe(before.entries)
    expect(count('outfit_group', 'WHERE trip_id = ?', trip.id)).toBe(before.groups)
    expect(count('outfit_slot')).toBe(before.slots)
    expect(count('trip_fact', 'WHERE trip_id = ?', trip.id)).toBe(before.facts)
  })

  it('is still there, and still readable', async () => {
    const trip = await fullTrip()
    await archiveTrip(db.binding, trip.id, NOW + 10)

    // `CLAUDE.md`: archived inventory must remain visible on historical trips.
    // The trip itself is the same rule one level up.
    expect(await getTrip(db.binding, trip.id)).not.toBeNull()
    expect((await listChecklist(db.binding, trip.id)).length).toBeGreaterThan(0)
    expect((await listTrips(db.binding)).map((t) => t.id)).toContain(trip.id)
  })

  it('restores to exactly not-archived', async () => {
    const trip = await fullTrip()
    await archiveTrip(db.binding, trip.id, NOW + 10)
    const restored = await restoreTrip(db.binding, trip.id, NOW + 20)
    expect(restored?.archivedAt).toBeNull()
  })

  it('archiving twice does not move the date', async () => {
    /*
     * The guard is `AND archived_at IS NULL`. Without it a retry after a dropped
     * connection would quietly restamp the archive date, which is the sort of
     * thing nobody notices until they sort by it.
     */
    const trip = await fullTrip()
    await archiveTrip(db.binding, trip.id, NOW + 10)
    const again = await archiveTrip(db.binding, trip.id, NOW + 99)
    expect(again?.archivedAt).toBe(NOW + 10)
  })
})

describe('deleting a trip removes the trip, and only the trip', () => {
  it('takes every row that belonged to it', async () => {
    const trip = await fullTrip()
    expect(count('checklist_entry', 'WHERE trip_id = ?', trip.id)).toBeGreaterThan(0)
    expect(count('outfit_group', 'WHERE trip_id = ?', trip.id)).toBeGreaterThan(0)

    expect(await deleteTrip(db.binding, trip.id)).toBe(true)

    for (const table of [
      'checklist_entry',
      'outfit_group',
      'trip_fact',
      'trip_destination',
      'trip_event',
      'trip_weather',
      'wear_log',
      'daily_plan',
    ]) {
      expect(count(table, 'WHERE trip_id = ?', trip.id), `${table} kept a row`).toBe(0)
    }

    expect(await getTrip(db.binding, trip.id)).toBeNull()
  })

  it('leaves no orphaned outfit slot or link behind', async () => {
    const trip = await fullTrip()
    await deleteTrip(db.binding, trip.id)

    /*
     * Foreign keys are ON in this harness and in D1, so a bad delete order would
     * throw rather than orphan — but these assert the outcome directly, because a
     * future schema change could add a nullable link that fails silently instead.
     */
    expect(count('outfit_slot')).toBe(0)
    expect(count('checklist_link')).toBe(0)
  })

  it('does not touch the wardrobe', async () => {
    const items = count('item')
    const rules = count('packing_rule')
    expect(items).toBeGreaterThan(0)

    const trip = await fullTrip()
    await deleteTrip(db.binding, trip.id)

    // Deleting a trip must never cost Alex a garment.
    expect(count('item')).toBe(items)
    expect(count('packing_rule')).toBe(rules)
  })

  it('keeps what Pack Smart has learned about which garments go together', async () => {
    /*
     * The one that matters most.
     *
     * `outfit_pairing` is counted co-occurrence across every approved outfit Alex
     * has ever made (doc 04 §5 criterion 3). It outlives the trip that taught it,
     * and losing a year of it because one trip was tidied away would be the worst
     * kind of silent loss — invisible until recommendations quietly got worse.
     */
    const trip = await fullTrip()
    const learned = count('outfit_pairing')
    expect(learned, 'the fixture taught no pairings, so this proves nothing').toBeGreaterThan(0)

    await deleteTrip(db.binding, trip.id)

    expect(count('outfit_pairing')).toBe(learned)
  })

  it('leaves other trips completely alone', async () => {
    const keep = await fullTrip('Kept trip')
    const drop = await fullTrip('Dropped trip')

    const kept = {
      entries: count('checklist_entry', 'WHERE trip_id = ?', keep.id),
      groups: count('outfit_group', 'WHERE trip_id = ?', keep.id),
      facts: count('trip_fact', 'WHERE trip_id = ?', keep.id),
      destinations: count('trip_destination', 'WHERE trip_id = ?', keep.id),
      wears: count('wear_log', 'WHERE trip_id = ?', keep.id),
    }

    await deleteTrip(db.binding, drop.id)

    expect(count('checklist_entry', 'WHERE trip_id = ?', keep.id)).toBe(kept.entries)
    expect(count('outfit_group', 'WHERE trip_id = ?', keep.id)).toBe(kept.groups)
    expect(count('trip_fact', 'WHERE trip_id = ?', keep.id)).toBe(kept.facts)
    expect(count('trip_destination', 'WHERE trip_id = ?', keep.id)).toBe(kept.destinations)
    expect(count('wear_log', 'WHERE trip_id = ?', keep.id)).toBe(kept.wears)
    expect(await getTrip(db.binding, keep.id)).not.toBeNull()
  })

  it('says so rather than pretending, when there is no such trip', async () => {
    expect(await deleteTrip(db.binding, 'not-a-trip')).toBe(false)
  })

  it('deleting an archived trip works the same way', async () => {
    const trip = await fullTrip()
    await archiveTrip(db.binding, trip.id, NOW + 10)
    expect(await deleteTrip(db.binding, trip.id)).toBe(true)
    expect(await getTrip(db.binding, trip.id)).toBeNull()
  })
})
