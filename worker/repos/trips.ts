import type { Trip, TripDay, TripFact, TripInput } from '@shared/trips'
import { ACTIVITY_LABELS, deriveTripFacts, tripDateRange, tripStatusOn } from '@shared/trips'
import { FALLBACK_EMOJI, isValidTripEmoji, suggestTripEmoji } from '@shared/trip-emoji'

/**
 * Alex's choice if he made one, otherwise a suggestion.
 *
 * Only ever called on create. The suggestion is a starting value written once;
 * re-running it on every edit would move the icon under him whenever he touched
 * the dates (02_DATA_MODEL.md §3).
 */
function resolveEmoji(input: TripInput, taken: string[] = []): string {
  if (isValidTripEmoji(input.emoji)) return input.emoji
  return suggestTripEmoji({
    destination: input.destinations?.[0]?.name ?? null,
    activities: input.activities,
    name: input.name,
    taken,
  })
}

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
  emoji: string
  start_date: string
  end_date: string
  status: string
  notes_raw: string | null
  luggage_mode: string | null
  laundry_available: number | null
  max_dressiness: number | null
  flight_hours: number | null
  archived_at: number | null
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
  arrive_date: string | null
  depart_date: string | null
  timezone: string | null
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

  const [destinations, facts, days] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, country, arrive_date, depart_date, timezone
           FROM trip_destination WHERE trip_id = ? ORDER BY sort_order`,
      )
      .bind(id)
      .all<DestinationRow>(),
    db
      .prepare('SELECT fact_key, value_json, certainty, source, evidence_text FROM trip_fact WHERE trip_id = ? AND superseded_by IS NULL')
      .bind(id)
      .all<FactRow>(),
    db
      .prepare('SELECT event_date, activity_tag FROM trip_event WHERE trip_id = ? ORDER BY event_date')
      .bind(id)
      .all<{ event_date: string; activity_tag: string | null }>(),
  ])

  const parsedFacts = parseFacts(facts.results ?? [])
  const activities = parsedFacts.find((f) => f.factKey === 'activities')?.value

  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji || FALLBACK_EMOJI,
    startDate: row.start_date,
    endDate: row.end_date,
    /*
     * Derived, not the stored value. Nothing in the app has ever called
     * setTripStatus, so every trip sat at 'planning' forever — a trip that
     * ended last month wore a "Planning" chip under the heading "Past trips".
     * The column is still written for explicit transitions; this decides what
     * is true today.
     */
    status: tripStatusOn(
      {
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status as Trip['status'],
      },
      new Date().toISOString().slice(0, 10),
    ),
    notes: row.notes_raw,
    luggageMode: row.luggage_mode,
    laundryAvailable: row.laundry_available === null ? null : row.laundry_available === 1,
    maxDressiness: row.max_dressiness,
    flightHours: row.flight_hours,
    archivedAt: row.archived_at,
    international: row.international === null ? null : row.international === 1,
    timezone: row.timezone,
    destinations: (destinations.results ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      country: d.country,
      arriveDate: d.arrive_date,
      timezone: d.timezone,
      departDate: d.depart_date,
    })),
    activities: Array.isArray(activities) ? (activities as string[]) : [],
    days: (days.results ?? []).map((d) => ({ date: d.event_date, activityTag: d.activity_tag })),
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

  /*
   * The icons other trips already wear, so the suggestion can avoid them.
   *
   * One cheap query on the one occasion the emoji is chosen. Read here rather than
   * in the resolver because `shared/` stays pure — it decides, it does not fetch.
   */
  const existing = await db.prepare('SELECT emoji FROM trip').all<{ emoji: string }>()
  const taken = (existing.results ?? []).map((row) => row.emoji)

  await db
    .prepare(
      `INSERT INTO trip (id, name, emoji, start_date, end_date, status, notes_raw, luggage_mode,
                         laundry_available, max_dressiness, flight_hours, international,
                         timezone, created_at, updated_at)
       VALUES (?,?,?,?,?,'planning',?,?,?,?,?,?,NULL,?,?)`,
    )
    .bind(
      id, input.name.trim(), resolveEmoji(input, taken), input.startDate, input.endDate, input.notes ?? null,
      input.luggageMode ?? null,
      input.laundryAvailable === null || input.laundryAvailable === undefined
        ? null
        : input.laundryAvailable ? 1 : 0,
      input.maxDressiness ?? null,
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
         VALUES (?,?,?,?,NULL,NULL,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(), id, destination.name.trim(), destination.country ?? null,
        destination.arriveDate ?? null, destination.departDate ?? null, order,
      )
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
      `UPDATE trip SET name = ?, emoji = ?, start_date = ?, end_date = ?, notes_raw = ?,
                       luggage_mode = ?, laundry_available = ?, max_dressiness = ?,
                       flight_hours = ?, international = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name.trim(),
      // Keeps what the trip already has unless Alex chose something else. An
      // edit must never silently re-suggest the icon he recognises this trip by.
      isValidTripEmoji(input.emoji) ? input.emoji : existing.emoji,
      input.startDate, input.endDate, input.notes ?? null,
      input.luggageMode ?? null,
      input.laundryAvailable === null || input.laundryAvailable === undefined
        ? null
        : input.laundryAvailable ? 1 : 0,
      input.maxDressiness ?? null,
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
         VALUES (?,?,?,?,NULL,NULL,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(), id, destination.name.trim(), destination.country ?? null,
        destination.arriveDate ?? null, destination.departDate ?? null, order,
      )
      .run()
    order += 1
  }

  await writeFacts(db, id, deriveTripFacts(input), now)
  return getTrip(db, id)
}

