import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TripInput } from '@shared/trips'
import { generateChecklist, listChecklist, setPackedQty } from '../../worker/repos/checklist'
import {
  dismissConflict,
  dismissedFor,
  ensureDailyPlans,
  getDayPlan,
} from '../../worker/repos/during-trip'
import {
  generateOutfits,
  listOutfits,
  setGroupStatus,
  syncChecklistFromOutfits,
} from '../../worker/repos/outfits'
import { createTrip, getTrip } from '../../worker/repos/trips'
import { saveTimezone, tripStops } from '../../worker/repos/weather'
import { buildBriefing } from '../../worker/services/today'
import { getWeather, shouldRefresh } from '../../worker/services/weather'
import { FORECAST_FRESH_FOR_SECONDS } from '@shared/weather'
import { createTestDatabase, type TestDatabase } from './d1'

/**
 * E2, against real SQL.
 *
 * The unit tests prove the rules; this proves that the rules are reading the
 * database they think they are — that `fetched_at` reaches the screen, that a
 * stop's zone changes which day Today calls today, and that "keep this outfit"
 * survives being closed.
 *
 * Migration `0015` is exercised here by construction: `createTestDatabase`
 * applies every migration in order, so a column that did not land would fail
 * these rather than production.
 */

const TRIP: TripInput = {
  name: 'South Africa',
  startDate: '2026-08-01',
  endDate: '2026-08-08',
  destinations: [{ name: 'Cape Town', country: 'South Africa' }],
  activities: ['safari'],
  international: true,
  laundryAvailable: false,
}

const NOW = 1_780_000_000
let db: TestDatabase

function garment(
  id: string,
  name: string,
  subcategory: string,
  options: { warmth?: number; weatherTags?: string[] } = {},
) {
  const category =
    subcategory === 'Shoes'
      ? 'Footwear'
      : subcategory === 'Pants'
        ? 'Bottoms & Swimwear'
        : 'Tops & Outerwear'
  db.raw
    .prepare(
      `INSERT INTO item (id, kind, display_name, category, subcategory, favorite, usage_frequency,
                         warmth, dressiness, typical_uses, weather_tags, is_critical,
                         requires_final_check, default_packing_timing, always_include,
                         never_include, source, created_at, updated_at)
       VALUES (?,'clothing',?,?,?,0,'sometimes',?,1,'["casual"]',?,0,0,'anytime',0,0,'seed_import',1,1)`,
    )
    .run(
      id,
      name,
      category,
      subcategory,
      options.warmth ?? 1,
      JSON.stringify(options.weatherTags ?? []),
    )
  return id
}

/**
 * Puts a wardrobe garment on the trip's list, the way `Add from your wardrobe`
 * does — outside any outfit.
 *
 * That is the case the rain conflict is FOR: a shell in the bag that the
 * approved outfit does not use. Generating it through an outfit instead would
 * test a different thing.
 *
 * `OR IGNORE` because migration 0013's unique index is the point of that
 * migration: one row per item per trip. If the planner already put the garment
 * on the list, that row is the right one and this is a no-op.
 */
