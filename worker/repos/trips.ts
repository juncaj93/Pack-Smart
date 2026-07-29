import type { Trip, TripFact, TripInput } from '@shared/trips'
import { deriveTripFacts } from '@shared/trips'

/**
 * Trip persistence.
 *
 * Nothing here may write to `item`, `packing_rule` or `preference` — that
 * separation is what makes "trip edits stay trip-only" structural rather than a
 * rule someone has to remember (02_DATA_MODEL.md §1).
 */

interface TripRow {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  notes_raw: string | null
  luggage_mode: string | null
  laundry_available: number | null
  max_dressiness: number | null
  flight_hours: number | null
  international: number | null
  timezone: string | null
  created_at: number
  updated_at: number
}

interface FactRow {
  fact_key: string
  value_json: string
  certainty: string
  source: string
  evidence_text: string | null
}

interface DestinationRow {
  id: string
  name: string
  country: string | null
}

function parseFacts(rows: FactRow[]): TripFact[] {
  return rows.map((r) => {
    let value: unknown = null
    let explanation = ''
    try {
      const parsed = JSON.parse(r.value_json) as { v: unknown; e: string }
      value = parsed.v
      explanation = parsed.e
    } catch {
      /* a malformed fact is dropped rather than crashing the trip */
    }
    return {
      factKey: r.fact_key,
      value,
      certainty: r.certainty as TripFact['certainty'],
      source: r.source as TripFact['source'],
      evidenceText: r.evidence_text,
      explanation,
    }
  })
}

export async function getTrip(db: D1Database, id: string): Promise<Trip | null> {
  const row = await db.prepare('SELECT * FROM trip WHERE id = ?').bind(id).first<TripRow>()
  if (!row) return null

  const [destinations, facts] = await Promise.all([
    db
      .prepare('SELECT id, name, country FROM trip_destination WHERE trip_id = ? ORDER BY sort_order')
      .bind(id)
      .all<DestinationRow>(),
    db
      .prepare('SELECT fact_key, value_json, certainty, source, evidence_text FROM trip_fact WHERE trip_id = ? AND superseded_by IS NULL')
      .bind(id)
      .all<FactRow>(),
  ])

  const parsedFacts = parseFacts(facts.results ?? [])
  const activities = parsedFacts.find((f) => f.factKey === 'activities')?.value

  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as Trip['status'],
    notes: row.notes_raw,
    luggageMode: row.luggage_mode,
    laundryAvailable: row.laundry_available === null ? null : row.laundry_available === 1,
    maxDressiness: row.max_dressiness,
    flightHours: row.flight_hours,
    international: row.international === null ? null : row.international === 1,
    timezone: row.timezone,
    destinations: (destinations.results ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      country: d.country,
    })),
    activities: Array.isArray(activities) ? (activities as string[]) : [],
    facts: parsedFacts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listTrips(db: D1Database): Promise<Trip[]> {
  const result = await db
    .prepare('SELECT id FROM trip ORDER BY start_date DESC')
    .all<{ id: string }>()

  const trips: Trip[] = []
  for (const row of result.results ?? []) {
    const trip = await getTrip(db, row.id)
    if (trip) trips.push(trip)
  }
  return trips
}

async function writeFacts(db: D1Database, tripId: string, facts: TripFact[], now: number) {
  // Facts are fully rewritten on edit. Superseding rather than replacing matters
  // only once detection produces competing facts (M7); until then a clean
  // rewrite keeps the trip a faithful reflection of what Alex last confirmed.
  await db.prepare('DELETE FROM trip_fact WHERE trip_id = ?').bind(tripId).run()

  for (const fact of facts) {
    await db
      .prepare(
        `INSERT INTO trip_fact (id, trip_id, fact_key, value_json, certainty, source,
                                evidence_text, evidence_start, evidence_end, confirmed_at,
                                superseded_by, created_at)
         VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?)`,
      )
      .bind(
        crypto.randomUUID(), tripId, fact.factKey,
        JSON.stringify({ v: fact.value, e: fact.explanation }),
        fact.certainty, fact.source, fact.evidenceText ?? null, now,
      )
      .run()
  }
}

export async function createTrip(db: D1Database, input: TripInput, now: number): Promise<Trip> {
  const id = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO trip (id, name, start_date, end_date, status, notes_raw, luggage_mode,
                         laundry_available, max_dressiness, flight_hours, international,
                         timezone, created_at, updated_at)
       VALUES (?,?,?,?,'planning',?,?,?,NULL,?,?,NULL,?,?)`,
    )
    .bind(
      id, input.name.trim(), input.startDate, input.endDate, input.notes ?? null,
      input.luggageMode ?? null,
      input.laundryAvailable === null || input.laundryAvailable === undefined
        ? null
        : input.laundryAvailable ? 1 : 0,
      input.flightHours ?? null,
      input.international === null || input.international === undefined
        ? null
        : input.international ? 1 : 0,
      now, now,
    )
    .run()

  let order = 0
  for (const destination of input.destinations) {
    if (!destination.name.trim()) continue
    await db
      .prepare(
        `INSERT INTO trip_destination (id, trip_id, name, country, latitude, longitude,
                                       arrive_date, depart_date, sort_order)
         VALUES (?,?,?,?,NULL,NULL,NULL,NULL,?)`,
      )
      .bind(crypto.randomUUID(), id, destination.name.trim(), destination.country ?? null, order)
      .run()
    order += 1
  }

  await writeFacts(db, id, deriveTripFacts(input), now)

  const trip = await getTrip(db, id)
  if (!trip) throw new Error('trip disappeared immediately after insert')
  return trip
}

export async function updateTrip(
  db: D1Database,
  id: string,
  input: TripInput,
  now: number,
): Promise<Trip | null> {
  const existing = await getTrip(db, id)
  if (!existing) return null

  await db
    .prepare(
      `UPDATE trip SET name = ?, start_date = ?, end_date = ?, notes_raw = ?, luggage_mode = ?,
                       laundry_available = ?, flight_hours = ?, international = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name.trim(), input.startDate, input.endDate, input.notes ?? null,
      input.luggageMode ?? null,
      input.laundryAvailable === null || input.laundryAvailable === undefined
        ? null
        : input.laundryAvailable ? 1 : 0,
      input.flightHours ?? null,
      input.international === null || input.international === undefined
        ? null
        : input.international ? 1 : 0,
      now, id,
    )
    .run()

  await db.prepare('DELETE FROM trip_destination WHERE trip_id = ?').bind(id).run()
  let order = 0
  for (const destination of input.destinations) {
    if (!destination.name.trim()) continue
    await db
      .prepare(
        `INSERT INTO trip_destination (id, trip_id, name, country, latitude, longitude,
                                       arrive_date, depart_date, sort_order)
         VALUES (?,?,?,?,NULL,NULL,NULL,NULL,?)`,
      )
      .bind(crypto.randomUUID(), id, destination.name.trim(), destination.country ?? null, order)
      .run()
    order += 1
  }

  await writeFacts(db, id, deriveTripFacts(input), now)
  return getTrip(db, id)
}

export async function setTripStatus(
  db: D1Database,
  id: string,
  status: Trip['status'],
  now: number,
): Promise<Trip | null> {
  await db
    .prepare('UPDATE trip SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, id)
    .run()
  return getTrip(db, id)
}
