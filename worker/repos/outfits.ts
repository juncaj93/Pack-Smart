import { garmentDetail, type Item } from '@shared/items'
import {
  EVERYDAY_TEMPLATE,
  LAUNDRY_DAY_CAP,
  LAUNDRY_MIN_TRIP_DAYS,
  SLOT_LABELS,
  TRAVEL_TEMPLATE,
  assign,
  clothingDemand,
  ensureSwimFootwear,
  formalityLabel,
  outfitContext,
  pairTankTopsWithSwimwear,
  passesFilters,
  planGroups,
  redistributeWearings,
  reuseCapacity,
  reviewReason,
  slotConflicts,
  rank,
  slotFor,
  slotMismatch,
  templateFor,
  type Demand,
  type FilledGroup,
  type SlotRole,
} from '@shared/outfits'
import { planSignals } from '@shared/replan'
import { reviewWardrobe, type LastLookResult } from '@shared/last-look'
import { ACTIVITY_LABELS, destinationForDate, tripDateRange, tripDays, type Trip } from '@shared/trips'
import { demandFor, warmthBandForDays, weatherForDates, type WeatherDay } from '@shared/weather'
import type { WeatherCapability } from '@shared/weather-fit'
import { activityKey as activityKeyOf } from '@shared/activity-fit'
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

/**
 * How many days of ordinary washable clothing this trip has to carry.
 *
 * Alex's ruling: four, when laundry is available. Null means "plan exactly as
 * before", and three different situations produce it — he said there is no
 * laundry, he has not answered, or the trip is short enough that four days of
 * clothing is the whole trip.
 *
 * `=== true`, not truthy. `laundryAvailable` is three-valued precisely so that
 * an unanswered question is not read as a no OR a yes, and an unanswered
 * question must never pack less than it did before this shipped.
 *
 * Stated once, because the planner and the checklist synchroniser both need it
 * and a trip whose two halves disagreed about the laundry would be the exact
 * conflicting-plans failure doc 04 §8 exists to prevent.
 */
function laundryCapFor(trip: Trip): number | null {
  if (trip.laundryAvailable !== true) return null
  if (tripDays(trip.startDate, trip.endDate) < LAUNDRY_MIN_TRIP_DAYS) return null
  return LAUNDRY_DAY_CAP
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
  /** "Columbia · Black" — who made it and which one (G6), or null. */
  itemDetail: string | null
  /**
   * The colour on its own, as stored, for the row's swatch.
   *
   * Carried separately from `itemDetail` rather than parsed back out of it: the
   * detail is a joined presentation string and pulling a colour out of
   * `Columbia · Black · Striped` would be re-deriving a fact this row already
   * has. Unrecognised strings render no swatch, so a `Suede` here costs
   * nothing.
   */
  itemColor: string | null
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
  /**
   * `user_swap` when Alex put this garment in the slot himself (H1d).
   *
   * Already stored and already read by the stale-plan check; carried out to the
   * client because `explainOutfit` will not credit the planner for a choice Alex
   * made — and the screen cannot tell the difference without this.
   */
  filledBy: string | null
  sortOrder: number
}

/** An approved outfit built on a garment Alex does not have for this trip. */
export interface OutfitConflict {
  groupId: string
  groupName: string
  slotId: string
  roleLabel: string
  itemId: string
  itemName: string
  /**
   * Which of the two it is.
   *
   * `not_bringing` is a decision about this trip and is undone by restoring the
   * checklist row. `archived` is the garment leaving the wardrobe altogether,
   * and Replace it is the only way out from here — so the banner must not offer
   * the wrong sentence for the wrong one.
   */
  why: 'not_bringing' | 'archived'
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
  /**
   * One short sentence, when the trip has moved out from under an APPROVED
   * outfit (§34).
   *
   * Never a replacement for the approval and never a reason to undo it. An
   * approved outfit whose garments no longer pass the planner's filters — the
   * jacket that is not warm enough for the new forecast, the shirt that is too
   * casual now the dinner is formal — is flagged so Alex can decide, because
   * silently replanning it would be inference overruling his explicit choice.
   *
   * Set and cleared by `generateOutfits` alone, from `outfitConflicts`, so it
   * cannot outlive the condition that produced it.
   */
  reviewReason: string | null
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
  review_reason: string | null
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
  filled_by: string | null
  wearings: number
  sort_order: number
}

