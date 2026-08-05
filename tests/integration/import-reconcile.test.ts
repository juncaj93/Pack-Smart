import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RULE_CORRECTIONS, correctionFor } from '@shared/rule-corrections'
import { reconcile } from '@shared/import'
import { importRoutes } from '../../worker/routes/import'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Importing a workbook twice is safe (G5b).
 *
 * The defect this closes is measured in doc 09 §5a: `/commit` dedupes only
 * within the spreadsheet it was handed and never consulted the catalog, so a
 * second import of the same file added a fresh copy of everything — items
 * 123 → 241, rules 41 → 75 — and a retired rule came back on an unsuperseded
 * `system` copy.
 *
 * `retired-rules.test.ts` covers the real workbook end to end. This file covers
 * the classification itself, on rows small enough to reason about, and the one
 * guarantee that has no other home: **the corrections a fresh install gets from
 * the importer are the same corrections migration 0017 makes.**
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  baseItems = count('SELECT count(*) AS n FROM item')
  baseRules = count('SELECT count(*) AS n FROM packing_rule')
})

afterEach(() => {
  db.close()
})

/** One clothing row, in the column order `toClothingSources` reads. */
function clothingRow(description: string, brand = '', color = ''): string[] {
  return ['Tops', 'T-Shirt', description, brand, color, 'casual', '']
}

function gearRow(item: string, category: string, rule: string): string[] {
  return [item, category, rule]
}

async function commit(clothing: string[][], gear: string[][]) {
  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'w.xlsx',
        clothing: [['Major Category', 'Subcategory', 'Description', 'Brand', 'Color', 'Style', 'Notes'], ...clothing],
        gear: [['Item', 'Category', 'Default Priority / Quantity Rule'], ...gear],
      }),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<{
    created: number
    reconciled: {
      new: number
      exactDuplicates: number
      likelyDuplicates: number
      retiredRulesKept: string[]
      rulesAlreadyPresent: string[]
    }
  }>
}

const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n

/*
 * Counted as DELTAS from a fresh database, not as absolutes.
 *
 * Migration 0009 seeds five canonical items and their rules, so an empty
 * catalog is not an empty table — and a test pinning absolute numbers would
 * fail the next time that list legitimately changes.
 */
let baseItems = 0
let baseRules = 0
const items = () => count('SELECT count(*) AS n FROM item') - baseItems
const rules = () => count('SELECT count(*) AS n FROM packing_rule') - baseRules

/* ------------------------------------------------------------------ */

describe('classifying a row against the catalog', () => {
  const existing = [
    { id: 'a', displayName: 'Uniqlo Grey Tee', brand: 'Uniqlo', color: 'Grey', pattern: null },
    { id: 'b', displayName: 'Black Shinola', brand: 'Shinola', color: 'Black', pattern: null },
  ]

  it('calls an identical row an exact duplicate', () => {
    const [row] = reconcile(
      [{ displayName: 'Uniqlo Grey Tee', brand: 'Uniqlo', color: 'Grey' }],
      existing,
    )
    expect(row!.decision).toBe('exact_duplicate')
    expect(row!.matchedItemId).toBe('a')
  })

  it('ignores case and padding, because the identity always has', () => {
    const [row] = reconcile(
      [{ displayName: '  uniqlo   grey tee ', brand: 'Uniqlo', color: 'Grey' }],
      existing,
    )
    expect(row!.decision).toBe('exact_duplicate')
  })

  it('calls a different brand a likely duplicate, and explains it', () => {
    // The importer composes `Brand Description`, so this is the same garment
    // with its brand corrected — not a new one.
    const [row] = reconcile(
      [{ displayName: 'Muji Grey Tee', brand: 'Muji', color: 'Grey' }],
      [{ id: 'a', displayName: 'Uniqlo Grey Tee', brand: 'Uniqlo', color: 'Grey', pattern: null }],
    )
    expect(row!.decision).toBe('likely_duplicate')
    expect(row!.why).toMatch(/different brand/i)
  })

  it('calls a genuinely new row new', () => {
    const [row] = reconcile([{ displayName: 'Linen Shirt', brand: null, color: 'White' }], existing)
    expect(row!.decision).toBe('new')
    expect(row!.matchedItemId).toBeNull()
  })

  /*
   * The Columbia jackets, found by re-importing the real workbook and comparing
   * every stored row against what a second import would write.
   *
   * `splitColor` turns `Black & Gray` into colour `Black` and pattern `Gray`,
   * so an identity built from the SPLIT colour reads these two as the same
   * garment — which is the exact merge `NormalizedGarment.rawColor` exists to
   * prevent, and its comment says so in as many words: splitting first "is what
   * makes Black and Black & Gray look identical, which silently merged two
   * genuinely different Columbia jackets into one and lost a garment".
   *
   * `dedupe` was careful about this within the spreadsheet. `reconcile` was not
   * careful about it against the catalog, so the care was undone one import
   * later. Pattern is part of the identity now, on both sides.
   */
  it('does not merge two jackets whose colours differ only after the split', () => {
    const [row] = reconcile(
      [{ displayName: 'Columbia Zip-Up', brand: 'Columbia', color: 'Black', pattern: 'Gray' }],
      [{ id: 'c', displayName: 'Columbia Zip-Up', brand: 'Columbia', color: 'Black', pattern: null }],
    )
    expect(row!.decision).not.toBe('exact_duplicate')
  })

  it('does not merge two watches that differ only in colour', () => {
    /*
     * The case migration 0009 went out of its way to keep as two rows. Identity
     * is the structured fields, never the display name alone — and this is why
     * the brief says so.
     */
    const [row] = reconcile(
      [{ displayName: 'White Shinola', brand: 'Shinola', color: 'White' }],
      existing,
    )
    expect(row!.decision).toBe('new')
  })
})

