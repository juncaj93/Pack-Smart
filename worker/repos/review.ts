import {
  isOutstanding,
  reviewProposals,
  summaryLines,
  type ReviewAnswer,
  type ReviewAnswerKind,
  type ReviewChange,
  type ReviewContext,
  type ReviewItemFacts,
  type ReviewObservations,
  type ReviewOutfitFacts,
  type ReviewProposal,
  type ReviewResolution,
  type ReviewRule,
} from '@shared/review'
import type { RuleSource, RuleType } from '@shared/rules'
import { nowSeconds } from '../auth'
import { createRule, disableRule, editRule, NOT_SUPERSEDED } from './rules'
import { undoRemembered } from './outfits'

/**
 * The post-trip review's reads and writes (F1).
 *
 * Everything the screen needs comes back from ONE request, which is the same
 * constraint `services/today.ts` works under and for the same reason:
 * `tests/e2e/performance.spec.ts` holds every screen but Home to a single
 * serial round trip. So the pickers, the summary, the answers and the proposals
 * are assembled here rather than fetched separately by the screen.
 *
 * The division of labour with `@shared/review` is the one this codebase uses
 * everywhere: this file knows SQL and knows nothing about what a proposal
 * should say; that file decides every sentence and never touches a database.
 */

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

interface AnswerRow {
  id: string
  kind: string
  item_id: string | null
  outfit_group_id: string | null
  note: string | null
  resolution: string
}

function toAnswer(row: AnswerRow): ReviewAnswer {
  return {
    id: row.id,
    kind: row.kind as ReviewAnswerKind,
    itemId: row.item_id,
    outfitGroupId: row.outfit_group_id,
    note: row.note,
    resolution: row.resolution as ReviewResolution,
  }
}

export async function listAnswers(db: D1Database, tripId: string): Promise<ReviewAnswer[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, item_id, outfit_group_id, note, resolution
         FROM trip_review_answer
        WHERE trip_id = ?
        ORDER BY created_at, id`,
    )
    .bind(tripId)
    .all<AnswerRow>()

  return (results ?? []).map(toAnswer)
}

export async function getAnswer(db: D1Database, tripId: string, id: string): Promise<ReviewAnswer | null> {
  const row = await db
    .prepare(
      `SELECT id, kind, item_id, outfit_group_id, note, resolution
         FROM trip_review_answer WHERE id = ? AND trip_id = ?`,
    )
    .bind(id, tripId)
    .first<AnswerRow>()

  return row ? toAnswer(row) : null
}

/**
 * What the app saw for itself.
 *
 * Four counts and two short lists, and the only subtle one is `wearLogUsed`:
 * it is the difference between "you wore all of it" and "nobody was watching",
 * and it is the same `EXISTS (... FROM wear_log ...)` guard
 * `pendingUnwornProposals` applies across trips.
 */
export async function observations(db: D1Database, tripId: string): Promise<ReviewObservations> {
  const [counts, wear, unworn, removed, outfits] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS bringing,
                SUM(CASE WHEN packed_qty >= required_qty THEN 1 ELSE 0 END) AS packed
           FROM checklist_entry
          WHERE trip_id = ? AND excluded_at IS NULL`,
      )
      .bind(tripId)
      .first<{ bringing: number; packed: number | null }>(),

    db
      .prepare('SELECT 1 AS used FROM wear_log WHERE trip_id = ? LIMIT 1')
      .bind(tripId)
      .first<{ used: number }>(),

    db
      .prepare(
        `SELECT c.name_snapshot AS name
           FROM checklist_entry c
          WHERE c.trip_id = ?
            AND c.excluded_at IS NULL
            AND c.item_id IS NOT NULL
            AND c.packed_qty > 0
            AND NOT EXISTS (
                  SELECT 1 FROM wear_log w
                   WHERE w.trip_id = c.trip_id
                     AND w.item_id = c.item_id
                     AND w.action IN ('will_wear', 'already_wore')
                )
          ORDER BY lower(c.name_snapshot)`,
      )
      .bind(tripId)
      .all<{ name: string }>(),

    db
      .prepare(
        `SELECT name_snapshot AS name FROM checklist_entry
          WHERE trip_id = ? AND excluded_at IS NOT NULL
          ORDER BY lower(name_snapshot)`,
      )
      .bind(tripId)
      .all<{ name: string }>(),

    db
      .prepare("SELECT COUNT(*) AS n FROM outfit_group WHERE trip_id = ? AND status = 'approved'")
      .bind(tripId)
      .first<{ n: number }>(),
  ])

  const wearLogUsed = wear !== null

  return {
    bringing: counts?.bringing ?? 0,
    packed: counts?.packed ?? 0,
    wearLogUsed,
    // Deliberately empty rather than "everything" when nothing was tracked. The
    // list is only meaningful beside a log that exists.
    unworn: wearLogUsed ? (unworn.results ?? []).map((row) => row.name) : [],
    removed: (removed.results ?? []).map((row) => row.name),
    outfitsApproved: outfits?.n ?? 0,
  }
}

