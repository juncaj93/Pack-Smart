import type { Item } from '@shared/items'
import {
  EVERYDAY_TEMPLATE,
  OUTFIT_TEMPLATES,
  SLOT_LABELS,
  assign,
  clothingDemand,
  passesFilters,
  planGroups,
  reuseCapacity,
  slotFor,
  type FilledGroup,
  type SlotRole,
} from '@shared/outfits'
import { reviewWardrobe, type LastLookResult } from '@shared/last-look'
import { tripDateRange, tripDays, type Trip } from '@shared/trips'
import { demandFor, warmthBandForDays, type WeatherDay } from '@shared/weather'
import type { ReuseDefaults } from '@shared/outfits'
import { listActiveCandidates } from './items'

/**
 * Alex's saved engine preferences, read at last.
 *
 * `reuse_defaults` and `warmth_bias` have sat in the `preference` table since
 * migration 0005 with nothing reading them, so "pack light" and "I run cold"
 * (doc 03 §2) had nowhere to land. A malformed row is ignored rather than
 * crashing the plan — a corrupt preference must not cost Alex his outfits.
 */
async function enginePreferences(
  db: D1Database,
): Promise<{ reuseDefaults: ReuseDefaults; warmthBias: number }> {
  const result = await db
    .prepare("SELECT key, value_json FROM preference WHERE key IN ('reuse_defaults','warmth_bias')")
    .all<{ key: string; value_json: string }>()

  let reuseDefaults: ReuseDefaults = {}
  let warmthBias = 0

  for (const row of result.results ?? []) {
    try {
      const parsed = JSON.parse(row.value_json) as Record<string, unknown>
      if (row.key === 'reuse_defaults') {
        reuseDefaults = Object.fromEntries(
          Object.entries(parsed).filter(([, v]) => typeof v === 'number' && v > 0),
        ) as ReuseDefaults
      } else if (typeof parsed.offset === 'number' && Number.isFinite(parsed.offset)) {
        warmthBias = parsed.offset
      }
    } catch {
      /* a corrupt preference is ignored, never fatal */
    }
  }

  return { reuseDefaults, warmthBias }
}

/** Shifts a band by the saved warmth bias, staying inside the 0-3 scale. */
function biased(band: [number, number] | null, offset: number): [number, number] | null {
  if (!band || offset === 0) return band
  const clamp = (n: number) => Math.max(0, Math.min(3, n + offset))
  return [clamp(band[0]), clamp(band[1])]
}

/**
 * Outfit persistence and the outfit-to-checklist link.
 *
 * Product doc 04 §8 makes approved outfits the source of truth for the clothing
 * checklist. `checklist_link` is what keeps that true in both directions, so
 * Alex never maintains two conflicting clothing plans.
 */

export interface OutfitSlotView {
  id: string
  role: SlotRole
  roleLabel: string
  required: boolean
  itemId: string | null
  itemName: string | null
  /** How many of the group's days this garment covers. */
  wearings: number
  unmetReason: string | null
  reason: string | null
  sortOrder: number
}

export interface OutfitGroupView {
  id: string
  tripId: string
  name: string
  activityTag: string | null
  occurrences: number
  status: 'draft' | 'approved' | 'incomplete'
  slots: OutfitSlotView[]
  sortOrder: number
}

interface GroupRow {
  id: string
  trip_id: string
  name: string
  activity_tag: string | null
  occurrences: number
  status: string
  sort_order: number
}

interface SlotRow {
  id: string
  outfit_group_id: string
  slot_role: string
  required: number
  item_id: string | null
  unmet_reason: string | null
  reason_json: string | null
  wearings: number
  sort_order: number
}

