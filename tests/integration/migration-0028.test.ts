import { afterEach, describe, expect, it } from 'vitest'
import { listChecklist } from '../../worker/repos/checklist'
import { getTrip } from '../../worker/repos/trips'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'

/**
 * Migration 0028, against the schema it will actually meet.
 *
 * Stood up at **0027** — production as it exists today — with a real trip, a
 * real checklist and a bag Alex chose already in it, and then upgraded. A
 * migration that has only ever run against an empty database is a migration
 * nobody has tested, and this one runs against Alex's only copy of his data.
 *
 * The claim it makes about itself is the one being tested: it adds one nullable
 * column and one table, rewrites no row, and every item already there reads as
 * "no learned preference" — which is the state the whole feature starts from.
 */

const PREVIOUS = '0027_replan_awareness.sql'
const NEW = '0028_learned_defaults.sql'

const TRIP = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
  laundryAvailable: false,
  flightHours: 11,
}

let db: TestDatabase

function gear(id: string) {
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                         typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'gear',?,'Travel Gear',0,'sometimes','[]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, id)
  db.raw
    .prepare(
      `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, condition_json,
                                 enabled, needs_review, original_text, created_at)
       VALUES (?,?,'fixed_per_trip',1,NULL,1,0,'test',1)`,
    )
    .run(`rule-${id}`, id)
}

/**
 * The schema as production has it, with a trip already lived in.
 *
 * Populated with raw SQL rather than through today's repositories, and that is
 * not a shortcut — it is the accurate model. `ENTRY_SELECT` reads
 * `i.default_bag` by name, so today's code CANNOT run against a database that
 * does not have it yet, in this test or in production. The deploy workflow
 * applies every migration before the Worker that reads them; these rows stand
 * for the ones the OLD code wrote before that happened.
 */
async function populated() {
  db = createTestDatabase({ upTo: PREVIOUS })
  gear('Sunglasses')
  gear('Adapter')

  db.raw
    .prepare(
      `INSERT INTO trip (id, name, start_date, end_date, status, notes_raw,
                         luggage_mode, laundry_available, max_dressiness, flight_hours,
                         international, created_at, updated_at)
       VALUES ('t1',?,?,?,'planning',NULL,NULL,0,NULL,11,1,1,1)`,
    )
    .run(TRIP.name, TRIP.startDate, TRIP.endDate)

  const row = (id: string, name: string, bag: string | null, source: string | null) =>
    db.raw
      .prepare(
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                      required_qty, packed_qty, packing_timing,
                                      requires_final_check, source, is_critical, trip_only,
                                      sort_order, bag, bag_source, created_at, updated_at)
         VALUES (?, 't1', ?, ?, 'Travel Gear', 1, 0, 'anytime', 0, 'always_packed', 0, 0, 0, ?, ?, 1, 1)`,
      )
      .run(id, name, name, bag, source)

  // One row carrying a bag Alex chose, which is the state most at risk from a
  // migration that rewrote anything.
  row('e1', 'Sunglasses', 'carry_on', 'user')
  row('e2', 'Adapter', null, null)

  return { tripId: 't1' }
}

const columns = (table: string) =>
  (db.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  )

afterEach(() => {
  db?.close()
})

describe('the schema before it', () => {
  it('has neither the column nor the table', async () => {
    await populated()

    expect(columns('item')).not.toContain('default_bag')
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).not.toContain('learning_decision')
  })
})

describe('after it runs', () => {
  it('adds exactly two objects and rewrites nothing', async () => {
    await populated()
    const before = db.raw
      .prepare('SELECT * FROM checklist_entry ORDER BY id')
      .all() as Array<Record<string, unknown>>
    const itemsBefore = db.raw.prepare('SELECT * FROM item ORDER BY id').all()

    applyMigration(db.raw, NEW)

    expect(columns('item')).toContain('default_bag')
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).toContain('learning_decision')

    // Every checklist row is byte-identical, including the bag Alex chose.
    const after = db.raw
      .prepare('SELECT * FROM checklist_entry ORDER BY id')
      .all() as Array<Record<string, unknown>>
    expect(after).toEqual(before)
    expect(before.length).toBeGreaterThan(0)
    expect(before.some((e) => e.bag === 'carry_on' && e.bag_source === 'user')).toBe(true)

    /*
     * The item rows, compared without the new column.
     *
     * A straight deep-equal would fail on the column that was just added, which
     * is not a rewrite — so the comparison drops it and asserts everything else
     * is byte-identical.
     */
    const itemsAfter = (db.raw.prepare('SELECT * FROM item ORDER BY id').all() as Array<
      Record<string, unknown>
    >).map(({ default_bag: _drop, ...rest }) => rest)
    expect(itemsAfter).toEqual(itemsBefore)
  })

  it('leaves every item with no learned preference', async () => {
    await populated()
    applyMigration(db.raw, NEW)

    const rows = db.raw.prepare('SELECT id, default_bag FROM item').all() as Array<{
      default_bag: string | null
    }>
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.default_bag).toBeNull()
  })

  it('starts with nothing declined', async () => {
    await populated()
    applyMigration(db.raw, NEW)

    const count = db.raw.prepare('SELECT COUNT(*) AS n FROM learning_decision').get() as {
      n: number
    }
    expect(count.n).toBe(0)
  })

  /* The column accepts the five `BagKey` values and refuses anything else. */
  it('accepts every bag the model has, and no invention', async () => {
    await populated()
    applyMigration(db.raw, NEW)

    for (const bag of ['wear', 'personal_item', 'carry_on', 'checked', 'either']) {
      expect(() =>
        db.raw.prepare('UPDATE item SET default_bag = ? WHERE id = ?').run(bag, 'Adapter'),
      ).not.toThrow()
    }

    expect(() =>
      db.raw.prepare('UPDATE item SET default_bag = ? WHERE id = ?').run('rucksack', 'Adapter'),
    ).toThrow()
  })

  it('records one decision per suggestion, replacing rather than accumulating', async () => {
    await populated()
    applyMigration(db.raw, NEW)

    const write = (decision: string) =>
      db.raw
        .prepare(
          `INSERT INTO learning_decision (subject, topic, decision, decided_at)
           VALUES ('Sunglasses','bag:carry_on',?,1)
           ON CONFLICT (subject, topic)
           DO UPDATE SET decision = excluded.decision`,
        )
        .run(decision)

    write('not_sure')
    write('declined')

    const rows = db.raw.prepare('SELECT * FROM learning_decision').all() as Array<{
      decision: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.decision).toBe('declined')

    // And a decision the code does not know how to honour is not storable.
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO learning_decision (subject, topic, decision, decided_at)
           VALUES ('x','y','accepted',1)`,
        )
        .run(),
    ).toThrow()
  })

  /* Today's repositories drive the upgraded schema, which is the real check. */
  it('reads through today’s repository once it is applied', async () => {
    const { tripId } = await populated()
    applyMigration(db.raw, NEW)

    const reloaded = await getTrip(db.binding, tripId)
    expect(reloaded).not.toBeNull()

    const rows = await listChecklist(db.binding, tripId)
    expect(rows.find((e) => e.name === 'Sunglasses')?.bag).toBe('carry_on')
    expect(rows.find((e) => e.name === 'Sunglasses')?.learnedBag).toBeNull()
  })
})
