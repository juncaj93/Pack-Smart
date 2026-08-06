import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  composeDisplayName,
  normalizeGarment,
  reconcile,
  toItemInput,
  type ClothingSource,
  type NormalizedGarment,
} from '@shared/import'
import { readWorkbook } from '@shared/xlsx'
import { createItem, listItems } from '../../worker/repos/items'
import { applyMigration, createTestDatabase, type TestDatabase } from './d1'

/**
 * G5b and G6 meet here, and only here.
 *
 * Each is correct on its own branch and each is green on its own branch. What
 * neither can see is that **G5b decides what an incoming row already IS by its
 * name, and G6 changes what a garment is called.** `identityOf` is
 * `name|brand|colour|pattern`, so changing the name half of it changes every
 * answer the reconciler gives.
 *
 * Doc 09 §0a records the consequence as a merge note. This file makes it a
 * measurement, against the real workbook, because a sequencing constraint that
 * lives only in prose is one nobody is holding.
 *
 * **The three states that must classify correctly**, which are the three a real
 * database is ever in:
 *
 *   1. pre-G6 stored names, pre-G6 importer — Alex's database today;
 *   2. migration `0018` applied, post-G6 importer — his database after the G6
 *      deploy, and a fresh install, which must agree;
 *   3. a repeat import after `0018` — idempotent, nothing added.
 *
 * **And the two transitional states that do NOT**, asserted deliberately rather
 * than left to be discovered. They are the release-sequencing constraint:
 *
 *   4. pre-G6 stored names, post-G6 importer — every garment reads as `new`;
 *   5. `0018`-renamed rows, pre-G6 importer — the same, in the other direction.
 *
 * A test asserting the broken behaviour is unusual and it is the point: these
 * two are not defects to fix, they are windows to *not import in*. If someone
 * later makes state 4 classify correctly, this test fails and they read why.
 *
 * @see product-docs/09_… §0a, "Do not import between merging G5b and running 0018"
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

/** The schema as it is in production today: G5 merged, G6 not. */
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
        majorCategory: r[0] ?? '',
        subcategory: r[1] ?? '',
        description: r[2] ?? '',
        brand: r[3] ?? '',
        color: r[4] ?? '',
        styleUse: r[5] ?? '',
        notes: r[6] ?? '',
        rowNumber: i + 1,
      } satisfies ClothingSource),
    )

  // 0019 is additive, unrelated, and present in production before any Worker
  // that reads it — the same reason `retired-rules.test.ts` names it.
  db = createTestDatabase({ upTo: BEFORE_G6, plus: [DETAIL, PROVENANCE] })
})

afterEach(() => {
  db.close()
})

/**
 * The catalog as Alex has it: every garment named the way the importer named it
 * before G6, which is what `composeDisplayName` still computes.
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

/**
 * The stored catalog, whole.
 *
 * Deliberately not a projection of the fields identity uses. `reconcile`
 * separates *identity* from *what changed*, and a field this function dropped
 * would read as `undefined` against the incoming row's real value — turning
 * every exact duplicate into an update candidate and quietly inverting what
 * this file claims to measure. The first draft of it did exactly that.
 */
async function catalog() {
  const all = await listItems(db.binding, { includeArchived: true })
  return all.filter((item) => item.source === 'seed_import')
}

/**
 * One incoming row, named however the caller says.
 *
 * `toItemInput` leaves `brand`, `color` and `pattern` optional; `reconcile`
 * requires them present, because the difference between absent and null is
 * exactly the difference between "not asked" and "recorded as nothing".
 */
function rowsNamed(name: (g: NormalizedGarment) => string) {
  return garments.map((g) => ({
    ...toItemInput(g),
    displayName: name(g),
    brand: g.brand ?? null,
    color: g.color ?? null,
    pattern: g.pattern ?? null,
  }))
}

/** What the importer sends today (G6): the description column, on its own. */
function postG6Rows() {
  return rowsNamed((g) => g.displayName)
}

/** What the importer sent before G6: `[colour] [brand] [description]`. */
function preG6Rows() {
  return rowsNamed((g) => composeDisplayName(g.displayName, g.brand, g.color))
}

function tally(rows: Array<{ decision: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.decision] = (out[r.decision] ?? 0) + 1
  return out
}

/* ------------------------------------------------------------------ */
/* The workbook itself — so every count below is anchored to a number  */
/* ------------------------------------------------------------------ */

describe('the workbook these states are measured against', () => {
  it('is the real one, and it is the size doc 09 records', () => {
    expect(garments.length).toBe(85)
  })
})

/* ------------------------------------------------------------------ */
/* State 1 — Alex's database today, and the importer that is deployed  */
/* ------------------------------------------------------------------ */

