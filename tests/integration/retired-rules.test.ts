import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { readWorkbook } from '@shared/xlsx'
import { parseGear, type GearSource } from '@shared/import'
import { importRoutes } from '../../worker/routes/import'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'

/**
 * The three rules Alex asked to retire, and the two he asked for (G5).
 *
 * **Stood up the way production actually is**: the schema at 0016, the real
 * workbook imported through the real endpoint, and *then* migration 0017
 * applied. Order matters more here than in any other migration test — 0017 acts
 * on rules the IMPORT wrote, so a database that migrates before it imports
 * finds nothing to supersede and the whole file is a silent no-op.
 *
 * That is also the honest limit of this slice and it is recorded rather than
 * hidden: re-importing the workbook into a database that has already been
 * upgraded would bring the workbook's own rules back. The last test in this
 * file measures what actually happens in that case rather than assuming.
 */

const PREVIOUS = '0016_post_trip_review.sql'
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
  '0020_item_field_provenance.sql',
  '0021_comfort_versatility.sql',
  '0022_dressiness_contexts.sql',
  /*
   * P3's two additive migrations. `item` gains seven nullable bag traits and
   * `trip` gains `bags_json`; today's repository code reads all eight by name,
   * so a pinned schema without them fails on columns that have nothing to do
   * with the migration under test. Same argument as every entry above it.
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
]

const NEW = '0017_retired_rules.sql'
const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

/** No outdoor activity, so the retired sunglasses condition would not fire. */
const INDOOR_TRIP: TripInput = {
  name: 'A week of meetings',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['nice_dinner'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

const NOW = 1_780_000_000
let db: TestDatabase

/*
 * Both halves, and both are required — this is the one semantic conflict
 * between G5b and G6, resolved here rather than left as a merge-time note.
 *
 *   * `plus: LATER_ADDITIVE` is G6's. This file stands up the schema as it was
 *     BEFORE 0017 and then drives it with today's repositories, which read
 *     0019's column by name. Production never has that problem — the deploy
 *     applies every migration before the Worker that reads them.
 *   * the workbook read is G5b's. Its tests drive the real gear sheet through
 *     `parseGear`, which is what makes `beforeEach` async.
 *
 * Taking either side alone breaks the file: without the first, every test fails
 * on a missing column that has nothing to do with retired rules; without the
 * second, `gearSheet` is empty and the rule assertions have no rows to read.
 */
beforeEach(async () => {
  db = createTestDatabase({ upTo: PREVIOUS, plus: LATER_ADDITIVE })
  if (gearSheet.length === 0) {
    const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
    gearSheet = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))!.rows
  }
})

afterEach(() => {
  db.close()
})

/** The gear sheet's rows, in the shape `parseGear` takes. */
function readGearRows(): GearSource[] {
  const rows = gearSheet
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[0] && r[1] && r[2] && r[0] !== 'Item')
    .map(({ r, i }) => ({
      item: r[0] ?? '',
      category: r[1] ?? '',
      rule: r[2] ?? '',
      rowNumber: i + 1,
    }))
}

let gearSheet: string[][] = []

async function importWorkbook(database: TestDatabase): Promise<void> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
  expect(clothing && gear).toBeTruthy()
  gearSheet = gear!

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

/**
 * The database production actually had before 0017, then upgraded.
 *
 * The import is **corrected at source since G5b**, so it no longer produces the
 * state 0017 was written against — which is the point of that slice, and means
 * this test can no longer stand its fixture up by importing. The three original
 * rules are written back explicitly instead: exactly what the workbook put in
 * Alex's database months ago, which is what 0017 met.
 */
