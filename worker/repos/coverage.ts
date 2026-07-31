import { coverageGaps, type CoverageGap } from '@shared/essentials'
import type { Trip } from '@shared/trips'
import { listActiveCandidates } from './items'
import { NOT_SUPERSEDED } from './rules'

/**
 * What this trip knows it is not covering (product doc 02 §9c).
 *
 * Reads the same two things `generateChecklist` reads — active candidates, and
 * which items carry an enabled rule — so "can this ever reach a list?" is
 * answered from the same facts the list itself is built from. Deriving it
 * differently is how a warning starts disagreeing with the checklist beside it.
 */
export async function tripCoverageGaps(db: D1Database, trip: Trip): Promise<CoverageGap[]> {
  const items = await listActiveCandidates(db)

  /*
   * `NOT_SUPERSEDED` matters here as much as `enabled = 1` does. A default that
   * Alex has switched off is stored as a disabled override shadowing an
   * untouched system row — so without it, coverage would read the shadowed row
   * and report the item as handled by a rule the packing list never applies.
   */
  const ruled = await db
    .prepare(
      `SELECT DISTINCT r.item_id FROM packing_rule r WHERE r.enabled = 1 AND ${NOT_SUPERSEDED}`,
    )
    .all<{ item_id: string }>()

  return coverageGaps({
    items,
    ruledItemIds: new Set((ruled.results ?? []).map((row) => row.item_id)),
    /*
     * Only a CONFIRMED international trip gets the passport check.
     *
     * `international` is null when unanswered, and treating null as "probably
     * abroad" would warn about a passport on every domestic trip Alex did not
     * bother to answer. That is precisely the false alarm doc 02 §9c exists to
     * avoid: a warning about something he does not need is how he learns to
     * dismiss the ones that matter.
     *
     * The cost is a real trip abroad with the question unanswered getting no
     * passport warning. That is the safer side to be wrong on — the trip sheet
     * asks, and check 1 still catches a passport he has marked essential.
     */
    trip: { international: trip.international === true },
  })
}