export async function listOutfits(db: D1Database, tripId: string): Promise<OutfitGroupView[]> {
  const groups = await db
    .prepare('SELECT * FROM outfit_group WHERE trip_id = ? ORDER BY sort_order')
    .bind(tripId)
    .all<GroupRow>()

  const rows = groups.results ?? []
  if (rows.length === 0) return []

  const slots = await db
    .prepare(
      `SELECT s.*, i.display_name AS item_name
         FROM outfit_slot s
         LEFT JOIN item i ON i.id = s.item_id
        WHERE s.outfit_group_id IN (SELECT id FROM outfit_group WHERE trip_id = ?)
        ORDER BY s.sort_order`,
    )
    .bind(tripId)
    .all<SlotRow & { item_name: string | null }>()

  const byGroup = new Map<string, OutfitSlotView[]>()
  for (const slot of slots.results ?? []) {
    const view: OutfitSlotView = {
      id: slot.id,
      role: slot.slot_role as SlotRole,
      roleLabel: SLOT_LABELS[slot.slot_role as SlotRole] ?? slot.slot_role,
      required: slot.required === 1,
      itemId: slot.item_id,
      itemName: slot.item_name,
      wearings: slot.wearings,
      unmetReason: slot.unmet_reason,
      reason: slot.reason_json,
      sortOrder: slot.sort_order,
    }
    byGroup.set(slot.outfit_group_id, [...(byGroup.get(slot.outfit_group_id) ?? []), view])
  }

  return rows.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    activityTag: row.activity_tag,
    occurrences: row.occurrences,
    status: row.status as OutfitGroupView['status'],
    slots: byGroup.get(row.id) ?? [],
    sortOrder: row.sort_order,
  }))
}

/**
 * Generates the outfit plan for a trip.
 *
 * Deliberately refuses to run over an approved plan. Regenerating after Alex has
 * approved outfits would silently discard his swaps, and the whole point of
 * approval is that it sticks (risk R12 — the app must not look like it changed
 * its mind).
 */
export async function generateOutfits(
  db: D1Database,
  trip: Trip,
  now: number,
  weather: WeatherDay[] = [],
): Promise<{ groups: OutfitGroupView[]; regenerated: boolean }> {
  const existing = await listOutfits(db, trip.id)
  if (existing.some((g) => g.status === 'approved')) {
    return { groups: existing, regenerated: false }
  }

  const wardrobe = await listActiveCandidates(db, 'clothing')

  /*
   * planGroups wants EVERY day of the trip, not only the ones Alex named.
   *
   * The trip stores just the named days — a date he has not spoken for has no
   * row. Handing that straight to the planner would make the first and last
   * NAMED days look like the ends of the trip, so the real travel days would
   * vanish and the plan would cover three days of a five-day trip.
   */
  const stated = new Map(trip.days.map((d) => [d.date, d.activityTag]))
  const everyDay = trip.days.length
    ? tripDateRange(trip.startDate, trip.endDate).map((date) => ({
        date,
        activityTag: stated.get(date) ?? null,
      }))
    : []

  const planned = planGroups(trip.activities, tripDays(trip.startDate, trip.endDate), everyDay)

  /*
   * Weather narrows jackets and mid-layers, per group, from that group's own
   * dates.
   *
   * Per group rather than per trip because that is the whole point: the safari
   * mornings and the city days on the same trip are not the same conditions, and
   * one band across the lot would either over-filter the mild days or admit a
   * summer shell to the cold ones. Groups whose dates are unknown, or a trip
   * with no forecast, fall back to the trip-wide band — and to no band at all,
   * which is exactly the behaviour before weather existed.
   */
  const byDate = new Map(weather.map((day) => [day.date, day]))
  const tripBand = warmthBandForDays(weather)
  const { reuseDefaults, warmthBias } = await enginePreferences(db)

  /** That group's own days, or the whole trip when its dates are unknown. */
  const daysOf = (group: { dates: string[] }): WeatherDay[] => {
    const own = group.dates.map((date) => byDate.get(date)).filter((d): d is WeatherDay => !!d)
    return own.length > 0 ? own : weather
  }

  const { groups } = assign(planned, wardrobe, {
    warmthBandFor: (group) => {
      const days = daysOf(group)
      return biased(days.length > 0 ? warmthBandForDays(days) : tripBand, warmthBias)
    },
    /*
     * Per group, from that group's own days. Rain on the city days does not make
     * the safari mornings wet, and a trip-wide "it rains sometime" would put a
     * waterproof requirement on every outfit of the trip.
     */
    demandFor: (group) => {
      const days = daysOf(group)
      return days.length > 0 ? demandFor(days) : null
    },
    maxDressiness: trip.maxDressiness,
    reuseDefaults,
  })

  // Only draft groups are replaced; approved ones were ruled out above.
  await db
    .prepare(
      `DELETE FROM outfit_slot WHERE outfit_group_id IN
         (SELECT id FROM outfit_group WHERE trip_id = ?)`,
    )
    .bind(trip.id)
    .run()
  await db.prepare('DELETE FROM outfit_group WHERE trip_id = ?').bind(trip.id).run()

  let groupOrder = 0
  for (const group of groups) {
    const groupId = crypto.randomUUID()
    const incomplete = group.slots.some((s) => s.required && !s.item)

    await db
      .prepare(
        `INSERT INTO outfit_group (id, trip_id, name, activity_tag, occurrences, dressiness,
                                   expected_conditions, status, sort_order, created_at, updated_at)
         VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?)`,
      )
      .bind(
        groupId, trip.id, group.name, group.activityTag, group.occurrences,
        incomplete ? 'incomplete' : 'draft', groupOrder, now, now,
      )
      .run()

    let slotOrder = 0
    for (const slot of group.slots) {
      await db
        .prepare(
          `INSERT INTO outfit_slot (id, outfit_group_id, slot_role, required, item_id, unmet_reason,
                                    reuse_allowed, rank_score, reason_json, filled_by, wearings,
                                    sort_order)
           VALUES (?,?,?,?,?,?,1,NULL,?,'generated',?,?)`,
        )
        .bind(
          crypto.randomUUID(), groupId, slot.role, slot.required ? 1 : 0,
          slot.item?.id ?? null, slot.unmetReason, slot.reason, slot.wearings, slotOrder,
        )
        .run()
      slotOrder += 1
    }

    groupOrder += 1
  }

  return { groups: await listOutfits(db, trip.id), regenerated: true }
}