async function asProductionWasBefore0017() {
  await importWorkbook(db)

  const idOf = (name: string) =>
    (db.raw
      .prepare('SELECT id FROM item WHERE lower(trim(display_name)) = ?')
      .get(name) as { id: string } | undefined)?.id

  const restore = (
    name: string,
    ruleType: string,
    quantity: number,
    buffer: number | null,
    condition: string | null,
    text: string,
  ) => {
    const itemId = idOf(name)
    expect(itemId, name).toBeDefined()
    db.raw.prepare('DELETE FROM packing_rule WHERE item_id = ?').run(itemId!)
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                   depends_on_item_id, enabled, original_text, needs_review,
                                   source, supersedes_rule_id, created_at)
         VALUES (?,?,?,?,?,?,NULL,1,?,0,'system',NULL,?)`,
      )
      .run(`orig-${name.replace(/\W+/g, '')}`, itemId!, ruleType, quantity, buffer, condition, text, NOW)
  }

  const outdoors = JSON.stringify({ fact: 'activities', contains: 'outdoor' })
  restore('gas-x', 'duration_plus_buffer', 1, 2, null, 'Frequently (Trip Days + 2 days buffer)')
  restore('prescription sunglasses', 'conditional_include', 1, null, outdoors, 'Warm weather / outdoor trips')
  restore('regular sunglasses', 'conditional_include', 1, null, outdoors, 'Outdoor trips')
}

/** Production, in order: the old state first, migrate second. */
async function upgraded() {
  await asProductionWasBefore0017()
  applyMigration(db.raw, NEW)
}

async function checklist(input: TripInput = INDOOR_TRIP) {
  const created = await createTrip(db.binding, input, NOW)
  const trip = (await getTrip(db.binding, created.id))!
  await generateChecklist(db.binding, trip, NOW)
  return listChecklist(db.binding, trip.id)
}

function ruleFor(name: string) {
  return db.raw
    .prepare(
      `SELECT r.id, r.rule_type, r.quantity_value, r.buffer, r.condition_json, r.enabled,
              r.source, r.supersedes_rule_id, r.original_text
         FROM packing_rule r
         JOIN item i ON i.id = r.item_id
        WHERE lower(trim(i.display_name)) = ?
        ORDER BY r.supersedes_rule_id IS NULL DESC`,
    )
    .all(name) as Array<Record<string, unknown>>
}

/* ------------------------------------------------------------------ */

describe('what the workbook actually says', () => {
  /*
   * Asserted on the PARSE, not on what the importer stores.
   *
   * G5b corrected the importer, so these rules no longer reach the database in
   * this shape — which is the point of that slice. The workbook still says what
   * it says, and `parseGearRule` still reads it the same way, so the
   * measurement behind G5 lives here where it is still true and still checkable.
   */
  const parsedFor = (name: string) => {
    const rows = readGearRows()
    const row = rows.find((r) => r.item.toLowerCase() === name)!
    expect(row, name).toBeDefined()
    return parseGear(row)
  }

  it('gives the two sunglasses the very same rule', () => {
    const prescription = parsedFor('prescription sunglasses')
    const regular = parsedFor('regular sunglasses')

    /*
     * `parseGearRule` tests `/outdoor/i` before `/warm weather/i`, so
     * `Warm weather / outdoor trips` never reaches the warm-weather branch and
     * both items end up on `activities contains outdoor`. They appear together
     * or not at all, and no trip can want one without the other.
     */
    expect(prescription.rule?.ruleType).toBe('conditional_include')
    expect(prescription.rule?.condition).toEqual({ fact: 'activities', contains: 'outdoor' })
    expect(regular.rule?.condition).toEqual(prescription.rule?.condition)
  })

  it('gives Gas-X a buffer that scales with the trip', () => {
    const gas = parsedFor('gas-x')
    // Trip days plus two, which is fourteen on a twelve-day trip — the number
    // Alex objected to.
    expect(gas.rule?.ruleType).toBe('duration_plus_buffer')
    expect(gas.rule?.buffer).toBe(2)
  })
})

describe('after the migration', () => {
  it('does not pack the Gas-X at all', async () => {
    await upgraded()
    const entries = await checklist()
    expect(entries.find((e) => e.name === 'Gas-X')).toBeUndefined()
  })

  it('packs both sunglasses, once each, on a trip with nothing outdoor about it', async () => {
    await upgraded()
    const entries = await checklist()

    const prescription = entries.filter((e) => e.name === 'Prescription Sunglasses')
    const regular = entries.filter((e) => e.name === 'Regular Sunglasses')

    // Independently, and exactly once — which is the whole of the request.
    expect(prescription).toHaveLength(1)
    expect(regular).toHaveLength(1)
    expect(prescription[0]!.requiredQty).toBe(1)
    expect(regular[0]!.requiredQty).toBe(1)
  })

  it('packs them on an outdoor trip too, and still only once', async () => {
    await upgraded()
    const entries = await checklist({ ...INDOOR_TRIP, activities: ['outdoor', 'nice_dinner'] })

    // The condition is gone rather than inverted: the old rule fired here, and
    // the new one must not fire twice because of it.
    expect(entries.filter((e) => e.name === 'Prescription Sunglasses')).toHaveLength(1)
    expect(entries.filter((e) => e.name === 'Regular Sunglasses')).toHaveLength(1)
  })

  it('changes nothing else on the list', async () => {
    await asProductionWasBefore0017()
    const before = (await checklist()).map((e) => `${e.name}=${e.requiredQty}`)

    db.close()
    db = createTestDatabase({ upTo: PREVIOUS, plus: LATER_ADDITIVE })
    await upgraded()
    const after = (await checklist()).map((e) => `${e.name}=${e.requiredQty}`)

    const expected = before
      // The three retired rules, and the two that replace them. Nothing else on
      // a thirty-row list may move.
      .filter((row) => !row.startsWith('Gas-X=') && !row.startsWith('Plane Seat Cushion='))
      .concat(['Prescription Sunglasses=1', 'Regular Sunglasses=1'])
      .sort()

    expect(after.sort()).toEqual(expected)
  })
})

describe('how it retires them', () => {
  it('supersedes the seeded rule rather than touching it', async () => {
    await upgraded()

    for (const name of ['gas-x', 'prescription sunglasses', 'regular sunglasses']) {
      const rows = ruleFor(name)
      expect(rows, name).toHaveLength(2)

      const [seeded, override] = rows as [Record<string, unknown>, Record<string, unknown>]
      // Untouched, still on, still the system's — so *Use the default* has
      // something to restore to.
      expect(seeded.supersedes_rule_id, name).toBeNull()
      expect(seeded.source, name).toBe('system')
      expect(seeded.enabled, name).toBe(1)

      expect(override.supersedes_rule_id, name).toBe(seeded.id)
      expect(override.source, name).toBe('user')
    }
  })

  it('says something true on the rules it rewrites', async () => {
    await upgraded()

    // The seeded text says `Outdoor trips`. Carrying that onto a rule that now
    // fires every trip would put a sentence on the row that contradicts it.
    const override = ruleFor('prescription sunglasses')[1]!
    expect(override.rule_type).toBe('fixed_per_trip')
    expect(override.condition_json).toBeNull()
    expect(override.original_text).toBe('One per trip.')
  })

  it('leaves an override Alex already wrote completely alone', async () => {
    await asProductionWasBefore0017()

    // He has already turned the Gas-X rule down to one per trip himself.
    const seeded = ruleFor('gas-x')[0]!
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                   depends_on_item_id, enabled, original_text, needs_review,
                                   source, supersedes_rule_id, created_at)
         SELECT 'alex-own', item_id, 'fixed_per_trip', 1, NULL, NULL, NULL, 1, NULL, 0,
                'user', id, ? FROM packing_rule WHERE id = ?`,
      )
      .run(NOW, String(seeded.id))

    applyMigration(db.raw, NEW)

    const rows = ruleFor('gas-x')
    expect(rows).toHaveLength(2)
    // His, unchanged, and still on. The migration wrote nothing.
    const override = rows.find((r) => r.id === 'alex-own')!
    expect(override.enabled).toBe(1)
    expect(override.quantity_value).toBe(1)
    expect((await checklist()).find((e) => e.name === 'Gas-X')?.requiredQty).toBe(1)
  })

  it('is safe to apply twice', async () => {
    await upgraded()
    applyMigration(db.raw, NEW)

    // The ids are derived from the rule superseded rather than generated, and
    // `supersedes_rule_id` is uniquely indexed — so a second run adds nothing.
    for (const name of ['gas-x', 'prescription sunglasses', 'regular sunglasses']) {
      expect(ruleFor(name), name).toHaveLength(2)
    }
  })
})

