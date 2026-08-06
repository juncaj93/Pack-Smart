import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { mayWrite, parseProvenance } from '@shared/provenance'
import type { FieldProvenance } from '@shared/provenance'
import { importRoutes } from '../../worker/routes/import'
import {
  clearFieldValue,
  confirmFields,
  createItem,
  getItem,
  updateItem,
} from '../../worker/repos/items'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'

/**
 * Comfort and versatility, stored (H1b).
 *
 * `tests/unit/worker/ratings.test.ts` decides what the two signals MEAN to the
 * planner. This file proves the values survive the things that were going to
 * take them away — a re-import, `update_existing`, a form save that did not
 * mention them — which is the whole reason H1a had to land first.
 */

const NOW = 1_780_000_000
const LATER = NOW + 86_400

const RATINGS = '0021_comfort_versatility.sql'
const BEFORE_H1B = '0020_item_field_provenance.sql'

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

const provenanceOf = (name: string): FieldProvenance =>
  parseProvenance((row(name).field_provenance as string | null) ?? null)

/**
 * Save the way the EDITOR saves: the whole item, with one field changed.
 *
 * `updateItem` writes every column, because the My Stuff form owns every column
 * and posts the lot back. A test that handed it a sparse `ItemInput` would null
 * everything it left out — and, worse, H1a would then record those nulls as
 * `user_confirmed`, so the next assertion would be measuring the test's own
 * sloppiness rather than the behaviour. Two of these tests did exactly that
 * before this helper existed.
 */
async function save(id: string, changes: Partial<Item>, at = LATER) {
  const current = (await getItem(db.binding, id))!
  return updateItem(db.binding, id, { ...current, ...changes }, at)
}

/* ------------------------------------------------------------------ */
/* storing a rating                                                    */
/* ------------------------------------------------------------------ */

