import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  composeDisplayName,
  extractQuantity,
  normalizeGarment,
  toItemInput,
  type ClothingSource,
  type NormalizedGarment,
} from '@shared/import'
import { garmentDetail } from '@shared/items'
import { readWorkbook } from '@shared/xlsx'
import { createTrip } from '../../worker/repos/trips'
import { createItem, listItems } from '../../worker/repos/items'
import type { Item } from '@shared/items'
import { listChecklist } from '../../worker/repos/checklist'
import { generateOutfits, setGroupStatus, syncChecklistFromOutfits } from '../../worker/repos/outfits'
import { rowSecondaryParts } from '@shared/checklist'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * G6 — a wardrobe name says what the thing is, and stops repeating its own row.
 *
 * Measured before anything changed, against the real workbook: of its 85
 * clothing rows, **70 carried both the brand and the colour inside the name**,
 * 3 the brand alone, 11 the colour alone, and 1 neither — that last one having
 * neither field recorded. In every one of the 84, the spreadsheet's own
 * description column was already the clean answer, because
 * `composeDisplayName` had built the name as `[colour] [brand] [description]`.
 *
 * The thing this file exists to prove is not the strip. It is that the strip
 * and the importer **agree**. There are two ways into Alex's catalog — a fresh
 * install that imports the workbook, and his existing database corrected by
 * `migrations/0018` — and doc 09 §5a already records what happens when those
 * two drift: a fresh install silently misses a correction the migration made.
 * So the same workbook goes down both paths here and the names are compared row
 * for row.
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

/** The schema as it was before G6 — the state Alex's database is actually in. */
const BEFORE_G6 = '0017_retired_rules.sql'
const NAMES = '0018_wardrobe_names.sql'
const DETAIL = '0019_checklist_detail.sql'
/**
 * H1a's column. Additive, unrelated to naming, and present in production before
 * any Worker that reads it — the same argument `DETAIL` already carries. Today's
 * repo code writes `field_provenance` on every insert, so a pre-G6 schema
 * standing up without it fails on a column that has nothing to do with this file.
 */
const PROVENANCE = '0020_item_field_provenance.sql'
/** H1b's two rating columns. Additive, and written by every insert. */
const RATINGS = '0021_comfort_versatility.sql'

const NOW = 1_780_000_000

let garments: NormalizedGarment[]
let db: TestDatabase

beforeEach(async () => {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  garments = sheets[0]!.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[0] && r[0] !== 'Major Category' && r[1])
    .map(({ r, i }) =>
      normalizeGarment({
        majorCategory: r[0] ?? '', subcategory: r[1] ?? '', description: r[2] ?? '',
        brand: r[3] ?? '', color: r[4] ?? '', styleUse: r[5] ?? '', notes: r[6] ?? '',
        rowNumber: i + 1,
      } satisfies ClothingSource),
    )
  db = createTestDatabase({ upTo: BEFORE_G6, plus: [PROVENANCE, RATINGS] })
})

afterEach(() => {
  db.close()
})

/**
 * The garments this file put there, and not migration 0009's five canonical
 * rows.
 *
 * Every test database carries those five — two of them the Shinola watches
 * whose names this migration must NOT touch — so an assertion over the whole
 * catalog would be an assertion about two unrelated things at once.
 */
async function imported(): Promise<Item[]> {
  const all = await listItems(db.binding, { includeArchived: true })
  return all.filter((item) => item.source === 'seed_import')
}

/**
 * The catalog as it stood before G6: every garment named the way the importer
 * named it then, which is what `composeDisplayName` still computes.
 */
async function seedLegacyCatalog(): Promise<void> {
  for (const g of garments) {
    await createItem(
      db.binding,
      { ...toItemInput(g), displayName: composeDisplayName(g.displayName, g.brand, g.color) },
      NOW,
      'seed_import',
    )
  }
}