describe('and G5b closed the hole this used to leave', () => {
  /**
   * These two tests **used to assert the defect**, and are changed only because
   * the fix made them fail (doc 09 §5a, G5b).
   *
   * What they measured: `/commit` dedupes only within the spreadsheet it was
   * handed and never consulted the database, so a second import added a fresh
   * copy of everything — items 123 → 241, rules 41 → 75 — and a retired rule
   * came back on an unsuperseded `system` copy. The importer reconciles against
   * the catalog now, so the same two scenarios assert the opposite.
   */
  it('a second import of the same workbook adds nothing', async () => {
    await upgraded()
    const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n

    const itemsBefore = count('SELECT count(*) AS n FROM item')
    const rulesBefore = count('SELECT count(*) AS n FROM packing_rule')

    await importWorkbook(db)

    // Every row is an exact identity match — same name, same brand, same
    // colour — which is the one class that cannot be a distinct item.
    expect(count('SELECT count(*) AS n FROM item')).toBe(itemsBefore)
    expect(count('SELECT count(*) AS n FROM packing_rule')).toBe(rulesBefore)
  })

  it('does not bring a retired rule back with it', async () => {
    await upgraded()
    await importWorkbook(db)

    // The seeded rule, its `user` override, and nothing new. A third row would
    // be an unsuperseded `system` copy, and Gas-X would return at 14.
    expect(ruleFor('gas-x')).toHaveLength(2)
    expect((await checklist()).find((e) => e.name === 'Gas-X')).toBeUndefined()
  })

  it('gives a fresh install the corrected rules without any migration doing it', async () => {
    /*
     * The scenario 0017 structurally cannot cover: migrations run before any
     * import, so on a clean database it finds nothing to supersede. The
     * corrections are applied by the IMPORTER now, from the one list both it
     * and the migration are checked against.
     */
    db.close()
    db = createTestDatabase()
    await importWorkbook(db)

    const entries = await checklist()
    expect(entries.find((e) => e.name === 'Gas-X')).toBeUndefined()
    expect(entries.find((e) => e.name === 'Plane Seat Cushion')).toBeUndefined()
    expect(entries.filter((e) => e.name === 'Prescription Sunglasses')).toHaveLength(1)
    expect(entries.filter((e) => e.name === 'Regular Sunglasses')).toHaveLength(1)
  })
})
