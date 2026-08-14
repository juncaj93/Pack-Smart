import { recurringClosetGaps, type ClosetGapInsight, type UnfilledSlotRow } from '@shared/closet-gaps'
import { SLOT_NOUNS, passesFilters, templateFor, type SlotRole } from '@shared/outfits'
import { listActiveCandidates } from './items'

/**
 * Holes in the wardrobe that keep coming back (P4d).
 *
 * The evidence is `outfit_slot.unmet_reason`, written since M6 whenever the
 * planner could not fill a required slot and refused to invent a garment — and
 * read by nothing across trips until now. Same shape as every other learning
 * family here: no new table, no counter maintained on any write path, and the
 * count recomputed on every read.
 *
 * ## Two tests, and the second is the one that keeps this honest
 *
 * The count is only the TRIGGER. The claim itself — *nothing you own suits
 * this* — is re-tested against the wardrobe as it stands right now, through
 * `passesFilters`, which is the same function the planner uses to decide
 * eligibility. So:
 *
 *   - a gap Alex has since filled stops being reported, without anything having
 *     to go back and invalidate three trips of history;
 *   - an ARCHIVED garment cannot close a gap.
 *
 * The second one is protected TWICE over, and it is worth being precise about
 * which does the work. `listActiveCandidates` is the repository's single archive
 * filter and never returns an archived row; `passesFilters` rejects one again on
 * its own account. Mutating either alone leaves the behaviour correct — proved,
 * by doing it — and mutating both together breaks three tests. Neither is
 * redundant enough to remove: the first is the wardrobe this module asks for,
 * the second is the planner's own idea of eligibility, and they are allowed to
 * agree.
 *
 * ## What this deliberately does not claim
 *
 * The structural question is asked at TEMPLATE level — *could anything you own
 * ever suit nice dinners* — with no warmth band and no trip formality cap. That
 * is the only version that is a fact about the closet: a slot left empty because
 * it was 4°C is a fact about that week, and reporting it as a wardrobe gap would
 * be the app telling Alex to buy a coat because he went somewhere cold once.
 *
 * The cost is stated rather than hidden: a wardrobe with exactly one jacket, too
 * light for anywhere cold, reads as covered here. That is the safer side to be
 * wrong on, and the trip's own outfit screen still says the slot is empty every
 * time it happens.
 */
export async function recurringGapInsights(db: D1Database): Promise<ClosetGapInsight[]> {
  /*
   * `archived_at IS NULL` on the trip: an archived trip is not evidence, exactly
   * as in `learning.ts`. `required = 1`: an optional accessory nobody owns is
   * not a hole in a wardrobe, it is a thing Alex does not wear.
   */
  const { results } = await db
    .prepare(
      `SELECT s.slot_role               AS role,
              g.activity_tag            AS activityTag,
              g.name                    AS groupName,
              COUNT(DISTINCT g.trip_id) AS trips
         FROM outfit_slot s
         JOIN outfit_group g ON g.id = s.outfit_group_id
         JOIN trip t ON t.id = g.trip_id AND t.archived_at IS NULL
        WHERE s.item_id IS NULL
          AND s.unmet_reason IS NOT NULL
          AND s.required = 1
        GROUP BY s.slot_role, g.activity_tag, g.name`,
    )
    .all<{ role: string; activityTag: string | null; groupName: string; trips: number }>()

  if ((results ?? []).length === 0) return []

  const wardrobe = await listActiveCandidates(db)

  const rows: UnfilledSlotRow[] = []
  for (const row of results ?? []) {
    /*
     * A group whose template cannot be resolved says nothing.
     *
     * `templateFor` returns null when neither the activity tag nor the name
     * matches anything the planner knows — a group from a template that has
     * since been retired, most likely. Naming the wrong occasion is worse than
     * naming none, which is the argument `templateFor` already makes.
     */
    const template = templateFor(row.activityTag, row.groupName)
    if (!template) continue

    const role = row.role as SlotRole
    if (!SLOT_NOUNS[role]) continue

    rows.push({
      role,
      roleLabel: SLOT_NOUNS[role],
      occasion: template.name,
      trips: row.trips,
      /*
       * The structural test, through the planner's own eligibility function.
       *
       * No warmth band and no formality cap — see the note at the top. This asks
       * whether ANY active garment could ever fill this slot for this occasion,
       * which is the only version of the question that is about the closet.
       */
      fillableNow: wardrobe.some((item) => passesFilters(item, { role, template }).ok),
    })
  }

  /*
   * One insight per occasion, whichever slot has the strongest evidence.
   *
   * `Nice dinners` with no top AND no shoes is one thing wrong — Alex has
   * nothing to wear to a nice dinner — and saying it twice would read as two
   * findings about two different problems. `recurringClosetGaps` sorts by
   * evidence, so the first of each occasion is the strongest.
   */
  const seen = new Set<string>()
  return recurringClosetGaps(rows).filter((insight) => {
    if (seen.has(insight.topic)) return false
    seen.add(insight.topic)
    return true
  })
}
