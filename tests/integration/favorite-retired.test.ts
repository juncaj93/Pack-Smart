import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rank } from '@shared/outfits'
import { reviewWardrobe } from '@shared/last-look'
import { createItem, listItems, updateItem } from '../../worker/repos/items'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Favorite is retired, and the column proves it (H1d).
 *
 * The TYPE no longer has the field, so nothing in TypeScript can read it and no
 * unit test could construct a garment that has one. That is the strong half of
 * the guarantee and it needs no test at all — it is the compiler.
 *
 * The half that DOES need a test is the storage. `migrations/0002` still
 * declares `favorite INTEGER NOT NULL DEFAULT 0`, §8.5 keeps it deliberately,
 * and production holds real 1s written before the toggle was removed. So the
 * claim under test is not "the field is gone" — it is **the surviving column
 * changes nothing**, which is the only sentence that can still be false.
 *
 * Every case here writes `favorite = 1` in raw SQL, behind the model's back,
 * exactly as production already has.
 */

const NOW = 1_780_000_000

let db: TestDatabase

/*
 * The test database arrives with `0005_seed_preferences.sql` already applied,
 * so the catalog is never empty. Every assertion below is scoped to the rows
 * this file created — a seeded bite guard drifting into an ordering assertion
 * would make the test about the seed rather than about the star.
 */
function onlyMine(names: string[], all: Array<{ displayName?: string; name?: string }>): string[] {
  const wanted = new Set(names)
  return all
    .map((row) => row.displayName ?? row.name ?? '')
    .filter((name) => wanted.has(name))
}

beforeEach(() => {
  db = createTestDatabase()
})
afterEach(() => {
  db.close()
})

function star(id: string) {
  db.raw.prepare('UPDATE item SET favorite = 1 WHERE id = ?').run(id)
}

/**
 * A garment with a CHOSEN id, not a random one.
 *
 * `rank` breaks an exact tie on `id.localeCompare`, so with `crypto.randomUUID`
 * the tiebreak winner is a coin flip — and a ranking test whose expected order
 * is read back from the ids it happened to get cannot fail. Naming the ids
 * makes the tiebreak the fixed part and the star the variable one, which is the
 * only arrangement in which this measures Favorite.
 */
async function tee(displayName: string, id?: string) {
  return createItem(
    db.binding,
    { displayName, category: 'Tops & Outerwear', usageFrequency: 'sometimes' },
    NOW,
    'manual',
    id ?? crypto.randomUUID(),
  )
}

const EMPTY_CONTEXT = {
  requestedItemIds: new Set<string>(),
  usedCount: new Map<string, number>(),
}

describe('a starred row is an ordinary row', () => {
  it('does not lift a garment in the ranker', async () => {
    /*
     * The star goes on `zzz-starred`, which the id tiebreak puts LAST.
     *
     * Both garments are identical on every surviving criterion, so the only
     * thing that can separate them is that tiebreak — and the only thing that
     * could overturn it is a criterion reading the star. So the expected order
     * is fixed in advance and stated here, rather than derived from whatever
     * ids the rows were given.
     */
    const starred = await tee('Aardvark Tee', 'zzz-starred')
    const plain = await tee('Beetle Tee', 'aaa-plain')
    star(starred.id)

    const pair = (await listItems(db.binding)).filter(
      (i) => i.id === starred.id || i.id === plain.id,
    )

    const ranked = rank(pair, EMPTY_CONTEXT)
    expect(ranked.map((r) => r.item.id)).toEqual(['aaa-plain', 'zzz-starred'])
    // Nothing decided it, because nothing could. A star would have.
    expect(ranked[0]?.decidedBy).toBeNull()
  })

  it('does not lift a garment in My Stuff', async () => {
    await tee('Aardvark Tee')
    const starred = await tee('Zebra Tee')
    /*
     * The star goes on the garment the alphabet puts LAST, and that is the
     * whole design of this case rather than an incidental choice.
     *
     * The first version starred "Aardvark", which sorts first either way — so
     * restoring `favorite DESC` to the ORDER BY changed nothing and the test
     * passed against the very defect it was written to catch. Mutation found
     * it; review had not. A test for an ordering has to star the row whose
     * position the ordering would move.
     */
    star(starred.id)

    /*
     * `listItems` used to order by `archived_at IS NOT NULL, favorite DESC,
     * lower(display_name)`. With the star still in the ORDER BY, "Zebra" leads
     * a list that reads alphabetically and nothing on screen can explain why.
     */
    const names = onlyMine(['Aardvark Tee', 'Zebra Tee'], await listItems(db.binding))
    expect(names).toEqual(['Aardvark Tee', 'Zebra Tee'])
  })

  it('gives a garment no section of its own in One Last Look', async () => {
    const starred = await tee('Linen Shirt')
    star(starred.id)

    const result = reviewWardrobe({
      wardrobe: await listItems(db.binding),
      plannedItemIds: new Set<string>(),
      unfilledRoles: [],
      usedRoles: new Set(),
    })

    // Behind the search with the rest of the closet, and with nothing to say.
    expect(result.nearMatches).toHaveLength(0)
    expect(onlyMine(['Linen Shirt'], result.remaining)).toEqual(['Linen Shirt'])
    expect(result.remaining.find((r) => r.name === 'Linen Shirt')?.reason).toBe('')
  })

  it('never reaches the API, so no screen can render one', async () => {
    const starred = await tee('Oxford')
    star(starred.id)

    const item = (await listItems(db.binding)).find((i) => i.id === starred.id)
    expect(item).toBeDefined()
    expect(Object.keys(item!)).not.toContain('favorite')
  })
})

describe('the column survives, untouched', () => {
  /*
   * The other half of §8.5's ruling: keeping the column is not debt, and a
   * retirement that quietly zeroed a hundred rows on the next save would be a
   * data rewrite nobody approved. An edit must leave the byte exactly as it
   * found it.
   */
  it('is not cleared by an ordinary edit', async () => {
    const item = await tee('Oxford')
    star(item.id)

    await updateItem(
      db.binding,
      item.id,
      { displayName: 'White Oxford', category: 'Tops & Outerwear', comfort: 4 },
      NOW + 1,
    )

    const stored = db.raw
      .prepare('SELECT favorite, comfort FROM item WHERE id = ?')
      .get(item.id) as { favorite: number; comfort: number | null }
    expect(stored.favorite).toBe(1)
    expect(stored.comfort).toBe(4)
  })

  it('takes its default on a row created after the retirement', async () => {
    const item = await tee('New Tee')
    const stored = db.raw
      .prepare('SELECT favorite FROM item WHERE id = ?')
      .get(item.id) as { favorite: number }
    // The INSERT no longer names the column at all; `DEFAULT 0` fills it in.
    expect(stored.favorite).toBe(0)
  })
})