describe('a second import of the same rows', () => {
  it('creates nothing the second time', async () => {
    await commit([clothingRow('Grey Tee', 'Uniqlo', 'Grey')], [gearRow('Toothbrush', 'Toiletries', 'Always')])
    const afterFirst = { items: items(), rules: rules() }
    expect(afterFirst.items).toBe(2)

    const second = await commit(
      [clothingRow('Grey Tee', 'Uniqlo', 'Grey')],
      [gearRow('Toothbrush', 'Toiletries', 'Always')],
    )

    expect(items()).toBe(afterFirst.items)
    expect(rules()).toBe(afterFirst.rules)
    expect(second.created).toBe(0)
    expect(second.reconciled.exactDuplicates).toBe(2)
  })

  it('still adds a row that is genuinely new', async () => {
    await commit([clothingRow('Grey Tee', 'Uniqlo', 'Grey')], [])
    await commit(
      [clothingRow('Grey Tee', 'Uniqlo', 'Grey'), clothingRow('Navy Tee', 'Uniqlo', 'Navy')],
      [],
    )

    expect(items()).toBe(2)
    expect(
      db.raw
        .prepare("SELECT display_name FROM item WHERE display_name LIKE '%Tee' ORDER BY display_name")
        .all(),
    ).toEqual([{ display_name: 'Uniqlo Grey Tee' }, { display_name: 'Uniqlo Navy Tee' }])
  })

  it('imports a changed brand rather than discarding it, and flags it', async () => {
    await commit([clothingRow('Grey Tee', 'Uniqlo', 'Grey')], [])
    const second = await commit([clothingRow('Grey Tee', 'Muji', 'Grey')], [])

    /*
     * The asymmetry, asserted. Wrongly skipping a garment loses something Alex
     * cannot get back; wrongly importing one costs an archive tap. So a likely
     * duplicate is imported AND reported, never silently resolved.
     */
    expect(items()).toBe(2)
    expect(second.reconciled.likelyDuplicates).toBe(1)

    const row = db.raw
      .prepare("SELECT decision, note FROM import_row WHERE decision = 'needs_review'")
      .get() as { decision: string; note: string }
    expect(row.note).toMatch(/different brand/i)
  })

  it('records the skipped row rather than dropping it silently', async () => {
    await commit([clothingRow('Grey Tee', 'Uniqlo', 'Grey')], [])
    await commit([clothingRow('Grey Tee', 'Uniqlo', 'Grey')], [])

    // Doc 05 §4: every row gets a recorded decision. A skip is a decision.
    const row = db.raw
      .prepare(
        `SELECT decision, matched_item_id, note FROM import_row
          WHERE decision = 'merged_duplicate' AND matched_item_id IS NOT NULL`,
      )
      .get() as { note: string }
    expect(row).toBeDefined()
    expect(row.note).toMatch(/already in your wardrobe/i)
  })
})