describe('the catalog Alex actually has', () => {
  it('is named the way it is, which is why this slice exists', async () => {
    await seedLegacyCatalog()
    const before = await imported()

    const repeats = before.filter(
      (item) =>
        (item.brand && item.displayName.toLowerCase().includes(item.brand.toLowerCase())) ||
        (item.color && item.displayName.toLowerCase().includes(item.color.toLowerCase())),
    )

    // Not "some": nearly all of them. A fix that only reached a handful would
    // not be worth a migration.
    expect(repeats.length).toBeGreaterThan(before.length * 0.9)
    expect(before.find((i) => i.displayName === 'Various Colors Pair of Thieves Boxer Briefs'))
      .toBeTruthy()
  })

  it('ends up named exactly what a fresh install would name it', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)

    const after = await imported()
    const byId = new Map(after.map((item) => [item.id, item]))

    /*
     * Row for row, against what `normalizeGarment` writes today.
     *
     * This is the assertion the whole slice turns on. If the migration and the
     * importer ever disagree, Alex's database and a fresh one hold two
     * different wardrobes with the same ids — and nothing else in the suite
     * would notice.
     */
    for (const g of garments) {
      const item = [...byId.values()].find(
        (i) => i.brand === g.brand && i.color === g.color && i.subcategory === g.subcategory
          && i.displayName === g.displayName,
      )
      expect(item, `${g.displayName} (${g.brand} / ${g.color})`).toBeTruthy()
    }

    const names = after.map((i) => i.displayName).sort()
    const expected = garments.map((g) => g.displayName).sort()
    expect(names).toEqual(expected)
  })

  it('changes the name and nothing else about the row', async () => {
    await seedLegacyCatalog()
    const before = await imported()
    applyMigration(db.raw, NAMES)
    const after = await imported()

    expect(after).toHaveLength(before.length)
    for (const was of before) {
      const now = after.find((i) => i.id === was.id)
      // The id never changes — approved outfits, `outfit_pairing`, learned
      // rules, checklist rows and archive state all point at it.
      expect(now, was.displayName).toBeTruthy()
      expect(now!.brand).toBe(was.brand)
      expect(now!.color).toBe(was.color)
      expect(now!.pattern).toBe(was.pattern)
      expect(now!.category).toBe(was.category)
      expect(now!.subcategory).toBe(was.subcategory)
      expect(now!.warmth).toBe(was.warmth)
      expect(now!.dressiness).toBe(was.dressiness)
      expect(now!.typicalUses).toEqual(was.typicalUses)
      expect(now!.weatherTags).toEqual(was.weatherTags)
      expect(now!.ownedQuantity).toBe(was.ownedQuantity)
      expect(now!.archivedAt).toBe(was.archivedAt)
      expect(now!.neverInclude).toBe(was.neverInclude)
      expect(now!.alwaysInclude).toBe(was.alwaysInclude)
    }
  })

  it('runs twice without taking a second bite', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)
    const once = (await imported()).map((i) => i.displayName).sort()
    applyMigration(db.raw, NAMES)
    const twice = (await imported()).map((i) => i.displayName).sort()

    /*
     * A migration file runs once in production, and this is not really about
     * that. It is about the shape of the rule: after the strip the name no
     * longer starts with the brand or the colour, so the conditions stop
     * matching. A rule that kept biting would be one that could eat a real word.
     */
    expect(twice).toEqual(once)
  })

  it('leaves an archived garment archived, and still renames it', async () => {
    await seedLegacyCatalog()
    const target = (await imported()).find((i) => i.brand === 'Columbia')!
    db.raw.prepare('UPDATE item SET archived_at = ? WHERE id = ?').run(NOW, target.id)

    applyMigration(db.raw, NAMES)

    const after = (await listItems(db.binding, { includeArchived: true })).find(
      (i) => i.id === target.id,
    )!
    expect(after.archivedAt).toBe(NOW)
    expect(after.displayName).not.toContain('Columbia')
    // Archived items stay visible on historical trips, which is the whole
    // reason they are still here to be renamed.
    expect(after.brand).toBe('Columbia')
  })
})