/**
 * Records what Alex is doing on each day of the trip.
 *
 * A full rewrite of the trip's days, because that is what the screen sends —
 * partial updates would need the client to track which dates changed, for no
 * benefit at this scale. Dates outside the trip are dropped rather than stored:
 * a day plan for a date the trip does not cover would be counted by the outfit
 * planner and would silently inflate the plan.
 *
 * Only tagged days are kept. A date Alex has explicitly marked as nothing in
 * particular is the same, to the planner, as one he has not reached yet — both
 * are ordinary days — so storing the difference would buy nothing and would make
 * "has he planned his days?" ambiguous.
 */
export async function setTripDays(
  db: D1Database,
  id: string,
  days: TripDay[],
): Promise<Trip | null> {
  const trip = await getTrip(db, id)
  if (!trip) return null

  const valid = new Set(tripDateRange(trip.startDate, trip.endDate))

  await db.prepare('DELETE FROM trip_event WHERE trip_id = ?').bind(id).run()

  let order = 0
  for (const day of days) {
    if (!day.activityTag) continue
    if (!valid.has(day.date)) continue

    await db
      .prepare(
        `INSERT INTO trip_event (id, trip_id, event_date, start_time, end_time, title,
                                 activity_tag, outdoor, dressiness, outfit_group_id, sort_order)
         VALUES (?,?,?,NULL,NULL,?,?,NULL,NULL,NULL,?)`,
      )
      .bind(
        crypto.randomUUID(), id, day.date,
        ACTIVITY_LABELS[day.activityTag] ?? day.activityTag,
        day.activityTag, order,
      )
      .run()
    order += 1
  }

  return getTrip(db, id)
}

/*
 * `setTripStatus` lived here and has been removed.
 *
 * Display status is DERIVED from the dates by `tripStatusOn` (shared/trips.ts),
 * which is what stopped a finished trip claiming to be "Planning". Nothing ever
 * wrote the stored column's `packing` or `active` values: the endpoint and the
 * client helper that could have were called from nowhere, so the whole path was
 * inert. Removed rather than left as surface that looks like a feature.
 *
 * The `status` COLUMN stays. It is in the backup export, and dropping it would be
 * a destructive migration — not something to do as a side effect of deleting
 * dead code.
 */

/* ------------------------------------------------------------------ */
/* archive, restore, delete                                            */
/* ------------------------------------------------------------------ */

/**
 * Puts a trip away without changing anything inside it.
 *
 * Reversible, and deliberately the easy one to reach: it is the answer to almost
 * every "I do not want to see this any more", and it costs nothing to undo. The
 * trip keeps its checklist, its outfits, its wear log and its facts, so a
 * historical trip archived by mistake is not a historical trip lost.
 */
export async function archiveTrip(db: D1Database, id: string, now: number): Promise<Trip | null> {
  await db
    .prepare('UPDATE trip SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL')
    .bind(now, now, id)
    .run()
  return getTrip(db, id)
}

export async function restoreTrip(db: D1Database, id: string, now: number): Promise<Trip | null> {
  await db
    .prepare('UPDATE trip SET archived_at = NULL, updated_at = ? WHERE id = ?')
    .bind(now, id)
    .run()
  return getTrip(db, id)
}

