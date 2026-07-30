import { removalProposals, type RemovalProposal, type RemovalRow } from '@shared/learning'

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
