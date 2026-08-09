import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { importRoutes } from '../../worker/routes/import'
import { createTrip } from '../../worker/repos/trips'
import { generateChecklist } from '../../worker/repos/checklist'
import { countRoundTrips, createTestDatabase, type TestDatabase } from './d1'
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
 * Against the real workbook it was **35 round trips**, of which 32 were one
 * write per checklist row, issued one after another. That is a round-trip
 * problem on a network database, and the fix is `batch()` — which the import
 * path already uses for exactly this reason (`import-d1-limits.test.ts`).
 *
 * The fixture was not representative and the conclusion inverted. That is why
 * this file exists rather than a paragraph of reasoning: **the measurement has
 * to run against the catalog the product has.**
 *
 * ## And the counter itself was wrong, which hid the fix completely
 *
 * The first version counted `prepare` calls. That is the same number as round
 * trips whenever every statement is built and immediately run — which was true
 * of this code and is true of most of this codebase — and it stops being true
 * at exactly the moment somebody batches. With the batch in place it still
 * reported 36, and the reduction from 35 round trips to 4 was invisible in the
 * only unit that mattered. `countRoundTrips` counts executions now, and a
 * `batch` counts as one however many statements it holds.
 *
 * ## What it costs now
 *
 * **Four round trips, whatever the size of the wardrobe** — three reads and one
 * batch — on the first generation and on every regeneration after it. That is
 * what this file asserts: not a number of milliseconds, and not even a number
 * of statements, but that the count **does not grow with the rows**.
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
  it('costs the same few round trips whatever the wardrobe, first time and every time', async () => {
    await importWorkbook()
    const trip = await createTrip(db.binding, TRIP, NOW)

    const first = countRoundTrips(db.binding)
    const created = await generateChecklist(first.db, trip, NOW)

    const again = countRoundTrips(db.binding)
    const regenerated = await generateChecklist(again.db, trip, NOW)

    console.log(
      [
        '',
        'generateChecklist — against the real workbook',
        `  first run   ${String(first.roundTrips()).padStart(3)} round trips   ${created.created} rows created`,
        `  again       ${String(again.roundTrips()).padStart(3)} round trips   ${regenerated.updated} rows updated`,
        '',
      ].join('\n'),
    )

    /*
     * The shape: **the cost does not grow with the rows.**
     *
     * Stated as a ceiling rather than an equality, because the reads are a
     * fixed handful (`item`, `packing_rule`, the existing list) and a future
     * one is a fair change; a write per row is not. `CEILING` is deliberately
     * far below the row count and far above what is measured — 4 — so it fails
     * the moment anybody puts an `await … .run()` back inside the loop, and
     * does not fail because the workbook gained a rule.
     *
     * The regeneration matters as much as the first pass. Editing a trip
     * updates every one of these rows, and it used to pay the whole cost again.
     */
    const CEILING = 8
    expect(created.created, 'the real workbook produces a real list').toBeGreaterThan(20)
    expect(first.roundTrips(), 'generating the list is a fixed number of round trips')
      .toBeLessThanOrEqual(CEILING)

    expect(regenerated.updated, 'regenerating touches the same rows').toBe(created.created)
    expect(again.roundTrips(), 'and so is regenerating it').toBeLessThanOrEqual(CEILING)
  })
})