/**
 * Every table a trip owns, children before parents.
 *
 * Written out rather than left to a cascade, because the interesting part of a
 * deletion is what it does NOT touch, and a cascade states that nowhere. Foreign
 * keys are on in the test harness and in D1, so an order that orphaned a row
 * would fail loudly rather than quietly leave one behind.
 *
 * The order matters twice over: `checklist_link` points at both a checklist entry
 * and an outfit slot, so it goes before either.
 *
 * **`daily_plan` used to come after `outfit_group`, and that was a real bug.**
 * `daily_plan.outfit_group_id` is a foreign key, so removing the group first
 * left a row pointing at nothing and SQLite refused the batch — which meant a
 * trip Alex had opened the Today screen on **could not be deleted at all**.
 * `Delete for good` answered 404 and the trip stayed. It survived because the
 * only spec that writes a `daily_plan` is `today.spec.ts`, the only spec that
 * deletes a trip is `trips.spec.ts`, and no test had ever done both — it was
 * found by an end-to-end teardown that tried to remove every trip the suite had
 * made, and could not remove those two.
 */
const TRIP_SCOPED_DELETES = [
  // Join rows first — they point at two parents each.
  `DELETE FROM checklist_link WHERE checklist_entry_id IN
     (SELECT id FROM checklist_entry WHERE trip_id = ?)`,
  `DELETE FROM checklist_link WHERE outfit_slot_id IN
     (SELECT s.id FROM outfit_slot s
        JOIN outfit_group g ON g.id = s.outfit_group_id
       WHERE g.trip_id = ?)`,
  /*
   * Before `outfit_group` and `trip_event`, both of which they reference. Every
   * row that POINTS at something goes before the thing it points at, which is
   * the rule the rest of this list already follows.
   */
  'DELETE FROM daily_plan WHERE trip_id = ?',
  'DELETE FROM wear_log WHERE trip_id = ?',
  `DELETE FROM outfit_slot WHERE outfit_group_id IN
     (SELECT id FROM outfit_group WHERE trip_id = ?)`,
  'DELETE FROM outfit_group WHERE trip_id = ?',
  'DELETE FROM checklist_entry WHERE trip_id = ?',
  'DELETE FROM trip_weather WHERE trip_id = ?',
  // Written by nothing today, but it carries a foreign key and an empty table is
  // not a guarantee — a row here would block the trip row from going.
  'DELETE FROM preference_change_suggestion WHERE trip_id = ?',
  // `trip_event` is referenced by wear_log and daily_plan, both already gone.
  'DELETE FROM trip_event WHERE trip_id = ?',
  // `trip_fact` can point at another fact via `superseded_by`; clearing the link
  // first means the delete does not depend on which row happens to come out
  // first.
  'UPDATE trip_fact SET superseded_by = NULL WHERE trip_id = ?',
  'DELETE FROM trip_fact WHERE trip_id = ?',
  // `trip_destination` is referenced by trip_weather, already gone.
  'DELETE FROM trip_destination WHERE trip_id = ?',
  'DELETE FROM trip WHERE id = ?',
]

/**
 * Removes a trip and everything that belonged only to it. Permanent.
 *
 * **What survives, and why it must:**
 *
 * - **The wardrobe.** Not one `item` or `packing_rule` row is touched. Deleting a
 *   trip must never cost Alex a garment, and `02_DATA_MODEL.md` makes "nothing is
 *   ever deleted" a structural rule for the catalog.
 * - **`outfit_pairing`** — what Pack Smart has learned about which garments go
 *   together (doc 04 §5). It references `item` and never `trip`, deliberately:
 *   the habit outlives the trip that taught it, and throwing away a year of
 *   learning because one trip was tidied up would be the worst kind of silent
 *   loss.
 * - **Every other trip**, including anything they share with this one.
 *
 * **What is genuinely lost, stated rather than glossed:** this trip's own
 * contribution to the learning that IS counted per trip — repeated removals
 * (`checklist_entry.excluded_at`) and packed-but-never-worn (`wear_log`). Those
 * proposals are derived by counting trips, so a deleted trip stops counting. That
 * is correct — it is gone — but it is a real consequence and the reason deletion
 * asks first while archiving does not.
 *
 * One `batch`, which D1 runs in a transaction: a half-deleted trip would leave
 * orphaned outfits pointing at a trip that no longer exists, which is worse than
 * either outcome.
 */
export async function deleteTrip(db: D1Database, id: string): Promise<boolean> {
  const existing = await db.prepare('SELECT id FROM trip WHERE id = ?').bind(id).first<{ id: string }>()
  if (!existing) return false

  await db.batch(TRIP_SCOPED_DELETES.map((sql) => db.prepare(sql).bind(id)))
  return true
}
