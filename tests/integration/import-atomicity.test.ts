import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importRoutes } from '../../worker/routes/import'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * What a failed import leaves behind (G5b).
 *
 * Doc 09 §0a asked for this to be answered with measurement rather than
 * reasoning, and not to claim atomicity that is not there. So the failure is
 * injected at a known write and the database is then counted — the answer is
 * whatever the rows say.
 *
 * The binding below fails the Nth write. Reads are untouched, because the
 * question is what happens once writing has started; a failure before that
 * cannot leave anything behind by definition, and the first test says so.
 */

const NOW_ROW = ['Major Category', 'Subcategory', 'Description', 'Brand', 'Color', 'Style', 'Notes']
const GEAR_HEAD = ['Item', 'Category', 'Default Priority / Quantity Rule']

let db: TestDatabase
let baseItems = 0
let baseRules = 0

beforeEach(() => {
  db = createTestDatabase()
  baseItems = count('SELECT count(*) AS n FROM item')
  baseRules = count('SELECT count(*) AS n FROM packing_rule')
})

afterEach(() => {
  db.close()
})

const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n
const items = () => count('SELECT count(*) AS n FROM item') - baseItems
const rules = () => count('SELECT count(*) AS n FROM packing_rule') - baseRules
const runs = () => count('SELECT count(*) AS n FROM import_run')
const importRows = () => count('SELECT count(*) AS n FROM import_row')

class InjectedFailure extends Error {}

/**
 * The same database, which stops accepting writes after `limit` of them.
 *
 * Counts `run()` and `batch()` alike, and counts the statements inside a batch
 * too — so "fail at write 7" means the same thing whether the route writes one
 * statement at a time or hands over a batch, which is exactly what makes the
 * before and after comparable.
 */
function failsAfter(binding: D1Database, limit: number): { db: D1Database; writes: () => number } {
  let writes = 0

  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
    ({
      bind: (...args: unknown[]) => wrap(stmt.bind(...args)),
      first: (...args: unknown[]) => (stmt.first as (...a: unknown[]) => unknown)(...args),
      all: (...args: unknown[]) => (stmt.all as (...a: unknown[]) => unknown)(...args),
      run: async () => {
        writes += 1
        if (writes > limit) throw new InjectedFailure(`write ${writes}`)
        return stmt.run()
      },
    }) as unknown as D1PreparedStatement

  const failing = {
    prepare: (sql: string) => wrap(binding.prepare(sql)),
    batch: (statements: D1PreparedStatement[]) =>
      (binding as unknown as { batch: (s: D1PreparedStatement[]) => unknown }).batch(statements),
  } as unknown as D1Database

  return { db: failing, writes: () => writes }
}

/**
 * Two garments and three pieces of gear — enough to have an order to fail in,
 * and the charger makes the dependency second pass part of the measurement
 * rather than something the small case quietly skips.
 */
const CLOTHING = [
  ['Tops', 'T-Shirt', 'Grey Tee', 'Uniqlo', 'Grey', 'casual', ''],
  ['Tops', 'T-Shirt', 'Blue Tee', 'Uniqlo', 'Blue', 'casual', ''],
]
const GEAR = [
  ['Toothbrush', 'Toiletries', 'Always'],
  ['Laptop', 'Electronics', 'Always'],
  ['Charger', 'Electronics', 'Packed if the Laptop is brought'],
]

async function commit(binding: D1Database) {
  return importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'w.xlsx',
        clothing: [NOW_ROW, ...CLOTHING],
        gear: [GEAR_HEAD, ...GEAR],
      }),
    }),
    undefined,
    { DB: binding } as never,
  )
}

/** The writes a complete import of the fixture above takes. Measured, not guessed. */
const WHOLE_IMPORT = 14

describe('a whole import', () => {
  it('lands completely, in the write budget every case below is measured against', async () => {
    const injected = failsAfter(db.binding, Number.MAX_SAFE_INTEGER)
    const response = await commit(injected.db)

    expect(response.status).toBe(200)
    expect(items()).toBe(5)
    expect(rules()).toBe(3)
    expect(runs()).toBe(1)
    expect(importRows()).toBe(5)

    /*
     * Pinned so a change in the write path is visible rather than silent. If
     * this number moves, the sweep below is measuring different boundaries and
     * its `WHOLE_IMPORT` has to move with it.
     */
    expect(injected.writes()).toBe(WHOLE_IMPORT)
  })
})

/**
 * The sweep, which is the honest answer to "is it atomic".
 *
 * Before the batch, this table had **fourteen distinct partial states** — some
 * garments in and some not, rules missing from items that were written, and
 * `import_run` inserted FIRST with `status = 'committed'`, so a half-failed
 * import was recorded in the history as a successful one.
 *
 * Every one of those windows is now empty. This is the test that would fail if
 * anyone put a bare `.run()` back into the commit path.
 */
describe('a failure at any point during the commit', () => {
  it('leaves nothing behind, wherever it happens', async () => {
    for (let failAfter = 0; failAfter < WHOLE_IMPORT; failAfter += 1) {
      db.close()
      db = createTestDatabase()
      baseItems = count('SELECT count(*) AS n FROM item')
      baseRules = count('SELECT count(*) AS n FROM packing_rule')

      const injected = failsAfter(db.binding, failAfter)
      await commit(injected.db).catch(() => undefined)

      const left = `items=${items()} rules=${rules()} runs=${runs()} rows=${importRows()}`
      expect(left, `failing after write ${failAfter} left rows behind`).toBe(
        'items=0 rules=0 runs=0 rows=0',
      )
    }
  })

  it('records no import run, so the history cannot claim a success that did not happen', async () => {
    const injected = failsAfter(db.binding, 3)
    await commit(injected.db).catch(() => undefined)

    expect(runs()).toBe(0)
    expect(
      count("SELECT count(*) AS n FROM import_run WHERE status = 'committed'"),
    ).toBe(0)
  })
})

describe('after a failed import', () => {
  it('simply running it again succeeds, with nothing doubled', async () => {
    await commit(failsAfter(db.binding, 6).db).catch(() => undefined)
    expect(items()).toBe(0)

    const response = await commit(db.binding)
    expect(response.status).toBe(200)

    // Exactly one import's worth — not one and a bit from the failed attempt.
    expect(items()).toBe(5)
    expect(rules()).toBe(3)
    expect(runs()).toBe(1)
    expect(importRows()).toBe(5)
  })

  it('and a retry that fails again still leaves nothing', async () => {
    await commit(failsAfter(db.binding, 6).db).catch(() => undefined)
    await commit(failsAfter(db.binding, 9).db).catch(() => undefined)

    expect(items()).toBe(0)
    expect(rules()).toBe(0)
    expect(runs()).toBe(0)
    expect(importRows()).toBe(0)
  })
})
