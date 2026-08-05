import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { importRoutes } from '../../worker/routes/import'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * The limits this environment cannot enforce, enforced here instead (G5b).
 *
 * AUTONOMY §7 records that the sandbox hides classes of defect. This is one of
 * them, and it is not theoretical: the reconciliation query bound **one
 * parameter per matched catalog item**, which on a second import of the real
 * workbook measured **117 bound parameters in a single query**. D1 caps bound
 * parameters per query well below that. `node:sqlite`, which every integration
 * test here runs on, allows tens of thousands — so the query passed every test
 * in this repository and would have failed the first time Alex re-imported on
 * production, on the exact path G5b exists to make safe.
 *
 * A ceiling is asserted rather than a bare "it works", because the defect was
 * never that a number was too big on one day. It was that the number was
 * allowed to GROW WITH THE CATALOG, so it would cross any limit eventually and
 * silently.
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')

/**
 * Comfortably under D1's documented cap, and far under `node:sqlite`'s.
 *
 * The point is not the exact number: it is that nothing in the import path may
 * bind a parameter count that depends on how much is already stored.
 */
const MAX_BOUND_PARAMETERS = 50

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

interface Probe {
  db: D1Database
  maxBoundParameters: () => number
  batches: () => number
  largestBatch: () => number
}

/** The same database, counting how wide each query is and how it is sent. */
function probe(binding: D1Database): Probe {
  let maxBound = 0
  let batches = 0
  let largest = 0

  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
    ({
      bind: (...args: unknown[]) => {
        maxBound = Math.max(maxBound, args.length)
        return wrap(stmt.bind(...args))
      },
      first: (...args: unknown[]) => (stmt.first as (...a: unknown[]) => unknown)(...args),
      all: (...args: unknown[]) => (stmt.all as (...a: unknown[]) => unknown)(...args),
      run: () => stmt.run(),
    }) as unknown as D1PreparedStatement

  return {
    db: {
      prepare: (sql: string) => wrap(binding.prepare(sql)),
      batch: (statements: D1PreparedStatement[]) => {
        batches += 1
        largest = Math.max(largest, statements.length)
        return (binding as unknown as { batch: (s: D1PreparedStatement[]) => unknown }).batch(
          statements,
        )
      },
    } as unknown as D1Database,
    maxBoundParameters: () => maxBound,
    batches: () => batches,
    largestBatch: () => largest,
  }
}

async function realWorkbook() {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
  expect(clothing && gear).toBeTruthy()
  return { clothing: clothing!, gear: gear! }
}

async function commit(binding: D1Database, sheets: { clothing: string[][]; gear: string[][] }) {
  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'Master_Packing_Database_Complete.xlsx', ...sheets }),
    }),
    undefined,
    { DB: binding } as never,
  )
  expect(response.status).toBe(200)
  return response
}

describe('importing the real workbook', () => {
  it('never binds a parameter count that grows with the catalog', async () => {
    const sheets = await realWorkbook()

    // First import: an empty catalog, so nothing can scale yet.
    const first = probe(db.binding)
    await commit(first.db, sheets)
    expect(first.maxBoundParameters()).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS)

    /*
     * Second import: 118 items are now stored, and this is the run that used to
     * bind one parameter for each of them.
     */
    const second = probe(db.binding)
    await commit(second.db, sheets)
    expect(second.maxBoundParameters()).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS)
  })

  it('sends the whole import as exactly one batch, which is what makes it atomic', async () => {
    const sheets = await realWorkbook()
    const watched = probe(db.binding)
    await commit(watched.db, sheets)

    expect(watched.batches()).toBe(1)

    /*
     * Recorded rather than bounded, deliberately.
     *
     * A batch is one transaction, so splitting it to make it smaller would give
     * back exactly the partial-write behaviour `import-atomicity.test.ts`
     * exists to prevent. **D1's own limit on batch length could not be checked
     * from this environment** — the documentation host is unreachable through
     * the proxy — so this number is measured and stated, not certified. It is
     * the one thing to watch on the first real import after this ships.
     */
    expect(watched.largestBatch()).toBeGreaterThan(100)
  })
})