function addToTrip(tripId: string, itemId: string, name: string, category: string) {
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                    required_qty, qty_breakdown_json, qty_override, packed_qty,
                                    packing_timing, requires_final_check, final_checked_at,
                                    excluded_at, source, reason_text, rule_snapshot_json,
                                    is_critical, trip_only, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,1,NULL,NULL,0,'anytime',0,NULL,NULL,'user_added',NULL,NULL,0,0,0,?,?)`,
    )
    .run(crypto.randomUUID(), tripId, itemId, name, category, NOW, NOW)
}

/** One stored day, the way `replaceWeather` would have written it. */
function storeWeather(
  tripId: string,
  date: string,
  options: {
    fetchedAt?: number
    rain?: number
    source?: 'forecast' | 'climate_normal'
    minC?: number
    maxC?: number
    destinationId?: string | null
  } = {},
) {
  db.raw
    .prepare(
      `INSERT INTO trip_weather (id, trip_id, destination_id, weather_date, temp_min_c,
                                 temp_max_c, precipitation, wind_kph, source, fetched_at)
       VALUES (?,?,?,?,?,?,?,8,?,?)`,
    )
    .run(
      crypto.randomUUID(),
      tripId,
      options.destinationId ?? null,
      date,
      options.minC ?? 12,
      options.maxC ?? 24,
      options.rain ?? 10,
      options.source ?? 'forecast',
      options.fetchedAt ?? NOW,
    )
}

beforeEach(() => {
  db = createTestDatabase()
  for (let i = 1; i <= 14; i += 1) garment(`tee${i}`, `Tee ${i}`, 'T-Shirt')
  for (let i = 1; i <= 5; i += 1) garment(`pants${i}`, `Pants ${i}`, 'Pants')
  garment('shoes', 'Walking Shoes', 'Shoes')
  garment('shell', 'Gore-Tex Shell', 'Outerwear', { warmth: 2, weatherTags: ['waterproof'] })
  garment('parka', 'Down Parka', 'Outerwear', { warmth: 3 })
})

afterEach(() => {
  db.close()
})

async function packedTrip() {
  const trip = await createTrip(db.binding, TRIP, NOW)
  await generateChecklist(db.binding, trip, NOW)
  await generateOutfits(db.binding, trip, NOW)

  for (const group of await listOutfits(db.binding, trip.id)) {
    if (group.status !== 'incomplete') await setGroupStatus(db.binding, group.id, 'approved', NOW)
  }
  await syncChecklistFromOutfits(db.binding, trip, NOW)

  // Two outer layers in the bag that no outfit uses: the shell Alex tagged
  // waterproof, and a parka he did not. Which is the whole point of the
  // capability rules — one of them is an answer to rain and one is not.
  addToTrip(trip.id, 'shell', 'Gore-Tex Shell', 'Tops & Outerwear')
  addToTrip(trip.id, 'parka', 'Down Parka', 'Tops & Outerwear')

  for (const entry of await listChecklist(db.binding, trip.id)) {
    await setPackedQty(db.binding, entry.id, entry.requiredQty, NOW)
  }

  await ensureDailyPlans(db.binding, trip, NOW)
  return (await getTrip(db.binding, trip.id))!
}

async function briefingFor(
  trip: Awaited<ReturnType<typeof packedTrip>>,
  date: string,
  at = new Date(NOW * 1000),
) {
  const [plan, entries] = await Promise.all([
    getDayPlan(db.binding, trip, date),
    listChecklist(db.binding, trip.id),
  ])
  return buildBriefing(db.binding, {
    trip,
    date,
    plan,
    entries,
    deviceDate: '2026-08-03',
    at,
  })
}

/* ------------------------------------------------------------------ */

describe('how old the stored forecast is', () => {
  it('reaches the Today screen, which it never did before E2', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { fetchedAt: NOW - 600 })

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.weatherFetchedAt).toBe(NOW - 600)
    expect(briefing.freshness).toBe('live')
  })

  it('reads as stale once it is older than the refresh window', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { fetchedAt: NOW - 3 * 86_400 })

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.freshness).toBe('stale')
  })

  it('reads as seasonal when only a climate normal is stored', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { source: 'climate_normal' })

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.freshness).toBe('seasonal')
  })

  it('reads as unavailable when nothing is stored', async () => {
    const trip = await packedTrip()
    const briefing = await briefingFor(trip, '2026-08-03')

    expect(briefing.freshness).toBe('unavailable')
    expect(briefing.weather).toBeNull()
  })

  it('is reported by the read endpoint too', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { fetchedAt: NOW - 3 * 86_400 })

    const read = await getWeather(db.binding, trip.id, NOW)
    expect(read.fetchedAt).toBe(NOW - 3 * 86_400)
    expect(read.freshness).toBe('stale')
  })
})

describe('when it is worth going and looking again', () => {
  /**
   * The guard that keeps this from becoming polling.
   *
   * A trip with no weather at all is deliberately NOT a reason to reach out on
   * every screen open: a destination Open-Meteo cannot find would otherwise cost
   * a network call every time Alex looked at Today, for ever, to be told the
   * same thing. The manual control is the answer for that case.
   */
  it('only when something is stored and has aged out', () => {
    expect(shouldRefresh(null, NOW)).toBe(false)
    expect(shouldRefresh(NOW - 60, NOW)).toBe(false)
    expect(shouldRefresh(NOW - FORECAST_FRESH_FOR_SECONDS + 1, NOW)).toBe(false)
    expect(shouldRefresh(NOW - FORECAST_FRESH_FOR_SECONDS, NOW)).toBe(true)
    expect(shouldRefresh(NOW - 5 * 86_400, NOW)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('the destination’s own time zone', () => {
  it('is stored on the stop and decides which day is today', async () => {
    const trip = await packedTrip()
    const [stop] = await tripStops(db.binding, trip.id)
    await saveTimezone(db.binding, stop!.id, 'Africa/Johannesburg')

    const withZone = (await getTrip(db.binding, trip.id))!
    expect(withZone.destinations[0]!.timezone).toBe('Africa/Johannesburg')

    // 22:30 in New York on the 3rd is already the 4th in Johannesburg.
    const briefing = await briefingFor(withZone, '2026-08-03', new Date('2026-08-04T02:30:00Z'))

    expect(briefing.dateBasis).toBe('destination')
    expect(briefing.todayDate).toBe('2026-08-04')
    expect(briefing.dateCaveat).toBe(false)
  })

  it('falls back to the phone, and says so, while no zone is recorded', async () => {
    const trip = await packedTrip()
    expect(trip.destinations[0]!.timezone).toBeNull()

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.dateBasis).toBe('device')
    expect(briefing.dateCaveat).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('a conflict between the day and the outfit', () => {
  it('is raised when rain is likely and nothing worn keeps it off', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { rain: 85 })

    const briefing = await briefingFor(trip, '2026-08-03')
    const rain = briefing.conflicts.find((c) => c.kind === 'rain')

    expect(rain).toBeDefined()
    // And it offers the shell, which Alex tagged waterproof — never the parka.
    expect(rain!.alternatives.map((a) => a.name)).toContain('Gore-Tex Shell')
    expect(rain!.alternatives.map((a) => a.name)).not.toContain('Down Parka')
  })

  it('is silent on an ordinary day', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { rain: 10, minC: 16, maxC: 22 })

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.conflicts).toEqual([])
  })

  /**
   * The rule the whole slice is built around (doc 04 §12).
   *
   * A conflict is a sentence and a list of options. It changes nothing.
   */
  it('leaves the approved outfit byte-for-byte unchanged', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { rain: 85, minC: 1, maxC: 4 })

    const before = (await listOutfits(db.binding, trip.id)).map((g) => ({
      id: g.id,
      status: g.status,
      slots: g.slots.map((s) => s.itemId),
    }))

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.conflicts.length).toBeGreaterThan(0)

    const after = (await listOutfits(db.binding, trip.id)).map((g) => ({
      id: g.id,
      status: g.status,
      slots: g.slots.map((s) => s.itemId),
    }))
    expect(after).toEqual(before)
  })

  it('says a lost forecast is lost, rather than comparing against nothing', async () => {
    const trip = await packedTrip()
    // Something was fetched for this trip, but not for the day being shown.
    storeWeather(trip.id, '2026-08-06', { fetchedAt: NOW - 60 })

    const briefing = await briefingFor(trip, '2026-08-03')
    expect(briefing.conflicts.map((c) => c.kind)).toEqual(['forecast_lost'])
  })
})

/* ------------------------------------------------------------------ */

describe('keeping the outfit', () => {
  it('is remembered against the forecast it was answered about', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { rain: 85, fetchedAt: NOW })

    expect((await briefingFor(trip, '2026-08-03')).conflicts.map((c) => c.kind)).toContain('rain')

    await dismissConflict(db.binding, trip.id, '2026-08-03', 'rain', NOW, NOW)
    expect(await dismissedFor(db.binding, trip.id, '2026-08-03')).toEqual({ rain: NOW })

    expect((await briefingFor(trip, '2026-08-03')).conflicts.map((c) => c.kind)).not.toContain(
      'rain',
    )
  })

  /**
   * Why the dismissal stores a timestamp rather than a flag.
   *
   * A decision about this morning's weather must not silence a warning raised by
   * tomorrow's. A boolean would have shipped exactly that, invisibly.
   */
  it('does not silence the same conflict raised by a newer forecast', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { rain: 85, fetchedAt: NOW })
    await dismissConflict(db.binding, trip.id, '2026-08-03', 'rain', NOW, NOW)

    // A later fetch replaces the row, and the conflict is news again.
    db.raw.prepare('DELETE FROM trip_weather WHERE trip_id = ?').run(trip.id)
    storeWeather(trip.id, '2026-08-03', { rain: 90, fetchedAt: NOW + 86_400 })

    const briefing = await briefingFor(trip, '2026-08-03', new Date((NOW + 86_400) * 1000))
    expect(briefing.conflicts.map((c) => c.kind)).toContain('rain')
  })

  it('silences only the day it was answered on', async () => {
    const trip = await packedTrip()
    storeWeather(trip.id, '2026-08-03', { rain: 85, fetchedAt: NOW })
    storeWeather(trip.id, '2026-08-04', { rain: 85, fetchedAt: NOW })

    await dismissConflict(db.binding, trip.id, '2026-08-03', 'rain', NOW, NOW)

    expect((await briefingFor(trip, '2026-08-04')).conflicts.map((c) => c.kind)).toContain('rain')
  })

  it('survives an unreadable record by showing the warning rather than swallowing it', async () => {
    const trip = await packedTrip()
    db.raw
      .prepare('UPDATE daily_plan SET dismissed_json = ? WHERE trip_id = ? AND plan_date = ?')
      .run('not json', trip.id, '2026-08-03')

    expect(await dismissedFor(db.binding, trip.id, '2026-08-03')).toEqual({})
  })
})
