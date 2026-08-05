import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTrip } from '../../worker/repos/trips'
import { LONG_FLIGHT_HOURS, MISSING_ITEMS, normalizeName } from '@shared/missing-items'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP } from './wardrobe'

/**
 * The five wardrobe rows Alex owns that were never in the workbook.
 *
 * This is the one gap in the product where Pack Smart can fail him *badly while
 * appearing to work*: `checklist.ts` treats candidacy as "has at least one enabled
 * rule", and the "still not packed" warning filters entries that already exist —
 * so an item absent from the database is absent from every list, forever, with no
 * warning. A bite guard is not optional.
 *
 * These tests care about three separate things, and the middle one is the one that
 * touches production data:
 *
 *   1. the migration and `shared/missing-items.ts` describe the same five rows;
 *   2. applying it to a database that already holds some of them changes nothing
 *      it did not create;
 *   3. the items actually reach a generated packing list, under the right
 *      conditions and not otherwise.
 */

const MIGRATION = join(process.cwd(), 'migrations', '0009_missing_items.sql')
const SQL = readFileSync(MIGRATION, 'utf8')
const NOW = 1_780_000_000

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

/** A database with every migration applied, so the SQL runs as it will in production. */
function migrated(): DatabaseSync {
  return db.raw
}

describe('the migration is additive, and provably so', () => {
  it('contains no statement that can change or remove existing data', () => {
    /*
     * Comments in this file legitimately mention UPDATE and DELETE while
     * explaining why there are none, so the check reads statements rather than
     * text. Anything else would fail on its own documentation.
     */
    const statements = SQL.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .toUpperCase()

    expect(statements).not.toContain('UPDATE ')
    expect(statements).not.toContain('DELETE ')
    expect(statements).not.toContain('DROP ')
    expect(statements).not.toContain('INSERT OR REPLACE')
    expect(statements).not.toContain('ALTER ')
  })

  it('inserts exactly the five items, and no sixth', () => {
    const rows = migrated()
      .prepare("SELECT display_name FROM item WHERE source = 'manual' ORDER BY display_name")
      .all() as Array<{ display_name: string }>

    expect(rows.map((r) => r.display_name)).toEqual([
      'Bite Guard',
      'Black Shinola',
      'Hairspray',
      'Plane Seat Cushion',
      'White Shinola',
    ])
  })

  it('does not add the Vuori jacket, which the wardrobe already has', () => {
    /*
     * The brief this list came from named six. Adding a garment that already
     * exists would manufacture the duplicate CLAUDE.md requires be *detected*
     * rather than silently imported.
     */
    expect(SQL.toLowerCase()).not.toContain('vuori')
    expect(MISSING_ITEMS.map((i) => i.displayName)).not.toContain('Black Vuori Jacket')
  })
})

describe('SQL and TypeScript describe the same five rows', () => {
  it.each(MISSING_ITEMS.map((item) => [item.displayName, item] as const))(
    '%s matches the migration',
    (_name, item) => {
      const row = migrated()
        .prepare('SELECT * FROM item WHERE id = ?')
        .get(item.id) as Record<string, unknown> | undefined

      expect(row, `${item.displayName} is missing from the migration`).toBeDefined()
      expect(row!.display_name).toBe(item.displayName)
      expect(row!.kind).toBe(item.kind)
      expect(row!.category).toBe(item.category)
      expect(row!.color).toBe(item.color)
      expect(row!.brand).toBe(item.brand)
      expect(row!.is_critical).toBe(item.isCritical ? 1 : 0)
      expect(row!.requires_final_check).toBe(item.requiresFinalCheck ? 1 : 0)

      const rule = migrated()
        .prepare('SELECT * FROM packing_rule WHERE item_id = ?')
        .get(item.id) as Record<string, unknown> | undefined

      if (item.rule === null) {
        expect(rule, `${item.displayName} should carry no rule`).toBeUndefined()
        return
      }

      expect(rule, `${item.displayName} should carry a rule`).toBeDefined()
      expect(rule!.rule_type).toBe(item.rule.ruleType)
      expect(rule!.quantity_value).toBe(item.rule.quantityValue)
      expect(rule!.original_text).toBe(item.rule.originalText)
      expect(rule!.condition_json === null ? null : JSON.parse(String(rule!.condition_json))).toEqual(
        item.rule.condition,
      )
    },
  )

  it('invents no attribute the data does not support', () => {
    /*
     * Doc 03: never claim a capability. The watches and the toiletries carry a
     * name, a category, and colour/brand read off the name — nothing else.
     */
    for (const item of MISSING_ITEMS) {
      const row = migrated().prepare('SELECT * FROM item WHERE id = ?').get(item.id) as Record<
        string,
        unknown
      >
      expect(row.warmth, `${item.displayName} claims a warmth`).toBeNull()
      expect(row.dressiness, `${item.displayName} claims a dressiness`).toBeNull()
      expect(row.weather_tags, `${item.displayName} claims weather tags`).toBeNull()
      expect(row.typical_uses, `${item.displayName} claims typical uses`).toBeNull()
    }
  })

  it('keeps the two watches as two rows', () => {
    const watches = MISSING_ITEMS.filter((i) => i.brand === 'Shinola')
    expect(watches).toHaveLength(2)
    expect(new Set(watches.map((w) => w.id)).size).toBe(2)
    // Neither is packed by the engine; a watch is chosen by an outfit.
    expect(watches.every((w) => w.rule === null)).toBe(true)
  })
})

