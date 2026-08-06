import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { parseContexts } from '@shared/dressiness'
import { parseProvenance } from '@shared/provenance'
import type { FieldProvenance } from '@shared/provenance'
import { importRoutes } from '../../worker/routes/import'
import {
  clearFieldValue,
  createItem,
  getItem,
  revertFieldValue,
  updateItem,
} from '../../worker/repos/items'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'

/**
 * Dressiness contexts, stored (H1c).
 *
 * `tests/unit/worker/dressiness.test.ts` decides what a SET means to the
 * planner. This file proves the set survives storage, the importer, a re-import
 * and an upgrade from schema 0021 — and that migration 0022 maps each legacy
 * integer to exactly one context without quietly widening it.
 */

const NOW = 1_780_000_000
const LATER = NOW + 86_400

const CONTEXTS = '0022_dressiness_contexts.sql'
const BEFORE_H1C = '0021_comfort_versatility.sql'

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})
afterEach(() => {
  db.close()
})

function clothingRow(description: string, brand = '', color = '', style = 'casual', notes = '') {
  return ['Tops', 'T-Shirt', description, brand, color, style, notes]
}

function sheets(clothing: string[][]) {
  return {
    filename: 'w.xlsx',
    clothing: [
      ['Major Category', 'Subcategory', 'Description', 'Brand', 'Color', 'Style', 'Notes'],
      ...clothing,
    ],
    gear: [['Item', 'Category', 'Default Priority / Quantity Rule']],
  }
}

