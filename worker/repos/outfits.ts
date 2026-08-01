import type { Item } from '@shared/items'
import {
  EVERYDAY_TEMPLATE,
  SLOT_LABELS,
  TRAVEL_TEMPLATE,
  assign,
  clothingDemand,
  formalityLabel,
  outfitContext,
  passesFilters,
  planGroups,
  reuseCapacity,
  slotFor,
  templateFor,
  type FilledGroup,
  type SlotRole,
} from '@shared/outfits'
import { reviewWardrobe, type LastLookResult } from '@shared/last-look'
import { ACTIVITY_LABELS, destinationForDate, tripDateRange, tripDays, type Trip } from '@shared/trips'
import { demandFor, warmthBandForDays, weatherForDates, type WeatherDay } from '@shared/weather'
import { assignDays } from '@shared/during-trip'
import type { ReuseDefaults } from '@shared/outfits'
import { listActiveCandidates } from './items'
import { forgetGroup, loadPairings, rememberGroup } from './pairings'

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
 * The forecast for a set of dates, at the places those dates belong to.
 *
 * Extracted so the planner and the REPLACEMENT sheet read weather the same way.
 * They did not: the planner narrowed a jacket by that group's own days, and the
 * sheet — which had no idea which days a group covered — applied no weather
 * filter at all. So a garment the planner had rejected for being the wrong
 * warmth came back offered as suitable, and Alex could be shown a summer shell
 * as the replacement for a rain layer.
 *
 * On a multi-city trip the same date can carry two rows, one per stop, so
 * matching on the date alone could plan a Reykjavik day against Cape Town's
 * weather. `destinationForDate` is the single stated rule for which place a date
 * belongs to, and it returns NOTHING rather than guess. Rows written before
 * multi-city carry no destination id; those mean "the trip's one place" and
 * still match, so no stored forecast is orphaned.
 */
function weatherForGroup(trip: Trip, weather: WeatherDay[], dates: string[]): WeatherDay[] {
  const own = dates
    .map((date) => {
      const stop = destinationForDate(trip.destinations, date)
      return weather.find(
        (day) =>
          day.date === date &&
          (day.destinationId == null || stop === null || day.destinationId === stop.id),
      )
    })
    .filter((day): day is WeatherDay => !!day)

  // Falling back to the whole trip is deliberate: a group whose dates are
  // unknown is better filtered by the trip's range than by nothing at all.
  return own.length > 0 ? own : weather
}

/**
 * Outfit persistence and the outfit-to-checklist link.
 *
 * Product doc 04 §8 makes approved outfits the source of truth for the clothing
 * checklist. What keeps that true in both directions is `checklist_entry.source`
 * — rows the planner owns are marked `outfit_generated`, so a resync can replace
 * exactly those and leave Alex's own additions and overrides alone.
 *
 * An earlier version of this comment credited the `checklist_link` table. That
 * was wrong: the table is created by migration 0004 and is never written or read.
 * It is left in place because dropping it is a destructive migration, and it is
 * recorded as dead in technical-docs/10.
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
  /**
   * The garment is on this trip's Not bringing list (doc 04 §8).
   *
   * Derived from the checklist, never stored: the outfit still says what Alex
   * approved, and this says what he is actually taking.
   */
  setAside: boolean
  unmetReason: string | null
  reason: string | null
  sortOrder: number
}

/** An approved outfit built on a garment the trip is not bringing. */
export interface OutfitConflict {
  groupId: string
  groupName: string
  slotId: string
  roleLabel: string
  itemId: string
  itemName: string
}

