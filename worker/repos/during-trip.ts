import {
  assignDays,
  packedOnly,
  resolveDayPlan,
  type DayPlan,
  type WearAction,
} from '@shared/during-trip'
import { garmentDetail } from '@shared/items'
import { slotFor, SLOT_LABELS } from '@shared/outfits'
import { type Trip } from '@shared/trips'
import { listChecklist } from './checklist'
import { listOutfits, type OutfitGroupView } from './outfits'

/**
 * During Trip persistence.
 *
 * `daily_plan` exists so the plan is READ, not recomputed, on every open. Risk
 * R12 is that the app appears to change its mind between two glances at the same
 * morning; storing the assignment is what prevents that.
 */

interface PlanRow {
  id: string
  plan_date: string
  outfit_group_id: string | null
  adjustments_json: string | null
}

/**
 * The packed catalog for a trip, keyed by item id.
 *
 * This is the ONLY source of During Trip candidates. Product doc 04 §10 makes
 * that absolute: not-bringing, unpacked, and archived items may never be
 * recommended, and routing every path through one function is what keeps that
 * true rather than aspirational.
 */
/**
 * What Today knows about a packed thing.
 *
 * `detail` is who made it and which one it is (G6). Today lists alternatives by
 * name, and after the names stopped repeating the brand and the colour, two
 * different shirts can arrive on that list reading identically — which on a
 * screen offering a REPLACEMENT is the one place it must not happen.
 */
export interface PackedGarment {
  name: string
  detail: string | null
  kind: string
  role: string | null
  roleLabel: string | null
}

export async function packedCatalog(
  db: D1Database,
  tripId: string,
): Promise<Map<string, PackedGarment>> {
  const entries = await listChecklist(db, tripId)
  const packedIds = packedOnly(entries)

  const catalog = new Map<string, PackedGarment>()
  if (packedIds.size === 0) return catalog

  const placeholders = [...packedIds].map(() => '?').join(',')
  const result = await db
    .prepare(
      `SELECT id, kind, display_name, subcategory, category, archived_at,
              brand, color, pattern
         FROM item WHERE id IN (${placeholders})`,
    )
    .bind(...packedIds)
    .all<{
      id: string
      kind: string
      display_name: string
      subcategory: string | null
      category: string
      archived_at: number | null
      brand: string | null
      color: string | null
      pattern: string | null
    }>()

  for (const row of result.results ?? []) {
    // Belt and braces: an item archived after packing is still excluded.
    if (row.archived_at !== null) continue

    const role = slotFor({
      subcategory: row.subcategory,
    } as Parameters<typeof slotFor>[0])

    catalog.set(row.id, {
      name: row.display_name,
      detail: garmentDetail(row),
      kind: row.kind,
      role,
      roleLabel: role ? SLOT_LABELS[role] : null,
    })
  }

  return catalog
}

/**
 * Reads today's plan, creating the day-to-outfit assignment once if it is
 * missing.
 *
 * Creation is idempotent and happens only when there is no stored row for the
 * date, so a second open reads back exactly what the first one wrote.
 */
