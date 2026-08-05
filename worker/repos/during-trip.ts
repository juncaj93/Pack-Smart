import {
  assignDays,
  packedOnly,
  resolveDayPlan,
  type DayPlan,
  type WearAction,
} from '@shared/during-trip'
import { garmentDetail } from '@shared/items'
import { slotFor, SLOT_LABELS } from '@shared/outfits'
import { tripDateRange, type Trip } from '@shared/trips'
import { listChecklist } from './checklist'
import { listOutfits } from './outfits'

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
): Promise<void> {
  const existing = await db
    .prepare('SELECT plan_date FROM daily_plan WHERE trip_id = ?')
    .bind(trip.id)
    .all<{ plan_date: string }>()

  const have = new Set((existing.results ?? []).map((r) => r.plan_date))
  const dates = tripDateRange(trip.startDate, trip.endDate)
  if (dates.every((date) => have.has(date))) return

  const approved = (await listOutfits(db, trip.id)).filter((g) => g.status === 'approved')
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

  for (const assignment of assignments) {
    if (have.has(assignment.date)) continue
    await db
      .prepare(
        `INSERT INTO daily_plan (id, trip_id, plan_date, event_id, outfit_group_id,
                                 adjustments_json, created_at, updated_at)
         VALUES (?,?,?,NULL,?,NULL,?,?)`,
      )
      .bind(crypto.randomUUID(), trip.id, assignment.date, assignment.outfitGroupId, now, now)
      .run()
  }
}

export async function getDayPlan(db: D1Database, trip: Trip, date: string): Promise<DayPlan> {
  const row = await db
    .prepare('SELECT * FROM daily_plan WHERE trip_id = ? AND plan_date = ?')
    .bind(trip.id, date)
    .first<PlanRow>()

  const packed = await packedCatalog(db, trip.id)

  let adjustments: Record<string, string | null> = {}
  if (row?.adjustments_json) {
    try {
      adjustments = JSON.parse(row.adjustments_json) as Record<string, string | null>
    } catch {
      /* an unreadable adjustment falls back to the plan, never to nothing */
    }
  }

  const groups = await listOutfits(db, trip.id)
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
    .prepare('SELECT plan_date FROM daily_plan WHERE trip_id = ? AND outfit_group_id = ? ORDER BY plan_date')
    .bind(trip.id, row?.outfit_group_id ?? '')
    .all<{ plan_date: string }>()

  const occurrenceIndex = Math.max(
    0,
    (groupDates.results ?? []).findIndex((r) => r.plan_date === date),
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
  const row = await db
    .prepare('SELECT id, adjustments_json FROM daily_plan WHERE trip_id = ? AND plan_date = ?')
    .bind(tripId, date)
    .first<{ id: string; adjustments_json: string | null }>()
  if (!row) return

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