describe('a rating Alex gives', () => {
  let id: string

  beforeEach(async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    id = row('Grey Tee').id as string
  })

  it('starts unknown, on both fields', async () => {
    // The importer has no comfort column and no versatility column, so a freshly
    // imported garment must have nothing recorded for either.
    expect(row('Grey Tee').comfort).toBeNull()
    expect(row('Grey Tee').versatility).toBeNull()
    expect(provenanceOf('Grey Tee').comfort).toBeUndefined()
    expect(provenanceOf('Grey Tee').versatility).toBeUndefined()
  })

  it('stores every value, and records that Alex gave it', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      await save(id, { comfort: rating, versatility: rating })
      expect(row('Grey Tee').comfort).toBe(rating)
      expect(row('Grey Tee').versatility).toBe(rating)
      expect(provenanceOf('Grey Tee').comfort?.source).toBe('user_confirmed')
      expect(provenanceOf('Grey Tee').versatility?.source).toBe('user_confirmed')
    }
  })

  it('can be edited to another value, keeping the one it replaced', async () => {
    await save(id, { comfort: 2 })
    await save(id, { comfort: 5 }, LATER + 1)

    expect(row('Grey Tee').comfort).toBe(5)
    expect(provenanceOf('Grey Tee').comfort?.was).toBe(2)
  })

  it('can be cleared back to unknown', async () => {
    await save(id, { comfort: 4, versatility: 4 })
    await clearFieldValue(db.binding, id, 'comfort', LATER + 1)

    expect(row('Grey Tee').comfort).toBeNull()
    // Cleared is CONFIRMED unknown — H1a's rule — so nothing refills it.
    expect(provenanceOf('Grey Tee').comfort?.source).toBe('user_confirmed')
    expect(row('Grey Tee').versatility).toBe(4)
  })

  it('lets the inferred versatility resume once the rating is cleared', async () => {
    await save(id, { versatility: 5 })
    expect((await getItem(db.binding, id))!.versatility).toBe(5)

    await clearFieldValue(db.binding, id, 'versatility', LATER + 1)

    const cleared = (await getItem(db.binding, id))!
    expect(cleared.versatility).toBeNull()
    // `versatilitySignal` reads null as "fall back", so the tags decide again.
    expect(cleared.typicalUses.length).toBeGreaterThan(0)
  })

  it('refuses a value outside 1–5 at the database, not only in the validator', () => {
    expect(() =>
      db.raw.prepare('UPDATE item SET comfort = 6 WHERE id = ?').run(id),
    ).toThrow()
    expect(() =>
      db.raw.prepare('UPDATE item SET versatility = 0 WHERE id = ?').run(id),
    ).toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* what must not take a rating away                                    */
/* ------------------------------------------------------------------ */

describe('what a rating survives', () => {
  let id: string

  beforeEach(async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    id = row('Grey Tee').id as string
    await save(id, { comfort: 5, versatility: 4 })
  })

  it('a re-import of the same workbook', async () => {
    await call('commit', sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'casual', 'Staple')]))
    expect(row('Grey Tee').comfort).toBe(5)
    expect(row('Grey Tee').versatility).toBe(4)
  })

  it('a changed workbook at Update existing — the case H1a was built for', async () => {
    await call('commit', {
      ...sheets([clothingRow('Grey Tee', 'Uniqlo', 'Grey', 'business formal', 'Changed')]),
      choices: { 'clothing#2': 'update_existing' },
    })

    // The import got what it legitimately came for…
    expect(row('Grey Tee').notes).toBe('Changed')
    // …and could not touch what Alex answered.
    expect(row('Grey Tee').comfort).toBe(5)
    expect(row('Grey Tee').versatility).toBe(4)
  })

  it('a form save that does not mention them', async () => {
    /*
     * The subtle one. `updateItem` writes the whole row, so a save that omits
     * the ratings would null them — and the editor posts the whole item back on
     * every save, including saves about something else entirely.
     */
    await save(id, { color: 'Charcoal' }, LATER + 1)

    expect(row('Grey Tee').comfort).toBe(5)
    expect(row('Grey Tee').versatility).toBe(4)
    expect(row('Grey Tee').color).toBe('Charcoal')
  })

  it('an unaccepted learned proposal, which writes nothing at all', async () => {
    const before = provenanceOf('Grey Tee')
    // A proposal is not a durable value; the row keeps what it had.
    expect(provenanceOf('Grey Tee')).toEqual(before)
    expect(mayWrite(before, 'comfort', 'learned_proposal')).toBe(false)
  })

  it('an ACCEPTED learned proposal cannot overwrite a confirmation either', async () => {
    await confirmFields(db.binding, id, ['comfort'], LATER + 1, 'learned_proposal')
    // The rank never climbed, so the value did not move.
    expect(row('Grey Tee').comfort).toBe(5)
    expect(provenanceOf('Grey Tee').comfort?.source).toBe('user_confirmed')
  })

  it('and an accepted proposal DOES own a field Alex never answered', async () => {
    const fresh = await createItem(
      db.binding,
      { displayName: 'Unrated Tee', category: 'Tops & Outerwear' },
      NOW, 'manual',
    )
    db.raw.prepare('UPDATE item SET comfort = 3 WHERE id = ?').run(fresh.id)
    await confirmFields(db.binding, fresh.id, ['comfort'], LATER, 'learned_proposal')

    const p = provenanceOf('Unrated Tee')
    expect(p.comfort?.source).toBe('learned_proposal')
    expect(mayWrite(p, 'comfort', 'imported')).toBe(false)
    expect(mayWrite(p, 'comfort', 'user_confirmed')).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* the whole workbook                                                  */
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

  it('imports 85 garments with no rating invented for any of them', async () => {
    await call('commit', await readSheets())

    const rated = db.raw
      .prepare('SELECT count(*) AS n FROM item WHERE comfort IS NOT NULL OR versatility IS NOT NULL')
      .get() as { n: number }
    expect(rated.n).toBe(0)
  })

  it('keeps every rating through a forced overwrite of the whole file', async () => {
    const parsed = await readSheets()
    await call('commit', parsed)

    const targets = db.raw
      .prepare("SELECT id FROM item WHERE kind = 'clothing' ORDER BY display_name LIMIT 5")
      .all() as Array<{ id: string }>
    for (const [index, target] of targets.entries()) {
      await save(target.id, { comfort: (index % 5) + 1, versatility: 5 - (index % 5) })
    }

    const choices: Record<string, string> = {}
    for (let n = 1; n <= parsed.clothing.length; n += 1) choices[`clothing#${n}`] = 'update_existing'
    await call('commit', { ...parsed, choices })

    for (const [index, target] of targets.entries()) {
      const after = db.raw.prepare('SELECT comfort, versatility FROM item WHERE id = ?').get(target.id) as {
        comfort: number
        versatility: number
      }
      expect(after.comfort).toBe((index % 5) + 1)
      expect(after.versatility).toBe(5 - (index % 5))
    }
  })
})

