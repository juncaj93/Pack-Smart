import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import {
  applyMigration,
  createTestDatabase,
  migrationFiles,
  type TestDatabase,
} from './d1'

/**
 * Migration 0011 against the three databases that actually exist.
 *
 * A migration tested only against an empty schema is a migration nobody has
 * tested: the rows it has to survive are the ones that were already there. So
 * this runs it three ways —
 *
 *   1. a **clean database**, every migration in order, which is what a fresh
 *      clone and CI get;
 *   2. the **current production schema**, stood up at 0010 and then migrated,
 *      with rows in it that predate the new columns;
 *   3. **production-like data**, the real 119-row workbook imported through the
 *      real endpoint, then a real trip generated from it.
 *
 * The claim being defended in all three is the same and is Alex's: *existing
 * seeded rules retain their current behaviour after migration.*
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'

/** The last migration before this release. See §2 below for why it is named. */
const PREVIOUS_MIGRATION = '0010_trip_archive.sql'

/**
 * Migrations applied on top of the old schema, because current code reads them.
 *
 * `0015` adds `trip_destination.timezone`, which `getTrip` now selects by name.
 * It is additive, nullable, and has nothing to do with the migration under test
 * — but a test standing up an older schema and then driving it with today's
 * repositories needs it present, exactly as production does: the deploy workflow
 * applies every migration before the Worker that reads them.
 */
const LATER_ADDITIVE = [
  '0015_weather_refresh.sql',
  '0019_checklist_detail.sql',
  '0020_item_field_provenance.sql',
  '0021_comfort_versatility.sql',
]

const NEW_MIGRATION = '0011_rule_source.sql'

const NOW = 1_800_000_000

/** The approved worked example: 31 Jul – 11 Aug, 12 days, 11 nights, abroad. */
const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'nice_dinner'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

let db: TestDatabase | null = null

afterEach(() => {
  db?.close()
  db = null
})

function columnsOf(raw: DatabaseSync, table: string): Record<string, { notnull: number; dflt: string | null }> {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string
    notnull: number
    dflt_value: string | null
  }>
  return Object.fromEntries(rows.map((r) => [r.name, { notnull: r.notnull, dflt: r.dflt_value }]))
}

/* ------------------------------------------------------------------ */
/* 1. a clean database                                                 */
/* ------------------------------------------------------------------ */

describe('a clean database', () => {
  it('applies every migration in order and ends with the new columns', () => {
    db = createTestDatabase()
    const columns = columnsOf(db.raw, 'packing_rule')

    expect(columns.source).toBeDefined()
    expect(columns.source?.notnull).toBe(1)
    expect(columns.source?.dflt).toBe("'system'")
    expect(columns.supersedes_rule_id).toBeDefined()
  })

  it('refuses a source nobody approved, and accepts the three that are', () => {
    db = createTestDatabase()
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, source, created_at, updated_at)
         VALUES ('i','gear','Thing','Travel Gear','manual',1,1)`,
      )
      .run()

    const insert = (id: string, source: string) =>
      db!.raw
        .prepare(
          `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, source, created_at)
           VALUES (?, 'i', 'fixed_per_trip', 1, 1, ?, 1)`,
        )
        .run(id, source)

    for (const source of ['system', 'user', 'learned']) insert(`ok-${source}`, source)
    // `learned` is admitted by the CHECK before anything writes it, so adding
    // an approved source later is a migration rather than a table rebuild.
    expect(() => insert('bad', 'whatever')).toThrow(/CHECK/)
  })

  it('will not let two rules replace the same default', () => {
    // The reason precedence never has to ask which row came first: a default
    // cannot collect two competing overrides in the first place.
    db = createTestDatabase()
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, source, created_at, updated_at)
         VALUES ('i','gear','Thing','Travel Gear','manual',1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, source, created_at)
         VALUES ('base','i','fixed_per_trip',1,1,'system',1)`,
      )
      .run()

    const override = (id: string) =>
      db!.raw
        .prepare(
          `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, source,
                                     supersedes_rule_id, created_at)
           VALUES (?, 'i', 'fixed_per_trip', 2, 1, 'user', 'base', 1)`,
        )
        .run(id)

    override('first')
    expect(() => override('second')).toThrow(/UNIQUE/)
  })

  it('cannot point at a default that does not exist', () => {
    db = createTestDatabase()
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, source, created_at, updated_at)
         VALUES ('i','gear','Thing','Travel Gear','manual',1,1)`,
      )
      .run()

    expect(() =>
      db!.raw
        .prepare(
          `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, source,
                                     supersedes_rule_id, created_at)
           VALUES ('orphan','i','fixed_per_trip',2,1,'user','no-such-rule',1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/)
  })
})

/* ------------------------------------------------------------------ */
/* 2. the schema production is on today                                */
/* ------------------------------------------------------------------ */