async function call(path: string, body: unknown) {
  const response = await importRoutes.request(
    new Request(`https://example.test/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, unknown>>
}

const row = (name: string) =>
  db.raw.prepare('SELECT * FROM item WHERE display_name = ?').get(name) as Record<string, unknown>

const contextsOf = (name: string) => parseContexts(row(name).dressiness_contexts as string | null)

const provenanceOf = (name: string): FieldProvenance =>
  parseProvenance((row(name).field_provenance as string | null) ?? null)

/** Save the way the editor saves — the whole item, one field changed (H1b's lesson). */
async function save(id: string, changes: Partial<Item>, at = LATER) {
  const current = (await getItem(db.binding, id))!
  return updateItem(db.binding, id, { ...current, ...changes }, at)
}

/* ------------------------------------------------------------------ */
/* storing a set                                                       */
/* ------------------------------------------------------------------ */

describe('a set Alex chooses', () => {
  let id: string

  beforeEach(async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    id = row('Grey Tee').id as string
  })

  it('starts as the one context the importer guessed', async () => {
    // `casual` in the Style column -> level 1 -> exactly one context, not two.
    expect(contextsOf('Grey Tee')).toEqual(['casual'])
    expect(provenanceOf('Grey Tee').dressinessContexts?.source).toBe('inferred')
  })

  it('stores one, several, and all five', async () => {
    /*
     * `['casual']` is NOT first, and that is not cosmetic.
     *
     * The importer already stored exactly that, and H1a stamps
     * `user_confirmed` only on values that actually MOVED — so saving the set
     * it already had confirms nothing, and this loop would have asserted the
     * wrong thing on its first pass. Confirming a value without changing it is
     * `confirmFields`, which is H1d's *Keep as is*.
     */
    for (const set of [
      ['loungewear', 'casual'],
      ['casual'],
      ['casual', 'smart_casual'],
      ['smart_casual', 'dressy'],
      ['dressy', 'formal'],
      ['casual', 'smart_casual', 'dressy'],
      ['loungewear', 'casual', 'smart_casual', 'dressy', 'formal'],
    ] as const) {
      await save(id, { dressinessContexts: [...set] })
      expect(contextsOf('Grey Tee')).toEqual([...set])
      expect(provenanceOf('Grey Tee').dressinessContexts?.source).toBe('user_confirmed')
    }
  })

  it('stores canonically however the set arrived', async () => {
    await save(id, { dressinessContexts: ['formal', 'casual', 'casual'] })
    // Sorted and de-duplicated, or an identical save later reads as a change.
    expect(row('Grey Tee').dressiness_contexts).toBe('["casual","formal"]')
  })

  it('removes one context while keeping the other', async () => {
    await save(id, { dressinessContexts: ['smart_casual', 'dressy'] })
    await save(id, { dressinessContexts: ['dressy'] }, LATER + 1)
    expect(contextsOf('Grey Tee')).toEqual(['dressy'])
  })

  it('adds a context later without disturbing the first', async () => {
    await save(id, { dressinessContexts: ['smart_casual'] })
    await save(id, { dressinessContexts: ['smart_casual', 'dressy'] }, LATER + 1)
    expect(contextsOf('Grey Tee')).toEqual(['smart_casual', 'dressy'])
  })

  it('clears every context, and the empty set is CONFIRMED rather than forgotten', async () => {
    await save(id, { dressinessContexts: ['casual', 'smart_casual'] })
    await clearFieldValue(db.binding, id, 'dressinessContexts', LATER + 1)

    expect(contextsOf('Grey Tee')).toEqual([])
    expect(row('Grey Tee').dressiness_contexts).toBeNull()
    // H1a's rule: a cleared value is a confirmed unknown, so nothing refills it.
    expect(provenanceOf('Grey Tee').dressinessContexts?.source).toBe('user_confirmed')
  })

  it('restores what the importer guessed', async () => {
    await save(id, { dressinessContexts: ['dressy', 'formal'] })
    expect(contextsOf('Grey Tee')).toEqual(['dressy', 'formal'])

    await revertFieldValue(db.binding, id, 'dressinessContexts', LATER + 1)

    expect(contextsOf('Grey Tee')).toEqual(['casual'])
    // And back under the importer's authority, not merely back in value.
    expect(provenanceOf('Grey Tee').dressinessContexts?.source).toBe('inferred')
  })

  it('derives the set for a caller that only knows the legacy integer', async () => {
    /*
     * `undefined` and `[]` are different on the way in. A client sending only
     * `dressiness` must not silently lose the garment's formality — it gets the
     * one context that level means.
     */
    const created = await createItem(
      db.binding,
      { displayName: 'Legacy Tee', category: 'Tops & Outerwear', dressiness: 3 },
      NOW, 'manual',
    )
    expect((await getItem(db.binding, created.id))!.dressinessContexts).toEqual(['dressy'])

    const cleared = await createItem(
      db.binding,
      { displayName: 'Blank Tee', category: 'Tops & Outerwear', dressiness: 3, dressinessContexts: [] },
      NOW, 'manual',
    )
    // An explicit empty array is an answer and stays empty.
    expect((await getItem(db.binding, cleared.id))!.dressinessContexts).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* what must not take a set away                                       */
/* ------------------------------------------------------------------ */

describe('what a confirmed set survives', () => {
  let id: string

  beforeEach(async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    id = row('Grey Tee').id as string
    await save(id, { dressinessContexts: ['smart_casual', 'dressy'] })
  })

  it('a re-import of the same workbook', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    expect(contextsOf('Grey Tee')).toEqual(['smart_casual', 'dressy'])
  })

  it('a changed workbook at Update existing, with the difference REPORTED', async () => {
    const result = await call('commit', {
      // `business formal` makes the importer infer Formal — a different set.
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'Changed')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    // The import got what it legitimately came for…
    expect(row('Grey Tee').notes).toBe('Changed')
    // …and could not touch the set Alex confirmed.
    expect(contextsOf('Grey Tee')).toEqual(['smart_casual', 'dressy'])

    const refused = result.refusedWrites as Array<{ field: string; heldBy: string }>
    expect(refused.map((r) => r.field)).toContain('dressinessContexts')
    expect(refused.find((r) => r.field === 'dressinessContexts')?.heldBy).toBe('user_confirmed')
  })

  it('a fresh inference, which may still correct the legacy integer beside it', async () => {
    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'Staple')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    // Two fields, two authorities: the integer is still the importer's, the
    // set is Alex's, and that is the whole reason they are separate columns.
    expect(row('Grey Tee').dressiness).toBe(4)
    expect(contextsOf('Grey Tee')).toEqual(['smart_casual', 'dressy'])
  })

  it('a form save that never mentions it', async () => {
    await save(id, { color: 'Charcoal' }, LATER + 1)
    expect(contextsOf('Grey Tee')).toEqual(['smart_casual', 'dressy'])
    expect(row('Grey Tee').color).toBe('Charcoal')
  })
})

/* ------------------------------------------------------------------ */
/* the real workbook                                                   */
/* ------------------------------------------------------------------ */

describe('the real workbook', () => {
  async function readSheets() {
    const { readWorkbook } = await import('@shared/xlsx')
    const parsed = await readWorkbook(
      new Uint8Array(readFileSync('seed-data/Master_Packing_Database_Complete.xlsx')),
    )
    return {
      filename: 'seed.xlsx',
      clothing: parsed.find((s) => /clothing/i.test(s.name))!.rows,
      gear: parsed.find((s) => /non-?clothing|rules|gear/i.test(s.name))!.rows,
    }
  }

  it('gives every garment at most ONE context, never a broadened set', async () => {
    await call('commit', await readSheets())

    const rows = db.raw
      .prepare(
        `SELECT display_name, dressiness, dressiness_contexts FROM item
          WHERE kind = 'clothing' AND source = 'seed_import'`,
      )
      .all() as Array<{ display_name: string; dressiness: number | null; dressiness_contexts: string | null }>

    expect(rows.length).toBeGreaterThan(80)
    for (const item of rows) {
      const contexts = parseContexts(item.dressiness_contexts)
      // The importer guessed a level from free text. Widening that guess is the
      // review queue's job, and a fresh install must not pre-empt it.
      expect(contexts.length, item.display_name).toBeLessThanOrEqual(1)
      if (item.dressiness === null) expect(contexts).toEqual([])
    }
  })

  it('keeps a confirmed set through a forced overwrite of the whole file', async () => {
    const parsed = await readSheets()
    await call('commit', parsed)

    const target = db.raw
      .prepare("SELECT id FROM item WHERE kind = 'clothing' ORDER BY display_name LIMIT 1")
      .get() as { id: string }
    await save(target.id, { dressinessContexts: ['smart_casual', 'dressy'] })

    const choices: Record<string, string> = {}
    for (let n = 1; n <= parsed.clothing.length; n += 1) choices[`clothing#${n}`] = 'update_existing'
    await call('commit', { ...parsed, choices })

    const after = db.raw
      .prepare('SELECT dressiness_contexts FROM item WHERE id = ?')
      .get(target.id) as { dressiness_contexts: string }
    expect(parseContexts(after.dressiness_contexts)).toEqual(['smart_casual', 'dressy'])
  })
})