describe('applied to a database that already holds some of them', () => {
  /** A fresh database with the migrations UP TO 0009, so 0009 can be applied by hand. */
  function beforeMissingItems(): DatabaseSync {
    const fresh = new DatabaseSync(':memory:')
    fresh.exec('PRAGMA foreign_keys = ON')
    for (const file of ['0001_auth_throttle', '0002_catalog', '0003_trips', '0004_outfits_and_checklist', '0005_seed_preferences', '0006_outfit_slot_wearings', '0007_trip_emoji', '0008_outfit_pairings']) {
      fresh.exec(readFileSync(join(process.cwd(), 'migrations', `${file}.sql`), 'utf8'))
    }
    return fresh
  }

  it('adds nothing when run twice', () => {
    const before = migrated().prepare('SELECT count(*) c FROM item').get() as { c: number }
    const rulesBefore = migrated().prepare('SELECT count(*) c FROM packing_rule').get() as {
      c: number
    }

    migrated().exec(SQL)

    expect((migrated().prepare('SELECT count(*) c FROM item').get() as { c: number }).c).toBe(
      before.c,
    )
    expect(
      (migrated().prepare('SELECT count(*) c FROM packing_rule').get() as { c: number }).c,
    ).toBe(rulesBefore.c)
  })

  it("leaves Alex's own row alone, and gives it no orphan rule", () => {
    const fresh = beforeMissingItems()
    /*
     * Padding and a different case on purpose: a production row differing only in
     * whitespace or capitalisation is the same hairspray, and merging or
     * duplicating it would both be wrong.
     */
    fresh
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, is_critical, requires_final_check,
                           source, created_at, updated_at)
         VALUES ('alex-own','gear','  hairSPRAY  ','Grooming',0,0,'manual',1,1)`,
      )
      .run()
    fresh
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, enabled, created_at)
         VALUES ('alex-rule','alex-own','per_day',3,1,1)`,
      )
      .run()

    fresh.exec(SQL)

    const hairsprays = fresh
      .prepare("SELECT id, display_name, category FROM item WHERE lower(trim(display_name)) = 'hairspray'")
      .all() as Array<{ id: string; display_name: string; category: string }>

    // One row, still his, still in his category, still padded exactly as he left it.
    expect(hairsprays).toHaveLength(1)
    expect(hairsprays[0]!.id).toBe('alex-own')
    expect(hairsprays[0]!.display_name).toBe('  hairSPRAY  ')
    expect(hairsprays[0]!.category).toBe('Grooming')

    // His rule survives untouched, and the migration attached none of its own.
    const rules = fresh
      .prepare("SELECT id, rule_type, quantity_value FROM packing_rule WHERE item_id = 'alex-own'")
      .all() as Array<{ id: string; rule_type: string; quantity_value: number }>
    expect(rules).toEqual([{ id: 'alex-rule', rule_type: 'per_day', quantity_value: 3 }])

    fresh.close()
  })

  it('treats a merely similar name as a different item', () => {
    const fresh = beforeMissingItems()
    fresh
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, is_critical, requires_final_check,
                           source, created_at, updated_at)
         VALUES ('bare-shinola','clothing','Shinola','Accessories & Undergarments',0,0,'manual',1,1)`,
      )
      .run()

    fresh.exec(SQL)

    /*
     * Both survive. A wrongly merged item is unrecoverable; a duplicate is one
     * archive tap away, and CLAUDE.md asks for likely duplicates to be surfaced
     * rather than silently resolved.
     */
    const shinolas = fresh
      .prepare("SELECT display_name FROM item WHERE lower(display_name) LIKE '%shinola%' ORDER BY display_name")
      .all() as Array<{ display_name: string }>
    expect(shinolas.map((s) => s.display_name)).toEqual(['Black Shinola', 'Shinola', 'White Shinola'])

    fresh.close()
  })

  it('matches on the same normalisation the migration uses', () => {
    expect(normalizeName('  hairSPRAY  ')).toBe('hairspray')
    expect(normalizeName('Bite Guard')).toBe('bite guard')
  })
})

describe('and they actually reach a packing list', () => {
  async function checklistFor(overrides: Partial<typeof TRIP> = {}) {
    const trip = await createTrip(db.binding, { ...TRIP, ...overrides }, NOW)
    await generateChecklist(db.binding, trip, NOW)
    return listChecklist(db.binding, trip.id)
  }

  it('packs the bite guard on a trip with a night in it', async () => {
    const entries = await checklistFor()
    const guard = entries.find((e) => e.name === 'Bite Guard')

    expect(guard, 'the bite guard reached no list at all').toBeDefined()
    expect(guard!.requiredQty).toBe(1)
    // Essential and final-check, like Synthroid and the Medicine Wheel.
    expect(guard!.isCritical).toBe(true)
  })

  /**
   * The seat cushion is retired, and no flight length brings it back (G5).
   *
   * It used to be packed on a flight over six hours. Alex asked for it to stop,
   * and migration 0017 writes a superseding `user` row with `enabled = 0` —
   * which is exactly what `disableRule` writes from Settings, so nothing seeded
   * is touched and *Use the default* still restores it.
   */
  it('never packs the seat cushion, however long the flight', async () => {
    for (const flightHours of [LONG_FLIGHT_HOURS + 1, LONG_FLIGHT_HOURS, 24, null]) {
      const entries = await checklistFor({ flightHours })
      const cushion = entries.find((e) => e.name === 'Plane Seat Cushion')
      expect(cushion?.requiredQty ?? null, `at ${flightHours} hours`).toBeNull()
    }
  })

  it('retires it by superseding the rule, never by touching it', async () => {
    const db = migrated()

    // The seeded rule is still there, still enabled, still readable.
    const seeded = db
      .prepare(
        `SELECT id, enabled, source FROM packing_rule
          WHERE item_id = ? AND supersedes_rule_id IS NULL`,
      )
      .get('a1f0b3c2-0003-4e00-9a00-packsmartv2003') as Record<string, unknown>
    expect(seeded).toBeDefined()
    expect(seeded.enabled).toBe(1)
    expect(seeded.source).toBe('system')

    // And one override, off, owned by Alex — the shape *Use the default* undoes.
    const override = db
      .prepare('SELECT enabled, source FROM packing_rule WHERE supersedes_rule_id = ?')
      .get(String(seeded.id)) as Record<string, unknown>
    expect(override).toBeDefined()
    expect(override.enabled).toBe(0)
    expect(override.source).toBe('user')
  })

  it('no longer names it in the question that used to add it', async () => {
    /*
     * The long-flight question is still worth asking — the workbook adds a neck
     * pillow and compression socks over five hours — but it may not go on
     * citing something nothing adds any more.
     */
    const { openQuestions } = await import('@shared/readiness')
    const unanswered = openQuestions({ flightHours: null } as never)
    const flight = unanswered.find((q) => q.fact === 'flight_hours')
    expect(flight, 'the long flight question still gets asked').toBeDefined()
    expect(flight!.because).not.toMatch(/cushion/i)
    expect(flight!.because).toMatch(/neck pillow/i)
  })

  it('always packs the hairspray', async () => {
    const entries = await checklistFor()
    const hairspray = entries.find((e) => e.name === 'Hairspray')
    expect(hairspray).toBeDefined()
    expect(hairspray!.requiredQty).toBe(1)
  })

  it('never puts a watch on the list by rule', async () => {
    const entries = await checklistFor()
    expect(entries.find((e) => e.name === 'Black Shinola')).toBeUndefined()
    expect(entries.find((e) => e.name === 'White Shinola')).toBeUndefined()
  })
})
