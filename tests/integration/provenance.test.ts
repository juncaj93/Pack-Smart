import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SOURCE_RANK, mayWrite, parseProvenance } from '@shared/provenance'
import type { FieldProvenance } from '@shared/provenance'
import { importRoutes } from '../../worker/routes/import'
import {
  clearFieldValue,
  confirmFields,
  createItem,
  getItem,
  revertFieldValue,
  updateItem,
} from '../../worker/repos/items'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'

/**
 * Per-value provenance, through the real SQL and the real importer (H1a).
 *
 * `tests/unit/worker/provenance.test.ts` decides precedence. This file proves
 * the writers obey it — which is a different question, and the one that was
 * actually broken: `update_existing` used to write every column of a partly
 * filled `ItemInput`, so a garment Alex had marked as a rain layer came back
 * from an import with no weather tags at all.
 */

const NOW = 1_780_000_000
const LATER = NOW + 86_400

/** H1a's own migration, for the tests that stand up the schema without it. */
const PROVENANCE = '0020_item_field_provenance.sql'
const BEFORE_H1A = '0019_checklist_detail.sql'

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})
afterEach(() => {
  db.close()
})

/* ------------------------------------------------------------------ */
/* driving the importer                                                */
/* ------------------------------------------------------------------ */

function clothingRow(description: string, brand = '', color = '', style = 'casual', notes = '') {
  return ['Tops', 'T-Shirt', description, brand, color, style, notes]
}

function sheets(clothing: string[][], gear: string[][] = []) {
  return {
    filename: 'w.xlsx',
    clothing: [
      ['Major Category', 'Subcategory', 'Description', 'Brand', 'Color', 'Style', 'Notes'],
      ...clothing,
    ],
    gear: [['Item', 'Category', 'Default Priority / Quantity Rule'], ...gear],
  }
}

