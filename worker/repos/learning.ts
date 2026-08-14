import {
  bagProposals,
  quantityProposals,
  removalProposals,
  timingProposals,
  unwornProposals,
  type DecidedProposal,
  type LearnedChange,
  type LearningDecision,
  type OverrideProposal,
  type OverrideRow,
  type QuantityOverrideRow,
  type RemovalProposal,
  type RemovalRow,
  type UnwornRow,
} from '@shared/learning'
import { BAG_LABELS, type BagKey } from '@shared/checklist'
import { PACKING_TIMING_LABELS, readTiming } from '@shared/items'
import { nowSeconds } from '../auth'
import { disableRule, editRule, NOT_SUPERSEDED } from './rules'

/**
 * Which trips are allowed to teach Pack Smart anything (G1).
 *
 * **An archived trip is not evidence.** Archiving is how Alex says "this one is
 * not part of my history any more" — a test trip, a demo, a plan that never
 * happened — and until this existed both proposal families counted them. Three
 * trips created to try the app out could therefore offer to stop packing
 * something he has never actually left behind, which is exactly the kind of
 * confidently-wrong suggestion that teaches him the panel is not worth reading.
 *
 * Archiving rather than a `is_test` flag, deliberately: it is a control that
 * already exists, that Alex already understands, and that is reversible in one
 * tap. A second marker would be a second thing to remember to set, and the one
 * he forgets is the one that pollutes the history.
 *
 * Un-archiving restores the evidence, because these proposals are DERIVED — the
 * count is recomputed on every read, so nothing has to go back and undo
 * anything. That is the same property that made `preference_change_suggestion`
 * unnecessary.
 *
 * A DELETED trip needs no clause: its rows are gone.
 */
const TRIP_COUNTS = 't.archived_at IS NULL'

/**
 * What Alex's own history suggests changing (product doc 04 §7).
 *
 * Computed from `checklist_entry.excluded_at`, which has always been recorded and
 * never read across trips. No new table: the evidence was already there, which
 * is why `preference_change_suggestion` — created in migration 0004 and
 * referenced by no code — stays unused rather than being populated. A stored
 * suggestion could go stale against the history that produced it; a derived one
 * cannot.
 */
export async function pendingRemovalProposals(db: D1Database): Promise<RemovalProposal[]> {
  const { results } = await db
    .prepare(
      `SELECT e.item_id                         AS itemId,
              i.display_name                    AS itemName,
              COUNT(DISTINCT e.trip_id)         AS trips,
              MAX(r.id)                         AS ruleId,
              i.is_critical                     AS isCritical
         FROM checklist_entry e
         JOIN item i ON i.id = e.item_id
         -- Joined for one reason: to ask whether Alex has put the trip away.
         JOIN trip t ON t.id = e.trip_id
         LEFT JOIN packing_rule r
                ON r.item_id = e.item_id AND r.enabled = 1 AND ${NOT_SUPERSEDED}
        WHERE e.excluded_at IS NOT NULL
          AND e.item_id IS NOT NULL
          AND i.archived_at IS NULL
          AND ${TRIP_COUNTS}
        GROUP BY e.item_id`,
    )
    .all<{
      itemId: string
      itemName: string
      trips: number
      ruleId: string | null
      isCritical: number
    }>()

  const rows: RemovalRow[] = (results ?? []).map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    // DISTINCT trip_id, not row count: removing the same thing twice within one
    // trip is one decision, and counting it twice would fake a pattern.
    trips: row.trips,
    ruleId: row.ruleId,
    isCritical: row.isCritical === 1,
  }))

  return removalProposals(rows)
}

/**
 * Accepts one proposal: stop adding this item automatically.
 *
 * Disables the rule rather than deleting it, so Packing rules can turn it back
 * on and nothing about why it existed is lost (data model Rule 2).
 *
 * It used to disable the rule by writing `enabled = 0` over whichever row it
 * found — including a seeded one. That is the mutation of a canonical default
 * Alex's ruling forbids, and it left nothing to restore *to*: the default and
 * the decision to stop using it were the same row. Accepting now writes a
 * `learned` override, which is a rule of its own, reversible in one tap, and
 * distinguishable from both a system default and a rule Alex wrote himself.
 */