interface RuleRow {
  id: string
  item_id: string
  rule_type: string
  quantity_value: number | null
  source: string
  enabled: number
}

/**
 * The rules in force for a set of items.
 *
 * `NOT_SUPERSEDED` is what makes "in force" true rather than "all of them": a
 * default that Alex has overridden must be read as the override, or the review
 * would offer to step down a number nothing is using and the packing list would
 * not move.
 */
async function rulesFor(db: D1Database, itemIds: string[]): Promise<Map<string, ReviewRule[]>> {
  const byItem = new Map<string, ReviewRule[]>()
  if (itemIds.length === 0) return byItem

  const placeholders = itemIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(
      `SELECT r.id, r.item_id, r.rule_type, r.quantity_value, r.source, r.enabled
         FROM packing_rule r
        WHERE r.item_id IN (${placeholders}) AND ${NOT_SUPERSEDED}`,
    )
    .bind(...itemIds)
    .all<RuleRow>()

  for (const row of results ?? []) {
    const list = byItem.get(row.item_id) ?? []
    list.push({
      id: row.id,
      ruleType: row.rule_type as RuleType,
      quantityValue: row.quantity_value,
      source: (row.source === 'user' || row.source === 'learned' ? row.source : 'system') as RuleSource,
      enabled: row.enabled === 1,
    })
    byItem.set(row.item_id, list)
  }

  return byItem
}

/**
 * Everything the proposals need to know about the things they are about.
 *
 * Only the items actually answered about are resolved, not the whole wardrobe:
 * this runs on every read of the screen, and the answers are typically two or
 * three rows.
 */
async function contextFor(db: D1Database, tripId: string, answers: ReviewAnswer[]): Promise<ReviewContext> {
  const itemIds = [...new Set(answers.map((a) => a.itemId).filter((id): id is string => id !== null))]
  const groupIds = [...new Set(answers.map((a) => a.outfitGroupId).filter((id): id is string => id !== null))]

  const items = new Map<string, ReviewItemFacts>()
  const outfits = new Map<string, ReviewOutfitFacts>()

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',')
    const [names, entries, rules] = await Promise.all([
      db
        .prepare(`SELECT id, display_name FROM item WHERE id IN (${placeholders})`)
        .bind(...itemIds)
        .all<{ id: string; display_name: string }>(),
      db
        .prepare(
          `SELECT item_id, excluded_at FROM checklist_entry
            WHERE trip_id = ? AND item_id IN (${placeholders})`,
        )
        .bind(tripId, ...itemIds)
        .all<{ item_id: string; excluded_at: number | null }>(),
      rulesFor(db, itemIds),
    ])

    const onList = new Map<string, boolean>()
    for (const row of entries.results ?? []) {
      onList.set(row.item_id, row.excluded_at !== null)
    }

    for (const row of names.results ?? []) {
      items.set(row.id, {
        itemId: row.id,
        itemName: row.display_name,
        onTripList: onList.has(row.id),
        excludedOnTrip: onList.get(row.id) === true,
        rules: rules.get(row.id) ?? [],
      })
    }
  }

  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',')
    const { results } = await db
      .prepare(
        `SELECT g.id, g.name, g.status,
                (SELECT COUNT(*) FROM outfit_slot s
                  WHERE s.outfit_group_id = g.id AND s.item_id IS NOT NULL) AS garments
           FROM outfit_group g
          WHERE g.id IN (${placeholders})`,
      )
      .bind(...groupIds)
      .all<{ id: string; name: string; status: string; garments: number }>()

    for (const row of results ?? []) {
      outfits.set(row.id, {
        groupId: row.id,
        name: row.name,
        approved: row.status === 'approved',
        hasGarments: row.garments > 0,
      })
    }
  }

  return { items, outfits }
}