async function call(path: string, body: unknown, binding: D1Database = db.binding) {
  const response = await importRoutes.request(
    new Request(`https://example.test/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined,
    { DB: binding } as never,
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, unknown>>
}

function row(name: string): Record<string, unknown> {
  return db.raw.prepare('SELECT * FROM item WHERE display_name = ?').get(name) as Record<
    string,
    unknown
  >
}

function provenanceOf(name: string): FieldProvenance {
  return parseProvenance((row(name).field_provenance as string | null) ?? null)
}

/** Confirm a field directly in SQL, for tests that are not about the repo API. */
function confirmInSql(name: string, provenance: FieldProvenance) {
  db.raw
    .prepare('UPDATE item SET field_provenance = ? WHERE display_name = ?')
    .run(JSON.stringify(provenance), name)
}

/* ------------------------------------------------------------------ */
/* a clean installation                                                */
/* ------------------------------------------------------------------ */

describe('a clean installation', () => {
  it('stamps read columns as imported and guessed ones as inferred', async () => {
    // `business formal` is what `inferDressiness` reads; `winter` in the notes
    // is what `inferWarmth` reads. Both guesses, from two different columns.
    await call(
      'commit',
      sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'winter weight')]),
    )

    const p = provenanceOf('Grey Tee')
    expect(p.displayName?.source).toBe('imported')
    expect(p.brand?.source).toBe('imported')
    expect(p.color?.source).toBe('imported')
    expect(p.typicalUses?.source).toBe('imported')

    // `normalizeGarment` guesses these two from the Style / Use Case column and
    // says so. The record has to say so too, or the review queue would claim
    // the spreadsheet stated a dressiness it never mentioned.
    expect(p.warmth?.source).toBe('inferred')
    expect(p.dressiness?.source).toBe('inferred')
  })

  it('records nothing for a field the workbook did not fill in', async () => {
    await call('commit', sheets([clothingRow('Plain Tee')]))
    const p = provenanceOf('Plain Tee')

    // No brand column means no brand to have a source for. Writing `imported`
    // here would claim the spreadsheet said something it did not say.
    expect(p.brand).toBeUndefined()
    expect(row('Plain Tee').brand).toBeNull()
  })

  it('stamps gear from the columns it actually has, and guesses nothing', async () => {
    await call('commit', sheets([], [['Passport', 'Documents', 'Always 1']]))
    const p = provenanceOf('Passport')

    expect(p.displayName?.source).toBe('imported')
    expect(p.isCritical?.source).toBe('imported')
    expect(p.alwaysInclude?.source).toBe('imported')
    expect(p.warmth).toBeUndefined()
    expect(p.dressiness).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* the defect this slice closes                                        */
/* ------------------------------------------------------------------ */

describe('Update existing, and the fields the workbook never mentions', () => {
  /*
   * The measured defect, and the reason H1a had to touch the importer as well
   * as add a column.
   *
   * `toItemInput` carries eleven fields. `updateItemStatement` wrote all
   * twenty-one, so `normalise` turned every omission into a DEFAULT and the
   * UPDATE wrote the default over whatever was there. Before this slice, the
   * assertions below measured: favorite 1 → 0, usage_frequency frequent → new,
   * weather_tags ["rain","cold"] → [], reuse_capacity 3 → null,
   * never_include 1 → 0.
   *
   * The weather one is the serious one. Doc 09 §9 makes `weather_tags` the ONLY
   * source the planner trusts for rain, so a jacket silently stopped being a
   * rain layer on a trip Alex had not planned yet.
   */
  it('leaves every field the importer does not carry exactly where it was', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))

    db.raw
      .prepare(
        `UPDATE item SET favorite = 1, usage_frequency = 'frequent',
           weather_tags = '["rain","cold"]', reuse_capacity = 3, never_include = 1,
           default_packing_timing = 'day_of'
         WHERE display_name = 'Grey Tee'`,
      )
      .run()

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple; getting thin')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    const after = row('Grey Tee')
    expect(after.favorite).toBe(1)
    expect(after.usage_frequency).toBe('frequent')
    expect(after.weather_tags).toBe('["rain","cold"]')
    expect(after.reuse_capacity).toBe(3)
    expect(after.never_include).toBe(1)
    expect(after.default_packing_timing).toBe('day_of')

    // And it still did the job it was asked to do.
    expect(after.notes).toBe('Staple; getting thin')
  })

  it('keeps the same row, so every trip and outfit still points at it', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const before = row('Grey Tee').id

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Changed')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    expect(row('Grey Tee').id).toBe(before)
  })
})

/* ------------------------------------------------------------------ */
/* a confirmed value survives the spreadsheet                          */
/* ------------------------------------------------------------------ */

describe('a value Alex confirmed', () => {
  beforeEach(async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
  })

  it('is not overwritten by Update existing, and the difference is reported instead', async () => {
    const id = row('Grey Tee').id as string
    await updateItem(
      db.binding, id,
      { displayName: 'Grey Tee', category: 'Tops & Outerwear', dressiness: 3 },
      LATER,
    )
    expect(provenanceOf('Grey Tee').dressiness?.source).toBe('user_confirmed')

    const result = await call('commit', {
      // `business formal` makes the importer infer 4, against the 3 Alex chose.
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'Staple')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    expect(row('Grey Tee').dressiness).toBe(3)
    expect(provenanceOf('Grey Tee').dressiness?.source).toBe('user_confirmed')

    // Reported, never applied — a suggestion nobody is told about is a silent skip.
    const refused = result.refusedWrites as Array<{ field: string; heldBy: string }>
    expect(refused.map((r) => r.field)).toContain('dressiness')
    expect(refused.find((r) => r.field === 'dressiness')?.heldBy).toBe('user_confirmed')
  })

  it('does not block the import from correcting the fields beside it', async () => {
    confirmInSql('Grey Tee', {
      ...provenanceOf('Grey Tee'),
      dressiness: { source: 'user_confirmed', at: NOW },
    })

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Charcoal', 'business formal', 'New note')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    // Per field, not per row. The one Alex owns is his; the rest are the
    // spreadsheet's, which is what he asked Update existing for.
    expect(row('Grey Tee').notes).toBe('New note')
    expect(row('Grey Tee').dressiness).toBe(1)
  })

  it('survives repeated imports, not just the first', async () => {
    confirmInSql('Grey Tee', { dressiness: { source: 'user_confirmed', at: NOW } })
    // 3, against the 4 `business formal` infers. The two must DIFFER, or this
    // test passes whether precedence works or not — the "test that cannot fail"
    // doc 09 has now recorded three times in this repository.
    db.raw.prepare("UPDATE item SET dressiness = 3 WHERE display_name = 'Grey Tee'").run()

    for (let i = 0; i < 3; i += 1) {
      await call('commit', {
        ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'Staple')]),
        choices: { 'clothing#2': 'update_existing' },
      })
      expect(row('Grey Tee').dressiness).toBe(3)
    }
  })

  it('is not reported as a suggestion when the workbook agrees with it', async () => {
    confirmInSql('Grey Tee', { notes: { source: 'user_confirmed', at: NOW } })

    const result = await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    const refused = result.refusedWrites as Array<{ field: string }>
    expect(refused.map((r) => r.field)).not.toContain('notes')
  })
})

/* ------------------------------------------------------------------ */
/* the editor, and the review queue's door                             */
/* ------------------------------------------------------------------ */

describe('editing in My Stuff', () => {
  it('confirms only the fields whose value actually moved', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const id = row('Grey Tee').id as string

    await updateItem(
      db.binding, id,
      {
        displayName: 'Grey Tee', category: 'Tops & Outerwear', brand: 'Uniqlo',
        color: 'Charcoal', notes: 'Staple', dressiness: 1, warmth: 1,
        typicalUses: ['casual'],
      },
      LATER,
    )

    const p = provenanceOf('Grey Tee')
    expect(p.color?.source).toBe('user_confirmed')

    // The form posts the whole item back. Stamping the lot would mean changing
    // a colour silently promised that no import may ever touch the dressiness.
    expect(p.dressiness?.source).toBe('inferred')
    expect(p.notes?.source).toBe('imported')
  })
})

describe('Keep as is', () => {
  it('moves the authority without moving the value', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal')]))
    const id = row('Grey Tee').id as string
    const before = row('Grey Tee').dressiness

    await confirmFields(db.binding, id, ['dressiness'], LATER)

    expect(row('Grey Tee').dressiness).toBe(before)
    expect(provenanceOf('Grey Tee').dressiness?.source).toBe('user_confirmed')
    expect(mayWrite(provenanceOf('Grey Tee'), 'dressiness', 'imported')).toBe(false)
  })

  it('records an accepted learned value at its own rank', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual')]))
    const id = row('Grey Tee').id as string

    await confirmFields(db.binding, id, ['dressiness'], LATER, 'learned_proposal')

    const p = provenanceOf('Grey Tee')
    expect(p.dressiness?.source).toBe('learned_proposal')
    expect(mayWrite(p, 'dressiness', 'imported')).toBe(false)
    expect(mayWrite(p, 'dressiness', 'user_confirmed')).toBe(true)
  })
})

describe('clearing and going back', () => {
  it('a cleared value stays cleared through the next import', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const id = row('Grey Tee').id as string

    await clearFieldValue(db.binding, id, 'brand', LATER)
    expect(row('Grey Tee').brand).toBeNull()

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    // Helpfully refilling it is the silent overwrite this slice exists to stop,
    // arriving through the one path that looks like tidying up.
    expect(row('Grey Tee').brand).toBeNull()
  })

  it('restores the imported value, and lets the spreadsheet own it again', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const id = row('Grey Tee').id as string

    await updateItem(
      db.binding, id,
      { displayName: 'Grey Tee', category: 'Tops & Outerwear', brand: 'Uniqlo Ltd' },
      LATER,
    )
    expect(row('Grey Tee').brand).toBe('Uniqlo Ltd')

    await revertFieldValue(db.binding, id, 'brand', LATER + 1)
    expect(row('Grey Tee').brand).toBe('Uniqlo')
    expect(provenanceOf('Grey Tee').brand?.source).toBe('imported')

    // Really back under the importer's authority, not just back in value.
    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Muji', 'Grey', 'casual', 'Staple')]),
      choices: { 'clothing#2': 'import_separately' },
    })
    expect(mayWrite(provenanceOf('Grey Tee'), 'brand', 'imported')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* the other reconciliation classes, and archived rows                 */
/* ------------------------------------------------------------------ */

describe('the reconciliation classes that do not write', () => {
  it('an exact duplicate leaves provenance untouched', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    await confirmFields(db.binding, row('Grey Tee').id as string, ['dressiness'], LATER)
    const before = provenanceOf('Grey Tee')

    const result = await call(
      'commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]),
    )
    expect((result.reconciled as { exactDuplicates: number }).exactDuplicates).toBe(1)
    expect(provenanceOf('Grey Tee')).toEqual(before)
  })

  it('keep_existing writes nothing at all', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const before = provenanceOf('Grey Tee')

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Changed')]),
      choices: { 'clothing#2': 'keep_existing' },
    })

    expect(row('Grey Tee').notes).toBe('Staple')
    expect(provenanceOf('Grey Tee')).toEqual(before)
  })

  it('import_separately gives the new row its own fresh provenance', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    await confirmFields(db.binding, row('Grey Tee').id as string, ['dressiness'], LATER)

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Muji', 'Grey', 'casual', 'Staple')]),
      choices: { 'clothing#2': 'import_separately' },
    })

    const rows = db.raw
      .prepare('SELECT field_provenance FROM item WHERE display_name = ? ORDER BY created_at')
      .all('Grey Tee') as Array<{ field_provenance: string | null }>
    expect(rows).toHaveLength(2)

    // The confirmation belongs to the garment Alex confirmed, not to a new one
    // that happens to share its name.
    expect(parseProvenance(rows[0]!.field_provenance).dressiness?.source).toBe('user_confirmed')
    expect(parseProvenance(rows[1]!.field_provenance).dressiness?.source).toBe('inferred')
  })
})

describe('an archived garment', () => {
  it('keeps its confirmations, and an import still may not overwrite them', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const id = row('Grey Tee').id as string
    await confirmFields(db.binding, id, ['dressiness'], LATER)

    db.raw.prepare('UPDATE item SET archived_at = ? WHERE id = ?').run(LATER, id)
    // 3 against the 4 the import infers, so the assertion below distinguishes
    // "precedence held" from "the two happened to agree".
    db.raw.prepare('UPDATE item SET dressiness = 3 WHERE id = ?').run(id)

    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'Staple')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    expect(row('Grey Tee').dressiness).toBe(3)
    expect(row('Grey Tee').archived_at).toBe(LATER)
  })
})

describe('a copied item', () => {
  it('carries the original’s confirmations onto the copy', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    const original = (await getItem(db.binding, row('Grey Tee').id as string))!
    await confirmFields(db.binding, original.id, ['dressiness'], LATER)
    const confirmed = (await getItem(db.binding, original.id))!

    const copy = await createItem(
      db.binding,
      { displayName: 'Grey Tee (2)', category: original.category, dressiness: original.dressiness },
      LATER,
      'manual',
    )
    db.raw
      .prepare('UPDATE item SET field_provenance = ? WHERE id = ?')
      .run(JSON.stringify(confirmed.fieldProvenance), copy.id)

    const reloaded = (await getItem(db.binding, copy.id))!
    expect(reloaded.fieldProvenance.dressiness?.source).toBe('user_confirmed')
    // The ROW is new; the values are not. The two facts are separate on purpose.
    expect(reloaded.source).toBe('manual')
  })
})

/* ------------------------------------------------------------------ */
/* the migration                                                       */
/* ------------------------------------------------------------------ */

describe('upgrading a database that stops at 0019', () => {
  let legacy: TestDatabase

  afterEach(() => {
    legacy?.close()
  })

  it('adds the column, changes no value, and changes no import outcome', async () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1A })

    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, subcategory, color, brand, notes,
                           favorite, usage_frequency, warmth, dressiness, typical_uses,
                           owned_quantity, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('g1','clothing','Grey Tee','Tops & Outerwear','T-Shirt','Grey','Uniqlo','Staple',
                 1,'frequent',1,1,'["casual"]',3,0,0,'anytime',0,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW)
    const before = legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('g1')

    applyMigration(legacy.raw, PROVENANCE)

    const after = legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('g1') as Record<
      string,
      unknown
    >
    for (const [column, value] of Object.entries(before as Record<string, unknown>)) {
      expect(after[column]).toBe(value)
    }

    /*
     * The behaviour-neutrality claim, as arithmetic rather than a paragraph.
     *
     * The backfill writes `imported` (2) and `inferred` (1). An import writes at
     * rank 2, so every field it could write yesterday it can still write today.
     */
    const p = parseProvenance(after.field_provenance as string)
    for (const field of Object.keys(p) as Array<keyof typeof p>) {
      expect(mayWrite(p, field, 'imported')).toBe(true)
    }
    expect(p.dressiness?.source).toBe('inferred')
    expect(p.warmth?.source).toBe('inferred')
    expect(p.brand?.source).toBe('imported')
    expect(SOURCE_RANK[p.dressiness!.source]).toBeLessThan(SOURCE_RANK.imported)
  })

  it('records nothing for a field the row does not have', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1A })
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('g2','clothing','Plain Tee','Tops & Outerwear',0,'new','[]',0,0,
                 'anytime',0,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW)

    applyMigration(legacy.raw, PROVENANCE)

    const p = parseProvenance(
      (legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get('g2') as {
        field_provenance: string
      }).field_provenance,
    )
    expect(p.brand).toBeUndefined()
    expect(p.color).toBeUndefined()
    expect(p.dressiness).toBeUndefined()
    expect(p.displayName?.source).toBe('imported')
  })

  it('claims nothing about a row Alex typed', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1A })
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, color, favorite, usage_frequency,
                           dressiness, typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('m1','clothing','Hand Typed','Tops & Outerwear','Blue',0,'new',2,'[]',0,0,
                 'anytime',0,0,'manual',?,?)`,
      )
      .run(NOW, NOW)

    applyMigration(legacy.raw, PROVENANCE)

    // Claiming he confirmed fourteen fields because he once saved a form is
    // precisely the guess this column exists to end.
    expect(
      (legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get('m1') as {
        field_provenance: string | null
      }).field_provenance,
    ).toBeNull()
  })

  it('splits the two importers, so a default is never attributed to the workbook', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1A })
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('c1','clothing','A Tee','Tops & Outerwear',0,'new','["casual"]',0,0,
                 'anytime',0,0,'seed_import',?,?),
                ('r1','gear','A Charger','Electronics',0,'new','[]',1,0,
                 'anytime',1,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW, NOW, NOW)

    applyMigration(legacy.raw, PROVENANCE)

    const read = (id: string) =>
      parseProvenance(
        (legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get(id) as {
          field_provenance: string
        }).field_provenance,
      )

    // The clothing importer never sets the gear flags; `normalise` defaults them.
    expect(read('c1').typicalUses?.source).toBe('imported')
    expect(read('c1').isCritical).toBeUndefined()

    // The gear importer never sets typical uses; same argument, other way round.
    expect(read('r1').isCritical?.source).toBe('imported')
    expect(read('r1').alwaysInclude?.source).toBe('imported')
    expect(read('r1').typicalUses).toBeUndefined()
  })

  it('runs twice with the same result', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1A })
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, color, favorite, usage_frequency,
                           dressiness, typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('g3','clothing','Grey Tee','Tops & Outerwear','Grey',0,'new',1,'[]',0,0,
                 'anytime',0,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW)

    applyMigration(legacy.raw, PROVENANCE)
    const once = legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get('g3')

    // The ALTER cannot run twice; the backfill is what must be idempotent, and
    // it is the half that touches rows.
    legacy.raw.exec(
      readFileSync('migrations/0020_item_field_provenance.sql', 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('ALTER TABLE'))
        .join('\n'),
    )
    expect(legacy.raw.prepare('SELECT field_provenance FROM item WHERE id = ?').get('g3')).toEqual(
      once,
    )
  })
})