export async function ensureDailyPlans(
  db: D1Database,
  trip: Trip,
  now: number,
): Promise<OutfitGroupView[]> {
  const existing = await db
    .prepare('SELECT plan_date, event_id FROM daily_plan WHERE trip_id = ?')
    .bind(trip.id)
    .all<{ plan_date: string; event_id: string | null }>()

  /*
   * Keyed by date AND event, because a date can hold several (G2).
   *
   * `plan_date` alone was enough while a day meant one outfit. It is not now: a
   * beach afternoon and a formal dinner are two plans on one date, and a set of
   * dates would see the first and decide the day was already planned.
   *
   * `event_id` is null for a date Alex never spoke for — a travel or casual day
   * the spread reached — and that is a stable key too, because such a date gets
   * exactly one plan.
   */
  const key = (date: string, eventId: string | null) => `${date}\u0000${eventId ?? ''}`
  const have = new Set(
    (existing.results ?? []).map((r) => key(r.plan_date, r.event_id)),
  )

  /*
   * Returned as well as used (P1B).
   *
   * Today calls this and then `getDayPlans`, which wanted the same list — three
   * round trips for a second copy of rows that a `daily_plan` insert cannot
   * have changed. Handing the snapshot back is the whole saving, and it keeps
   * the read in the one place that has to do it rather than making every caller
   * remember to.
   */
  const groups = await listOutfits(db, trip.id)
  const approved = groups.filter((g) => g.status === 'approved')
  const assignments = assignDays(
    trip.startDate,
    trip.endDate,
    approved.map((g) => ({
      id: g.id,
      name: g.name,
      occurrences: g.occurrences,
      activityTag: g.activityTag,
    })),
    trip.days,
  )

  if (assignments.every((a) => have.has(key(a.date, a.eventId)))) return groups

  /*
   * One batch, not a round trip per day (P1B).
   *
   * This is the first open of Today for a trip, and it was inserting a
   * `daily_plan` row per day of the trip one at a time — half the endpoint's
   * server time on the measured trip, and it grows with the length of the
   * holiday. The same shape `generateChecklist` had, in the one place the
   * screen cannot render without.
   *
   * The rows are independent of each other and nothing below reads them back,
   * so sending them together changes when they land and nothing else. D1 runs a
   * batch in an implicit transaction, so a failure part way through no longer
   * leaves a trip half planned either.
   */
  const inserts = assignments
    .filter((assignment) => !have.has(key(assignment.date, assignment.eventId)))
    .map((assignment) =>
      db
        .prepare(
          `INSERT INTO daily_plan (id, trip_id, plan_date, event_id, outfit_group_id,
                                   adjustments_json, created_at, updated_at)
           VALUES (?,?,?,?,?,NULL,?,?)`,
        )
        .bind(
          crypto.randomUUID(), trip.id, assignment.date, assignment.eventId,
          assignment.outfitGroupId, now, now,
        ),
    )

  if (inserts.length > 0) await db.batch(inserts)

  return groups
}

/**
 * Every outfit this date calls for, in the order the day happens (G2).
 *
 * A list rather than one plan, because a date can hold a beach afternoon and a
 * formal dinner, and dressing Alex for one of them is worse than saying nothing:
 * he would arrive at dinner in what the app told him to wear.
 *
 * Ordered by the event's own `sort_order`, so the sequence is the one he
 * arranged rather than whatever the rows came back in. A date he never spoke
 * for has exactly one plan with a null `event_id`, which is the shape every
 * trip had before this and still has.
 */
export async function getDayPlans(
  db: D1Database,
  trip: Trip,
  date: string,
  /**
   * The outfit groups, when the caller has already read them (P1B).
   *
   * `ensureDailyPlans` reads the same list immediately before this on the Today
   * path, and inserting a `daily_plan` row cannot change an outfit — so sharing
   * one snapshot removes three round trips without changing an answer. Omitted
   * by the callers that have no list of their own, which read it here as before.
   */
  known?: OutfitGroupView[],
): Promise<DayPlan[]> {
  const [rows, groups, packed] = await Promise.all([
    db
      .prepare(
        `SELECT p.* FROM daily_plan p
           LEFT JOIN trip_event e ON e.id = p.event_id
          WHERE p.trip_id = ? AND p.plan_date = ?
          ORDER BY COALESCE(e.sort_order, 0), p.rowid`,
      )
      .bind(trip.id, date)
      .all<PlanRow>(),
    /*
     * Read ONCE for the whole date, not once per plan.
     *
     * `buildDayPlan` used to fetch both of these itself, and a date can hold
     * several plans — so a beach afternoon and a formal dinner read the entire
     * outfit list and the entire checklist twice each. That is the N+1 the P1B
     * audit found on this endpoint, and it got worse exactly as a day got busier.
     */
    known ? Promise.resolve(known) : listOutfits(db, trip.id),
    packedCatalog(db, trip.id),
  ])

  const list = rows.results ?? []
  if (list.length === 0) return [await buildDayPlan(db, trip, date, null, groups, packed)]
  return Promise.all(list.map((row) => buildDayPlan(db, trip, date, row, groups, packed)))
}

/**
 * The first of them, for the callers that genuinely want one.
 *
 * Kept because "what is the outfit for this date" is still a sensible question
 * for the majority of dates, which carry exactly one. Anything that renders the
 * day to Alex must use `getDayPlans` — showing the first of three would be the
 * defect this slice exists to fix, wearing a convenient signature.
 */
export async function getDayPlan(db: D1Database, trip: Trip, date: string): Promise<DayPlan> {
  return (await getDayPlans(db, trip, date))[0]!
}

