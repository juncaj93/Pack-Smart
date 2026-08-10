import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createItem, listItems, updateItem } from '../../worker/repos/items'
import { garmentDetail } from '@shared/items'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * What the catalog keeps while the screen says grey.
 *
 * `tests/unit/worker/colour-spelling.test.ts` asserts the two mapping
 * functions. This asserts the boundary they must NOT cross.
 *
 * The first version of this feature canonicalised the colour on write — `Grey`
 * in, `Gray` stored — on the theory that it protected import identity. It did
 * the opposite, and five existing tests in `import-reconcile`, `import-review`
 * and `provenance` said so within a minute: reconciliation compares a
 * spreadsheet row against the stored item by `name|brand|colour`, so a column
 * that disagrees with its own source stops matching it, and a workbook whose
 * colour really is `Grey` comes back on the next import as a wardrobe of
 * brand-new garments. That is precisely the silent duplicate `CLAUDE.md`
 * requires be detected rather than manufactured.
 *
 * So the rule is the plain one: **the column says what its source said.** The
 * respelling is applied where a colour is read, and the item sheet keeps the
 * stored string in its draft — mapping only the input's `value` — so a save
 * that never touched the colour returns the characters it was handed.
 *
 * These are here to make that boundary fail loudly if anyone re-derives the
 * original mistake.
 */

const NOW = 1_700_000_000

describe('what the column keeps when the screen says grey', () => {
  let db: TestDatabase

  beforeEach(() => {
    db = createTestDatabase()
  })

  afterEach(() => {
    db.raw.close()
  })

  function storedColour(id: string): string {
    return (db.raw.prepare('SELECT color FROM item WHERE id = ?').get(id) as { color: string }).color
  }

  /*
   * The regression guard. A `Grey` that arrives is a `Grey` that is stored,
   * because import reconciliation will later compare this column against the
   * spreadsheet cell it came from.
   */
  it('stores a grey the source actually said, without respelling it', async () => {
    const created = await createItem(
      db.binding,
      { displayName: 'Layering T-Shirt', category: 'Tops & Outerwear', color: 'Heather Grey' },
      NOW,
      'seed_import',
    )
    expect(storedColour(created.id)).toBe('Heather Grey')
  })

  it('stores a gray the source actually said, and shows it as grey', async () => {
    const created = await createItem(
      db.binding,
      { displayName: 'Quarter-Zip', category: 'Tops & Outerwear', color: 'Heather Gray' },
      NOW,
      'seed_import',
    )
    expect(storedColour(created.id)).toBe('Heather Gray')
    expect(garmentDetail(created)).toBe('Heather Grey')
  })

  /*
   * The case the item sheet has to get right on its own: he opened a garment to
   * rename it, the colour field showed him `Grey`, and nothing about that edit
   * was about the colour. The sheet keeps the stored string in its draft and
   * respells only what it renders, so the value that comes back is the value it
   * was given — asserted here at the repository, which is what actually writes.
   */
  it('writes back exactly the colour it was handed on an unrelated edit', async () => {
    const created = await createItem(
      db.binding,
      { displayName: 'Layering T-Shirt', category: 'Tops & Outerwear', color: 'Gray' },
      NOW,
      'seed_import',
    )

    await updateItem(
      db.binding,
      created.id,
      { displayName: 'Layering Tee', category: 'Tops & Outerwear', color: 'Gray' },
      NOW + 1,
    )

    expect(storedColour(created.id)).toBe('Gray')
  })

  it('leaves a colour that was never grey alone', async () => {
    const created = await createItem(
      db.binding,
      { displayName: 'Zip-Up Jacket', category: 'Tops & Outerwear', color: 'Greenish Slate' },
      NOW,
      'manual',
    )
    expect(storedColour(created.id)).toBe('Greenish Slate')
    expect(garmentDetail(created)).toBe('Greenish Slate')
  })

  /*
   * Searching by colour is how Alex finds one of seven quarter-zips, and the
   * screen has just taught him the word is `grey`. Because the column is left
   * as its source wrote it, BOTH spellings are really in there — so neither
   * needle may be the only one that works, and a search that fails on the exact
   * word the list is displaying reads as "the app has lost my jumper".
   */
  it('finds both spellings from either spelling', async () => {
    for (const [name, color] of [
      ['Turtleneck Sweater', 'Gray'],
      ['Layering T-Shirt', 'Heather Grey'],
      // Not black: `migrations/0009` seeds a Black Shinola, and a fixture that
      // collides with the seed is a fixture asserting somebody else's row.
      ['Zip-Up Jacket', 'Chartreuse'],
    ] as const) {
      await createItem(
        db.binding,
        { displayName: name, category: 'Tops & Outerwear', color },
        NOW,
        'seed_import',
      )
    }

    const found = ['grey', 'gray', 'GREY'].map(async (search) =>
      (await listItems(db.binding, { search })).map((i) => i.displayName).sort(),
    )

    for (const names of await Promise.all(found)) {
      expect(names).toEqual(['Layering T-Shirt', 'Turtleneck Sweater'])
    }

    // And an ordinary needle still searches for exactly itself.
    expect((await listItems(db.binding, { search: 'chartreuse' })).map((i) => i.displayName))
      .toEqual(['Zip-Up Jacket'])
  })
})
