import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { importRoutes } from '../../worker/routes/import'
import { createTrip } from '../../worker/repos/trips'
import { generateChecklist } from '../../worker/repos/checklist'
import { createTestDatabase, type TestDatabase } from './d1'
import { TRIP } from './wardrobe'

/**
 * What `generateChecklist` costs, against the wardrobe Alex actually has (P1B).
 *
 * `action-cost.spec.ts` put this second on the list: 71% of creating a trip and
 * 69% of editing one. This says WHY, and the answer decides what the fix is.
 *
 * ## The first version of this measurement reached the opposite conclusion
 *
 * It ran against `seedWardrobe`, the small fixture the outfit tests use, where
 * almost nothing carries a packing rule. `generateChecklist` came out at **five
 * statements**, which reads as "its cost is the rules engine thinking, not
 * round trips" — and the conclusion drawn from that was that the fix would be a
 * CPU profile rather than anything to do with D1.
 *
 * Against the real workbook it is **35 statements**, of which 32 are one write
 * per checklist row, issued one after another. That is a round-trip problem, on
 * a network database, and the fix is `batch()` — which the import path already
 * uses for exactly this reason (`import-d1-limits.test.ts`).
 *
 * The fixture was not representative and the conclusion inverted. That is why
 * this file exists rather than a paragraph of reasoning: **the measurement has
 * to run against the catalog the product has.**
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')
const NOW = 1_780_000_000

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})
afterEach(() => {
  db.close()
})

/** The same database, counting the statements run against it. */
function counting(binding: D1Database): { db: D1Database; statements: () => number } {
  let count = 0
  const db = {
    prepare: (sql: string) => {
      count += 1
      return binding.prepare(sql)
    },
    // A batch is ONE round trip however many statements it holds — which is the
    // whole point of the number below, so it must not be counted as many.
    batch: (statements: unknown[]) => {
      count += 1
      return (binding as unknown as { batch(s: unknown[]): unknown }).batch(statements)
    },
  } as unknown as D1Database

  return { db, statements: () => count }
}

/** Alex's real catalog, through the real import endpoint. */
async function importWorkbook(): Promise<void> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
  expect(clothing && gear, 'the workbook has both sheets').toBeTruthy()

  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'Master_Packing_Database_Complete.xlsx',
        clothing: clothing!,
        gear: gear!,
      }),
    }),
    undefined,
    { DB: db.binding } as never,
  )
  expect(response.status).toBe(200)
}

describe('what generating a checklist costs', () => {
  it('spends a round trip per row, on both the first pass and every later one', async () => {
    await importWorkbook()
    const trip = await createTrip(db.binding, TRIP, NOW)

    const first = counting(db.binding)
    const created = await generateChecklist(first.db, trip, NOW)

    const again = counting(db.binding)
    const regenerated = await generateChecklist(again.db, trip, NOW)

    console.log(
      [
        '',
        'generateChecklist — against the real workbook',
        `  first run   ${String(first.statements()).padStart(3)} statements   ${created.created} rows created`,
        `  again       ${String(again.statements()).padStart(3)} statements   ${regenerated.updated} rows updated`,
        '',
      ].join('\n'),
    )

    /*
     * The shape, stated as the relationship rather than as a number.
     *
     * A round trip per row is what makes this the second-most expensive write
     * in the app on a network database, and it is true of the REGENERATION as
     * well as the first pass — every trip edit pays it again. The reads are a
     * fixed handful (`item`, `packing_rule`, the existing list), so anything
     * above that count is per-row work.
     *
     * Pinning the exact count would fail the day a rule is added to the
     * workbook, which is a fact about the seed data rather than about this
     * code. What must not change silently is that the count TRACKS the rows.
     */
    const FIXED_READS = 4
    expect(created.created, 'the real workbook produces a real list').toBeGreaterThan(20)
    expect(first.statements()).toBeGreaterThanOrEqual(created.created + 1)
    expect(first.statements()).toBeLessThanOrEqual(created.created + FIXED_READS)

    expect(regenerated.updated, 'regenerating touches the same rows').toBe(created.created)
    expect(again.statements()).toBeGreaterThanOrEqual(regenerated.updated + 1)
    expect(again.statements()).toBeLessThanOrEqual(regenerated.updated + FIXED_READS)
  })
})