/* ------------------------------------------------------------------ */
/* the migration                                                       */
/* ------------------------------------------------------------------ */

describe('upgrading a database that stops at 0021', () => {
  let legacy: TestDatabase

  afterEach(() => {
    legacy?.close()
  })

  function seedLevels(database: TestDatabase) {
    const values = [
      ['l0', 0], ['l1', 1], ['l2', 2], ['l3', 3], ['l4', 4],
    ] as const
    for (const [id, level] of values) {
      database.raw
        .prepare(
          `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                             dressiness, typical_uses, is_critical, requires_final_check,
                             default_packing_timing, always_include, never_include, source,
                             created_at, updated_at)
           VALUES (?,'clothing',?,'Tops & Outerwear',0,'new',?,'[]',0,0,
                   'anytime',0,0,'seed_import',?,?)`,
        )
        .run(id, `Level ${level}`, level, NOW, NOW)
    }
    database.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           dressiness, typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('none','clothing','No Level','Tops & Outerwear',0,'new',NULL,'[]',0,0,
                 'anytime',0,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW)
  }

  const contextsFor = (database: TestDatabase, id: string) =>
    parseContexts(
      (database.raw.prepare('SELECT dressiness_contexts FROM item WHERE id = ?').get(id) as {
        dressiness_contexts: string | null
      }).dressiness_contexts,
    )

  it('maps each legacy level to EXACTLY ONE context', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    seedLevels(legacy)
    applyMigration(legacy.raw, CONTEXTS)

    expect(contextsFor(legacy, 'l0')).toEqual(['loungewear'])
    expect(contextsFor(legacy, 'l1')).toEqual(['casual'])
    expect(contextsFor(legacy, 'l2')).toEqual(['smart_casual'])
    expect(contextsFor(legacy, 'l3')).toEqual(['dressy'])
    expect(contextsFor(legacy, 'l4')).toEqual(['formal'])
  })

  it('does not broaden a legacy value', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    seedLevels(legacy)
    applyMigration(legacy.raw, CONTEXTS)

    // Smart casual becomes Smart casual, NOT Casual + Smart casual — even though
    // the second is probably true of most of them. Widening a guess is the
    // review queue's job.
    for (const id of ['l0', 'l1', 'l2', 'l3', 'l4']) {
      expect(contextsFor(legacy, id)).toHaveLength(1)
    }
  })

  it('records nothing for a row that had no level', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    seedLevels(legacy)
    applyMigration(legacy.raw, CONTEXTS)

    expect(contextsFor(legacy, 'none')).toEqual([])
    expect(
      (legacy.raw.prepare('SELECT dressiness_contexts FROM item WHERE id = ?').get('none') as {
        dressiness_contexts: string | null
      }).dressiness_contexts,
    ).toBeNull()
  })

  it('changes no other value', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    seedLevels(legacy)
    const before = legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('l2') as Record<
      string,
      unknown
    >

    applyMigration(legacy.raw, CONTEXTS)

    const after = legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('l2') as Record<
      string,
      unknown
    >
    for (const [column, value] of Object.entries(before)) {
      if (column === 'field_provenance') continue
      expect(after[column], column).toBe(value)
    }
    // The integer is NOT dropped: it stays as what the importer inferred and as
    // what `reconcile` diffs a re-import against.
    expect(after.dressiness).toBe(2)
  })

  it('inherits the integer’s provenance rather than claiming a new one', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    seedLevels(legacy)
    applyMigration(legacy.raw, CONTEXTS)

    const p = parseProvenance(
      (legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get('l2') as {
        field_provenance: string
      }).field_provenance,
    )
    // A mechanical re-expression of a guess is still a guess, so `inferred` —
    // the first thing a better source may correct.
    expect(p.dressinessContexts?.source).toBe('inferred')
  })

  it('claims nothing about a row Alex typed', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           dressiness, typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('m1','clothing','Typed','Tops & Outerwear',0,'new',2,'[]',0,0,
                 'anytime',0,0,'manual',?,?)`,
      )
      .run(NOW, NOW)

    applyMigration(legacy.raw, CONTEXTS)

    // The contexts are still written — the level is real data — but nothing
    // claims Alex confirmed them.
    expect(contextsFor(legacy, 'm1')).toEqual(['smart_casual'])
    expect(
      parseProvenance(
        (legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get('m1') as {
          field_provenance: string | null
        }).field_provenance,
      ).dressinessContexts,
    ).toBeUndefined()
  })

  it('runs twice with the same result, and cannot widen an edited set', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1C })
    seedLevels(legacy)
    applyMigration(legacy.raw, CONTEXTS)

    // Alex broadens one, the way H1d will let him.
    legacy.raw
      .prepare(`UPDATE item SET dressiness_contexts = '["smart_casual","dressy"]' WHERE id = 'l2'`)
      .run()

    const backfillOnly = readFileSync(`migrations/${CONTEXTS}`, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('ALTER TABLE'))
      .join('\n')
    legacy.raw.exec(backfillOnly)

    /*
     * The guard is `dressiness_contexts IS NULL`, not `dressiness IS NOT NULL`.
     * The difference is this row: a bare re-run of the second form would reset
     * Alex's two contexts back to the one the integer means.
     */
    expect(contextsFor(legacy, 'l2')).toEqual(['smart_casual', 'dressy'])
    expect(contextsFor(legacy, 'l3')).toEqual(['dressy'])
  })
})

describe('a clean installation', () => {
  it('writes the same shape the backfill produces', async () => {
    /*
     * Its own block, because it uses the fully-migrated `db` rather than the
     * upgrade fixture — and sharing that block's `afterEach` closed an already
     * closed handle, which is what the first draft of this file did.
     *
     * The default harness applies every migration; a fresh import then writes
     * contexts directly rather than through the backfill. Both must agree, or a
     * new install and an upgraded database would plan differently.
     */
    await call('commit', sheets([clothingRow('Fresh Tee', '', '', 'smart casual')]))
    expect(contextsOf('Fresh Tee')).toEqual(['smart_casual'])
    expect(row('Fresh Tee').dressiness).toBe(2)
  })
})