/**
 * The garments this trip has decided against — one definition, two callers.
 *
 * "Every row for it is on Not bringing", not "any row is". Migration 0013 now
 * makes a second row for the same item impossible, so in practice the two read
 * the same — but the aggregate is kept because it states the intent rather than
 * relying on the index to hold, and because it is what makes the slot marking
 * and the conflict list unable to disagree about what "not bringing" means.
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

  /*
   * Both at once, because neither needs the other (P1B).
   *
   * These ran one after the other, which on D1 is two round trips of latency
   * for two queries that take the same one argument and never look at each
   * other's answer. `listOutfits` is on the Today path, the Outfits screen and
   * the replan, so the rung this removes is removed from all three.
   */
  const [setAside, slots] = await Promise.all([
    setAsideItems(db, tripId),
    db
      .prepare(
      `SELECT s.*, i.display_name AS item_name, i.brand AS item_brand,
              i.color AS item_color, i.pattern AS item_pattern
         FROM outfit_slot s
         LEFT JOIN item i ON i.id = s.item_id
        WHERE s.outfit_group_id IN (SELECT id FROM outfit_group WHERE trip_id = ?)
        ORDER BY s.sort_order`,
      )
      .bind(tripId)
      .all<
        SlotRow & {
          item_name: string | null
          item_brand: string | null
          item_color: string | null
          item_pattern: string | null
        }
      >(),
  ])

  const byGroup = new Map<string, OutfitSlotView[]>()
  for (const slot of slots.results ?? []) {
    const view: OutfitSlotView = {
      id: slot.id,
      role: slot.slot_role as SlotRole,
      roleLabel: SLOT_LABELS[slot.slot_role as SlotRole] ?? slot.slot_role,
      required: slot.required === 1,
      itemId: slot.item_id,
      itemName: slot.item_name,
      /*
       * Which garment this is, when the name alone no longer says (G6).
       *
       * Read live from the item rather than snapshotted, unlike the checklist:
       * an outfit slot points at an item id and has always shown that item's
       * CURRENT name, so a detail that lagged behind it would be the odd one
       * out on its own row.
       */
      itemDetail: slot.item_id ? garmentDetail({
        brand: slot.item_brand,
        color: slot.item_color,
        pattern: slot.item_pattern,
      }) : null,
      itemColor: slot.item_id ? slot.item_color : null,
      wearings: slot.wearings,
      setAside: slot.item_id !== null && setAside.has(slot.item_id),
      unmetReason: slot.unmet_reason,
      reason: slot.reason_json,
      filledBy: slot.filled_by,
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
    reviewReason: row.review_reason,
    slots: byGroup.get(row.id) ?? [],
    sortOrder: row.sort_order,
  }))
}

/**
 * Generates the outfit plan for a trip.
 *
 * **Per group, not per trip (D1c).** Refusing to replan over an approved outfit
 * is right — the whole point of approval is that it sticks, and regenerating
 * would silently discard Alex's swaps (risk R12). But the refusal was applied to
 * the TRIP: approving one outfit froze every other one for the life of the trip,
 * so naming four safari days after approving a dinner outfit left `Safari ×1`
 * and the screen said `replanned: false` and moved on.
 *
 * So an approval now freezes its own outfit. The drafts replan around it, its
 * garments are reserved while they do (`alreadyUsed`), and its own day count is
 * brought up to date — doc 04 §8 asks for quantities to be recalculated when a
 * trip changes, and how many days an outfit covers is not a choice Alex made
 * about garments. **Which garments are in it is never touched.**
 */