/** Swaps one slot's garment, or empties it. */
export async function setSlotItem(
  db: D1Database,
  slotId: string,
  itemId: string | null,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE outfit_slot
          SET item_id = ?, unmet_reason = NULL, reason_json = ?, filled_by = 'user_swap'
        WHERE id = ?`,
    )
    .bind(itemId, itemId ? 'You chose this' : null, slotId)
    .run()

  const group = await db
    .prepare('SELECT outfit_group_id FROM outfit_slot WHERE id = ?')
    .bind(slotId)
    .first<{ outfit_group_id: string }>()

  if (group) await refreshGroupStatus(db, group.outfit_group_id, now)
}

/**
 * Recomputes a group's completeness after an edit.
 *
 * A group with an unfilled required slot is `incomplete` and says so, rather
 * than presenting itself as a finished outfit that happens to have no trousers.
 */
async function refreshGroupStatus(db: D1Database, groupId: string, now: number): Promise<string> {
  const missing = await db
    .prepare('SELECT count(*) AS n FROM outfit_slot WHERE outfit_group_id = ? AND required = 1 AND item_id IS NULL')
    .bind(groupId)
    .first<{ n: number }>()

  const current = await db
    .prepare('SELECT status FROM outfit_group WHERE id = ?')
    .bind(groupId)
    .first<{ status: string }>()

  const incomplete = (missing?.n ?? 0) > 0
  // Approval is Alex's decision and survives an edit; only the incomplete flag
  // is derived.
  const next = incomplete ? 'incomplete' : current?.status === 'approved' ? 'approved' : 'draft'

  await db
    .prepare('UPDATE outfit_group SET status = ?, updated_at = ? WHERE id = ?')
    .bind(next, now, groupId)
    .run()

  return next
}

/**
 * Approves or un-approves an outfit.
 *
 * An outfit missing a required garment cannot be approved — it would put a
 * half-dressed plan on the checklist. The resulting status is returned so the
 * caller can say why rather than appearing to ignore the tap.
 */
export async function setGroupStatus(
  db: D1Database,
  groupId: string,
  status: 'draft' | 'approved',
  now: number,
): Promise<{ status: string }> {
  await db
    .prepare('UPDATE outfit_group SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, groupId)
    .run()

  return { status: await refreshGroupStatus(db, groupId, now) }
}

/* ------------------------------------------------------------------ */
/* outfit -> checklist synchronisation                                 */
/* ------------------------------------------------------------------ */

/**
 * Rewrites the clothing half of the checklist from the approved outfits.
 *
 * Only clothing rows the outfit planner owns are touched. Gear, trip-only
 * additions, and anything Alex has overridden or set aside are left exactly as
 * they are — a checklist that undoes your edits is worse than one slightly out
 * of date (product doc 03 §7).
 */
export async function syncChecklistFromOutfits(
  db: D1Database,
  trip: Trip,
  now: number,
): Promise<{ added: number; updated: number; removed: number }> {
  const approved = (await listOutfits(db, trip.id)).filter((g) => g.status === 'approved')

  const wardrobe = new Map((await listActiveCandidates(db, 'clothing')).map((i) => [i.id, i]))

  const filled: FilledGroup[] = approved.map((group) => ({
    name: group.name,
    activityTag: group.activityTag,
    occurrences: group.occurrences,
    dates: [],
    slots: group.slots.map((slot) => ({
      role: slot.role,
      required: slot.required,
      item: slot.itemId ? (wardrobe.get(slot.itemId) ?? null) : null,
      wearings: slot.wearings,
      unmetReason: slot.unmetReason,
      reason: slot.reason,
    })),
  }))

  const demand = clothingDemand(filled)

  const existing = await db
    .prepare("SELECT * FROM checklist_entry WHERE trip_id = ? AND source = 'outfit_generated'")
    .bind(trip.id)
    .all<{ id: string; item_id: string | null; qty_override: number | null; excluded_at: number | null }>()

  const existingByItem = new Map((existing.results ?? []).map((r) => [r.item_id ?? '', r]))
  const result = { added: 0, updated: 0, removed: 0 }

  for (const [itemId, need] of demand) {
    const reason = `Worn for ${need.groups.join(' and ')}`
    const current = existingByItem.get(itemId)

    if (current) {
      // A hand-set quantity or a Not Bringing decision is Alex's, not ours.
      if (current.qty_override !== null || current.excluded_at !== null) continue
      await db
        .prepare(
          'UPDATE checklist_entry SET required_qty = ?, reason_text = ?, updated_at = ? WHERE id = ?',
        )
        .bind(need.quantity, reason, now, current.id)
        .run()
      result.updated += 1
      continue
    }

    await db
      .prepare(
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, category_snapshot,
                                      required_qty, qty_breakdown_json, qty_override, packed_qty,
                                      packing_timing, requires_final_check, final_checked_at,
                                      excluded_at, source, reason_text, rule_snapshot_json,
                                      is_critical, trip_only, sort_order, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,NULL,0,?,?,NULL,NULL,'outfit_generated',?,NULL,?,0,0,?,?)`,
      )
      .bind(
        crypto.randomUUID(), trip.id, itemId, need.item.displayName, need.item.category,
        need.quantity, describeDemand(need.item, need.quantity),
        need.item.defaultPackingTiming, need.item.requiresFinalCheck ? 1 : 0,
        reason, need.item.isCritical ? 1 : 0, now, now,
      )
      .run()
    result.added += 1
  }

  // A garment no longer worn by any approved outfit leaves the list — unless
  // Alex has touched its row, in which case it is his to remove.
  for (const [itemId, row] of existingByItem) {
    if (demand.has(itemId)) continue
    if (row.qty_override !== null || row.excluded_at !== null) continue
    await db.prepare('DELETE FROM checklist_entry WHERE id = ?').bind(row.id).run()
    result.removed += 1
  }

  return result
}