describe('what the cleanup refuses to touch', () => {
  /**
   * The five canonical rows migration 0009 seeds, of which two are watches Alex
   * tells apart BY their colour. Stripping it would leave him with two items
   * both called `Shinola`.
   *
   * The first draft of 0018 did exactly that — it matched on `kind` alone and
   * stripped the two prefixes in independent passes — and
   * `missing-items.test.ts` failed on it. Two conditions stop it now, and
   * removing each one in turn says which does the work: `source` is what saves
   * a `trip_promoted` garment, and the never-leave-it-empty condition is what
   * saves these two, because `Black Shinola` minus its colour and its brand is
   * nothing at all.
   */
  it('leaves a name a person wrote out alone, even when it starts with the colour', async () => {
    /*
     * These two rows are already in every database: migration 0009 seeds the
     * five canonical `MISSING_ITEMS`, and they are `source = 'manual'` because
     * a person wrote those names out rather than a composer building them.
     */
    applyMigration(db.raw, NAMES)

    const watches = (await listItems(db.binding, { search: 'shinola' })).map((i) => ({
      name: i.displayName, brand: i.brand, color: i.color, source: i.source,
    }))

    expect(watches.map((w) => w.name).sort()).toEqual(['Black Shinola', 'White Shinola'])
    expect(watches.every((w) => w.source === 'manual')).toBe(true)
  })

  it('leaves a garment Alex promoted from a trip alone', async () => {
    await createItem(
      db.binding,
      { displayName: 'Blue Patagonia Fleece', category: 'Tops & Outerwear', kind: 'clothing',
        color: 'Blue', brand: 'Patagonia' },
      NOW,
      'trip_promoted',
    )
    applyMigration(db.raw, NAMES)
    expect((await listItems(db.binding, { search: 'Fleece' }))[0]!.displayName).toBe('Blue Patagonia Fleece')
  })

  it('leaves an imported name that does not start with its own fields alone', async () => {
    await createItem(
      db.binding,
      { displayName: 'The Good Jacket', category: 'Tops & Outerwear', kind: 'clothing',
        color: 'Black', brand: 'Arc’teryx' },
      NOW,
      'seed_import',
    )
    applyMigration(db.raw, NAMES)
    // A nickname is not a composed name, and nothing here can tell it is one
    // except that it does not have the shape the composer produced.
    expect((await listItems(db.binding, { search: 'Jacket' }))[0]!.displayName).toBe('The Good Jacket')
  })

  it('never leaves a garment with no name at all', async () => {
    await createItem(
      db.binding,
      { displayName: 'Black', category: 'Tops & Outerwear', kind: 'clothing', color: 'Black' },
      NOW,
      'seed_import',
    )
    applyMigration(db.raw, NAMES)
    const kept = (await listItems(db.binding, {})).filter((i) => i.source === 'seed_import')
    expect(kept.map((i) => i.displayName)).toEqual(['Black'])
  })

  it('leaves gear alone, because nothing ever composed a gear name', async () => {
    await createItem(
      db.binding,
      { displayName: 'Black Anker Charger', category: 'Electronics', kind: 'gear',
        color: 'Black', brand: 'Anker' },
      NOW,
      'seed_import',
    )
    applyMigration(db.raw, NAMES)
    expect((await listItems(db.binding, { search: 'Charger' }))[0]!.displayName).toBe('Black Anker Charger')
  })
})

