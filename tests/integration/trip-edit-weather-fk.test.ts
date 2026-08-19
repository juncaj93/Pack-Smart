import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import type { WeatherDay } from '@shared/weather'
import { createTrip, updateTrip } from '../../worker/repos/trips'
import { listWeather, replaceWeather } from '../../worker/repos/weather'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Editing a trip that already has a forecast (CI, #129).
 *
 * `trip_weather.destination_id` has referenced `trip_destination (id)` since
 * migration 0003, and it has been POPULATED since the two-stop fix — before
 * that it was always NULL, which is why this could not fire. `updateTrip`
 * rewrites the destination list by deleting every row and inserting the new
 * set, so the moment a trip has a cached forecast that delete is removing rows
 * something still points at, and SQLite refuses the whole statement.
 *
 * **What that costs Alex is the entire edit.** Not the weather — the edit. The
 * name change, the dates, the activities: `updateTrip` throws before any of it
 * is written, the sheet says it could not save, and the only trips it can happen
 * to are the ones he has already opened, because opening one is what fetches
 * the forecast.
 *
 * It is the same defect the trip DELETE path already carries a fix and a comment
 * for — "`trip_destination` is referenced by trip_weather, already gone" —
 * found there by a teardown rather than by a test, and never checked on the
 * update path.
 *
 * It reached CI as a WebKit-only failure in `itinerary.spec.ts`, which is what
 * a race looks like from the outside: the same spec passes on Chromium, where
 * the browser gets to the apply before the forecast lands. Nothing about the
 * bug is engine-specific, so nothing about this test is.
 */

const NOW = 1_780_000_000
let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})
afterEach(() => {
  db.close()
})

const TRIP: TripInput = {
  name: 'Cape Town',
  startDate: '2026-08-01',
  endDate: '2026-08-08',
  destinations: [{ name: 'Cape Town', country: 'ZA' }],
  activities: [],
}

/** The forecast rows a trip has the moment its screen has been opened once. */
async function cacheForecastFor(tripId: string): Promise<string> {
  const stop = db.raw
    .prepare('SELECT id FROM trip_destination WHERE trip_id = ?')
    .get(tripId) as { id: string }

  await replaceWeather(
    db.binding,
    tripId,
    [
      {
        date: '2026-08-02',
        tempMinC: 9,
        tempMaxC: 18,
        precipitationProbability: 0.1,
        windKph: 12,
        source: 'forecast',
        destinationId: stop.id,
      } satisfies WeatherDay,
    ],
    NOW,
  )
  return stop.id
}

describe('editing a trip that already has a forecast', () => {
  it('saves the edit rather than failing on the forecast pointing at the old stop', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await cacheForecastFor(trip.id)

    /*
     * The plain case, and the one that was broken: an edit that does not even
     * mention the destinations still rewrites them, because `updateTrip` always
     * replaces the whole list.
     */
    const updated = await updateTrip(
      db.binding,
      trip.id,
      { ...TRIP, name: 'Cape Town, renamed' },
      NOW + 1,
    )

    expect(updated?.name).toBe('Cape Town, renamed')
  })

  it('keeps the forecast, which is the whole reason the rows are not simply deleted', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await cacheForecastFor(trip.id)

    await updateTrip(db.binding, trip.id, { ...TRIP, name: 'Renamed' }, NOW + 1)

    /*
     * Deleting the weather alongside the destinations would also satisfy the
     * constraint, and it would throw away a usable forecast on every edit —
     * the exact thing `replaceWeather`'s empty-days guard exists to prevent,
     * arriving from the other direction. The link is dropped; the reading stays.
     */
    const kept = await listWeather(db.binding, trip.id)
    expect(kept.map((day) => day.date)).toEqual(['2026-08-02'])
    expect(kept[0]?.tempMaxC).toBe(18)
  })

  it('leaves no forecast row pointing at a destination that no longer exists', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const oldStop = await cacheForecastFor(trip.id)

    await updateTrip(db.binding, trip.id, { ...TRIP, name: 'Renamed' }, NOW + 1)

    const rows = db.raw
      .prepare('SELECT destination_id FROM trip_weather WHERE trip_id = ?')
      .all(trip.id) as Array<{ destination_id: string | null }>

    expect(rows).toHaveLength(1)
    // Not the old id, which has been deleted — a dangling pointer is what the
    // constraint was there to prevent and satisfying it by hiding is not a fix.
    expect(rows[0]?.destination_id).not.toBe(oldStop)
    expect(rows[0]?.destination_id).toBeNull()
  })

  it('still edits a trip that has no forecast at all', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    const updated = await updateTrip(
      db.binding,
      trip.id,
      { ...TRIP, name: 'No forecast yet' },
      NOW + 1,
    )
    expect(updated?.name).toBe('No forecast yet')
  })
})
