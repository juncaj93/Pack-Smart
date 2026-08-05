import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { readWorkbook } from '@shared/xlsx'
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

beforeEach(() => {
  db = createTestDatabase({ upTo: PREVIOUS })
})

afterEach(() => {
  db.close()
})

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

/** Production, in order: import first, migrate second. */
async function upgraded() {
  await importWorkbook(db)
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

describe('what the workbook actually says, before anything is changed', () => {
  it('gives the two sunglasses the very same rule', async () => {
    await importWorkbook(db)

    /*
     * The measurement behind "legacy duplicate sunglasses rules".
     *
     * `parseGearRule` tests `/outdoor/i` before `/warm weather/i`, so
     * `Warm weather / outdoor trips` never reaches the warm-weather branch and
     * both items end up on `activities contains outdoor`. They appear together
     * or not at all, and no trip can want one without the other.
     */
    const prescription = ruleFor('prescription sunglasses')[0]!
    const regular = ruleFor('regular sunglasses')[0]!

    expect(prescription.rule_type).toBe('conditional_include')
    expect(prescription.condition_json).toBe(regular.condition_json)
    expect(JSON.parse(String(prescription.condition_json))).toEqual({
      fact: 'activities',
      contains: 'outdoor',
    })
  })

  it('gives Gas-X a buffer that scales with the trip', async () => {
    await importWorkbook(db)
    const gas = ruleFor('gas-x')[0]!
    expect(gas.rule_type).toBe('duration_plus_buffer')
    expect(Number(gas.buffer)).toBe(2)

    // Fourteen on a twelve-day trip, which is the number Alex is objecting to.
    const before = await checklist()
    expect(before.find((e) => e.name === 'Gas-X')?.requiredQty).toBe(14)
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
    await importWorkbook(db)
    const before = (await checklist()).map((e) => `${e.name}=${e.requiredQty}`)

    db.close()
    db = createTestDatabase({ upTo: PREVIOUS })
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
    await importWorkbook(db)

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

describe('the limit of this, measured rather than assumed', () => {
  /**
   * **A second import of the same workbook duplicates every rule.** Found by
   * G5, not caused by it, and deliberately not fixed here — scoped as **G5b**
   * in doc 09 §5a.
   *
   * `/commit` dedupes only *within the spreadsheet it was handed* and never
   * consults the database, so a second import of the same file adds a fresh
   * copy of every item and every rule. Measured: **items 123 → 241, rules
   * 41 → 75**. For G5 the visible consequence is that a retired rule comes
   * back, because the fresh copy is a `system` rule nothing supersedes.
   *
   * Asserted rather than logged, and asserted as the CURRENT behaviour, so that
   * fixing it fails this test and the fix has to be a deliberate act. A comment
   * describing a defect is a comment; a test describing one is a decision.
   */
  it('duplicates every rule, and brings a retired one back with it', async () => {
    await upgraded()
    const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n

    const rulesBefore = count('SELECT count(*) AS n FROM packing_rule')
    const itemsBefore = count('SELECT count(*) AS n FROM item')

    await importWorkbook(db)

    /*
     * `/commit` dedupes **within the spreadsheet** — exact and identity
     * duplicates among the rows it was handed — and never looks at what the
     * database already holds. `createItem` runs unconditionally for every
     * unique row, so a second import of the same file doubles both tables.
     */
    expect(count('SELECT count(*) AS n FROM item')).toBeGreaterThan(itemsBefore)
    expect(count('SELECT count(*) AS n FROM packing_rule')).toBeGreaterThan(rulesBefore)

    // Three rules under that name now: the seeded one, 0017's override of it,
    // and a fresh unsuperseded copy on a second Gas-X item.
    expect(
      count(
        `SELECT count(*) AS n FROM packing_rule r JOIN item i ON i.id = r.item_id
          WHERE lower(trim(i.display_name)) = 'gas-x'`,
      ),
    ).toBe(3)

    const entries = await checklist()
    expect(entries.find((e) => e.name === 'Gas-X')?.requiredQty).toBe(14)
  })

  /**
   * The same defect stated as the thing Alex would actually notice, so a fix
   * has an acceptance criterion waiting for it rather than a rule count.
   */
  it('is why a fresh install would not carry these corrections', async () => {
    // Migrations first, import second — a clean clone, in that order.
    db.close()
    db = createTestDatabase()
    await importWorkbook(db)

    const entries = await checklist()
    // 0017 ran before the items existed, so it found nothing to supersede.
    expect(entries.find((e) => e.name === 'Gas-X')?.requiredQty).toBe(14)
  })
})