describe('the current production schema, migrated forward', () => {
  /*
   * `PREVIOUS_MIGRATION` is asserted rather than assumed. If someone updates
   * this constant carelessly, the "migrate an existing database" test would
   * quietly become "migrate a database that already had the columns" — which
   * passes and proves nothing.
   *
   * ADJACENCY, not "0011 is the last file". The original form asserted the
   * latter and broke the moment 0012 landed, which made a guard about THIS
   * migration fail for a reason that had nothing to do with it — the kind of
   * false alarm that teaches people to edit the assertion rather than read it.
   * What the test above actually needs is that nothing has been inserted
   * between the two, and that is what this says.
   */
  it('runs immediately after the migration it is tested against', () => {
    const files = migrationFiles()
    const previous = files.indexOf(PREVIOUS_MIGRATION)
    expect(previous).toBeGreaterThanOrEqual(0)
    expect(files[previous + 1]).toBe(NEW_MIGRATION)
  })

  function atPreviousSchema(): TestDatabase {
    return createTestDatabase({ upTo: PREVIOUS_MIGRATION, plus: LATER_ADDITIVE })
  }

  it('leaves every rule that was already there behaving exactly as it did', async () => {
    db = atPreviousSchema()

    // Rows written by the OLD code, before the columns existed.
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, source, created_at, updated_at)
         VALUES ('underwear','clothing','Underwear','Accessories & Undergarments','seed_import',1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled,
                                   original_text, needs_review, created_at)
         VALUES ('seeded','underwear','per_day',2,1,'Saved preference: 2 per trip day',0,1)`,
      )
      .run()

    applyMigration(db.raw, NEW_MIGRATION)

    const row = db.raw
      .prepare('SELECT source, supersedes_rule_id FROM packing_rule WHERE id = ?')
      .get('seeded') as { source: string; supersedes_rule_id: string | null }

    // Backfilled to the honest reading: it came from the spreadsheet, it
    // replaces nothing, and therefore it still simply combines.
    expect(row).toMatchObject({ source: 'system', supersedes_rule_id: null })

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, (await getTrip(db.binding, trip.id))!, NOW)
    const entry = (await listChecklist(db.binding, trip.id)).find((e) => e.name === 'Underwear')

    // The M4 acceptance number, unchanged by the migration: 12 days × 2.
    expect(entry?.requiredQty).toBe(24)
  })

  it("recognises an amount Alex added himself, and marks it his", async () => {
    /*
     * The one class of existing row that is genuinely `user`. `Your usual
     * amounts` has always stamped this exact wording, so the backfill is a
     * statement of fact rather than a guess — and it is matched on the literal
     * string our own code wrote, not on a pattern that a spreadsheet row could
     * also satisfy.
     */
    db = atPreviousSchema()
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, source, created_at, updated_at)
         VALUES ('socks','clothing','Wool socks','Accessories & Undergarments','manual',1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled,
                                   original_text, needs_review, created_at)
         VALUES ('mine','socks','per_day',1,1,'Set in Your usual amounts',0,1)`,
      )
      .run()
    // A spreadsheet row that merely mentions the phrase must NOT be swept up.
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled,
                                   original_text, needs_review, created_at)
         VALUES ('theirs','socks','minimum',2,1,'Set in Your usual amounts elsewhere',0,1)`,
      )
      .run()

    applyMigration(db.raw, NEW_MIGRATION)

    // Scoped to this item: migration 0009 seeds rules of its own, and they are
    // the subject of the test above rather than this one.
    const sources = db.raw
      .prepare("SELECT id, source FROM packing_rule WHERE item_id = 'socks' ORDER BY id")
      .all() as Array<{ id: string; source: string }>

    expect(sources).toEqual([
      { id: 'mine', source: 'user' },
      { id: 'theirs', source: 'system' },
    ])
  })

  it('does not disturb a rule that was already switched off', async () => {
    db = atPreviousSchema()
    db.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, source, created_at, updated_at)
         VALUES ('iron','gear','Travel Iron','Travel Gear','seed_import',1,1)`,
      )
      .run()
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled,
                                   original_text, needs_review, created_at)
         VALUES ('off','iron','fixed_per_trip',1,0,'Always packed.',0,1)`,
      )
      .run()

    applyMigration(db.raw, NEW_MIGRATION)

    /*
     * A rule disabled under the old scheme stays disabled under the new one.
     * The engine sees disabled rules now — it has to, so a switched-off default
     * is visible as switched off — so this is the assertion that "sees" did not
     * quietly become "obeys".
     */
    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, (await getTrip(db.binding, trip.id))!, NOW)
    const names = (await listChecklist(db.binding, trip.id)).map((e) => e.name)
    expect(names).not.toContain('Travel Iron')
  })
})

/* ------------------------------------------------------------------ */
/* 3. production-like data                                             */
/* ------------------------------------------------------------------ */

describe("Alex's actual catalog", () => {
  async function importWorkbook(database: TestDatabase): Promise<void> {
    const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
    const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
    const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
    expect(clothing && gear).toBeTruthy()

    const response = await importRoutes.request(
      new Request('https://example.test/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'seed.xlsx', clothing, gear }),
      }),
      undefined,
      { DB: database.binding } as never,
    )
    expect(response.status).toBe(200)
  }

  it('imports every rule as a system default, replacing nothing', async () => {
    db = createTestDatabase()
    await importWorkbook(db)

    /*
     * The rules the IMPORT wrote, which is what this test is about.
     *
     * Scoped to `seed_import` items since G5: migration 0017 writes `user`
     * overrides against seeded rules, so reading the whole table now answers a
     * different question — "has anything ever been overridden" — and would fail
     * on a change that has nothing to do with the importer.
     */
    const rows = db.raw
      .prepare(
        `SELECT r.source, r.supersedes_rule_id
           FROM packing_rule r
           JOIN item i ON i.id = r.item_id
          WHERE i.source = 'seed_import'`,
      )
      .all() as Array<{ source: string; supersedes_rule_id: string | null }>

    expect(rows.length).toBeGreaterThan(20)
    expect(rows.every((r) => r.source === 'system')).toBe(true)
    expect(rows.every((r) => r.supersedes_rule_id === null)).toBe(true)
  })

  it('still produces the approved worked example', async () => {
    /*
     * The M4 acceptance criteria, over the whole real catalog rather than a
     * fixture. This is the test that would catch the fixed-per-trip change
     * having moved a number nobody meant to move: every seeded quantity on a
     * twelve-day trip abroad is still what the milestone plan says it is.
     */
    db = createTestDatabase()
    await importWorkbook(db)

    const trip = await createTrip(db.binding, TRIP, NOW)
    await generateChecklist(db.binding, (await getTrip(db.binding, trip.id))!, NOW)
    const entries = await listChecklist(db.binding, trip.id)

    const quantityOf = (name: string) =>
      entries.find((e) => e.name.toLowerCase() === name.toLowerCase())?.requiredQty

    expect(quantityOf('Contacts')).toBe(24)
    expect(quantityOf('Passport')).toBe(1)

    // And nothing came out at zero, which is what a rule that stopped firing
    // looks like from the outside.
    expect(entries.every((e) => e.requiredQty > 0)).toBe(true)
  })

  it('reads the same list twice, whatever order the rules come back in', async () => {
    /*
     * Row order is not something a test can command SQLite to reverse, so this
     * reverses the thing that decides it: the ids. Re-generating after shuffling
     * every rule id must not move a single quantity, which is the whole of
     * "reversing database row order must produce the same result" stated over
     * the real catalog rather than over two hand-written rules.
     */
    db = createTestDatabase()
    await importWorkbook(db)

    const trip = await createTrip(db.binding, TRIP, NOW)
    const stored = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, stored, NOW)
    const before = (await listChecklist(db.binding, trip.id)).map((e) => `${e.name}=${e.requiredQty}`)

    // `id DESC` inverts the sort the engine falls back on for ties.
    const ids = (db.raw.prepare('SELECT id FROM packing_rule ORDER BY id').all() as Array<{ id: string }>)
      .map((r) => r.id)
    const renamed = new Map(
      ids.map((id, index) => [id, `z${String(ids.length - index).padStart(4, '0')}-${id.slice(0, 8)}`]),
    )

    /*
     * `supersedes_rule_id` travels with the id — see the same note in
     * `necessity-reasons.test.ts`. Renaming ids alone leaves an override
     * pointing at a rule it was never about, which silently un-retires whatever
     * it was written to retire.
     */
    const overrides = db.raw
      .prepare('SELECT id, supersedes_rule_id FROM packing_rule WHERE supersedes_rule_id IS NOT NULL')
      .all() as Array<{ id: string; supersedes_rule_id: string }>
    db.raw.exec('UPDATE packing_rule SET supersedes_rule_id = NULL')

    db.raw.exec('PRAGMA foreign_keys = OFF')
    ids.forEach((id) => {
      db!.raw.prepare('UPDATE packing_rule SET id = ? WHERE id = ?').run(renamed.get(id)!, id)
    })
    for (const override of overrides) {
      db!.raw
        .prepare('UPDATE packing_rule SET supersedes_rule_id = ? WHERE id = ?')
        .run(renamed.get(override.supersedes_rule_id)!, renamed.get(override.id)!)
    }
    db.raw.exec('PRAGMA foreign_keys = ON')

    await generateChecklist(db.binding, stored, NOW)
    const after = (await listChecklist(db.binding, trip.id)).map((e) => `${e.name}=${e.requiredQty}`)

    expect(after).toEqual(before)
  })
})