/* ------------------------------------------------------------------ */
/* the real workbook                                                   */
/* ------------------------------------------------------------------ */

describe('the workbook Alex will actually import', () => {
  /*
   * Measured against `seed-data/Master_Packing_Database_Complete.xlsx` rather
   * than a hand-written row, because doc 09 §5a's whole argument for the
   * production import procedure is that the real file behaves differently from
   * fixtures — the Columbia identity defect and the 84-of-85 rename window were
   * both found this way and neither would have appeared on three rows.
   */
  async function readWorkbookSheets() {
    const { readWorkbook } = await import('@shared/xlsx')
    const sheets = await readWorkbook(
      new Uint8Array(readFileSync('seed-data/Master_Packing_Database_Complete.xlsx')),
    )
    return {
      filename: 'seed.xlsx',
      clothing: sheets.find((sheet) => /clothing/i.test(sheet.name))!.rows,
      gear: sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))!.rows,
    }
  }

  async function importWorkbook() {
    const sheets = await readWorkbookSheets()
    await call('commit', sheets)
    return sheets
  }

  it('gives every imported row a provenance record', async () => {
    await importWorkbook()

    const rows = db.raw
      .prepare("SELECT display_name, kind, field_provenance FROM item WHERE source = 'seed_import'")
      .all() as Array<{ display_name: string; kind: string; field_provenance: string | null }>

    expect(rows.length).toBeGreaterThan(80)
    for (const item of rows) {
      const p = parseProvenance(item.field_provenance)
      expect(p.displayName?.source, item.display_name).toBe('imported')
      expect(p.category?.source, item.display_name).toBe('imported')
    }
  })

  it('records a guessed dressiness as a guess, on the real rows', async () => {
    await importWorkbook()

    const guessed = (db.raw
      .prepare(
        `SELECT count(*) AS n FROM item
          WHERE source = 'seed_import'
            AND json_extract(field_provenance, '$.dressiness.source') = 'inferred'`,
      )
      .get() as { n: number }).n

    // The importer guesses dressiness for most garments and for no gear. What
    // matters is that none of them claim the spreadsheet stated it.
    expect(guessed).toBeGreaterThan(0)
    expect(
      (db.raw
        .prepare(
          `SELECT count(*) AS n FROM item
            WHERE json_extract(field_provenance, '$.dressiness.source') = 'imported'`,
        )
        .get() as { n: number }).n,
    ).toBe(0)
  })

  it('re-imports the whole workbook, forced to overwrite, and still cannot have it', async () => {
    const { clothing } = await importWorkbook()

    const target = db.raw
      .prepare(
        `SELECT id, display_name, dressiness FROM item
          WHERE source = 'seed_import' AND kind = 'clothing' AND dressiness IS NOT NULL
          ORDER BY display_name LIMIT 1`,
      )
      .get() as { id: string; display_name: string; dressiness: number }

    const chosen = target.dressiness === 4 ? 0 : 4
    db.raw.prepare('UPDATE item SET dressiness = ? WHERE id = ?').run(chosen, target.id)
    await confirmFields(db.binding, target.id, ['dressiness'], LATER)

    /*
     * `update_existing` on EVERY clothing row, which is the strongest form the
     * question has.
     *
     * A second import of the identical file is otherwise all `exact_duplicate`
     * and writes nothing at all — so a test that just re-imported would pass
     * whether precedence worked or not. Forcing the overwrite is what makes the
     * assertion below about H1a rather than about G5b's skip.
     */
    const choices: Record<string, string> = {}
    for (let n = 1; n <= clothing.length; n += 1) choices[`clothing#${n}`] = 'update_existing'

    const sheetsAgain = await readWorkbookSheets()
    const result = await call('commit', { ...sheetsAgain, choices })

    const after = db.raw.prepare('SELECT dressiness FROM item WHERE id = ?').get(target.id) as {
      dressiness: number
    }
    expect(after.dressiness).toBe(chosen)

    // And the difference was reported rather than swallowed.
    const refused = result.refusedWrites as Array<{ itemId: string; field: string }>
    expect(refused.some((r) => r.itemId === target.id && r.field === 'dressiness')).toBe(true)
  })

  it('leaves the rest of the wardrobe exactly where a forced overwrite found it', async () => {
    const { clothing } = await importWorkbook()
    const before = db.raw
      .prepare('SELECT id, display_name, dressiness, warmth FROM item ORDER BY id')
      .all()

    const choices: Record<string, string> = {}
    for (let n = 1; n <= clothing.length; n += 1) choices[`clothing#${n}`] = 'update_existing'
    await call('commit', { ...(await readWorkbookSheets()), choices })

    // Nothing Alex owns has an opinion of its own yet, so a forced overwrite
    // from the same file must be a no-op on every value.
    expect(
      db.raw.prepare('SELECT id, display_name, dressiness, warmth FROM item ORDER BY id').all(),
    ).toEqual(before)
  })
})