export async function acceptRemovalProposal(
  db: D1Database,
  ruleId: string,
): Promise<{ disabled: boolean }> {
  // `false` when the rule was already off or never existed — the caller says so
  // rather than reporting a change that did not happen.
  return { disabled: await disableRule(db, ruleId, 'learned', nowSeconds()) }
}

/**
 * Things packed on finished trips and never worn.
 *
 * The guard that makes this usable rather than noise: a trip only counts if Alex
 * actually used During Trip on it, proven by the trip having at least one
 * `wear_log` row. `wear_log` is written only from that screen, so on a trip he
 * never opened, EVERY item looks unworn — and without this the panel would
 * confidently offer to stop packing his whole wardrobe.
 *
 * Absence of evidence is not evidence of absence. That distinction is the
 * difference between a suggestion worth reading and one that destroys trust in
 * the panel.
 *
 * Completed trips only, by date: mid-trip, "not yet worn" means nothing.
 */
export async function pendingUnwornProposals(
  db: D1Database,
  today: string,
): Promise<RemovalProposal[]> {
  const { results } = await db
    .prepare(
      `SELECT c.item_id                 AS itemId,
              i.display_name            AS itemName,
              COUNT(DISTINCT c.trip_id) AS trips,
              MAX(r.id)                 AS ruleId,
              i.is_critical             AS isCritical
         FROM checklist_entry c
         JOIN item i ON i.id = c.item_id
         JOIN trip t ON t.id = c.trip_id
         LEFT JOIN packing_rule r
                ON r.item_id = c.item_id AND r.enabled = 1 AND ${NOT_SUPERSEDED}
        WHERE c.packed_qty > 0
          AND c.excluded_at IS NULL
          AND c.item_id IS NOT NULL
          AND i.archived_at IS NULL
          AND ${TRIP_COUNTS}
          AND t.end_date < ?
          -- The trip was actually tracked. Without this, a trip where During
          -- Trip was never opened makes every packed item look unworn.
          AND EXISTS (SELECT 1 FROM wear_log w WHERE w.trip_id = c.trip_id)
          -- And this particular item was never recorded as worn on it.
          AND NOT EXISTS (
                SELECT 1 FROM wear_log w
                 WHERE w.trip_id = c.trip_id
                   AND w.item_id = c.item_id
                   AND w.action IN ('will_wear', 'already_wore')
              )
        GROUP BY c.item_id`,
    )
    .bind(today)
    .all<{
      itemId: string
      itemName: string
      trips: number
      ruleId: string | null
      isCritical: number
    }>()

  const rows: UnwornRow[] = (results ?? []).map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    trips: row.trips,
    ruleId: row.ruleId,
    isCritical: row.isCritical === 1,
  }))

  return unwornProposals(rows)
}

/* ------------------------------------------------------------------ */
/* the same correction, trip after trip (P4c)                          */
/* ------------------------------------------------------------------ */

/**
 * What Alex keeps correcting, counted rather than stored.
 *
 * The evidence for all three families was already being written and read by
 * nothing across trips — `packing_timing`, `bag` with `bag_source = 'user'`,
 * and `qty_override` — which is exactly the gap `pendingRemovalProposals` closed
 * for `excluded_at`. No write path changes, no counter is maintained anywhere,
 * and the count is recomputed on every read so a proposal cannot go stale
 * against the history that produced it.
 *
 * Every query here carries `TRIP_COUNTS`, so an archived trip teaches nothing,
 * and excludes archived items, so a garment out of the wardrobe cannot produce
 * a suggestion about itself.
 */

/**
 * A timing Alex moved a row to, on trips where it differed from the default.
 *
 * Restricted to the two LIVE timings. `night_before` and `last_minute` are
 * retired aliases (`RETIRED_TIMINGS`) that only a pre-migration row can still
 * hold, and a legacy import artefact is not evidence of a deliberate
 * correction. Filtering here rather than normalising also keeps the retired map
 * in one place: mirroring it in SQL would be a second copy free to drift.
 */