export interface OutfitGroupView {
  id: string
  tripId: string
  name: string
  activityTag: string | null
  occurrences: number
  status: 'draft' | 'approved' | 'incomplete'
  /**
   * When Alex said "decide later", or null (doc 09 §7, migration 0012).
   *
   * Orthogonal to `status` on purpose: a deferred outfit is still a draft or
   * still incomplete, and it is still unresolved. This only says he has seen it
   * and chosen not to answer yet, so the walkthrough can move on without
   * pretending the outfit is settled.
   */
  deferredAt: number | null
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
  deferred_at: number | null
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

/**
 * The garments this trip has decided against — one definition, two callers.
 *
 * "Every row for it is on Not bringing", not "any row is": a garment can hold
 * both a rule-driven row and an outfit-driven one — two shirts from a rule and a
 * third for the dinner — and setting one aside while the other still stands is
 * not a decision to leave the garment at home. Stated once because the slot
 * marking and the conflict list must never disagree about what "not bringing"
 * means.
 */
const SET_ASIDE_ITEMS = `SELECT item_id FROM checklist_entry
   WHERE trip_id = ? AND item_id IS NOT NULL
   GROUP BY item_id
  HAVING sum(CASE WHEN excluded_at IS NULL THEN 1 ELSE 0 END) = 0`

async function setAsideItems(db: D1Database, tripId: string): Promise<Set<string>> {
  const result = await db.prepare(SET_ASIDE_ITEMS).bind(tripId).all<{ item_id: string }>()
  return new Set((result.results ?? []).map((r) => r.item_id))
}

export async function listOutfits(db: D1Database, tripId: string): Promise<OutfitGroupView[]> {
  const groups = await db
    .prepare('SELECT * FROM outfit_group WHERE trip_id = ? ORDER BY sort_order')
    .bind(tripId)
    .all<GroupRow>()

  const rows = groups.results ?? []
  if (rows.length === 0) return []

  const setAside = await setAsideItems(db, tripId)

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
      setAside: slot.item_id !== null && setAside.has(slot.item_id),
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
    deferredAt: row.deferred_at,
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
  const tripBand = warmthBandForDays(weather)
  const { reuseDefaults, warmthBias } = await enginePreferences(db)

  /*
   * What Alex has approved together before (doc 04 §5 criterion 3).
   *
   * Read once for the whole run rather than per candidate per slot: ranking
   * touches every surviving garment for every slot of every group, and the
   * Worker has a 10ms CPU budget per request.
   */
  const pairings = await loadPairings(db)

  /** That group's own days — see `weatherForGroup`, which the sheet shares. */
  const daysOf = (group: { dates: string[] }): WeatherDay[] =>
    weatherForGroup(trip, weather, group.dates)

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
    // Doc 04 §5 criterion 3. Empty on a first trip, which makes the criterion
    // score 0 for everything and leaves the ranking exactly as it was.
    pairings,
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
 *
 * Approving is also how a saved outfit relationship is created (doc 04 §5
 * criterion 3): the garments in the outfit are recorded as worn together, and
 * un-approving forgets exactly that. `remembered` reports whether lasting
 * catalog state was written, so the screen can say so and offer Undo rather than
 * changing future trips silently.
 */
export async function setGroupStatus(
  db: D1Database,
  groupId: string,
  status: 'draft' | 'approved',
  now: number,
): Promise<{ status: string; remembered: boolean }> {
  /*
   * The TRANSITION, not the requested status.
   *
   * Re-approving an already-approved outfit is a no-op that must not inflate the
   * pairing counts, and un-approving something already draft must not decrement
   * a count nobody added. Read before writing.
   */
  const before = await db
    .prepare('SELECT status FROM outfit_group WHERE id = ?')
    .bind(groupId)
    .first<{ status: string }>()

  await db
    .prepare('UPDATE outfit_group SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now, groupId)
    .run()

  const next = await refreshGroupStatus(db, groupId, now)

  // Only a genuine crossing of the approved boundary changes what Alex is
  // recorded as standing behind. `refreshGroupStatus` can veto an approval
  // (a missing required garment), so the settled status decides, not the request.
  const wasApproved = before?.status === 'approved'
  const isApproved = next === 'approved'

  let remembered = false
  if (!wasApproved && isApproved) {
    remembered = (await rememberGroup(db, groupId, now)) > 0
  } else if (wasApproved && !isApproved) {
    await forgetGroup(db, groupId)
  }

  /*
   * An approval answers the question a deferral postponed.
   *
   * Cleared on the SETTLED status rather than the requested one, so an approval
   * that `refreshGroupStatus` vetoed leaves the deferral where it was — the
   * outfit is still undecided, and marking it decided because Alex tried would
   * be the silent approval doc 09 §7 forbids in its other half.
   *
   * Un-approving deliberately does NOT re-defer. Alex is looking at the outfit
   * at that moment; putting it back on the "decide later" pile would hide it
   * from the very walkthrough he is standing in.
   */
  if (isApproved) {
    await db.prepare('UPDATE outfit_group SET deferred_at = NULL WHERE id = ?').bind(groupId).run()
  }

  return { status: next, remembered }
}

/**
 * "Decide later", and the way back from it.
 *
 * Writes nothing but the marker: the status is untouched, the slots are
 * untouched, and the packing list is untouched — because only approved outfits
 * put clothing on it. So the draft Alex was looking at is exactly the draft he
 * comes back to, which is what doc 09 §7 means by preserving a partly-made
 * decision.
 */
export async function setGroupDeferred(
  db: D1Database,
  groupId: string,
  deferred: boolean,
  now: number,
): Promise<{ deferredAt: number | null }> {
  const at = deferred ? now : null
  await db
    .prepare('UPDATE outfit_group SET deferred_at = ?, updated_at = ? WHERE id = ?')
    .bind(at, now, groupId)
    .run()
  return { deferredAt: at }
}

/**
 * Undo for the pairings a single approval created.
 *
 * Separate from un-approving on purpose: doc 04 §5 requires the lasting effect
 * be refusable without giving up the approval itself. Alex keeps the outfit and
 * declines the habit.
 */
export async function undoRemembered(db: D1Database, groupId: string): Promise<void> {
  await forgetGroup(db, groupId)
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

export interface AffectedOutfit {
  groupId: string
  name: string
  /** The slot the garment was filling — where a replacement has to go. */
  slotId: string
  role: SlotRole
  roleLabel: string
}

/**
 * Which approved outfits use a garment — for "removing this affects 2 outfits".
 *
 * `status = 'approved'` is the whole point and was missing for four milestones:
 * the comment said approved, the query said any, so a draft plan Alex had never
 * signed off on was reported as depending on the garment. Only approved outfits
 * put clothing on the checklist (§8), so only they can conflict with taking it
 * off. Nothing read the result, which is how the defect survived unnoticed.
 *
 * Returns the SLOT, not only the name, because doc 04 §8 asks for a replacement
 * to be offered and a replacement needs somewhere to go.
 */
export async function outfitsUsingItem(
  db: D1Database,
  tripId: string,
  itemId: string,
): Promise<AffectedOutfit[]> {
  const result = await db
    .prepare(
      `SELECT g.id AS group_id, g.name, s.id AS slot_id, s.slot_role
         FROM outfit_slot s
         JOIN outfit_group g ON g.id = s.outfit_group_id
        WHERE g.trip_id = ? AND s.item_id = ? AND g.status = 'approved'
        ORDER BY g.sort_order, s.sort_order`,
    )
    .bind(tripId, itemId)
    .all<{ group_id: string; name: string; slot_id: string; slot_role: string }>()

  return (result.results ?? []).map((r) => ({
    groupId: r.group_id,
    name: r.name,
    slotId: r.slot_id,
    role: r.slot_role as SlotRole,
    roleLabel: SLOT_LABELS[r.slot_role as SlotRole] ?? r.slot_role,
  }))
}

/**
 * Garments an approved outfit is built on that this trip is not bringing.
 *
 * DERIVED, every time, from the checklist rows and the slots as they stand —
 * never stored, and the exclusion never edits the outfit. That is what makes
 * doc 04 §8's "the user must never maintain two conflicting clothing plans"
 * hold in both directions: undo is a single flag flip on the checklist row, and
 * the marking follows it because it was never anywhere else.
 *
 * The alternative shape — clearing the slot on removal and putting it back on
 * undo — has to remember what it destroyed, and would flip the group's stored
 * status to `incomplete`, which drops it out of `syncChecklistFromOutfits` and
 * takes the outfit's *other* garments off the list on the next unrelated sync.
 *
 * One query, because this is served with every load of the packing list — the
 * screen Alex opens most.
 */
export async function outfitConflicts(db: D1Database, tripId: string): Promise<OutfitConflict[]> {
  const result = await db
    .prepare(
      `SELECT g.id AS group_id, g.name AS group_name, s.id AS slot_id, s.slot_role,
              i.id AS item_id, i.display_name AS item_name
         FROM outfit_slot s
         JOIN outfit_group g ON g.id = s.outfit_group_id
         JOIN item i ON i.id = s.item_id
        WHERE g.trip_id = ? AND g.status = 'approved'
          AND s.item_id IN (${SET_ASIDE_ITEMS})
        ORDER BY g.sort_order, s.sort_order`,
    )
    .bind(tripId, tripId)
    .all<{
      group_id: string
      group_name: string
      slot_id: string
      slot_role: string
      item_id: string
      item_name: string
    }>()

  return (result.results ?? []).map((r) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    slotId: r.slot_id,
    roleLabel: SLOT_LABELS[r.slot_role as SlotRole] ?? r.slot_role,
    itemId: r.item_id,
    itemName: r.item_name,
  }))
}

export interface SwapCandidate {
  item: Item
  /** Whether it survives the filters for this occasion. */
  suitable: boolean
  /** Why not, when it does not. */
  reason: string | null
}

/**
 * What a slot's replacement flow needs to know — the same facts the planner had.
 *
 * Returned alongside the candidates so the sheet can SHOW the context it is
 * filtering by. A list that silently rejects half the wardrobe is indistinct
 * from a broken one; saying "8–10 Aug, Kruger, rain likely" is what makes
 * "not recorded as keeping rain out" read as an answer.
 */
export interface SwapContext {
  roleLabel: string
  /** "8–10 Aug", or "3 days" when Alex has not said which days are which. */
  when: string
  place: string | null
  /** The activity in Alex's words, or null for a group that is not one. */
  activity: string | null
  travelDay: boolean
  formality: string | null
  /** "55–70°F · rain likely", "Usually 55–70°F", or null when nothing is stored. */
  conditions: string | null
}

/**
 * Everything that could go in a slot, marked for suitability.
 *
 * Returns unsuitable garments too, rather than hiding them. The system's job is
 * to say a linen shirt is wrong for the cold, not to make it unchoosable — Alex
 * knows things about his trip the app does not, and a swap list that silently
 * omits half his wardrobe looks broken rather than opinionated.
 *
 * **C2b: this now applies the planner's own weather filters.** It could not
 * before, because a stored group has no dates and the warmth band and rain
 * demand are derived from them — so a garment the planner had rejected for
 * being the wrong warmth came back here labelled suitable, and a summer shell
 * could be offered as the replacement for a rain layer.
 *
 * The audit proposed a `dates_json` column. **It is not needed, and would have
 * been worse.** `assignDays` is a pure function of the trip's dates, the trip's
 * named days and the groups — all of which the Worker already has. Deriving
 * costs one call; storing would mean a cache of a pure function that goes stale
 * on every trip edit and every re-plan, which is exactly the second source of
 * truth doc 04 §8 exists to prevent. Deriving also guarantees the sheet, the
 * review screen and During Trip cannot disagree about which days a group
 * covers, because all three call the same function on the same inputs.
 */
export async function swapCandidates(
  db: D1Database,
  groupId: string,
  slotId: string,
  /**
   * The trip, for the dressiness ceiling and the dates. Optional so the older
   * callers — and any test that only cares about the role filter — still work.
   */
  trip: Trip | null = null,
  weather: WeatherDay[] = [],
): Promise<{ candidates: SwapCandidate[]; context: SwapContext | null }> {
  const slot = await db
    .prepare('SELECT slot_role FROM outfit_slot WHERE id = ?')
    .bind(slotId)
    .first<{ slot_role: string }>()
  if (!slot) return { candidates: [], context: null }

  const group = await db
    .prepare('SELECT activity_tag, name FROM outfit_group WHERE id = ?')
    .bind(groupId)
    .first<{ activity_tag: string | null; name: string }>()

  const wardrobe = await listActiveCandidates(db, 'clothing')
  const role = slot.slot_role as SlotRole
  /*
   * The group's OWN template, travel days included.
   *
   * Matching on the activity tag alone fell through to `EVERYDAY_TEMPLATE` for
   * both untagged groups, and the two are not the same: travel days want
   * clothes tagged for travelling and everyday wants no tag at all. So the
   * travel outfit's swap list was drawn from a looser filter than the one that
   * planned it.
   */
  const template = templateFor(group?.activity_tag ?? null, group?.name) ?? EVERYDAY_TEMPLATE

  /*
   * The dates this group covers, derived exactly as every other surface derives
   * them. `assignDays` needs the whole plan, not one group, because two groups
   * must not both believe they own the same Tuesday.
   */
  let dates: string[] = []
  if (trip) {
    const all = await listOutfits(db, trip.id)
    dates = assignDays(
      trip.startDate,
      trip.endDate,
      all.map((g) => ({
        id: g.id,
        name: g.name,
        occurrences: g.occurrences,
        activityTag: g.activityTag,
      })),
      trip.days,
    )
      .filter((day) => day.outfitGroupId === groupId)
      .map((day) => day.date)
  }

  const days = trip ? weatherForGroup(trip, weather, dates) : []
  const { warmthBias } = trip ? await enginePreferences(db) : { warmthBias: 0 }
  const band = days.length > 0 ? biased(warmthBandForDays(days), warmthBias) : null
  const demand = days.length > 0 ? demandFor(days) : null

  const candidates = wardrobe
    .filter((item) => slotFor(item) === role)
    .map((item) => {
      const verdict = passesFilters(item, {
        role,
        template,
        maxDressiness: trip?.maxDressiness ?? null,
        warmthBand: band,
        /*
         * Rain is a hard filter on the OUTER layer only, exactly as in the
         * planner. Promoting it to every slot would reject a perfectly good
         * shirt for not being waterproof.
         */
        needsRainLayer: demand?.rain ?? false,
      })
      return { item, suitable: verdict.ok, reason: verdict.ok ? null : verdict.reason }
    })
    .sort(
      (a, b) =>
        Number(b.suitable) - Number(a.suitable) ||
        a.item.displayName.localeCompare(b.item.displayName),
    )

  /*
   * The dates are only CLAIMED when Alex named his days. `assignDays` spreads
   * groups over the calendar either way, and that spread is a reasonable order
   * for During Trip to walk — but it is not a statement that the safari is on
   * the Tuesday. The weather still reads from the spread dates, because a
   * forecast for roughly those days beats none; the context line falls back to
   * the occurrence count, so nothing on screen asserts a day he never gave.
   */
  const stated = trip && trip.days.length > 0 ? dates : []
  const stop = trip ? destinationForDate(trip.destinations, dates[0] ?? trip.startDate) : null

  const context: SwapContext | null = group
    ? {
        roleLabel: SLOT_LABELS[role] ?? role,
        when: outfitContext({
          activityTag: group.activity_tag,
          dates: stated,
          place: null,
          occurrences: Math.max(1, dates.length),
          name: group.name,
        })[0]!,
        place: trip
          ? (stop?.name ?? (trip.destinations.length === 1 ? trip.destinations[0]!.name : null))
          : null,
        activity: group.activity_tag ? (ACTIVITY_LABELS[group.activity_tag] ?? null) : null,
        travelDay: templateFor(group.activity_tag, group.name) === TRAVEL_TEMPLATE,
        formality: formalityLabel(template),
        conditions: weatherForDates(weather, dates, stop?.id ?? null),
      }
    : null

  return { candidates, context }
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
