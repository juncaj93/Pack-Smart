import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { forbidsInternals } from '@shared/explain'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { importRoutes } from '../../worker/routes/import'
import { tripRoutes } from '../../worker/routes/trips'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * C1's acceptance, measured the way the gap was measured.
 *
 * The audit in doc 09 §4 counted **32 generated rows, 19 with no explanation
 * at all**, against the real workbook imported through the real endpoint on the
 * approved worked example. That number is the whole reason this slice exists,
 * so the test that closes it has to be the same measurement rather than a
 * fixture that agrees with the implementation.
 *
 * Nothing here is mocked: the real 119-row spreadsheet, the real import route,
 * real SQL, the real generator.
 *
 * The second half matters as much as the first. C1 was scoped to change
 * **explanation copy, not packing quantities** — so the M4 numbers are asserted
 * again here, on the same rows, in the same run. A reason that arrived by
 * moving a quantity would be a failure of this slice, not a success.
 */

const WORKBOOK = 'seed-data/Master_Packing_Database_Complete.xlsx'
const NOW = 1_800_000_000

/** The approved worked example: 31 Jul – 11 Aug, 12 days, 11 nights, abroad. */
const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-07-31',
  endDate: '2026-08-11',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari', 'nice_dinner'],
  international: true,
  laundryAvailable: false,
  flightHours: 15,
}

let db: TestDatabase | null = null

afterEach(() => {
  db?.close()
  db = null
})

async function importWorkbook(database: TestDatabase): Promise<void> {
  const sheets = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK)))
  const clothing = sheets.find((sheet) => /clothing/i.test(sheet.name))?.rows
  const gear = sheets.find((sheet) => /non-?clothing|rules|gear/i.test(sheet.name))?.rows
  expect(clothing && gear).toBeTruthy()

  const response = await importRoutes.request(
    new Request('https://example.test/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'seed.xlsx', clothing, gear }),
    }),
    undefined,
    { DB: database.binding } as never,
  )
  expect(response.status).toBe(200)
}

async function generatedChecklist() {
  db = createTestDatabase()
  await importWorkbook(db)
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, (await getTrip(db.binding, trip.id))!, NOW)
  return listChecklist(db.binding, trip.id)
}