export async function pendingTimingProposals(db: D1Database): Promise<OverrideProposal[]> {
  const { results } = await db
    .prepare(
      `SELECT e.item_id                  AS itemId,
              i.display_name             AS itemName,
              e.packing_timing           AS value,
              COUNT(DISTINCT e.trip_id)  AS trips,
              i.default_packing_timing   AS current
         FROM checklist_entry e
         JOIN item i ON i.id = e.item_id
         JOIN trip t ON t.id = e.trip_id
        WHERE e.item_id IS NOT NULL
          AND e.excluded_at IS NULL
          AND i.archived_at IS NULL
          AND e.packing_timing IN ('anytime', 'day_of')
          AND ${TRIP_COUNTS}
        GROUP BY e.item_id, e.packing_timing`,
    )
    .all<{ itemId: string; itemName: string; value: string; trips: number; current: string }>()

  const rows: OverrideRow[] = (results ?? []).map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    value: row.value,
    // DISTINCT trip_id: one decision per trip, however many rows carry it.
    trips: row.trips,
    // Normalised through the shared map, so a stored `night_before` default
    // compares as the `anytime` it has always meant.
    current: readTiming(row.current),
  }))

  return timingProposals(rows, (timing) => PACKING_TIMING_LABELS[readTiming(timing)])
}

/**
 * A bag Alex put something in HIMSELF, on several trips.
 *
 * `bag_source = 'user'` is the whole filter that makes this evidence rather than
 * noise: a recommendation is not stored on the row at all, and a stored `bag`
 * with any other source is a leftover from an earlier release whose rule has
 * since gone. Only his own choice counts.
 */
export async function pendingBagProposals(db: D1Database): Promise<OverrideProposal[]> {
  const { results } = await db
    .prepare(
      `SELECT e.item_id                 AS itemId,
              i.display_name            AS itemName,
              e.bag                     AS value,
              COUNT(DISTINCT e.trip_id) AS trips,
              i.default_bag             AS current
         FROM checklist_entry e
         JOIN item i ON i.id = e.item_id
         JOIN trip t ON t.id = e.trip_id
        WHERE e.item_id IS NOT NULL
          AND e.excluded_at IS NULL
          AND i.archived_at IS NULL
          AND e.bag IS NOT NULL
          AND e.bag_source = 'user'
          AND ${TRIP_COUNTS}
        GROUP BY e.item_id, e.bag`,
    )
    .all<{
      itemId: string
      itemName: string
      value: string
      trips: number
      current: string | null
    }>()

  const rows: OverrideRow[] = (results ?? []).map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    value: row.value,
    trips: row.trips,
    current: row.current,
  }))

  return bagProposals(rows, (bag) => BAG_LABELS[bag as BagKey] ?? bag)
}

/**
 * A quantity Alex set by hand, the same number, on several trips.
 *
 * ## Why `HAVING COUNT(DISTINCT r.id) = 1`
 *
 * The correction has to land on ONE rule, and the id, the quantity and the type
 * all have to come from that same rule. `pendingRemovalProposals` gets away with
 * `MAX(r.id)` because disabling any one enabled rule is a defensible answer to
 * "stop adding this"; here, `MAX(r.id)` with `MAX(r.quantity_value)` could take
 * the id of one rule and the number of another and then write the difference
 * back. An item with two enabled rules has no unambiguous target, so it is
 * declined outright — the same posture `writeThreshold` takes towards a rule
 * with two numbers in it.
 */
export async function pendingQuantityProposals(db: D1Database): Promise<OverrideProposal[]> {
  const { results } = await db
    .prepare(
      `SELECT e.item_id                    AS itemId,
              i.display_name               AS itemName,
              CAST(e.qty_override AS TEXT) AS value,
              COUNT(DISTINCT e.trip_id)    AS trips,
              MIN(r.id)                    AS ruleId,
              MIN(r.quantity_value)        AS ruleQuantity,
              MIN(r.rule_type)             AS ruleType
         FROM checklist_entry e
         JOIN item i ON i.id = e.item_id
         JOIN trip t ON t.id = e.trip_id
         LEFT JOIN packing_rule r
                ON r.item_id = e.item_id AND r.enabled = 1 AND ${NOT_SUPERSEDED}
        WHERE e.item_id IS NOT NULL
          AND e.excluded_at IS NULL
          AND i.archived_at IS NULL
          AND e.qty_override IS NOT NULL
          AND ${TRIP_COUNTS}
        GROUP BY e.item_id, e.qty_override
       HAVING COUNT(DISTINCT r.id) = 1`,
    )
    .all<{
      itemId: string
      itemName: string
      value: string
      trips: number
      ruleId: string | null
      ruleQuantity: number | null
      ruleType: string | null
    }>()

  const rows: QuantityOverrideRow[] = (results ?? []).map((row) => ({
    itemId: row.itemId,
    itemName: row.itemName,
    value: row.value,
    trips: row.trips,
    // There is no catalog "usual amount" to compare against; the rule is the
    // comparison, and `quantityProposals` reads it from `ruleQuantity`.
    current: null,
    ruleId: row.ruleId,
    ruleQuantity: row.ruleQuantity,
    scalesWithTrip: SCALING_RULE_TYPES.has(row.ruleType ?? ''),
  }))

  return quantityProposals(rows)
}