export async function generateOutfits(
  db: D1Database,
  trip: Trip,
  now: number,
  weather: WeatherDay[] = [],
): Promise<{
  groups: OutfitGroupView[]
  regenerated: boolean
  replanned: number
  kept: number
  /** Approved outfits the changed trip has put a question mark over (§32). */
  flagged: Array<{ id: string; name: string; reason: string }>
}> {
  const existing = await listOutfits(db, trip.id)
  const approved = existing.filter((g) => g.status === 'approved')

  const wardrobe = await listActiveCandidates(db, 'clothing')

  /*
   * planGroups wants EVERY day of the trip, not only the ones Alex named.
   *
   * The trip stores just the named days — a date he has not spoken for has no
   * row. Handing that straight to the planner would make the first and last
   * NAMED days look like the ends of the trip, so the real travel days would
   * vanish and the plan would cover three days of a five-day trip.
   */
  /*
   * A LIST per date, and a fifth place this collapsed (G2).
   *
   * This was `Map<date, tag>`, so a beach afternoon and a formal dinner reached
   * `planGroups` as one activity and the planner — which has always been able
   * to make two groups from two tags — never saw the second. Found by the test,
   * after an audit that had already named four other places and missed this
   * one: every layer that reduced a day to a single fact had to be looked at,
   * not only the ones that obviously held a map.
   *
   * A date Alex has not spoken for still contributes one entry with a null tag,
   * which is what keeps the real travel days at the ends of the trip rather
   * than at the ends of the named days.
   */
  const stated = new Map<string, string[]>()
  for (const day of trip.days) {
    if (!day.activityTag) continue
    stated.set(day.date, [...(stated.get(day.date) ?? []), day.activityTag])
  }

  const everyDay = trip.days.length
    ? tripDateRange(trip.startDate, trip.endDate).flatMap((date) => {
        const tags = stated.get(date)
        return tags?.length
          ? tags.map((activityTag) => ({ date, activityTag }))
          : [{ date, activityTag: null as string | null }]
      })
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

  /*
   * The outfits Alex has approved, and the garments they are standing on.
   *
   * Matched by NAME, which is what a group is identified by across a replan —
   * ids are minted fresh each time and the template a group came from is the
   * thing that persists.
   */
  const frozen = new Map(approved.map((group) => [group.name, group]))
  const toPlan = planned.filter((group) => !frozen.has(group.name))

  const alreadyUsed = new Map<string, number>()
  for (const group of approved) {
    for (const slot of group.slots) {
      if (!slot.itemId) continue
      alreadyUsed.set(slot.itemId, (alreadyUsed.get(slot.itemId) ?? 0) + slot.wearings)
    }
  }

  const { groups } = assign(toPlan, wardrobe, {
    // Garments an approved outfit is already wearing are not free to plan again.
    alreadyUsed,
    // Alex's laundry ruling. Null in all three "change nothing" cases.
    laundryDayCap: laundryCapFor(trip),
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

  /*
   * The choices Alex made inside outfits he has NOT approved (G3).
   *
   * Read before the delete below, because the delete is what used to lose them.
   * D1c froze approved outfits and that was read as covering swaps generally —
   * it does not. A draft group is deleted and planned again from scratch, so
   * until now the only explicit choice that survived a trip edit was one inside
   * an outfit that had already been approved, and every other one was replaced
   * without a word. Doc 09 §6a's acceptance line assumed `filled_by` was doing
   * this work; it was only recording it.
   *
   * Keyed by the group's NAME, the slot's role and its position — the same
   * identity a replan preserves, since ids are minted fresh each time. If a
   * template ever changes shape the key simply stops matching and the planner's
   * answer stands, which is the safe direction to fail in.
   */
  const swapped = await db
    .prepare(
      `SELECT g.name AS group_name, s.slot_role, s.sort_order, s.item_id
         FROM outfit_slot s
         JOIN outfit_group g ON g.id = s.outfit_group_id
        WHERE g.trip_id = ? AND g.status <> 'approved' AND s.filled_by = 'user_swap'`,
    )
    .bind(trip.id)
    .all<{ group_name: string; slot_role: string; sort_order: number; item_id: string | null }>()

  const active = new Set(wardrobe.map((item) => item.id))
  const chosen = new Map<string, string | null>()
  for (const row of swapped.results ?? []) {
    /*
     * A garment Alex has since archived is not restored. Putting it back would
     * plan a trip around something he has said he no longer packs, and the
     * planner's answer is the honest replacement. An emptied slot — `item_id`
     * null — IS a choice and is kept.
     */
    if (row.item_id !== null && !active.has(row.item_id)) continue
    chosen.set(`${row.group_name} ${row.slot_role} ${row.sort_order}`, row.item_id)
  }

  /*
   * Only the groups that were replanned are replaced. An approved outfit's row
   * and every slot in it survive untouched — which is what makes "his swaps are
   * safe" a fact about the SQL rather than a promise in a comment.
   */
  await db
    .prepare(
      `DELETE FROM outfit_slot WHERE outfit_group_id IN
         (SELECT id FROM outfit_group WHERE trip_id = ? AND status <> 'approved')`,
    )
    .bind(trip.id)
    .run()
  await db
    .prepare("DELETE FROM outfit_group WHERE trip_id = ? AND status <> 'approved'")
    .bind(trip.id)
    .run()

  /*
   * The approved outfits' day counts, brought up to date.
   *
   * Their garments are untouched; only how many of the trip's days each one
   * covers, and how those days are spread across the garments already in it.
   * A group whose name has left the plan entirely — Alex removed the activity —
   * keeps what it had, because he approved it.
   */
  let updated = 0
  for (const group of approved) {
    const nowPlanned = planned.find((p) => p.name === group.name)
    if (!nowPlanned || nowPlanned.occurrences === group.occurrences) continue

    const byId = new Map(wardrobe.map((item) => [item.id, item]))
    const spread = redistributeWearings(
      group.slots.map((slot) => ({
        role: slot.role,
        item: slot.itemId ? (byId.get(slot.itemId) ?? null) : null,
        sortOrder: slot.sortOrder,
      })),
      nowPlanned.occurrences,
      reuseDefaults,
    )

    await db
      .prepare('UPDATE outfit_group SET occurrences = ?, updated_at = ? WHERE id = ?')
      .bind(nowPlanned.occurrences, now, group.id)
      .run()

    for (const slot of group.slots) {
      await db
        .prepare('UPDATE outfit_slot SET wearings = ? WHERE id = ?')
        .bind(spread.get(slot.sortOrder) ?? slot.wearings, slot.id)
        .run()
    }
    updated += 1
  }

  /*
   * Every row of the new plan, collected and sent as ONE round trip (P1B).
   *
   * The third time this pattern has turned up: 26 slot inserts and 4 group
   * inserts, issued one at a time, were **30 of this function's 41 round
   * trips**. `generateChecklist` and `ensureDailyPlans` had the same shape, and
   * on D1 — a network database — a loop of single-row writes is the dominant
   * cost of every one of them.
   *
   * Order is preserved inside a batch, so a slot still lands after the group it
   * belongs to and the FK holds. The deletes above stay where they are: they
   * must complete before any of this is built, and they are two round trips
   * rather than thirty.
   */
  const inserts: D1PreparedStatement[] = []

  let groupOrder = 0
  for (const group of groups) {
    const groupId = crypto.randomUUID()

    /*
     * The planner's answer, with Alex's own choices laid back over it.
     *
     * Resolved before the group's status is computed, because a slot he
     * deliberately emptied makes the outfit incomplete and a slot he filled
     * himself completes it — deriving `incomplete` from the plan alone would
     * describe an outfit that is not the one about to be written.
     */
    const slots = group.slots.map((slot, index) => {
      const key = `${group.name} ${slot.role} ${index}`
      if (!chosen.has(key)) {
        return {
          role: slot.role,
          required: slot.required,
          itemId: slot.item?.id ?? null,
          unmetReason: slot.unmetReason,
          reason: slot.reason,
          filledBy: 'generated' as const,
          wearings: slot.wearings,
        }
      }

      const itemId = chosen.get(key) ?? null
      return {
        role: slot.role,
        required: slot.required,
        itemId,
        // The same row `setSlotItem` writes, so a choice reads identically
        // whether it was made a moment ago or survived a replan.
        unmetReason: null,
        reason: itemId ? 'You chose this' : null,
        filledBy: 'user_swap' as const,
        wearings: slot.wearings,
      }
    })

    const incomplete = slots.some((s) => s.required && !s.itemId)

    inserts.push(
      db
        .prepare(
          `INSERT INTO outfit_group (id, trip_id, name, activity_tag, occurrences, dressiness,
                                     expected_conditions, status, sort_order, created_at, updated_at)
           VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?)`,
        )
        .bind(
          groupId, trip.id, group.name, group.activityTag, group.occurrences,
          incomplete ? 'incomplete' : 'draft', groupOrder, now, now,
        ),
    )

    let slotOrder = 0
    for (const slot of slots) {
      inserts.push(
        db
          .prepare(
            `INSERT INTO outfit_slot (id, outfit_group_id, slot_role, required, item_id, unmet_reason,
                                      reuse_allowed, rank_score, reason_json, filled_by, wearings,
                                      sort_order)
             VALUES (?,?,?,?,?,?,1,NULL,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(), groupId, slot.role, slot.required ? 1 : 0,
            slot.itemId, slot.unmetReason, slot.reason, slot.filledBy, slot.wearings, slotOrder,
          ),
      )
      slotOrder += 1
    }

    groupOrder += 1
  }

  if (inserts.length > 0) await db.batch(inserts)

  /*
   * The plan is now as new as the days it was planned from (P1B, 0024).
   *
   * Written on EVERY run, including one that decided to change nothing. That is
   * what makes `outfitsAreStale` converge: a trip whose groups are all approved
   * gets no new rows and no `updated_at` of its own, and a staleness test based
   * on the groups would call it stale for ever and replan it on every visit.
   */
  /*
   * What this plan was made from, so the NEXT one can say what moved (§27).
   *
   * Written in the same statement as `outfits_planned_at` and for the same
   * reason: both describe this run, and a snapshot that could be a run behind
   * would make the control either miss a change or invent one.
   */
  const signals = planSignals(trip, weather)
  await db
    .prepare('UPDATE trip SET outfits_planned_at = ?, outfit_plan_inputs = ? WHERE id = ?')
    .bind(now, JSON.stringify(signals), trip.id)
    .run()

  /*
   * The approved outfits, re-examined against conditions as they are now (§30).
   *
   * Case C of the brief, and the only case where an approval produces work.
   * Their garments are NOT replanned — that is the whole meaning of approval,
   * and doc 04 §5 puts Alex's explicit choice above anything inference prefers.
   * What can change is whether the outfit is still ALLOWED to exist: a jacket
   * that suited 57–67°F does not suit 41–49°F, and an approved outfit standing
   * on one is a plan quietly disagreeing with the forecast.
   *
   * Cleared as well as set, in the same pass. A flag that only ever went on
   * would outlive the weather that produced it — press replan after the
   * forecast recovers and the outfit would still be asking to be looked at.
   */
  const reviewed = await flagApprovedForReview(db, trip, approved, {
    weather,
    warmthBias,
    tripBand,
    daysOf: (group) => weatherForGroup(trip, weather, group.dates),
    wardrobe,
  })

  return {
    groups: await listOutfits(db, trip.id),
    // True when anything actually moved — a replanned draft, or an approved
    // outfit whose day count followed the trip.
    regenerated: groups.length > 0 || updated > 0,
    replanned: groups.length,
    kept: approved.length,
    /** Approved outfits the changed trip has put a question mark over (§32). */
    flagged: reviewed,
  }
}

/**
 * Sets or clears `review_reason` on every approved outfit of a trip.
 *
 * Runs `passesFilters` — the planner's own eligibility gate — over each
 * approved outfit's garments under current conditions, with that group's own
 * template, warmth band and rain demand. See `outfitConflicts` for why this is
 * a re-filter rather than a table of "colder weather affects layers".
 *
 * Returns the outfits that came out flagged, so the screen can say `1 dinner
 * outfit needs review` instead of making Alex compare the whole plan.
 */
async function flagApprovedForReview(
  db: D1Database,
  trip: Trip,
  approved: OutfitGroupView[],
  ctx: {
    weather: WeatherDay[]
    warmthBias: number
    tripBand: [number, number] | null
    daysOf: (group: { dates: string[] }) => WeatherDay[]
    wardrobe: Item[]
  },
): Promise<Array<{ id: string; name: string; reason: string }>> {
  if (approved.length === 0) return []

  const byId = new Map(ctx.wardrobe.map((item) => [item.id, item]))
  const flagged: Array<{ id: string; name: string; reason: string }> = []
  const writes: D1PreparedStatement[] = []

  /*
   * The dates each approved group covers, derived exactly as everywhere else.
   * `assignDays` needs the whole plan at once, or two groups both believe they
   * own the same Tuesday.
   */
  const all = await listOutfits(db, trip.id)
  const spread = assignDays(
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

  for (const group of approved) {
    const dates = spread.filter((day) => day.outfitGroupId === group.id).map((d) => d.date)
    const days = ctx.daysOf({ dates })
    const band = biased(days.length > 0 ? warmthBandForDays(days) : ctx.tripBand, ctx.warmthBias)
    const demand = days.length > 0 ? demandFor(days) : null
    const template = templateFor(group.activityTag, group.name) ?? EVERYDAY_TEMPLATE

    const conflicts = slotConflicts(
      group.slots.map((slot) => ({
        role: slot.role,
        itemName: slot.itemName,
        item: slot.itemId ? (byId.get(slot.itemId) ?? null) : null,
      })),
      {
        template,
        maxDressiness: trip.maxDressiness,
        warmthBand: band,
        needsRainLayer: demand?.rain ?? false,
      },
    )

    const reason = reviewReason(conflicts)
    if (reason !== group.reviewReason) {
      writes.push(
        db.prepare('UPDATE outfit_group SET review_reason = ? WHERE id = ?').bind(reason, group.id),
      )
    }
    if (reason) flagged.push({ id: group.id, name: group.name, reason })
  }

  if (writes.length > 0) await db.batch(writes)
  return flagged
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

  const demand = clothingDemand(filled, { laundryDayCap: laundryCapFor(trip) })

  /*
   * EVERY row with an item, not only the ones this function owns.
   *
   * Reading only `source = 'outfit_generated'` is what let the list grow. A
   * garment carrying a packing rule that an approved outfit also uses —
   * underwear is the documented case — is wanted by both writers, and
   * `generateChecklist` takes such a row over and rewrites its `source`. Filtered
   * to its own rows, this function then saw nothing, inserted a second, and did
   * it again on every alternating regeneration.
   *
   * So the ownership rule is stated rather than assumed: **a rule row wins.** A
   * per-day rule already counts the whole trip, so adding the outfit's wearings
   * on top would double-count the same days. This function contributes nothing
   * for an item another writer has claimed, and removes nothing it does not own.
   */
  const existing = await db
    .prepare('SELECT * FROM checklist_entry WHERE trip_id = ? AND item_id IS NOT NULL')
    .bind(trip.id)
    .all<{
      id: string
      item_id: string | null
      qty_override: number | null
      excluded_at: number | null
      source: string
    }>()

  const existingByItem = new Map((existing.results ?? []).map((r) => [r.item_id ?? '', r]))
  const result = { added: 0, updated: 0, removed: 0 }

  /*
   * One tank top for every swimsuit (doc 09 §0l).
   *
   * After `clothingDemand` because the rule is stated over what is being PACKED,
   * and before the write loop so the additions are ordinary demand rows — kept,
   * updated and removed by exactly the same ownership rules as everything else
   * this function writes. When the swimwear leaves the plan, they leave with it.
   */
  const catalog = [...wardrobe.values()]

  const pairing = pairTankTopsWithSwimwear(demand, catalog)
  for (const tank of pairing.added) {
    demand.set(tank.id, {
      item: tank,
      quantity: 1,
      groups: [],
      daysOfWear: 1,
      laundryCapped: false,
      reason: 'Packed with your swimwear',
    })
  }

  /*
   * And one pair of sandals for the trip, not one per swimsuit.
   *
   * AFTER the tank tops, and the order is load-bearing: a tank top this rule
   * just added changes nothing about footwear, but running footwear first and
   * tank tops second would let a sandal be counted as "already packed" by a
   * rule that never wanted one. Each reads a `demand` the other has finished
   * with.
   */
  const footwear = ensureSwimFootwear(demand, catalog)
  if (footwear.added) {
    demand.set(footwear.added.id, {
      item: footwear.added,
      quantity: 1,
      groups: [],
      daysOfWear: 1,
      laundryCapped: false,
      reason: 'Packed with your swimwear',
    })
  }

  for (const [itemId, need] of demand) {
    const reason = need.reason ?? `Worn for ${need.groups.join(' and ')}`
    const current = existingByItem.get(itemId)

    // A rule already speaks for this item. Two rows would be two answers.
    if (current && current.source !== 'outfit_generated') continue

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
        `INSERT INTO checklist_entry (id, trip_id, item_id, name_snapshot, detail_snapshot,
                                      category_snapshot,
                                      required_qty, qty_breakdown_json, qty_override, packed_qty,
                                      packing_timing, requires_final_check, final_checked_at,
                                      excluded_at, source, reason_text, rule_snapshot_json,
                                      is_critical, trip_only, sort_order, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,NULL,0,?,?,NULL,NULL,'outfit_generated',?,NULL,?,0,0,?,?)`,
      )
      .bind(
        crypto.randomUUID(), trip.id, itemId, need.item.displayName, garmentDetail(need.item),
        need.item.category,
        need.quantity, describeDemand(need.item, need),
        need.item.defaultPackingTiming, need.item.requiresFinalCheck ? 1 : 0,
        reason, need.item.isCritical ? 1 : 0, now, now,
      )
      .run()
    result.added += 1
  }

  // A garment no longer worn by any approved outfit leaves the list — unless
  // Alex has touched its row, in which case it is his to remove.
  for (const [itemId, row] of existingByItem) {
    // Only rows this function wrote. A rule row, or something Alex added, is not
    // this function's to take away however little the outfits want it.
    if (row.source !== 'outfit_generated') continue
    if (demand.has(itemId)) continue
    if (row.qty_override !== null || row.excluded_at !== null) continue
    await db.prepare('DELETE FROM checklist_entry WHERE id = ?').bind(row.id).run()
    result.removed += 1
  }

  return result
}

/**
 * "3 days of wear, worn once each" — the arithmetic, not a bare number.
 *
 * When laundry did the reducing it says so, because a quantity that does not
 * follow from the trip's length is exactly the kind Alex should be able to check.
 * The wording is about the TRIP — "4 days of clothing" — never about the garment:
 * laundry does not change what a t-shirt can do, it changes how much of it has to
 * be in the bag at once.
 */
function describeDemand(item: Item, need: Demand): string | null {
  const { quantity, laundryCapped } = need
  const capacity = reuseCapacity(item)

  /*
   * Only where laundry actually changed THIS row's number.
   *
   * With laundry a twelve-day group needs four different t-shirts rather than
   * twelve, and each of those rows is still a quantity of one — there is nothing
   * to explain on the row, and "1 day of clothing" beside a single t-shirt would
   * be noise. The sentence that belongs to the group is on the group, in
   * `explainFit`. This is for the case where the row's own count moved: a pair
   * of jeans worn three times covers twelve days with four pairs and four days
   * with two.
   */
  if (laundryCapped && quantity > 1) {
    return `${quantity} needed · laundry available, worn up to ${capacity} times each`
  }

  if (quantity <= 1) return null
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
 * Garments an approved outfit is built on that Alex does not have for this trip.
 *
 * **Two ways that happens, and until D1b only one of them was reported.** He can
 * set the garment aside on this trip — a decision about this trip — or he can
 * archive it, which is the documented way a garment leaves the wardrobe for good
 * (doc 05 §11). Archiving was reported nowhere: the slot went on naming a
 * garment he no longer owns, and the checklist row vanished on the next
 * unrelated sync without a word. Both are the same problem to the person
 * standing beside the suitcase, so both are the same banner — with `why` saying
 * which, because "you are not bringing it" and "it is not in your wardrobe any
 * more" are different sentences and only one of them is true at a time.
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
              i.id AS item_id, i.display_name AS item_name,
              CASE WHEN i.archived_at IS NOT NULL THEN 'archived' ELSE 'not_bringing' END AS why
         FROM outfit_slot s
         JOIN outfit_group g ON g.id = s.outfit_group_id
         JOIN item i ON i.id = s.item_id
        WHERE g.trip_id = ? AND g.status = 'approved'
          AND (s.item_id IN (${SET_ASIDE_ITEMS}) OR i.archived_at IS NOT NULL)
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
      why: string
    }>()

  return (result.results ?? []).map((r) => ({
    groupId: r.group_id,
    groupName: r.group_name,
    slotId: r.slot_id,
    roleLabel: SLOT_LABELS[r.slot_role as SlotRole] ?? r.slot_role,
    itemId: r.item_id,
    itemName: r.item_name,
    why: r.why === 'archived' ? ('archived' as const) : ('not_bringing' as const),
  }))
}

export interface SwapCandidate {
  item: Item
  /** Whether it survives the filters for this occasion. */
  suitable: boolean
  /** Why not, when it does not. */
  reason: string | null
  /**
   * Whether this is the kind of garment that usually fills the slot (G3).
   *
   * The sheet shows the slot's own garments by default and everything else
   * behind *All items*, so the two need telling apart — but the distinction is
   * about where a thing is offered, never about whether it may be chosen.
   */
  inSlot: boolean
  /**
   * The criterion that put this garment above the next one down (§18), or null.
   *
   * `rank`'s `decidedBy`, unchanged and not recomputed — so it cannot credit
   * comfort where comfort said nothing, and it is null wherever nothing
   * separated the two. Only ever set on a suitable candidate: an unsuitable one
   * already carries `reason`, and a row saying both why it was set aside and
   * why it would otherwise have won is a row nobody finishes reading.
   */
  recommendation: string | null
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
  /**
   * The rest of the outfit — every filled slot but the one being changed (§15).
   *
   * The sheet's most important context and the one it did not have. While
   * replacing a top, the trousers, shoes and layer it has to work with are
   * worth more than a second reading of the trip's dates and formality, which
   * is what the sheet used to spend its first third on.
   */
  paired: PairedGarment[]
}

/** One garment the replacement will be worn with. */
export interface PairedGarment {
  role: SlotRole
  roleLabel: string
  itemId: string
  itemName: string
  /** "Nordstrom · Bone", or null. */
  detail: string | null
  /** The colour on its own, as stored, for the swatch beside it. */
  color: string | null
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
  const { warmthBias, reuseDefaults } = trip
    ? await enginePreferences(db)
    : { warmthBias: 0, reuseDefaults: {} as ReuseDefaults }
  const band = days.length > 0 ? biased(warmthBandForDays(days), warmthBias) : null
  const demand = days.length > 0 ? demandFor(days) : null

  /*
   * The rest of the outfit — everything but the slot being changed (§15, §52).
   *
   * Replacing a garment is a relational question. "Which tops are good" has one
   * answer; "which top works with these trousers, these shoes and this layer,
   * for a smart-casual dinner at 57–67°F" has another, and the sheet was asking
   * the first while claiming to answer the second. These go two places: into
   * the ranking, as what the pairing criterion scores against, and onto the
   * screen, so Alex can see what he is pairing with instead of remembering it.
   *
   * The slot being replaced is excluded by id. Showing the garment on its way
   * out as one of the things the replacement must work with would be the sheet
   * arguing with itself.
   */
  const pairedRows = await db
    .prepare(
      `SELECT s.slot_role, i.display_name, i.brand, i.color, i.pattern, s.item_id
         FROM outfit_slot s
         JOIN item i ON i.id = s.item_id
        WHERE s.outfit_group_id = ? AND s.id <> ? AND s.item_id IS NOT NULL
        ORDER BY s.sort_order`,
    )
    .bind(groupId, slotId)
    .all<{
      slot_role: string
      display_name: string
      brand: string | null
      color: string | null
      pattern: string | null
      item_id: string
    }>()

  const paired = (pairedRows.results ?? []).map((row) => ({
    role: row.slot_role as SlotRole,
    roleLabel: SLOT_LABELS[row.slot_role as SlotRole] ?? row.slot_role,
    itemId: row.item_id,
    itemName: row.display_name,
    detail: garmentDetail({ brand: row.brand, color: row.color, pattern: row.pattern }),
    color: row.color,
  }))

  /*
   * What the rest of the PLAN is wearing, and what Alex has approved together
   * before. Both are one query each and both feed `rank`, which is what makes
   * the top of this list the garment the planner would have chosen.
   */
  const [pairings, planned] = await Promise.all([
    loadPairings(db),
    trip
      ? db
          .prepare(
            `SELECT s.item_id, s.wearings
               FROM outfit_slot s
               JOIN outfit_group g ON g.id = s.outfit_group_id
              WHERE g.trip_id = ? AND g.id <> ? AND s.item_id IS NOT NULL`,
          )
          .bind(trip.id, groupId)
          .all<{ item_id: string; wearings: number }>()
      : Promise.resolve({ results: [] as Array<{ item_id: string; wearings: number }> }),
  ])

  const usedCount = new Map<string, number>()
  for (const row of planned.results ?? []) {
    usedCount.set(row.item_id, (usedCount.get(row.item_id) ?? 0) + row.wearings)
  }

  /*
   * The WHOLE active wardrobe, in three tiers (G3).
   *
   * It used to be filtered down to the one subcategory group the slot maps to,
   * which meant a jacket could not be reached from a Layer slot by any path —
   * not searched for, not scrolled to, not seen. Doc 04 §7 is explicit that the
   * app's job is to say a garment is wrong, not to make it unchoosable, and the
   * slot filter was the one place that rule was not being followed.
   *
   * Sent in one response rather than behind a second request for *All items*:
   * `tests/e2e/performance.spec.ts` holds every screen but Home to a single
   * round trip, and a wardrobe of this size costs a few kilobytes.
   *
   * Nothing about which garment is RECOMMENDED changes. `passesFilters` still
   * decides that, on exactly the planner's terms, and only for garments that
   * belong in the slot.
   */
  const judged = wardrobe.map((item) => {
    const itsRole = slotFor(item)
    if (itsRole !== role) {
      return { item, suitable: false, reason: slotMismatch(itsRole, role), inSlot: false }
    }

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
    return {
      item,
      suitable: verdict.ok,
      reason: verdict.ok ? null : verdict.reason,
      inSlot: true,
    }
  })

  /*
   * The suitable garments, in the planner's own order (§17).
   *
   * They were sorted alphabetically. Everything that survives the filters is
   * *allowed*, and the sheet was calling that list "Recommended" while ordering
   * it by the first letter of the name — so the garment Pack Smart would
   * actually have chosen sat wherever the alphabet put it, and `Recommended`
   * meant nothing more than `eligible`.
   *
   * `rank` is the planner's stage two and is already used for exactly this
   * decision when the outfit is built. Reusing it means the top of this list is
   * the garment the planner would pick, computed the same way, with the same
   * lexicographic priority and the same deterministic tie-break on item id —
   * so opening the sheet twice cannot produce two different orders.
   *
   * Eligibility still happens FIRST and separately. Nothing here can promote a
   * garment that failed a filter: `rank` only ever sees the survivors, which is
   * the ordering §17 requires and the reason a hard exclusion cannot be
   * out-scored.
   */
  const preferredCapabilities: WeatherCapability[] = []
  if (demand?.wind) preferredCapabilities.push('wind')
  if (demand?.rain) preferredCapabilities.push('rain')

  const ranked = rank(
    judged.filter((c) => c.suitable).map((c) => c.item),
    {
      requestedItemIds: new Set<string>(),
      /*
       * What the rest of the plan is already wearing, so a garment doing duty
       * in three other outfits does not top this list purely by being popular.
       * The planner counts the same way while it builds.
       */
      usedCount,
      activityTag: activityKeyOf(template),
      preferredCapabilities,
      reuseDefaults,
      /*
       * The rest of THIS outfit — the whole point of §52.
       *
       * `chosenInGroup` is what the "you wear these together" criterion scores
       * against, and on this screen it is not an optimisation: the question
       * being asked is which top goes with THESE trousers and THESE shoes, and
       * without the other slots the criterion had nothing to compare and could
       * never fire.
       */
      chosenInGroup: paired.map((slot) => ({
        id: slot.itemId,
        displayName: slot.itemName,
        color: slot.color,
      })),
      pairings,
    },
  )

  const order = new Map(ranked.map((candidate, index) => [candidate.item.id, index]))
  const why = new Map(ranked.map((candidate) => [candidate.item.id, candidate.decidedBy]))

  const candidates = judged
    .map((candidate) => ({
      ...candidate,
      /*
       * One short reason, and only where it distinguishes (§18).
       *
       * `rank` already refuses to name a criterion that did not separate the
       * winner from its runner-up, so this is null far more often than it is
       * set — which is the intent. A list where every row carries a reason is a
       * list where none of them mean anything.
       */
      recommendation: candidate.suitable ? (why.get(candidate.item.id) ?? null) : null,
    }))
    .sort(
      (a, b) =>
        Number(b.suitable) - Number(a.suitable) ||
        Number(b.inSlot) - Number(a.inSlot) ||
        (order.get(a.item.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.item.id) ?? Number.MAX_SAFE_INTEGER) ||
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
        paired,
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
 * Leads with the garments that would fill a real gap in the plan. Everything
 * else is returned too, but the UI keeps it behind a search — product doc 04 §9
 * forbids leading with the full closet, because that is how a packing assistant
 * turns into an overpacking assistant.
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
  // outfit is approved. Offering something as missing while it is sitting in the
  // wedding outfit would be plainly wrong.
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