describe('rules the catalog has already decided about', () => {
  it('does not recreate a rule an override has retired', async () => {
    await commit([], [gearRow('Zinc', 'Medication', 'Always')])
    const rule = db.raw
      .prepare(
        `SELECT r.id, r.item_id FROM packing_rule r
           JOIN item i ON i.id = r.item_id WHERE i.display_name = 'Zinc'`,
      )
      .get() as { id: string; item_id: string }

    // Exactly what `disableRule` and migration 0017 write.
    db.raw
      .prepare(
        `INSERT INTO packing_rule (id, item_id, rule_type, quantity_value, buffer, condition_json,
                                   depends_on_item_id, enabled, original_text, needs_review,
                                   source, supersedes_rule_id, created_at)
         VALUES ('override',?,'fixed_per_trip',1,NULL,NULL,NULL,0,NULL,0,'user',?,?)`,
      )
      .run(rule.item_id, rule.id, NOW)

    const second = await commit([], [gearRow('Zinc', 'Medication', 'Always')])

    expect(rules()).toBe(2)
    expect(second.reconciled.retiredRulesKept).toContain('Zinc')
    // The override still points at the rule it was written about.
    const kept = db.raw
      .prepare("SELECT supersedes_rule_id, enabled FROM packing_rule WHERE id = 'override'")
      .get() as { supersedes_rule_id: string; enabled: number }
    expect(kept.supersedes_rule_id).toBe(rule.id)
    expect(kept.enabled).toBe(0)
  })

  it('does not add a second copy of a rule that is already active', async () => {
    await commit([], [gearRow('Toothbrush', 'Toiletries', 'Always')])
    const second = await commit([], [gearRow('Toothbrush', 'Toiletries', 'Always')])

    expect(rules()).toBe(1)
    expect(second.reconciled.rulesAlreadyPresent).toContain('Toothbrush')
  })
})

describe('the corrections a fresh install gets', () => {
  it('applies them at import time, with no migration involved', async () => {
    await commit(
      [],
      [
        gearRow('Gas-X', 'Medication', 'Frequently (Trip Days + 2 days buffer)'),
        gearRow('Prescription Sunglasses', 'Vision', 'Warm weather / outdoor trips'),
        gearRow('Regular Sunglasses', 'Vision', 'Outdoor trips'),
      ],
    )

    const stored = db.raw
      .prepare(
        `SELECT i.display_name, r.rule_type, r.condition_json
           FROM item i LEFT JOIN packing_rule r ON r.item_id = i.id
          ORDER BY i.display_name`,
      )
      .all() as Array<{ display_name: string; rule_type: string | null; condition_json: string | null }>

    const byName = new Map(stored.map((row) => [row.display_name, row]))
    // Retired: the item is kept, so One last look can still find it; the rule is
    // simply never written.
    expect(byName.get('Gas-X')?.rule_type).toBeNull()
    // Replaced: one per trip, unconditional, and independently of each other.
    for (const name of ['Prescription Sunglasses', 'Regular Sunglasses']) {
      expect(byName.get(name)?.rule_type, name).toBe('fixed_per_trip')
      expect(byName.get(name)?.condition_json, name).toBeNull()
    }
  })

  it('says the same thing migration 0017 says', async () => {
    /*
     * The guard between the two writers, and the reason this file exists.
     *
     * `shared/missing-items.ts` and migration 0009 have the same one. Without
     * it, correcting a rule in one place and not the other gives a fresh
     * install and an upgraded database different wardrobes, and nothing fails.
     */
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const sql = readFileSync(join(process.cwd(), 'migrations', '0017_retired_rules.sql'), 'utf8')

    for (const correction of RULE_CORRECTIONS) {
      expect(sql.toLowerCase(), correction.itemName).toContain(correction.itemName.toLowerCase())
    }

    // And nothing the migration retires by name is missing from the list. The
    // seat cushion is deliberately absent: it is matched by the stable id
    // migration 0009 fixed, and is never imported from the workbook at all.
    expect(correctionFor('gas-x')?.action).toBe('retire')
    expect(correctionFor('Prescription Sunglasses')?.action).toBe('replace')
    expect(correctionFor('Plane Seat Cushion')).toBeNull()
    expect(sql).toContain('a1f0b3c2-0003-4e00-9a00-packsmartv2003')
  })
})