async function buildDayPlan(
  db: D1Database,
  trip: Trip,
  date: string,
  row: PlanRow | null,
  groups: OutfitGroupView[],
  packed: Map<string, PackedGarment>,
): Promise<DayPlan> {
  let adjustments: Record<string, string | null> = {}
  if (row?.adjustments_json) {
    try {
      adjustments = JSON.parse(row.adjustments_json) as Record<string, string | null>
    } catch {
      /* an unreadable adjustment falls back to the plan, never to nothing */
    }
  }

  const group = groups.find((g) => g.id === row?.outfit_group_id) ?? null

  const worn = await db
    .prepare(
      "SELECT item_id FROM wear_log WHERE trip_id = ? AND worn_date != ? AND action IN ('will_wear','already_wore')",
    )
    .bind(trip.id, date)
    .all<{ item_id: string }>()

  /*
   * Which of this group's days today is.
   *
   * A "Casual days x 5" group holds five days of tops. Today must show one of
   * them, and it must show the SAME one every time, so the index comes from the
   * stored date order rather than from anything recomputed.
   */
  const groupDates = await db
    .prepare(
      `SELECT plan_date, id FROM daily_plan
        WHERE trip_id = ? AND outfit_group_id = ? ORDER BY plan_date, rowid`,
    )
    .bind(trip.id, row?.outfit_group_id ?? '')
    .all<{ plan_date: string; id: string }>()

  /*
   * Found by ROW, not by date (G2).
   *
   * A group can now dress two activities on one date — a `Casual days x 5`
   * group covering a morning and an afternoon — and matching on the date alone
   * gave both of them occurrence 0, so both showed the same shirt.
   */
  const occurrenceIndex = Math.max(
    0,
    (groupDates.results ?? []).findIndex((r) =>
      row ? r.id === row.id : r.plan_date === date,
    ),
  )

  // Gear worth carrying out for the day: what this trip triggered, not the whole
  // bag. See DayPlanInput.bringableItemIds.
  const bringable = await db
    .prepare(
      `SELECT item_id FROM checklist_entry
        WHERE trip_id = ? AND item_id IS NOT NULL AND excluded_at IS NULL
          AND source IN ('trip_triggered', 'dependency_triggered')`,
    )
    .bind(trip.id)
    .all<{ item_id: string }>()

  return resolveDayPlan({
    date,
    groupName: group?.name ?? null,
    slots: (group?.slots ?? []).map((slot) => ({
      role: slot.role,
      roleLabel: slot.roleLabel,
      itemId: slot.itemId,
      itemName: slot.itemName,
      reason: slot.reason,
      wearings: slot.wearings,
    })),
    occurrenceIndex,
    packed,
    adjustments,
    wornItemIds: new Set((worn.results ?? []).map((r) => r.item_id)),
    bringableItemIds: new Set((bringable.results ?? []).map((r) => r.item_id)),
  })
}

/**
 * Swaps one garment for another, for this day only.
 *
 * Stored as an adjustment rather than by editing the outfit: the approved plan
 * is what Alex agreed to before the trip, and one cold morning should not
 * silently rewrite it (doc 04 §12).
 */
