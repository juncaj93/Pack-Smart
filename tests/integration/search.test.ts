import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createItem, listItems } from '../../worker/repos/items'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * `GET /api/items?search=` — the forgiving search, through the real catalog.
 *
 * `tests/unit/search.test.ts` owns the RULE, over plain strings. This file owns
 * the thing that rule had to be moved out of the database to get: the search
 * used to be six `LIKE '%needle%'` comparisons in the WHERE clause, and SQLite
 * on D1 has no edit distance to hand and may load no extension that does. So
 * `listItems` reads the catalog and filters beside it.
 *
 * Two properties are asserted here rather than in the unit file, because only a
 * real catalog can show them:
 *
 *   1. **Nothing that used to be found stops being found, and nothing that used
 *      to be found gains company.** The tightest tier is a strict superset of
 *      the substring rule it replaced, and the tiers are evaluated narrowest
 *      first — so a query that worked returns exactly what it returned.
 *   2. The ordering is still the database's. The filter preserves it; it does
 *      not re-sort by how well anything matched.
 */

const NOW = 1_700_000_000
let db: TestDatabase

const WARDROBE: Array<[string, Record<string, unknown>]> = [
  ['Layering T-Shirt', { subcategory: 'T-Shirt', color: 'Heather Gray', brand: 'Uniqlo' }],
  ['Long-Sleeve T-Shirt', { subcategory: 'T-Shirt', color: 'Navy', brand: 'Uniqlo' }],
  ['Button-Up Shirt', { subcategory: 'Shirt', color: 'White', brand: "Levi's" }],
  ['Zip-Up Jacket', { subcategory: 'Jacket', color: 'Blue', brand: 'Columbia' }],
  ['Athletic Shorts', { subcategory: 'Shorts', color: 'Black', brand: 'Nike' }],
  ['Sports Cap', { subcategory: 'Hat', color: 'Black', brand: 'Nike' }],
  ['Crewneck Sweater', { subcategory: 'Sweater', color: 'Chartreuse', brand: 'Uniqlo' }],
]

beforeEach(async () => {
  db = createTestDatabase()
  for (const [displayName, extra] of WARDROBE) {
    await createItem(
      db.binding,
      { displayName, category: 'Tops & Outerwear', ...extra },
      NOW,
      'manual',
    )
  }
})

afterEach(() => {
  db.close()
})

/** The names this search finds, scoped to the rows this file created. */
async function found(search: string): Promise<string[]> {
  const mine = new Set(WARDROBE.map(([name]) => name))
  const items = await listItems(db.binding, { search })
  return items.map((i) => i.displayName).filter((name) => mine.has(name))
}

describe('what the search now finds that it could not before', () => {
  it('finds a hyphenated name typed without the hyphen', async () => {
    expect(await found('tshirt')).toEqual(['Layering T-Shirt', 'Long-Sleeve T-Shirt'])
    expect(await found('zipup')).toEqual(['Zip-Up Jacket'])
  })

  it('finds a possessive brand typed without the apostrophe', async () => {
    expect(await found('levis')).toEqual(['Button-Up Shirt'])
  })

  it('forgives a typo when nothing matched without forgiving one', async () => {
    expect(await found('jaket')).toEqual(['Zip-Up Jacket'])
    expect(await found('sweter')).toEqual(['Crewneck Sweater'])
    expect(await found('colombia')).toEqual(['Zip-Up Jacket'])
  })

  it('lets two words land in two different columns', async () => {
    // After G6 the name carries neither the brand nor the colour, so this
    // query had to reach two columns at once or it could not work at all.
    expect(await found('blue jacket')).toEqual(['Zip-Up Jacket'])
    expect(await found('navy tshirt')).toEqual(['Long-Sleeve T-Shirt'])
  })
})

describe('what it still refuses, which is the half that keeps it useful', () => {
  it('does not answer shorts with shirts', async () => {
    /*
     * The measurement that produced the tier rule. `shorts`/`shirts` and
     * `shorts`/`sports` are each one edit apart, so a search that forgave an
     * edit on every row buried the right answer among wrong ones.
     */
    expect(await found('shorts')).toEqual(['Athletic Shorts'])
  })

  it('does not let a typed hyphen widen the query', async () => {
    // Splitting on the hyphen first would make `t` match nearly everything and
    // collapse this to `shirt`, which is `Button-Up Shirt` as well.
    expect(await found('t-shirt')).toEqual(['Layering T-Shirt', 'Long-Sleeve T-Shirt'])
  })

  it('finds nothing when the wardrobe holds nothing like it', async () => {
    expect(await found('kayak')).toEqual([])
    expect(await found('linen trousers')).toEqual([])
  })
})

describe('the parts that must not have changed', () => {
  it('returns exactly what the old substring rule returned, where it returned anything', async () => {
    for (const [query, expected] of [
      ['shirt', ['Button-Up Shirt', 'Layering T-Shirt', 'Long-Sleeve T-Shirt']],
      ['jacket', ['Zip-Up Jacket']],
      ['black', ['Athletic Shorts', 'Sports Cap']],
      ['uniqlo', ['Crewneck Sweater', 'Layering T-Shirt', 'Long-Sleeve T-Shirt']],
      ['chartreuse', ['Crewneck Sweater']],
    ] as const) {
      expect(await found(query)).toEqual([...expected])
    }
  })

  it('keeps both spellings of grey finding each other', async () => {
    // The column is deliberately never canonicalised on write, so it genuinely
    // holds either — and a needle taken literally fails on the exact word the
    // list is displaying.
    expect(await found('grey')).toEqual(['Layering T-Shirt'])
    expect(await found('gray')).toEqual(['Layering T-Shirt'])
  })

  it('leaves the ordering to the database rather than to how well anything matched', async () => {
    // Alphabetical, which is `listItems`' own ORDER BY. A filter may not resort.
    expect(await found('uniqlo')).toEqual([
      'Crewneck Sweater',
      'Layering T-Shirt',
      'Long-Sleeve T-Shirt',
    ])
  })

  it('returns the whole catalog when nothing was typed', async () => {
    expect(await found('')).toHaveLength(WARDROBE.length)
    expect(await found('   ')).toHaveLength(WARDROBE.length)
  })
})
