import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWorkbook } from '@shared/xlsx'
import { importRoutes } from '../../worker/routes/import'
import { todayRoutes } from '../../worker/routes/today'
import { generateChecklist } from '../../worker/repos/checklist'
import { generateOutfits, setGroupStatus } from '../../worker/repos/outfits'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { countRoundTrips, createTestDatabase, type TestDatabase } from './d1'
import { TRIP } from './wardrobe'

/**
 * What `GET /trips/:id/today` costs, against the wardrobe Alex actually has (P1B).
 *
 * The last uninstrumented path on the P1B list, and second in the audit table at
 * 51–73 ms of server time. The brief's instruction was to find out where that
 * goes before optimising anything, so this measures the stages the handler
 * ACTUALLY has rather than the ones a guess would name — `trip`, `plans`,
 * `reads`, `briefing` — and counts the round trips each one costs.
 *
 * **Against the real workbook, never `seedWardrobe`.** Today reads the whole
 * checklist, and the checklist is generated from the catalog, so the fixture
 * decides the workload. Profiling `generateChecklist` against the small fixture
 * produced the exact opposite of the truth once already; that is now a standing
 * warning rather than an anecdote.
 *
 * Two opens are measured, and the difference between them is the point.
 * `ensureDailyPlans` is a WRITE inside a GET: the first open of a trip creates
 * a `daily_plan` row per day, and every open after it should find them and
 * return early.
 */

const WORKBOOK = join(process.cwd(), 'seed-data', 'Master_Packing_Database_Complete.xlsx')
const NOW = 1_780_000_000

/** The route as it is mounted in production: `/:id/today`, params and all. */
const app = new Hono().route('/:id/today', todayRoutes)

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})
afterEach(() => {
  db.close()
})

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

/** The `Server-Timing` stages, in the order the Worker ran them. */
function stages(header: string | null): Array<{ name: string; ms: number }> {
  if (!header) return []
  return header.split(',').map((entry) => {
    const [name, duration] = entry.trim().split(';')
    return { name: name!.trim(), ms: Number(duration?.split('=')[1] ?? NaN) }
  })
}

async function open(binding: D1Database, tripId: string) {
  const response = await app.request(
    new Request(`https://example.test/${tripId}/today`, {
      headers: { 'X-Client-Date': '2026-08-03' },
    }),
    undefined,
    { DB: binding } as never,
  )
  expect(response.status).toBe(200)
  return { response, stages: stages(response.headers.get('server-timing')) }
}

describe('what opening Today costs', () => {
  it('spends its time where the header says, and the second open is cheaper', async () => {
    await importWorkbook()

    /* A trip in the state Today is actually opened in: days named, outfits
     * planned and approved, a generated checklist. */
    const trip = await createTrip(db.binding, TRIP, NOW)
    await setTripDays(
      db.binding,
      trip.id,
      [
        { date: '2026-08-02', activityTag: 'safari' },
        { date: '2026-08-03', activityTag: 'safari' },
        { date: '2026-08-04', activityTag: 'nice_dinner' },
      ],
      NOW,
    )
    const planned = (await getTrip(db.binding, trip.id))!
    await generateChecklist(db.binding, planned, NOW)
    const { groups } = await generateOutfits(db.binding, planned, NOW)
    for (const group of groups) {
      if (group.slots.every((slot) => !slot.required || slot.itemId)) {
        await setGroupStatus(db.binding, group.id, 'approved', NOW)
      }
    }

    const cold = countRoundTrips(db.binding)
    const first = await open(cold.db, trip.id)

    const warm = countRoundTrips(db.binding)
    const second = await open(warm.db, trip.id)

    const table = (label: string, measured: Array<{ name: string; ms: number }>, trips: number) =>
      [
        `  ${label}  ${String(trips).padStart(3)} round trips`,
        ...measured.map((stage) => `      ${stage.name.padEnd(10)} ${stage.ms.toFixed(1)} ms`),
      ].join('\n')

    /*
     * Which queries the repeat open actually runs, grouped.
     *
     * The count alone says "21" and nothing about what to do with it. A read
     * issued twenty times is a different problem from twenty different reads,
     * and only one of them is worth fixing.
     */
    const grouped = new Map<string, number>()
    for (const sql of warm.executed()) grouped.set(sql, (grouped.get(sql) ?? 0) + 1)

    console.log(
      [
        '',
        'GET /trips/:id/today — against the real workbook',
        table('first open ', first.stages, cold.roundTrips()),
        table('second open', second.stages, warm.roundTrips()),
        '',
        '  what the repeat open reads:',
        ...[...grouped.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([sql, n]) => `    ${String(n).padStart(3)}x  ${sql.slice(0, 96)}`),
        '',
      ].join('\n'),
    )

    /*
     * The shape, not the milliseconds. Two facts, and both were false before.
     *
     * **The first open costs about what a repeat open costs.** It has to write a
     * `daily_plan` row per day of the trip, and it was writing them one at a
     * time — so the first open of Today grew with the length of the holiday, on
     * the one request the screen cannot render without. They go as one batch
     * now, so the difference between a cold open and a warm one is a single
     * round trip rather than a dozen. `WRITES` is the ceiling on that
     * difference; per-row inserts would put it at the day count.
     *
     * **A repeat open still writes nothing at all.** `ensureDailyPlans` returns
     * early when every assignment already has a row, and if that ever stops
     * being true this endpoint has started writing on every read.
     */
    const WRITES = 2
    expect(warm.roundTrips(), 'a repeat open writes nothing').toBeLessThan(cold.roundTrips())
    expect(
      cold.roundTrips() - warm.roundTrips(),
      'the first open writes its day plans in one batch, not one per day',
    ).toBeLessThanOrEqual(WRITES)
    expect(first.stages.map((s) => s.name)).toEqual([
      'trip',
      'plans',
      'reads',
      'briefing',
      'total',
    ])
  })
})
