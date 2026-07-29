import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateOutfits, listOutfits } from '../../worker/repos/outfits'
import { createTrip, getTrip, setTripDays } from '../../worker/repos/trips'
import { replaceWeather } from '../../worker/repos/weather'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * Saying which days are what, against real SQL.
 *
 * The behaviour that matters is end to end rather than in `planGroups` alone:
 * the days have to survive a write and a read, and the outfit plan has to come
 * out with the right number of safari outfits at the far end. Unit tests prove
 * the arithmetic; this proves the wiring.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-08-01',
  endDate: '2026-08-05',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
}

const NOW = 1_780_000_000
let db: TestDatabase

function garment(id: string, subcategory: string, warmth: number | null = null) {
  const category =
    subcategory === 'Shoes' ? 'Footwear' : subcategory === 'Pants' ? 'Bottoms & Swimwear' : 'Tops & Outerwear'
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, favorite, usage_frequency,
                         warmth, dressiness, typical_uses, is_critical, requires_final_check,
                         default_packing_timing, always_include, never_include, source,
                         created_at, updated_at)
       VALUES (?,'clothing',?,?,?,0,'sometimes',?,1,'["casual"]',0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(id, id, category, subcategory, warmth)
  return id
}

/** Enough of a wardrobe to dress five separate days without running out. */
function stockWardrobe() {
  for (let i = 1; i <= 6; i += 1) garment(`tee${i}`, 'T-Shirt')
  garment('pants', 'Pants')
  garment('shoes', 'Shoes')
}

beforeEach(() => {
  db = createTestDatabase()
})

afterEach(() => {
  db.close()
})

describe('which days are what', () => {
  it('stores only the days it was given, and reads them back', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    const updated = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-02', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
    ])

    expect(updated?.days).toEqual([
      { date: '2026-08-02', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
    ])
  })

  /*
   * A day outside the trip would be counted by the planner and would inflate
   * the plan by an outfit Alex has nowhere to wear.
   */
  it('refuses a date the trip does not cover', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    const updated = await setTripDays(db.binding, trip.id, [
      { date: '2026-08-02', activityTag: 'safari' },
      { date: '2027-01-01', activityTag: 'safari' },
    ])

    expect(updated?.days.map((d) => d.date)).toEqual(['2026-08-02'])
  })

  it('replaces the previous answer rather than accumulating', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)

    await setTripDays(db.binding, trip.id, [{ date: '2026-08-02', activityTag: 'safari' }])
    await setTripDays(db.binding, trip.id, [{ date: '2026-08-03', activityTag: 'safari' }])

    expect((await getTrip(db.binding, trip.id))?.days).toEqual([
      { date: '2026-08-03', activityTag: 'safari' },
    ])
  })

  /*
   * The defect this whole feature exists to fix: one safari tag used to produce
   * exactly one safari outfit no matter how many safari days there were.
   */
  it('plans one safari outfit per safari day', async () => {
    stockWardrobe()
    const trip = await createTrip(db.binding, TRIP, NOW)

    const before = await generateOutfits(db.binding, trip, NOW)
    expect(before.groups.find((g) => g.name === 'Safari')?.occurrences).toBe(1)

    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2026-08-02', activityTag: 'safari' },
      { date: '2026-08-03', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
    ]))!

    await generateOutfits(db.binding, withDays, NOW)
    const groups = await listOutfits(db.binding, trip.id)

    expect(groups.find((g) => g.name === 'Safari')?.occurrences).toBe(3)
    // And the whole trip is still accounted for, not double-counted.
    expect(groups.reduce((sum, g) => sum + g.occurrences, 0)).toBe(5)
  })

  it('dresses a repeated group in more than one garment', async () => {
    stockWardrobe()
    const trip = await createTrip(db.binding, TRIP, NOW)

    const withDays = (await setTripDays(db.binding, trip.id, [
      { date: '2026-08-02', activityTag: 'safari' },
      { date: '2026-08-03', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
    ]))!

    const { groups } = await generateOutfits(db.binding, withDays, NOW)
    const safari = groups.find((g) => g.name === 'Safari')!
    const tops = safari.slots.filter((s) => s.role === 'top' && s.itemId)

    // Tees have a reuse capacity of 1, so three safari days need three of them.
    expect(new Set(tops.map((s) => s.itemId)).size).toBe(3)
  })
})

describe('weather narrows what the planner will offer', () => {
  function cold(dates: string[]) {
    return dates.map((date) => ({
      date,
      tempMinC: -2,
      tempMaxC: 2,
      precipitationProbability: null,
      windKph: null,
      source: 'forecast' as const,
    }))
  }

  it('keeps a summer shell out of a freezing trip', async () => {
    stockWardrobe()
    garment('summer-shell', 'Outerwear', 0)
    garment('parka', 'Outerwear', 3)

    const trip = await createTrip(db.binding, TRIP, NOW)
    await replaceWeather(db.binding, trip.id, cold(['2026-08-01', '2026-08-02', '2026-08-03']), NOW)

    const weather = cold(['2026-08-01', '2026-08-02', '2026-08-03'])
    const { groups } = await generateOutfits(db.binding, trip, NOW, weather)

    const outerChoices = groups
      .flatMap((g) => g.slots)
      .filter((s) => s.role === 'outer' && s.itemId)
      .map((s) => s.itemId)

    expect(outerChoices).not.toContain('summer-shell')
  })

  /*
   * Without a forecast the planner must behave exactly as it did before weather
   * existed. This environment cannot reach Open-Meteo, so "no weather" is the
   * path that will actually run here — it has to be the safe one.
   */
  it('plans exactly as before when there is no forecast at all', async () => {
    stockWardrobe()
    garment('summer-shell', 'Outerwear', 0)

    const trip = await createTrip(db.binding, TRIP, NOW)
    const { groups } = await generateOutfits(db.binding, trip, NOW, [])

    expect(groups.length).toBeGreaterThan(0)
    expect(groups.every((g) => g.slots.length > 0)).toBe(true)
  })

  it('does not throw away a stored forecast when a refresh finds nothing', async () => {
    const trip = await createTrip(db.binding, TRIP, NOW)
    await replaceWeather(db.binding, trip.id, cold(['2026-08-01']), NOW)

    // What a blocked network produces: an empty list.
    await replaceWeather(db.binding, trip.id, [], NOW)

    const rows = db.raw
      .prepare('SELECT COUNT(*) AS n FROM trip_weather WHERE trip_id = ?')
      .get(trip.id) as { n: number }
    expect(rows.n).toBe(1)
  })
})
