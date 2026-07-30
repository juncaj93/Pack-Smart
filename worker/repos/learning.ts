import {
  removalProposals,
  unwornProposals,
  type RemovalProposal,
  type RemovalRow,
  type UnwornRow,
} from '@shared/learning'

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
         LEFT JOIN packing_rule r
                ON r.item_id = e.item_id AND r.enabled = 1
        WHERE e.excluded_at IS NOT NULL
          AND e.item_id IS NOT NULL
          AND i.archived_at IS NULL
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
 */
export async function acceptRemovalProposal(
  db: D1Database,
  ruleId: string,
): Promise<{ disabled: boolean }> {
  const result = await db
    .prepare('UPDATE packing_rule SET enabled = 0 WHERE id = ? AND enabled = 1')
    .bind(ruleId)
    .run()

  // `false` when the rule was already off or never existed — the caller says so
  // rather than reporting a change that did not happen.
  return { disabled: (result.meta?.changes ?? 0) > 0 }
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
                ON r.item_id = c.item_id AND r.enabled = 1
        WHERE c.packed_qty > 0
          AND c.excluded_at IS NULL
          AND c.item_id IS NOT NULL
          AND i.archived_at IS NULL
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