describe('where the words went instead', () => {
  it('says who made it and which one it is, under the name', () => {
    expect(garmentDetail({ brand: 'Columbia', color: 'Black', pattern: null }))
      .toBe('Columbia · Black')
    expect(garmentDetail({ brand: null, color: 'Gray', pattern: null })).toBe('Gray')
    expect(garmentDetail({ brand: 'Nike', color: null, pattern: null })).toBe('Nike')
    // Nothing recorded is nothing said — never a bare separator standing in for
    // a fact nobody has.
    expect(garmentDetail({ brand: null, color: null, pattern: null })).toBeNull()
    expect(garmentDetail({ brand: '  ', color: '', pattern: null })).toBeNull()
  })

  it('puts it on a packing list, beside a name that no longer says it', async () => {
    applyMigration(db.raw, NAMES)
    applyMigration(db.raw, DETAIL)

    /*
     * Two garments that after G6 share a name, which is the whole problem: Alex
     * owns seven quarter-zips and the workbook's description column calls every
     * one of them `Quarter-Zip`. Only the brand and the colour tell them apart,
     * and only one screen was showing those.
     *
     * Driven through `syncChecklistFromOutfits` because that is how clothing
     * actually reaches a packing list — `generateChecklist` is the rules path,
     * and a garment with no rule has no quantity for it to compute.
     */
    seedWardrobe(db)
    db.raw.prepare("UPDATE item SET brand = 'REI', color = 'Green' WHERE id = 'tee'").run()
    db.raw.prepare("UPDATE item SET brand = 'Vuori', color = 'Navy' WHERE id = 'tee2'").run()
    db.raw.prepare("UPDATE item SET display_name = 'Layering T-Shirt' WHERE id IN ('tee','tee2')").run()

    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW)
    for (const group of groups) {
      if (group.slots.every((slot) => !slot.required || slot.itemId)) {
        await setGroupStatus(db.binding, group.id, 'approved', NOW)
      }
    }
    await syncChecklistFromOutfits(db.binding, trip, NOW)

    const entries = await listChecklist(db.binding, trip.id)
    const shared = entries.filter((e) => e.name === 'Layering T-Shirt')
    expect(shared.length, 'both shirts reached the list').toBeGreaterThan(1)

    // Same name, and no two rows a person could not tell apart.
    expect(shared.every((e) => !!e.detail)).toBe(true)
    expect(new Set(shared.map((e) => e.detail)).size).toBe(shared.length)
    expect(shared.map((e) => e.detail).sort()).toEqual(['REI · Green', 'Vuori · Navy'])

    // And the line the row actually renders leads with it.
    expect(rowSecondaryParts(shared[0]!)[0]).toBe(shared[0]!.detail)
  })

  it('leaves a row written before G6 exactly as it was', async () => {
    applyMigration(db.raw, DETAIL)

    /*
     * A checklist row from an older trip still carries the composed name in its
     * snapshot, on purpose (0004): a finished trip reads the way it read when it
     * was packed. Giving it a detail line would print the brand and the colour
     * twice on a row that is already correct, so 0019 backfills nothing.
     */
    db.raw
      .prepare(
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                      required_qty, source, sort_order, created_at, updated_at)
         VALUES ('legacy', ?, NULL, 'Black Columbia Zip-Up Jacket', 'Tops & Outerwear',
                 1, 'always_packed', 0, ?, ?)`,
      )
      .run((await createTrip(db.binding, TRIP, NOW)).id, NOW, NOW)

    const row = db.raw
      .prepare('SELECT name_snapshot, detail_snapshot FROM checklist_entry WHERE id = ?')
      .get('legacy') as { name_snapshot: string; detail_snapshot: string | null }

    expect(row.name_snapshot).toBe('Black Columbia Zip-Up Jacket')
    expect(row.detail_snapshot).toBeNull()
  })
})

describe('finding a garment once its name stopped saying everything', () => {
  it('still finds it by brand, by colour and by what it is', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)

    const byBrand = (await listItems(db.binding, { search: 'columbia' }))
      .filter((i) => i.source === 'seed_import')
    expect(byBrand.length).toBeGreaterThan(0)
    // The proof that this is doing real work: the word is no longer in any of
    // the names it just found.
    expect(byBrand.every((i) => !i.displayName.toLowerCase().includes('columbia'))).toBe(true)

    const byColor = (await listItems(db.binding, { search: 'dark green' }))
      .filter((i) => i.source === 'seed_import')
    expect(byColor.length).toBeGreaterThan(0)
    expect(byColor.every((i) => !i.displayName.toLowerCase().includes('dark green'))).toBe(true)

    // And by the kind of thing it is, which is what makes "jacket" find a
    // garment Alex called something else.
    const byKind = await listItems(db.binding, { search: 'outerwear' })
    expect(byKind.length).toBeGreaterThan(0)

    const byName = await listItems(db.binding, { search: 'quarter-zip' })
    expect(byName.length).toBeGreaterThan(1)
  })

  it('keeps the quantity out of the name and in the count', () => {
    const boxers = garments.find((g) => g.source.description.startsWith('Boxer Briefs'))!
    expect(extractQuantity(boxers.source.description).quantity).toBe(15)
    expect(boxers.displayName).toBe('Boxer Briefs')
    expect(boxers.ownedQuantity).toBe(15)
  })
})