describe('every generated necessity says why it is there', () => {
  it('leaves nothing unexplained on the canonical worked example', async () => {
    /*
     * The acceptance criterion, stated as the audit stated it.
     *
     * Reported as the list of offending names rather than a bare count,
     * because "19 rows are unexplained" was a number nobody could act on until
     * someone went and found out which nineteen.
     */
    const entries = await generatedChecklist()

    const unexplained = entries.filter((entry) => !entry.reason).map((entry) => entry.name)

    expect(unexplained).toEqual([])
    expect(entries.length).toBeGreaterThanOrEqual(30)
  })

  it('never puts an internal identifier or a rule type on a row', async () => {
    const entries = await generatedChecklist()

    for (const entry of entries) {
      expect(forbidsInternals(entry.reason ?? ''), `${entry.name}: ${entry.reason}`).toBe(true)
      // A row must never carry an id, a column name or condition JSON.
      expect(entry.reason ?? '').not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
  })

  it('never falls back to filler', async () => {
    /*
     * The failure mode this slice was most at risk of: satisfying "every row
     * has a reason" by giving every row the same non-answer. These are the
     * exact phrases the brief names.
     */
    const entries = await generatedChecklist()
    const FILLER = /recommended for your trip|pack smart suggested|you may need this/i

    for (const entry of entries) {
      expect(FILLER.test(entry.reason ?? ''), `${entry.name}: ${entry.reason}`).toBe(false)
    }
  })

  it('explains the rows the audit named, in the words of their real rules', async () => {
    const entries = await generatedChecklist()
    const reasonOf = (name: string) =>
      entries.find((e) => e.name.toLowerCase() === name.toLowerCase())?.reason

    // Nine of the nineteen the audit listed by name. All `fixed_per_trip: 1`
    // in the real catalog, whose `originalText` is the priority shorthand
    // `Critical (Always)` / `Always` / `Usually` — see `explain.ts` on why that
    // is declined and the rule kind is stated instead.
    for (const name of ['Toothbrush', 'Wallet', 'Phone', 'ID', 'Deodorant', 'Glasses']) {
      expect(reasonOf(name), name).toBe('One per trip')
    }

    // A trip fact, not a constant.
    expect(reasonOf('Passport')).toBe('International trip')

    // Arithmetic, because arithmetic is what produced the number.
    expect(reasonOf('Contacts')).toMatch(/×\s*2$/)
  })

  it('changes what the rows say without moving a single quantity', async () => {
    /*
     * The M4 expectations, re-asserted inside C1's own suite.
     *
     * They are already covered elsewhere; the point of repeating them here is
     * that this file is where a future copy change will be made, and the guard
     * belongs where the risk is.
     */
    const entries = await generatedChecklist()
    const quantityOf = (name: string) =>
      entries.find((e) => e.name.toLowerCase() === name.toLowerCase())?.requiredQty

    expect(quantityOf('Contacts')).toBe(24)
    expect(quantityOf('Passport')).toBe(1)
    expect(quantityOf('Toothbrush')).toBe(1)
  })

  it('heals a trip written before C1, without undoing anything Alex changed', async () => {
    /*
     * The production-data case, which no clean-database test can reach.
     *
     * Alex's existing trips have `reason_text` null on every row, and the
     * checklist regenerates when a trip CHANGES rather than when it is read —
     * so without a backfill "every necessity has a reason" would be true of new
     * trips only. Opening a trip repairs it.
     *
     * The risk is the whole point of this test: the repair runs
     * `generateChecklist`, and a regeneration that quietly reverted a hand-set
     * quantity or resurrected something moved to Not bringing would be far
     * worse than a blank explanation. Both are set up here first, and both have
     * to survive.
     */
    db = createTestDatabase()
    await importWorkbook(db)
    const trip = await createTrip(db.binding, TRIP, NOW)
    const stored = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, stored, NOW)

    const before = await listChecklist(db.binding, trip.id)
    const overridden = before.find((e) => e.name === 'Contacts')!
    const excluded = before.find((e) => e.name === 'Rogaine')!

    // An edit of each kind the generator promises to preserve, plus the state
    // every pre-C1 row is actually in.
    db.raw.prepare('UPDATE checklist_entry SET qty_override = 7 WHERE id = ?').run(overridden.id)
    db.raw.prepare('UPDATE checklist_entry SET excluded_at = ? WHERE id = ?').run(NOW, excluded.id)
    db.raw.exec('UPDATE checklist_entry SET reason_text = NULL')

    const response = await tripRoutes.request(
      new Request(`https://example.test/${trip.id}/checklist`),
      undefined,
      { DB: db.binding } as never,
    )
    expect(response.status).toBe(200)
    const { entries } = (await response.json()) as { entries: typeof before }

    const engineRows = entries.filter((e) => e.itemId !== null && e.excludedAt === null)
    expect(engineRows.filter((e) => !e.reason).map((e) => e.name)).toEqual([])

    // The edits, still exactly as Alex left them.
    expect(entries.find((e) => e.name === 'Contacts')?.requiredQty).toBe(7)
    expect(entries.find((e) => e.name === 'Rogaine')?.excludedAt).not.toBeNull()

    /*
     * And the overridden row's reason does not argue with his number: the
     * arithmetic that produced 22 must not be offered as the explanation for
     * a 7.
     */
    const contacts = entries.find((e) => e.name === 'Contacts')!
    expect(contacts.reason).toBeTruthy()
    expect(contacts.reason).not.toMatch(/×/)
  })

  it('says the same thing however the database returned the rules', async () => {
    /*
     * The engine already guarantees the QUANTITY is order-independent
     * (`rule-precedence.test.ts`). C1 adds a sentence assembled from the same
     * fold, so the sentence inherits that guarantee or the guarantee is worth
     * nothing — a row that explains itself differently on a second load is not
     * an explanation.
     */
    db = createTestDatabase()
    await importWorkbook(db)
    const trip = await createTrip(db.binding, TRIP, NOW)
    const stored = (await getTrip(db.binding, trip.id))!

    await generateChecklist(db.binding, stored, NOW)
    const before = (await listChecklist(db.binding, trip.id)).map((e) => `${e.name}=${e.reason}`)

    // Invert the id order the fold falls back on for ties.
    const ids = (db.raw.prepare('SELECT id FROM packing_rule ORDER BY id').all() as Array<{
      id: string
    }>).map((r) => r.id)
    db.raw.exec('PRAGMA foreign_keys = OFF')
    ids.forEach((id, index) => {
      db!.raw.prepare('UPDATE packing_rule SET id = ? WHERE id = ?').run(`z${index}`, id)
    })
    ids.forEach((_original, index) => {
      db!.raw.prepare('UPDATE packing_rule SET id = ? WHERE id = ?').run(ids[ids.length - 1 - index]!, `z${index}`)
    })
    db.raw.exec('PRAGMA foreign_keys = ON')

    await generateChecklist(db.binding, stored, NOW)
    const after = (await listChecklist(db.binding, trip.id)).map((e) => `${e.name}=${e.reason}`)

    expect(after).toEqual(before)
  })
})