export interface ReviewChoice {
  id: string
  name: string
  /** The category, for the wardrobe picker's grouping. Null for outfits. */
  category: string | null
}

export interface ReviewView {
  tripId: string
  tripName: string
  /** The dates, so the screen can say WHICH trip without a second request. */
  startDate: string
  endDate: string
  reviewedAt: number | null
  summary: string[]
  observations: ReviewObservations
  proposals: ReviewProposal[]
  /** How many proposals are still waiting on a yes or no. */
  outstanding: number
  choices: {
    /** Things that were in the bag — for "ran out" and "too many". */
    packed: ReviewChoice[]
    /** Things Alex owns that this trip's list never had — for "forgot". */
    notPacked: ReviewChoice[]
    /** The approved outfits — for "that one was wrong". */
    outfits: ReviewChoice[]
  }
}

/**
 * The whole screen, in one response.
 *
 * The pickers are filtered here rather than on the screen because the filtering
 * is a product rule, not a presentation detail: *forgot* may only offer things
 * that were NOT on the list, because offering something that was on it invites
 * an answer the review then has to talk him out of.
 */
export async function reviewView(
  db: D1Database,
  trip: { id: string; name: string; startDate: string; endDate: string; reviewedAt: number | null },
): Promise<ReviewView> {
  const [seen, answers, packed, notPacked, outfits] = await Promise.all([
    observations(db, trip.id),
    listAnswers(db, trip.id),

    db
      .prepare(
        `SELECT c.item_id AS id, c.name_snapshot AS name, c.category_snapshot AS category
           FROM checklist_entry c
          WHERE c.trip_id = ?
            AND c.item_id IS NOT NULL
            AND c.excluded_at IS NULL
            AND c.packed_qty > 0
          ORDER BY lower(c.name_snapshot)`,
      )
      .bind(trip.id)
      .all<ReviewChoice>(),

    db
      .prepare(
        `SELECT i.id, i.display_name AS name, i.category
           FROM item i
          WHERE i.archived_at IS NULL
            AND i.id NOT IN (SELECT item_id FROM checklist_entry
                              WHERE trip_id = ? AND item_id IS NOT NULL)
          ORDER BY lower(i.display_name)`,
      )
      .bind(trip.id)
      .all<ReviewChoice>(),

    db
      .prepare(
        `SELECT id, name, NULL AS category FROM outfit_group
          WHERE trip_id = ? AND status = 'approved' ORDER BY sort_order, lower(name)`,
      )
      .bind(trip.id)
      .all<ReviewChoice>(),
  ])

  const proposals = reviewProposals(answers, await contextFor(db, trip.id, answers))

  return {
    tripId: trip.id,
    tripName: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    reviewedAt: trip.reviewedAt,
    summary: summaryLines(seen),
    observations: seen,
    proposals,
    outstanding: proposals.filter(isOutstanding).length,
    choices: {
      packed: packed.results ?? [],
      notPacked: notPacked.results ?? [],
      outfits: outfits.results ?? [],
    },
  }
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

export interface NewAnswer {
  kind: ReviewAnswerKind
  itemId: string | null
  outfitGroupId: string | null
  note: string | null
}

/**
 * Whether this exact thing has already been said on this trip.
 *
 * Not a uniqueness constraint in the schema, because "the same note twice" is a
 * different question from "the same item twice" and only the second is
 * certainly a mistake. Two `ran_out` answers about the same socks would produce
 * two proposals to add a spare, and accepting both would add two — which is not
 * what saying it twice meant.
 */
export async function duplicateAnswer(
  db: D1Database,
  tripId: string,
  answer: NewAnswer,
): Promise<boolean> {
  if (answer.itemId) {
    const row = await db
      .prepare('SELECT 1 AS n FROM trip_review_answer WHERE trip_id = ? AND kind = ? AND item_id = ?')
      .bind(tripId, answer.kind, answer.itemId)
      .first<{ n: number }>()
    return row !== null
  }

  if (answer.outfitGroupId) {
    const row = await db
      .prepare(
        'SELECT 1 AS n FROM trip_review_answer WHERE trip_id = ? AND kind = ? AND outfit_group_id = ?',
      )
      .bind(tripId, answer.kind, answer.outfitGroupId)
      .first<{ n: number }>()
    return row !== null
  }

  return false
}

export async function addAnswer(
  db: D1Database,
  tripId: string,
  answer: NewAnswer,
  now: number,
): Promise<string> {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO trip_review_answer
         (id, trip_id, kind, item_id, outfit_group_id, note, resolution, resolved_at, created_at)
       VALUES (?,?,?,?,?,?,'pending',NULL,?)`,
    )
    .bind(id, tripId, answer.kind, answer.itemId, answer.outfitGroupId, answer.note, now)
    .run()
  return id
}

/**
 * Removes an answer outright.
 *
 * The undo for a mis-tap, and the one place in this feature where a row is
 * deleted rather than marked. Safe as a delete because it is what Alex just
 * typed and has not yet acted on: nothing else references it, no rule was
 * written from it, and the alternative — a third resolution meaning "never
 * mind" — would make every query carry a filter to hide it.
 *
 * An ACCEPTED answer is not deletable through this path; see the route.
 */
export async function deleteAnswer(db: D1Database, tripId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM trip_review_answer WHERE id = ? AND trip_id = ? AND resolution <> 'accepted'")
    .bind(id, tripId)
    .run()
  return (result.meta?.changes ?? 0) > 0
}

async function setResolution(
  db: D1Database,
  id: string,
  resolution: ReviewResolution,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE trip_review_answer SET resolution = ?, resolved_at = ? WHERE id = ?')
    .bind(resolution, now, id)
    .run()
}

/**
 * Applies one proposal, and records that it was applied.
 *
 * Every branch either writes a `learned` rule or reverses a lasting effect that
 * already had an exact inverse. Nothing here writes to the trip: it is over,
 * and what it records about what Alex actually took is history that a later
 * opinion does not get to edit.
 *
 * `editRule` and `disableRule` decide for themselves whether a change belongs
 * on the rule named or on an override of it — which is what keeps a seeded
 * default un-rewritten (A4b) without this file having to know the difference.
 */
export async function applyChange(db: D1Database, change: ReviewChange, now: number): Promise<void> {
  switch (change.kind) {
    case 'always_pack':
      await createRule(db, { itemId: change.itemId, ruleType: 'fixed_per_trip', quantityValue: 1 }, now, 'learned')
      break

    case 'add_spare':
      if (change.spareRuleId) {
        await editRule(db, change.spareRuleId, { quantityValue: change.to }, now)
      } else {
        await createRule(db, { itemId: change.itemId, ruleType: 'spare', quantityValue: change.to }, now, 'learned')
      }
      break

    case 'step_down':
      await editRule(db, change.ruleId, { quantityValue: change.to }, now)
      break

    case 'remove_spare':
      // Off, not deleted — the same reversible decision the learning panel
      // makes, and `Packing rules` can turn it back on.
      await disableRule(db, change.ruleId, 'learned', now)
      break

    case 'forget_pairings':
      await undoRemembered(db, change.outfitGroupId)
      break
  }
}

export async function resolveAnswer(
  db: D1Database,
  answer: ReviewAnswer,
  proposal: ReviewProposal,
  resolution: 'accepted' | 'declined',
): Promise<void> {
  const now = nowSeconds()
  if (resolution === 'accepted' && proposal.change) {
    await applyChange(db, proposal.change, now)
  }
  await setResolution(db, answer.id, resolution, now)
}

/**
 * Marks the sitting as done.
 *
 * Idempotent, and deliberately keeps the FIRST time rather than the latest: the
 * question this column answers is "has this trip been reviewed", and re-opening
 * a finished review to read it again is not a second review.
 */
export async function finishReview(db: D1Database, tripId: string, now: number): Promise<number> {
  const existing = await db
    .prepare('SELECT reviewed_at FROM trip WHERE id = ?')
    .bind(tripId)
    .first<{ reviewed_at: number | null }>()

  if (existing?.reviewed_at) return existing.reviewed_at

  await db.prepare('UPDATE trip SET reviewed_at = ? WHERE id = ?').bind(now, tripId).run()
  return now
}