describe('state 1 — pre-G6 stored names, pre-G6 importer', () => {
  it('reads every garment as one it already has', async () => {
    await seedLegacyCatalog()

    const counts = tally(reconcile(preG6Rows(), await catalog()))

    expect(counts.exact_duplicate).toBe(85)
    expect(counts.new ?? 0).toBe(0)
    expect(counts.likely_duplicate ?? 0).toBe(0)
    expect(counts.conflict ?? 0).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* State 2 — after the G6 deploy, which runs 0018 and then the Worker  */
/* ------------------------------------------------------------------ */

describe('state 2 — migration 0018 applied, post-G6 importer', () => {
  it('reads every garment as one it already has', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)

    const counts = tally(reconcile(postG6Rows(), await catalog()))

    expect(counts.exact_duplicate).toBe(85)
    expect(counts.new ?? 0).toBe(0)
    expect(counts.likely_duplicate ?? 0).toBe(0)
    expect(counts.conflict ?? 0).toBe(0)
  })

  it('is the same answer a fresh install gives, which is the point of 0018', async () => {
    // A fresh install never had a composed name: the importer writes the
    // structured one from the start. If the migration and the importer agree,
    // the two databases are indistinguishable to the reconciler.
    for (const g of garments) {
      await createItem(db.binding, { ...toItemInput(g), displayName: g.displayName }, NOW, 'seed_import')
    }

    const counts = tally(reconcile(postG6Rows(), await catalog()))
    expect(counts.exact_duplicate).toBe(85)
  })
})

/* ------------------------------------------------------------------ */
/* State 3 — the second import, which is the whole reason G5b exists   */
/* ------------------------------------------------------------------ */

describe('state 3 — a repeat import after 0018', () => {
  it('adds nothing, twice over', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)

    const after0018 = await catalog()
    expect(tally(reconcile(postG6Rows(), after0018)).exact_duplicate).toBe(85)

    /*
     * And again against the same catalog, because idempotence that holds once
     * and drifts on the third run is not idempotence. Nothing was written
     * between the two, so the answer must be identical rather than merely
     * similar.
     */
    expect(tally(reconcile(postG6Rows(), after0018))).toEqual({ exact_duplicate: 85 })
  })

  it('leaves the stored names alone when 0018 runs a second time', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)
    const once = (await catalog()).map((i) => i.displayName).sort()

    applyMigration(db.raw, NAMES)
    const twice = (await catalog()).map((i) => i.displayName).sort()

    expect(twice).toEqual(once)
  })
})

/* ------------------------------------------------------------------ */
/* States 4 and 5 — the windows. Asserted so they cannot be forgotten. */
/* ------------------------------------------------------------------ */

describe('the release-sequencing constraint, measured rather than asserted in prose', () => {
  /**
   * **Do not run an import in this window.** It is the gap between the post-G6
   * importer reaching production and `migrations/0018` having renamed the rows
   * it compares against.
   *
   * The deploy applies migrations before uploading the Worker, so the intended
   * window is close to zero — but "close to zero" is a property of one
   * workflow's ordering, not a guarantee, and an import started by hand at the
   * wrong minute would double the wardrobe with no error and no warning.
   */
  it('state 4 — pre-G6 stored names against the post-G6 importer: everything reads as new', async () => {
    await seedLegacyCatalog()

    const counts = tally(reconcile(postG6Rows(), await catalog()))

    /*
     * The whole tally, pinned, because a partial assertion here would let the
     * shape of the damage change without anyone noticing.
     *
     * 84 of 85 go wrong, and the one that does not is the measurement worth
     * having: `composeDisplayName` only ever prepended a brand or a colour the
     * row actually recorded, and `Pickleball Shoes` is the single workbook
     * garment with NEITHER. Its name was its own description before G6 and
     * after it, so its identity never moved.
     *
     * The 9 `likely_duplicate`s are not a consolation. `bareName` strips the
     * brand off the stored name, which bridges the gap for exactly those 9 —
     * and their default choice is `import_separately`. They are questions Alex
     * would have to answer correctly nine times, not garments the reconciler
     * saves on his behalf.
     *
     * So the cost of importing in this window is a second wardrobe of up to 84
     * garments, silently, with no error for him to see and nothing thrown for
     * anything to catch.
     */
    expect(counts).toEqual({ new: 75, likely_duplicate: 9, exact_duplicate: 1 })
  })

  it('state 5 — 0018-renamed rows against the pre-G6 importer: the same, in reverse', async () => {
    await seedLegacyCatalog()
    applyMigration(db.raw, NAMES)

    const counts = tally(reconcile(preG6Rows(), await catalog()))

    /*
     * Same single survivor, for the same reason, and one row lands on
     * `conflict` — two stored garments now answer to the bare name this row
     * carries. A conflict at least ASKS; it is still 84 rows of questions and
     * duplicates where there should have been none.
     */
    expect(counts).toEqual({ new: 76, likely_duplicate: 7, conflict: 1, exact_duplicate: 1 })
  })

  it('and the two safe states are the ones either side of it', async () => {
    /*
     * The sequencing rule in one assertion, so a reader does not have to hold
     * five describes in their head: it is safe when the stored names and the
     * importer are from the same side of G6, and only then.
     */
    await seedLegacyCatalog()

    const before = tally(reconcile(preG6Rows(), await catalog())).exact_duplicate
    applyMigration(db.raw, NAMES)
    const after = tally(reconcile(postG6Rows(), await catalog())).exact_duplicate

    expect([before, after]).toEqual([85, 85])
  })
})
