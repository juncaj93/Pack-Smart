import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTrip, getTrip, outfitsAreStale, setTripDays } from '../../worker/repos/trips'
import { generateOutfits, listOutfits } from '../../worker/repos/outfits'
import { getWeather } from '../../worker/services/weather'
import { countRoundTrips, createTestDatabase, type TestDatabase } from './d1'
import { TRIP, seedWardrobe } from './wardrobe'

/**
 * What `Apply itinerary` costs, and what moving it did NOT cost (P1B).
 *
 * The measurement came first. `PUT /trips/:id/days` ran three things in a row
 * before it answered — write the days, read the forecast, replan every outfit
 * over the whole wardrobe — and the replan was 92.9% of it. Both callers
 * navigate to Outfits the instant it answers, so the tap that commits an
 * itinerary was holding Alex still through work he was about to watch happen.
 *
 * The replan now runs on the Outfits screen. That is only a SCHEDULING change
 * if the guarantee survives, and this file is where the guarantee is asserted:
 *
 * - the days are durable before anything derived is attempted;
 * - the trip records that they moved;
 * - the plan is reported behind until it is replanned;
 * - and the report converges, including for a trip whose outfits are all
 *   approved and are therefore left alone by the planner.
 *
 * That last one is the trap. A staleness test based on the outfit ROWS would
 * call an all-approved trip behind for ever — `generateOutfits` deliberately
 * does not touch an approved group — and the Outfits screen would replan the
 * whole wardrobe on every visit. `outfits_planned_at` is stamped on every run,
 * whatever the planner decided, which is what makes the comparison terminate.
 *
 * Timings are PRINTED, never asserted. A test that fails when a runner is
 * loaded teaches nobody anything; doc 09 §8.1 settled that.
 */

const NOW = 1_780_000_000
const LATER = NOW + 60

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
  seedWardrobe(db)
})
afterEach(() => {
  db.close()
})

/** Milliseconds for one call, measured the same way for each stage. */
async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now()
  const value = await run()
  return { ms: performance.now() - started, value }
}

const DAYS = [
  { date: '2026-08-02', activityTag: 'safari' },
  { date: '2026-08-03', activityTag: 'safari' },
  { date: '2026-08-04', activityTag: 'safari' },
  { date: '2026-08-05', activityTag: 'nice_dinner' },
]

describe('what applying an itinerary costs', () => {
  it('leaves the replan out of the write, and says the plan is behind instead', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    const writes = countRoundTrips(db.binding)
    const write = await timed(() => setTripDays(writes.db, trip.id, DAYS, NOW))
    expect(write.value).not.toBeNull()

    /*
     * Nothing derived has happened yet, and that is the whole change. Asserted
     * on the ROWS rather than on a duration: an outfit table that is still
     * empty is not a fast replan, it is no replan.
     */
    expect(await listOutfits(db.binding, trip.id)).toEqual([])
    expect(await outfitsAreStale(db.binding, trip.id)).toBe(true)

    // ...and the days themselves are already durable.
    const stored = db.raw
      .prepare('SELECT COUNT(*) AS n FROM trip_event WHERE trip_id = ?')
      .get(trip.id) as { n: number }
    expect(stored.n).toBe(DAYS.length)
    expect(write.value?.days.map((d) => d.activityTag)).toEqual(DAYS.map((d) => d.activityTag))

    /* The deferred half, measured where it now runs: POST .../outfits/generate. */
    const generates = countRoundTrips(db.binding)
    const weather = await timed(() => getWeather(generates.db, trip.id, NOW))
    const replan = await timed(() =>
      generateOutfits(generates.db, write.value!, NOW, weather.value.days),
    )

    expect(replan.value.groups.length).toBeGreaterThan(0)
    expect(await outfitsAreStale(db.binding, trip.id)).toBe(false)

    const total = write.ms + weather.ms + replan.ms
    const share = (ms: number) => `${((ms / total) * 100).toFixed(1)}%`

    console.log(
      [
        '',
        'Apply itinerary — the work, and which request now carries it',
        `  PUT /trips/:id/days          ${write.ms.toFixed(1)} ms  ${share(write.ms)}   ${writes.roundTrips()} statements`,
        `  POST .../outfits/generate    ${(weather.ms + replan.ms).toFixed(1)} ms  ${share(
          weather.ms + replan.ms,
        )}   ${generates.roundTrips()} statements`,
        `    ├ getWeather               ${weather.ms.toFixed(1)} ms`,
        `    └ generateOutfits          ${replan.ms.toFixed(1)} ms`,
        `  total                        ${total.toFixed(1)} ms`,
        `  the tap now waits for ${writes.roundTrips()} of ${
          writes.roundTrips() + generates.roundTrips()
        } D1 statements`,
        '',
      ].join('\n'),
    )

    /*
     * The claim, in the unit that survives the move to production.
     *
     * Not "the replan takes longer" — that is a stopwatch reading on an
     * in-process SQLite file. This says most of what the tap used to wait for
     * is no longer on the tap's path, counted in D1 round trips, which is true
     * on any machine. The first draft asserted an ORDER OF MAGNITUDE and was
     * simply wrong: the replan is about three times the statements, not ten,
     * and most of its cost is ranking the wardrobe in the Worker rather than
     * talking to the database. Measuring said so; the assertion now says what
     * was measured.
     */
    const everything = writes.roundTrips() + generates.roundTrips()
    expect(writes.roundTrips() / everything).toBeLessThan(0.35)
  })

  /**
   * The convergence case, and the reason `outfits_planned_at` lives on the trip
   * rather than being derived from the groups.
   *
   * Approving an outfit freezes it — D1c — so replanning an all-approved trip
   * writes no group rows and changes no `updated_at`. Anything that inferred
   * freshness from those rows would report "still behind" for ever.
   */
  it('stops reporting a plan as behind even when every outfit is approved', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await setTripDays(db.binding, trip.id, DAYS, NOW)

    const withDays = (await getTrip(db.binding, trip.id))!
    await generateOutfits(db.binding, withDays, NOW)

    db.raw.prepare("UPDATE outfit_group SET status = 'approved' WHERE trip_id = ?").run(trip.id)

    // The days move again, so the plan is behind again.
    await setTripDays(
      db.binding,
      trip.id,
      [...DAYS, { date: '2026-08-06', activityTag: 'safari' }],
      LATER,
    )
    expect(await outfitsAreStale(db.binding, trip.id)).toBe(true)

    const again = (await getTrip(db.binding, trip.id))!
    const result = await generateOutfits(db.binding, again, LATER)

    // The planner honoured approvals — so nothing it wrote could have said the
    // plan was fresh. The trip's own stamp did.
    expect(result.kept).toBeGreaterThan(0)
    expect(await outfitsAreStale(db.binding, trip.id)).toBe(false)
  })

  /**
   * A trip whose days were never touched is not behind — which is what every
   * trip that existed before migration 0024 looks like, and is correct: they
   * were all replanned synchronously by the endpoint this change replaced.
   */
  it('does not call a trip stale merely for having no recorded day change', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    expect(await outfitsAreStale(db.binding, trip.id)).toBe(false)
  })
})