export async function adjustDay(
  db: D1Database,
  tripId: string,
  date: string,
  fromItemId: string,
  toItemId: string | null,
  now: number,
): Promise<void> {
  /*
   * The plan that actually holds the garment, not the first one on the date (G2).
   *
   * A date can now carry several plans, and `.first()` adjusted whichever came
   * back first — so swapping the shoes in the evening outfit silently wrote the
   * adjustment onto the afternoon one, and neither screen would have shown what
   * Alex asked for. Resolved by the garment because that is what he actually
   * pointed at; a garment in two of the day's outfits adjusts the earlier one,
   * which is the one he reaches first.
   */
  const candidates = await db
    .prepare(
      `SELECT p.id, p.adjustments_json, p.outfit_group_id
         FROM daily_plan p
         LEFT JOIN trip_event e ON e.id = p.event_id
        WHERE p.trip_id = ? AND p.plan_date = ?
        ORDER BY COALESCE(e.sort_order, 0), p.rowid`,
    )
    .bind(tripId, date)
    .all<{ id: string; adjustments_json: string | null; outfit_group_id: string | null }>()

  const rows = candidates.results ?? []
  if (rows.length === 0) return

  let row = rows[0]!
  if (rows.length > 1) {
    const groups = await listOutfits(db, tripId)
    const holding = rows.find((candidate) => {
      const group = groups.find((g) => g.id === candidate.outfit_group_id)
      if (group?.slots.some((slot) => slot.itemId === fromItemId)) return true
      // An adjustment already made here counts too: swapping back has to reach
      // the row that recorded the swap.
      return candidate.adjustments_json?.includes(fromItemId) ?? false
    })
    if (holding) row = holding
  }

  let adjustments: Record<string, string | null> = {}
  if (row.adjustments_json) {
    try {
      adjustments = JSON.parse(row.adjustments_json) as Record<string, string | null>
    } catch {
      adjustments = {}
    }
  }

  adjustments[fromItemId] = toItemId

  await db
    .prepare('UPDATE daily_plan SET adjustments_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(adjustments), now, row.id)
    .run()
}

/**
 * Records what happened to a garment today.
 *
 * Guidance, not inventory accounting — doc 04 §14 is explicit that v1 must not
 * require Alex to maintain a perfect laundry ledger.
 */
export async function logWear(
  db: D1Database,
  tripId: string,
  itemId: string,
  date: string,
  action: WearAction,
  now: number,
): Promise<void> {
  await db
    .prepare('DELETE FROM wear_log WHERE trip_id = ? AND item_id = ? AND worn_date = ?')
    .bind(tripId, itemId, date)
    .run()

  await db
    .prepare(
      `INSERT INTO wear_log (id, trip_id, item_id, event_id, worn_date, action, created_at)
       VALUES (?,?,?,NULL,?,?,?)`,
    )
    .bind(crypto.randomUUID(), tripId, itemId, date, action, now)
    .run()
}

export async function listWearLog(
  db: D1Database,
  tripId: string,
  date: string,
): Promise<Record<string, WearAction>> {
  const result = await db
    .prepare('SELECT item_id, action FROM wear_log WHERE trip_id = ? AND worn_date = ?')
    .bind(tripId, date)
    .all<{ item_id: string; action: string }>()

  const log: Record<string, WearAction> = {}
  for (const row of result.results ?? []) log[row.item_id] = row.action as WearAction
  return log
}

/** Packed garments that could stand in for a given role today. */
export async function packedAlternatives(
  db: D1Database,
  trip: Trip,
  date: string,
  role: string,
): Promise<Array<{ itemId: string; name: string; detail: string | null }>> {
  const packed = await packedCatalog(db, trip.id)
  const plan = await getDayPlan(db, trip, date)
  const inUse = new Set(plan.wear.map((w) => w.itemId))

  const options: Array<{ itemId: string; name: string; detail: string | null }> = []
  for (const [itemId, candidate] of packed) {
    if (candidate.role !== role) continue
    if (inUse.has(itemId)) continue
    options.push({ itemId, name: candidate.name, detail: candidate.detail })
  }

  return options.sort((a, b) => a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ */
/* conflicts Alex has already answered                                 */
/* ------------------------------------------------------------------ */

/**
 * "Keep this outfit", remembered (E2).
 *
 * Stored as `{ "rain": 1780000000 }` — the conflict kind, and the `fetched_at`
 * of the forecast it was answered against. The second half is the whole design:
 * a dismissal silences that conflict for THAT forecast and no other, so a
 * decision made about this morning's weather cannot suppress a warning raised by
 * tomorrow's. A bare boolean would have done exactly that, silently, which is
 * the failure mode weather features are prone to.
 */
export async function dismissedFor(
  db: D1Database,
  tripId: string,
  date: string,
): Promise<Record<string, number>> {
  const row = await db
    .prepare('SELECT dismissed_json FROM daily_plan WHERE trip_id = ? AND plan_date = ?')
    .bind(tripId, date)
    .first<{ dismissed_json: string | null }>()

  if (!row?.dismissed_json) return {}

  try {
    const parsed: unknown = JSON.parse(row.dismissed_json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

    const out: Record<string, number> = {}
    for (const [kind, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) out[kind] = at
    }
    return out
  } catch {
    // An unreadable record means nothing was dismissed, which errs towards
    // showing a warning rather than swallowing one.
    return {}
  }
}

/**
 * Records that Alex looked at a conflict and kept his outfit.
 *
 * Against the forecast it was answered about, never against "for ever". A newer
 * forecast raises the same conflict again, because it is a different claim about
 * a different set of numbers.
 */
export async function dismissConflict(
  db: D1Database,
  tripId: string,
  date: string,
  kind: string,
  fetchedAt: number,
  now: number,
): Promise<void> {
  const row = await db
    .prepare('SELECT id FROM daily_plan WHERE trip_id = ? AND plan_date = ?')
    .bind(tripId, date)
    .first<{ id: string }>()
  if (!row) return

  const dismissed = await dismissedFor(db, tripId, date)
  dismissed[kind] = fetchedAt

  await db
    .prepare('UPDATE daily_plan SET dismissed_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(dismissed), now, row.id)
    .run()
}
