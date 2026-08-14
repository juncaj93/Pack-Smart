import { REMOVAL_THRESHOLD } from './learning'

/**
 * Gaps in the wardrobe that keep coming back (P4d, doc 02 §9c).
 *
 * ## What the evidence actually is
 *
 * `coverageGaps` answers a different and narrower question — gear with no rule,
 * a universal essential missing entirely — and it is about the GEAR path. The
 * clothing path records its gaps somewhere else and always has:
 * `outfit_slot.unmet_reason`, written whenever the planner could not fill a slot
 * and refused to invent a garment for it. *No footwear in your wardrobe suits
 * nice dinners* is already a sentence Pack Smart writes, once, on one trip.
 *
 * What has never happened is reading those across trips. A slot unfilled on one
 * trip is a fact about that trip; the same slot unfilled on three is a fact
 * about the closet.
 *
 * ## Two tests, and both have to pass
 *
 * **Repeated.** Three separate trips, the same `REMOVAL_THRESHOLD` as every
 * other learning family. One unusual trip must not create a permanent insight —
 * a black-tie weekend Alex will not repeat is not evidence that his wardrobe is
 * wrong.
 *
 * **Still true today.** The evidence is history, and history does not update
 * itself: rows saying *no formal footwear* stay in the database forever, so a
 * gap Alex has since filled would go on being reported from the same three
 * trips. So the count is only the trigger, and the claim is re-tested against
 * the CURRENT wardrobe every time it is read — if any active garment could fill
 * that slot for that occasion now, there is no gap and nothing is said.
 *
 * That second test is also what keeps an archived garment from satisfying a gap:
 * it is `passesFilters` doing the work, and `passesFilters` rejects archived and
 * never-packed items outright.
 *
 * ## This is not shopping
 *
 * It names what the wardrobe cannot cover and stops. No product links, no
 * search, no "buy" — the fix is the same sentence the coverage warnings already
 * use, because the only action Pack Smart knows about is Alex recording
 * something in My Stuff. Whether he buys anything is not the app's business.
 */

/** One (slot, occasion) pair the planner could not fill, and how often. */
export interface UnfilledSlotRow {
  /** `footwear`, `outer`, … — the slot the planner left empty. */
  role: string
  /** How that slot reads in a sentence: "footwear", "an outer layer". */
  roleLabel: string
  /** The occasion, in Alex's words: "Nice dinners", "Cold-weather days". */
  occasion: string
  /** Distinct trips this slot went unfilled on. */
  trips: number
  /**
   * Whether the wardrobe as it stands TODAY could fill it.
   *
   * Computed by the caller from `passesFilters` over the active wardrobe, so
   * this module never has to hold a second opinion about eligibility. `true`
   * means the gap is closed and nothing is reported, whatever the history says.
   */
  fillableNow: boolean
}

export interface ClosetGapInsight {
  /** What a decision is recorded against, with `topic`. */
  subject: string
  topic: string
  /** What was observed, in Alex's terms. Never a score. */
  message: string
  /** The one action, described — never performed, and never a purchase. */
  fix: string
  trips: number
}

/**
 * The gaps worth mentioning, or nothing at all.
 *
 * Nothing at all is the common case and the important one. A wardrobe that
 * covers everything Alex actually does produces an empty array, and the sheet
 * says so plainly rather than manufacturing advice.
 */
export function recurringClosetGaps(
  rows: UnfilledSlotRow[],
  threshold: number = REMOVAL_THRESHOLD,
): ClosetGapInsight[] {
  return rows
    .filter((row) => row.trips >= threshold)
    // Still true today, or it is not a gap — see the note above.
    .filter((row) => !row.fillableNow)
    .map((row) => ({
      subject: `gap:${row.role}`,
      /*
       * The occasion is part of the topic, and deliberately.
       *
       * "No footwear for nice dinners" and "no footwear for hiking" are two
       * different holes in the same drawer, and saying no to one must not
       * silence the other — the same argument the correction topics make for
       * carrying their value.
       */
      topic: `occasion:${row.occasion}`,
      message: `Nothing in your wardrobe has suited ${row.occasion.toLowerCase()} on ${row.trips} trips.`,
      /*
       * The same wording the coverage warnings already use, and for the same
       * reason: the only action Pack Smart knows about is Alex recording
       * something. It does not know what he owns but has not entered, and it
       * has no business naming a product.
       */
      fix: `Add ${row.roleLabel} you would wear for it in My Stuff, or ignore this if you have it covered.`,
      trips: row.trips,
    }))
    // Strongest evidence first, then alphabetically so the order never wobbles.
    .sort((a, b) => b.trips - a.trips || a.message.localeCompare(b.message))
}