/** "3 days of wear, worn once each" — the arithmetic, not a bare number. */
function describeDemand(item: Item, quantity: number): string | null {
  if (quantity <= 1) return null
  const capacity = reuseCapacity(item)
  if (capacity <= 1) return `${quantity} days of wear = ${quantity}`
  return `${quantity} needed, worn up to ${capacity} times each`
}

/** Which approved outfits use a garment — for "removing this affects 2 outfits". */
export async function outfitsUsingItem(
  db: D1Database,
  tripId: string,
  itemId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT g.name FROM outfit_slot s
         JOIN outfit_group g ON g.id = s.outfit_group_id
        WHERE g.trip_id = ? AND s.item_id = ?`,
    )
    .bind(tripId, itemId)
    .all<{ name: string }>()

  return [...new Set((result.results ?? []).map((r) => r.name))]
}

export interface SwapCandidate {
  item: Item
  /** Whether it survives the filters for this occasion. */
  suitable: boolean
  /** Why not, when it does not. */
  reason: string | null
}

/**
 * Everything that could go in a slot, marked for suitability.
 *
 * Returns unsuitable garments too, rather than hiding them. The system's job is
 * to say a linen shirt is wrong for the cold, not to make it unchoosable — Alex
 * knows things about his trip the app does not, and a swap list that silently
 * omits half his wardrobe looks broken rather than opinionated.
 */
export async function swapCandidates(
  db: D1Database,
  groupId: string,
  slotId: string,
): Promise<SwapCandidate[]> {
  const slot = await db
    .prepare('SELECT slot_role FROM outfit_slot WHERE id = ?')
    .bind(slotId)
    .first<{ slot_role: string }>()
  if (!slot) return []

  const group = await db
    .prepare('SELECT activity_tag FROM outfit_group WHERE id = ?')
    .bind(groupId)
    .first<{ activity_tag: string | null }>()

  const wardrobe = await listActiveCandidates(db, 'clothing')
  const role = slot.slot_role as SlotRole
  const template =
    OUTFIT_TEMPLATES.find((t) => t.activityTag === group?.activity_tag) ?? EVERYDAY_TEMPLATE

  return wardrobe
    .filter((item) => slotFor(item) === role)
    .map((item) => {
      const verdict = passesFilters(item, { role, template })
      return { item, suitable: verdict.ok, reason: verdict.ok ? null : verdict.reason }
    })
    .sort((a, b) => Number(b.suitable) - Number(a.suitable) || a.item.displayName.localeCompare(b.item.displayName))
}

/* ------------------------------------------------------------------ */
/* one last look                                                       */
/* ------------------------------------------------------------------ */

/**
 * The wardrobe review shown before packing starts.
 *
 * Leads with favourites left behind and garments that would fill a real gap in
 * the plan. Everything else is returned too, but the UI keeps it behind a
 * search — product doc 04 §9 forbids leading with the full closet, because that
 * is how a packing assistant turns into an overpacking assistant.
 */
export async function lastLook(db: D1Database, tripId: string): Promise<LastLookResult> {
  const [wardrobe, groups, entries] = await Promise.all([
    listActiveCandidates(db, 'clothing'),
    listOutfits(db, tripId),
    db
      .prepare('SELECT item_id FROM checklist_entry WHERE trip_id = ? AND item_id IS NOT NULL')
      .bind(tripId)
      .all<{ item_id: string }>(),
  ])

  const unfilledRoles: Array<{ role: SlotRole; groupName: string }> = []
  const usedRoles = new Set<SlotRole>()

  // A garment already chosen for an outfit counts as planned, even before the
  // outfit is approved. Calling it "a favourite you have not packed" while it is
  // sitting in the wedding outfit would be plainly wrong.
  const planned = new Set((entries.results ?? []).map((r) => r.item_id))

  for (const group of groups) {
    for (const slot of group.slots) {
      usedRoles.add(slot.role)
      if (slot.itemId) planned.add(slot.itemId)
      if (slot.required && !slot.itemId) {
        unfilledRoles.push({ role: slot.role, groupName: group.name })
      }
    }
  }

  return reviewWardrobe({ wardrobe, plannedItemIds: planned, unfilledRoles, usedRoles })
}
