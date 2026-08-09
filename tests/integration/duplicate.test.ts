import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { daysFromTemplate, toTemplate, tripStatusOn, type TripInput } from '@shared/trips'
import { generateOutfits } from '../../worker/repos/outfits'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { replaceWeather } from '../../worker/repos/weather'
import { setPackedQty, generateChecklist, listChecklist } from '../../worker/repos/checklist'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Reusing a finished trip.
 *
 * The load-bearing tests are the ones about what is NOT carried across.
 * A trip is two different things at once — a plan, and a record of what
 * happened — and copying the second produces a new trip that claims to be half
 * packed before Alex has touched it.
 */

const NOW = 1_780_000_000

const LAST_YEAR: TripInput = {
  name: 'South Africa',
  emoji: '🦁',
  startDate: '2025-08-01',
  endDate: '2025-08-08',
  destinations: [
    { name: 'Cape Town', country: 'South Africa', arriveDate: '2025-08-01', departDate: '2025-08-04' },
    { name: 'Kruger', country: 'South Africa', arriveDate: '2025-08-05', departDate: '2025-08-08' },
  ],
  activities: ['safari', 'winery'],
  international: true,
  laundryAvailable: false,
  maxDressiness: 2,
  flightHours: 14,
  notes: 'the good one',
}

let db: TestDatabase

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('what a trip carries into the next one', () => {
  it('brings across everything that describes the trip', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const template = toTemplate(trip)

    expect(template).toMatchObject({
      name: 'South Africa',
      emoji: '🦁',
      activities: ['safari', 'winery'],
      international: true,
      laundryAvailable: false,
      maxDressiness: 2,
      flightHours: 14,
      notes: 'the good one',
    })
    expect(template.destinations.map((d) => d.name)).toEqual(['Cape Town', 'Kruger'])
  })

  /*
   * Dates become offsets. A safari on the third day should be the third day of
   * the new trip, whatever its dates — copying 2025-08-03 verbatim would land
   * outside the new trip, where setTripDays drops it without comment.
   */
  it('turns the day plan into offsets and places it on the new dates', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2025-08-03', activityTag: 'safari' },
      { date: '2025-08-06', activityTag: 'winery' },
    ], NOW))!

    const template = toTemplate(withDays)
    expect(template.dayOffsets).toEqual([
      { offset: 2, activityTag: 'safari' },
      { offset: 5, activityTag: 'winery' },
    ])

    // Placed on a trip a year later, starting on a different weekday.
    expect(daysFromTemplate(template, '2026-09-10', '2026-09-17')).toEqual([
      { date: '2026-09-12', activityTag: 'safari' },
      { date: '2026-09-15', activityTag: 'winery' },
    ])
  })

  it('drops an offset that does not fit a shorter trip', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2025-08-07', activityTag: 'safari' },
    ], NOW))!

    // A three-day trip has no seventh day, so that plan simply does not apply.
    expect(daysFromTemplate(toTemplate(withDays), '2026-09-10', '2026-09-12')).toEqual([])
  })

  /*
   * Stop dates are re-derived rather than copied. Last year's arrive/depart are
   * as wrong as last year's trip dates.
   */
  it('does not carry last year’s stop dates', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const template = toTemplate(trip)

    expect(template.destinations.every((d) => d.arriveDate === null)).toBe(true)
    expect(template.destinations.every((d) => d.departDate === null)).toBe(true)
  })
})

describe('what it refuses to carry', () => {
  /*
   * The point. A completed trip is a record of what happened; a new trip is a
   * plan. Carrying the record across would show Alex a trip already half
   * packed, with a forecast for a week that is over.
   */
  it('brings no packed state, no outfits, and no old forecast', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)

    // Make the old trip look thoroughly lived-in.
    await generateChecklist(db.binding, trip, NOW)
    const entries = await listChecklist(db.binding, trip.id)
    if (entries[0]) await setPackedQty(db.binding, entries[0].id, 1, NOW)
    await generateOutfits(db.binding, trip, NOW)
    await replaceWeather(
      db.binding,
      trip.id,
      [{ date: '2025-08-02', tempMinC: 8, tempMaxC: 16, precipitationProbability: 90, windKph: 10, source: 'forecast' }],
      NOW,
    )

    const template = toTemplate((await getTrip(db.binding, trip.id))!)
    const carried = JSON.stringify(template)

    for (const leak of ['packedQty', 'checklist', 'outfit', 'wear', 'tempMin', 'precipitation']) {
      expect(carried, `template leaked ${leak}`).not.toContain(leak)
    }
  })

  /*
   * Reading a template must not create anything, the same guarantee the
   * itinerary parser gives. Alex can tap "Plan again", change his mind, and
   * leave nothing behind.
   */
  it('creates nothing by being read', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    const before = db.raw.prepare('SELECT COUNT(*) AS n FROM trip').get() as { n: number }

    toTemplate((await getTrip(db.binding, trip.id))!)

    const after = db.raw.prepare('SELECT COUNT(*) AS n FROM trip').get() as { n: number }
    expect(after.n).toBe(before.n)
  })
})

describe('a trip’s status is what the dates say', () => {
  it('calls a finished trip finished, whatever was last written', () => {
    const past = { startDate: '2025-08-01', endDate: '2025-08-08', status: 'planning' as const }
    expect(tripStatusOn(past, '2026-07-29')).toBe('completed')
  })

  it('calls a trip under way active', () => {
    const now = { startDate: '2026-07-28', endDate: '2026-08-04', status: 'planning' as const }
    expect(tripStatusOn(now, '2026-07-29')).toBe('active')
  })

  it('leaves a future trip alone', () => {
    const soon = { startDate: '2026-09-01', endDate: '2026-09-08', status: 'packing' as const }
    expect(tripStatusOn(soon, '2026-07-29')).toBe('packing')
  })

  it('reads through from the database', async () => {
    const trip = await createTrip(db.binding, LAST_YEAR, NOW)
    // LAST_YEAR ended in 2025 and the stored status is 'planning'.
    expect((await getTrip(db.binding, trip.id))?.status).toBe('completed')
  })
})