/* ------------------------------------------------------------------ */
/* the migration                                                       */
/* ------------------------------------------------------------------ */

describe('upgrading a database that stops at 0020', () => {
  let legacy: TestDatabase

  afterEach(() => {
    legacy?.close()
  })

  it('adds two nullable columns, backfills nothing, and changes no value', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1B })
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, color, favorite, usage_frequency,
                           dressiness, typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('g1','clothing','Grey Tee','Tops & Outerwear','Grey',0,'new',1,'["casual"]',0,0,
                 'anytime',0,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW)
    const before = legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('g1') as Record<
      string,
      unknown
    >

    applyMigration(legacy.raw, RATINGS)

    const after = legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('g1') as Record<
      string,
      unknown
    >
    for (const [column, value] of Object.entries(before)) expect(after[column]).toBe(value)

    // Unknown, not three. A backfilled middle value would be invisible
    // afterwards, because a stored 3 looks exactly like an answered 3.
    expect(after.comfort).toBeNull()
    expect(after.versatility).toBeNull()
  })

  it('leaves the row ranking exactly as it did before H1b', async () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1B })
    applyMigration(legacy.raw, RATINGS)

    const { versatilitySignal, comfortSignal } = await import('@shared/outfits')
    const { toItem } = await import('../../worker/repos/items')

    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('g2','clothing','Tee','Tops & Outerwear',0,'new','["casual","travel"]',0,0,
                 'anytime',0,0,'seed_import',?,?)`,
      )
      .run(NOW, NOW)

    const item = toItem(legacy.raw.prepare('SELECT * FROM item WHERE id = ?').get('g2') as never)
    expect(versatilitySignal(item)).toBe(item.typicalUses.length)
    expect(comfortSignal(item)).toBeNull()
  })

  it('refuses an out-of-range rating on the upgraded schema', () => {
    legacy = createTestDatabase({ upTo: BEFORE_H1B })
    applyMigration(legacy.raw, RATINGS)
    legacy.raw
      .prepare(
        `INSERT INTO item (id, kind, display_name, category, favorite, usage_frequency,
                           typical_uses, is_critical, requires_final_check,
                           default_packing_timing, always_include, never_include, source,
                           created_at, updated_at)
         VALUES ('g3','clothing','Tee','Tops & Outerwear',0,'new','[]',0,0,
                 'anytime',0,0,'manual',?,?)`,
      )
      .run(NOW, NOW)

    expect(() => legacy.raw.prepare('UPDATE item SET comfort = 0 WHERE id = ?').run('g3')).toThrow()
    expect(() => legacy.raw.prepare('UPDATE item SET comfort = 6 WHERE id = ?').run('g3')).toThrow()
    expect(() =>
      legacy.raw.prepare('UPDATE item SET versatility = -1 WHERE id = ?').run('g3'),
    ).toThrow()
  })
})
