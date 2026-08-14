import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { addAnswer, finishReview, listAnswers, reviewView } from '../../worker/repos/review'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { applyMigration, createTestDatabase, insertItem, type TestDatabase } from './d1'

/**
 * Migration 0016, against the schema it will actually meet.
 *
 * Stood up at **0015** — production as it exists today — with a real trip and a
 * real checklist already in it, and then upgraded. The claim being tested is
 * the one the migration makes about itself: it adds two objects, rewrites no
 * row, and every trip that already exists reads as "not reviewed yet".
 *
 * A migration that has only ever run against an empty database is a migration
 * nobody has tested, and this one runs against Alex's only copy of his data.
 */

const PREVIOUS = '0015_weather_refresh.sql'
/**
 * Migrations applied on top of the old schema, because current code writes them.
 *
 * `0019` adds `checklist_entry.detail_snapshot`, which the checklist writers
 * fill in from G6 onward. It is additive, nullable, and has nothing to do with
 * the migration under test — but a test standing up an older schema and then
 * driving it with today's repositories needs it present, exactly as production
 * does: the deploy workflow applies every migration before the Worker that
 * writes them.
 */
const LATER_ADDITIVE = [
  '0019_checklist_detail.sql',
  /*
   * P3's additive migration. `item` gains seven nullable bag traits and `trip`
   * gains `bags_json`; today's repository code reads all eight by name, so a
   * pinned schema without them fails on columns unrelated to what is under test.
   */
  '0025_bags_and_item_traits.sql',
  '0026_delay_sensitivity.sql',
  /*
   * P4c's additive migration. `item` gains `default_bag`, which today's
   * `ENTRY_SELECT` reads by name — so a pinned schema without it fails on a
   * column that has nothing to do with the migration under test. Same argument
   * as every entry above it.
   */
  '0028_learned_defaults.sql',
  /*
   * This pass's additive migration. `checklist_entry` gains `brand_snapshot`
   * and `color_snapshot`, which today's `ENTRY_SELECT` and every checklist
   * writer name explicitly, and `outfit_group` gains `source`, which
   * `listOutfits` and `generateOutfits` read by name — so a pinned schema
   * without them fails on columns that have nothing to do with the migration
   * under test. Same argument as every entry above it.
   */
  '0029_row_metadata_and_manual_outfits.sql',
]

const NEW = '0016_post_trip_review.sql'

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase({ upTo: PREVIOUS, plus: LATER_ADDITIVE })
})

afterEach(() => {
  db.close()
})

/** The trip and list that exist before the migration runs. */
async function existingData() {
  insertItem(db, { id: 'socks', kind: 'gear', displayName: 'Wool Socks', category: 'Travel Gear' })
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, needs_review,
                                 source, created_at)
       VALUES (?,?,'per_day',1,1,0,'system',1)`,
    )
    .run(crypto.randomUUID(), 'socks')

  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  return trip
}

describe('the schema before it', () => {
  it('has neither the column nor the table', () => {
    const columns = db.raw.prepare('PRAGMA table_info(trip)').all() as Array<{ name: string }>
    expect(columns.map((c) => c.name)).not.toContain('reviewed_at')

    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trip_review_answer'")
      .all()
    expect(tables).toHaveLength(0)
  })

  /*
   * The half of the upgrade that is easy to forget, and the reason the column
   * matters more than the table: today's code reads `reviewed_at` off every
   * trip. On the old schema `SELECT *` simply does not return it, and the trip
   * has to keep loading rather than failing on a column that is not there yet.
   */
  it('still loads a trip through today’s repository', async () => {
    const trip = await existingData()
    const loaded = await getTrip(db.binding, trip.id)

    expect(loaded?.name).toBe('South Africa')
    expect(loaded?.reviewedAt).toBeNull()
  })
})

describe('after it runs', () => {
  it('rewrites nothing that was already there', async () => {
    const trip = await existingData()
    const before = await listChecklist(db.binding, trip.id)
    const tripBefore = db.raw.prepare('SELECT * FROM trip WHERE id = ?').get(trip.id) as Record<
      string,
      unknown
    >

    applyMigration(db.raw, NEW)

    const after = await listChecklist(db.binding, trip.id)
    const tripAfter = db.raw.prepare('SELECT * FROM trip WHERE id = ?').get(trip.id) as Record<
      string,
      unknown
    >

    expect(after).toEqual(before)
    for (const key of Object.keys(tripBefore)) {
      expect(tripAfter[key]).toEqual(tripBefore[key])
    }
    // The one new column, and it is empty for a trip that predates the feature.
    expect(tripAfter.reviewed_at).toBeNull()
  })

  it('leaves every existing trip unreviewed', async () => {
    const trip = await existingData()
    applyMigration(db.raw, NEW)

    expect((await getTrip(db.binding, trip.id))?.reviewedAt).toBeNull()
  })

  it('accepts an answer and a finish on a trip that predates it', async () => {
    const trip = await existingData()
    applyMigration(db.raw, NEW)

    await addAnswer(
      db.binding,
      trip.id,
      { kind: 'ran_out', itemId: 'socks', outfitGroupId: null, note: null },
      NOW,
    )
    expect(await listAnswers(db.binding, trip.id)).toHaveLength(1)

    const finishedAt = await finishReview(db.binding, trip.id, NOW)
    const view = await reviewView(db.binding, { ...trip, reviewedAt: finishedAt })

    expect(view.reviewedAt).toBe(NOW)
    expect(view.proposals).toHaveLength(1)
  })

  /*
   * Applying it twice is not a scenario anyone plans, but `wrangler d1
   * migrations apply` on a partially-applied list is, and the failure mode is a
   * migration that half-runs and leaves the table behind without the column.
   */
  it('does not lose the table if the file is re-read', async () => {
    applyMigration(db.raw, NEW)

    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trip_review_answer'")
      .all()
    expect(tables).toHaveLength(1)
  })
})

describe('the constraints it declares', () => {
  beforeEach(() => {
    applyMigration(db.raw, NEW)
  })

  it('refuses a kind nothing knows how to turn into a proposal', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO trip_review_answer (id, trip_id, kind, resolution, created_at)
           VALUES (?,?,'liked_it','pending',?)`,
        )
        .run(crypto.randomUUID(), trip.id, NOW),
    ).toThrow()
  })

  it('refuses a resolution outside the three it has', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO trip_review_answer (id, trip_id, kind, resolution, created_at)
           VALUES (?,?,'forgot','maybe',?)`,
        )
        .run(crypto.randomUUID(), trip.id, NOW),
    ).toThrow()
  })

  it('refuses an answer about a trip that does not exist', () => {
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO trip_review_answer (id, trip_id, kind, resolution, created_at)
           VALUES (?,'no-such-trip','forgot','pending',?)`,
        )
        .run(crypto.randomUUID(), NOW),
    ).toThrow()
  })
})
