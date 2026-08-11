import { readFileSync } from 'node:fs'
import { contextForLevel } from '@shared/dressiness'
import { normalizeGarment, type ClothingSource } from '@shared/import'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import { readWorkbook } from '@shared/xlsx'

/**
 * Alex's actual closet, as the planner would hold it after an import.
 *
 * Built from `seed-data/Master_Packing_Database_Complete.xlsx` — the approved
 * workbook — through the REAL importer, rather than from garments invented to
 * make a point. That distinction is the reason this file exists.
 *
 * A hand-written fixture can only contain the defect its author already
 * understood. The V1.1 beach defect was not like that: the button-up shirt won
 * the beach top slot because `Casual / Smart Casual` in the spreadsheet parses
 * to `['casual','dressy']`, which both satisfies the beach template's `casual`
 * requirement AND scores 2 on versatility — while `Athletic Tank Top`, tagged
 * only `['athletic']`, was rejected outright. Nobody would have written that
 * fixture by hand, because nobody believed it until the real rows produced it.
 *
 * So: the real 85 garments, the real importer, the real inference. What comes
 * out is what production has.
 *
 * ## What this is NOT
 *
 * Not a database. There is no D1 here and no migration — `dressinessContexts`
 * is applied exactly as migration 0022 applies it, one context per legacy
 * level, and everything else is the importer's own output. Tests that need
 * storage semantics belong with `createTestDatabase`; tests that need the
 * planner's answers on a real wardrobe belong here.
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'

function toItem(garment: ReturnType<typeof normalizeGarment>, id: string): Item {
  /*
   * The contexts migration 0022 writes for this row, and no more.
   *
   * One legacy level maps to exactly one context. Widening it here — giving a
   * Smart casual shirt `['casual','smart_casual']` because that "feels right" —
   * would quietly hand the fixture a better wardrobe than Alex actually has,
   * and every eligibility assertion below it would be measuring the fixture.
   */
  const context = contextForLevel(garment.dressiness)

  return {
    id,
    kind: 'clothing',
    displayName: garment.displayName,
    category: garment.category,
    subcategory: garment.subcategory,
    color: garment.color,
    pattern: garment.pattern,
    brand: garment.brand,
    notes: garment.notes,
    usageFrequency: 'sometimes',
    warmth: garment.warmth,
    dressiness: garment.dressiness,
    dressinessContexts: context === null ? [] : [context],
    weatherTags: [],
    typicalUses: garment.typicalUses,
    reuseCapacity: null,
    ownedQuantity: garment.ownedQuantity,
    ...UNRECORDED_TRAITS,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    archivedAt: null,
    source: 'seed_import',
    comfort: null,
    versatility: null,
    fieldProvenance: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

/** Every garment in the approved workbook, as `Item` rows. */
export async function realCloset(): Promise<Item[]> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))

  return sheets[0]!.rows
    .map((row, index) => ({ row, index }))
    // The header row, and the trailing blanks a spreadsheet always carries.
    .filter(({ row }) => row[0] && row[0] !== 'Major Category' && row[1])
    .map(({ row, index }) =>
      toItem(
        normalizeGarment({
          majorCategory: row[0] ?? '',
          subcategory: row[1] ?? '',
          description: row[2] ?? '',
          brand: row[3] ?? '',
          color: row[4] ?? '',
          styleUse: row[5] ?? '',
          notes: row[6] ?? '',
          rowNumber: index + 1,
        } satisfies ClothingSource),
        `g${index}`,
      ),
    )
}

/**
 * The garments whose display name contains `text`, case-insensitively.
 *
 * By name because that is how the defect was REPORTED — "it put a dressy
 * button-up at the beach" — and a test that reads the way the bug report reads
 * is a test whose failure Alex could recognise. Nothing in the planner reads
 * display names to make a decision; this is a test convenience only.
 */
export function named(closet: Item[], text: string): Item[] {
  return closet.filter((item) => item.displayName.toLowerCase().includes(text.toLowerCase()))
}

/** The one garment with this name. Throws when the closet has none or several. */
export function one(closet: Item[], text: string): Item {
  const matches = named(closet, text)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one garment matching "${text}", found ${matches.length}`)
  }
  return matches[0]!
}