/**
 * Rule types whose answer depends on how long the trip is.
 *
 * A number cannot correct one of these — see `QuantityOverrideRow.scalesWithTrip`.
 * Listed rather than inverted, so a rule type added later is treated as
 * non-scaling only if somebody looks at this and decides it is.
 */
const SCALING_RULE_TYPES = new Set([
  'per_day',
  'per_night',
  'duration_plus_buffer',
  'per_activity_occurrence',
])

/* ------------------------------------------------------------------ */
/* what Alex has said about a suggestion                               */
/* ------------------------------------------------------------------ */

export async function listLearningDecisions(db: D1Database): Promise<DecidedProposal[]> {
  const { results } = await db
    .prepare('SELECT subject, topic, decision FROM learning_decision')
    .all<{ subject: string; topic: string; decision: string }>()

  return (results ?? []).map((row) => ({
    subject: row.subject,
    topic: row.topic,
    decision: row.decision as LearningDecision,
  }))
}

/** One decision per suggestion; answering again replaces the previous answer. */
export async function decideLearning(
  db: D1Database,
  subject: string,
  topic: string,
  decision: LearningDecision,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO learning_decision (subject, topic, decision, decided_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (subject, topic)
       DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
    )
    .bind(subject, topic, decision, now)
    .run()
}

/**
 * Brings back everything set aside.
 *
 * The escape hatch `Not sure` needs to be honest — a question put off has to be
 * findable rather than lost — and it is the same one `clearNotSure` gives the
 * closet review. Declines are untouched: "no" and "not now" are different
 * answers and only one of them was meant to be temporary.
 */
export async function restoreSetAsideLearning(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM learning_decision WHERE decision = 'not_sure'").run()
}

/* ------------------------------------------------------------------ */
/* accepting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Makes a repeated correction the default. The one write in this file.
 *
 * Each branch lands on something that already existed and is already reversible
 * where Alex would look for it:
 *
 * - `default_timing` → `item.default_packing_timing`, changed in My Stuff;
 * - `default_bag` → `item.default_bag`, changed on any trip by choosing a bag,
 *   and cleared by the same sheet's *Use what Pack Smart suggests*;
 * - `usual_amount` → the rule's quantity, changed in Packing rules.
 *
 * The quantity branch goes through `editRule` rather than writing the column,
 * so a seeded default is superseded rather than overwritten — and the override
 * is then stamped `learned`, exactly as `disableRule` does, because a learned
 * rule labelled `user` would be indistinguishable from something Alex decided.
 *
 * Nothing here touches a trip. A finished trip's record of what he took is
 * history, and an active trip picks the new default up the next time its
 * checklist is generated.
 */
export async function acceptOverrideProposal(
  db: D1Database,
  change: LearnedChange,
  now: number,
): Promise<{ applied: boolean }> {
  switch (change.kind) {
    case 'default_timing': {
      const result = await db
        .prepare('UPDATE item SET default_packing_timing = ?, updated_at = ? WHERE id = ?')
        .bind(change.to, now, change.itemId)
        .run()
      return { applied: (result.meta?.changes ?? 0) > 0 }
    }

    case 'default_bag': {
      const result = await db
        .prepare('UPDATE item SET default_bag = ?, updated_at = ? WHERE id = ?')
        .bind(change.to, now, change.itemId)
        .run()
      return { applied: (result.meta?.changes ?? 0) > 0 }
    }

    case 'usual_amount': {
      const outcome = await editRule(db, change.ruleId, { quantityValue: change.to }, now)
      if (!outcome) return { applied: false }
      /*
       * Stamped only when an override was actually minted. Writing `learned`
       * over a rule Alex authored himself would relabel his own decision as
       * something the app worked out.
       */
      if (outcome.overrode) {
        await db
          .prepare("UPDATE packing_rule SET source = 'learned' WHERE id = ?")
          .bind(outcome.row.id)
          .run()
      }
      return { applied: true }
    }
  }
}
