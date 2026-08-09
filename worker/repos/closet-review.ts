import type { DecisionRow, ReviewDecision, ReviewSignals, ReviewTopic } from '@shared/closet-review'

/**
 * The evidence Review Closet Items orders by, and the decisions Alex has
 * already made (H1d).
 *
 * `shared/closet-review.ts` decides WHICH question is worth asking; this file
 * only fetches the counts it decides from. Keeping those apart is what makes
 * every rule in the ordering a unit test over plain values rather than an
 * integration test that has to build a trip first.
 *
 * Three of the four queries below read tables that already existed for other
 * reasons — `checklist_entry`, `outfit_slot` — so the standing queue costs no
 * new bookkeeping on any write path. That was a requirement rather than a
 * happy accident: a review queue that needed its own counters maintained on
 * every pack, swap and removal would be a write-path change in service of a
 * read-only screen.
 */

/**
 * How many times Alex filled a slot with this garment HIMSELF.
 *
 * `outfit_slot.filled_by` has recorded `generated` or `user_swap` since
 * migration 0004, and `user_swap` is exactly the brief's *items Alex repeatedly
 * swaps in manually*: the planner offered something, and he chose otherwise.
 * That is the strongest possible evidence that the planner is missing something
 * about the garment — and the ratings are how he can say what.
 *
 * `DISTINCT` on nothing: two different outfits on one trip both wanting this
 * garment really are two separate decisions, unlike `packedTripCounts` where a
 * garment listed twice on one packing list is still one trip.
 */
export async function manualSwapCounts(db: D1Database): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT item_id AS id, COUNT(*) AS times
         FROM outfit_slot
        WHERE item_id IS NOT NULL AND filled_by = 'user_swap'
        GROUP BY item_id`,
    )
    .all<{ id: string; times: number }>()
  return toCounts(result.results ?? [])
}

/**
 * How many times a garment was taken back off a packing list.
 *
 * `excluded_at IS NOT NULL` is the checklist's own record of *I am not bringing
 * this*, and doing it repeatedly is Alex disagreeing with the engine in the
 * other direction. Counted per trip rather than per row, for the same reason
 * `packedTripCounts` is: one packing list is one opinion however many rows it
 * held.
 */
export async function removalCounts(db: D1Database): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT item_id AS id, COUNT(DISTINCT trip_id) AS times
         FROM checklist_entry
        WHERE item_id IS NOT NULL AND excluded_at IS NOT NULL
        GROUP BY item_id`,
    )
    .all<{ id: string; times: number }>()
  return toCounts(result.results ?? [])
}

function toCounts(rows: Array<{ id: string; times: number }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.id] = row.times
  return counts
}

/**
 * The two counts this file owns, alongside the one the catalog already
 * publishes.
 *
 * `packedTripCounts` stays where it is in `repos/items` — it is what My Stuff's
 * *Most packed* sort reads, and a second copy here would be two queries that
 * have to agree about what "packed" means.
 */
export async function reviewSignals(
  db: D1Database,
  packedTrips: Record<string, number>,
): Promise<ReviewSignals> {
  const [manualSwaps, removals] = await Promise.all([manualSwapCounts(db), removalCounts(db)])
  return { packedTrips, manualSwaps, removals }
}

/* ------------------------------------------------------------------ */
/* the decisions                                                       */
/* ------------------------------------------------------------------ */

export async function listDecisions(db: D1Database): Promise<DecisionRow[]> {
  const result = await db
    .prepare('SELECT item_id, topic, decision FROM closet_review_decision')
    .all<{ item_id: string; topic: string; decision: string }>()

  return (result.results ?? []).map((row) => ({
    itemId: row.item_id,
    topic: row.topic,
    decision: row.decision as ReviewDecision,
  }))
}

/**
 * One decision per question, replacing whatever was there.
 *
 * An UPSERT rather than an insert, so skipping the same card four times leaves
 * one row saying so rather than four rows saying the same thing — and so a
 * `not_sure` Alex later answers properly is corrected rather than shadowed by
 * an older row the reader would have to break a tie between.
 */
export async function recordDecision(
  db: D1Database,
  itemId: string,
  topic: ReviewTopic,
  decision: ReviewDecision,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO closet_review_decision (item_id, topic, decision, decided_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (item_id, topic)
       DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
    )
    .bind(itemId, topic, decision, now)
    .run()
}

/**
 * *Ask me again about the ones I was not sure about.*
 *
 * Deletes only the `not_sure` rows, so the questions come back and everything
 * Alex actually settled stays settled. This is the escape hatch that makes
 * *Not sure* safe to offer at all: without it, one uncertain tap would retire a
 * question permanently, and a queue that can lose a question is a queue nobody
 * should trust with a closet.
 *
 * `skipped` rows are deliberately untouched. A skipped card never left the
 * queue — it is at the back — so there is nothing to restore.
 */
export async function reopenNotSure(db: D1Database): Promise<number> {
  const result = await db
    .prepare("DELETE FROM closet_review_decision WHERE decision = 'not_sure'")
    .run()
  return result.meta.changes
}
