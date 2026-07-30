/**
 * Learning from what Alex actually does (product doc 04 §7).
 *
 * The audit found that removals were stored and never learned from:
 * `excluded_at` is respected within a trip and read by nothing across trips, so
 * taking the same thing off the list five times taught Pack Smart nothing and it
 * kept suggesting it.
 *
 * Deterministic and explainable, per doc 01 §4 — a count of trips, not a model.
 * Every proposal can say exactly what it saw and be refused.
 */

/**
 * How many separate trips make a pattern rather than a coincidence.
 *
 * Two is a coincidence: a swimsuit removed from two winter trips says nothing
 * about the summer. Three separate trips is a habit worth mentioning once.
 *
 * Deliberately not tunable in the UI. A threshold Alex has to think about is a
 * setting that costs attention and buys nothing.
 */
export const REMOVAL_THRESHOLD = 3

export interface RemovalRow {
  itemId: string
  itemName: string
  /** Distinct trips this item was taken off the list. */
  trips: number
  /** The enabled rule that keeps adding it, if there is one. */
  ruleId: string | null
  /** Alex has marked this as something he cannot travel without. */
  isCritical: boolean
}

export interface RemovalProposal {
  itemId: string
  itemName: string
  ruleId: string
  trips: number
  /** What was observed, in Alex's terms. Never a score or a confidence. */
  message: string
  /** What accepting does, stated before he does it. */
  effect: string
}

/**
 * Turns observed removals into proposals worth making.
 *
 * Filters more than it proposes, on purpose. A suggestion Alex disagrees with
 * costs more than a suggestion never made — it teaches him this panel is wrong.
 */
export function removalProposals(
  rows: RemovalRow[],
  threshold: number = REMOVAL_THRESHOLD,
): RemovalProposal[] {
  const proposals: RemovalProposal[] = []

  for (const row of rows) {
    if (row.trips < threshold) continue

    // Nothing to turn off. The item is arriving some other way, and disabling a
    // rule that does not exist would be a proposal that cannot be honoured.
    if (!row.ruleId) continue

    /*
     * NEVER propose switching off a rule for something Alex marked essential.
     *
     * This is the interaction with doc 02 §9c: a critical item with no enabled
     * rule can never reach a list, so accepting such a proposal would
     * manufacture exactly the silent omission that check exists to catch. The
     * app would help him disable his own passport and then warn him about it.
     *
     * If he genuinely wants it gone he can un-mark it as essential first, which
     * is a deliberate act rather than a tap on a suggestion.
     */
    if (row.isCritical) continue

    proposals.push({
      itemId: row.itemId,
      itemName: row.itemName,
      ruleId: row.ruleId,
      trips: row.trips,
      message: `You have taken ${row.itemName} off your list on ${row.trips} trips.`,
      effect: 'Stop adding it automatically. You can turn it back on in Packing rules.',
    })
  }

  // Strongest evidence first, then by name so the order never wobbles.
  return proposals.sort((a, b) => b.trips - a.trips || a.itemName.localeCompare(b.itemName))
}

/* ------------------------------------------------------------------ */
/* packed, and never worn                                              */
/* ------------------------------------------------------------------ */

/**
 * Learning from what came home unworn.
 *
 * `wear_log` was written and read only inside During Trip, so a jacket carried
 * on five trips and never put on kept being packed. This is mission priority 2
 * (packing-list accuracy) as much as priority 5 (learning): the most reliable way
 * to pack lighter is to stop packing what does not get worn.
 */

export interface UnwornRow {
  itemId: string
  itemName: string
  /** Completed trips where it was packed and no wearing was ever recorded. */
  trips: number
  ruleId: string | null
  isCritical: boolean
}

/**
 * Same threshold and the same reasoning as removals: three trips is a habit, two
 * is a coincidence. Deliberately the same number — two thresholds to reason
 * about would be one too many.
 */
export function unwornProposals(
  rows: UnwornRow[],
  threshold: number = REMOVAL_THRESHOLD,
): RemovalProposal[] {
  const proposals: RemovalProposal[] = []

  for (const row of rows) {
    if (row.trips < threshold) continue
    if (!row.ruleId) continue

    // Same refusal as removals, for the same reason: disabling the only rule on
    // a critical item leaves it unable to reach any list (doc 02 §9c).
    if (row.isCritical) continue

    proposals.push({
      itemId: row.itemId,
      itemName: row.itemName,
      ruleId: row.ruleId,
      trips: row.trips,
      message: `You packed ${row.itemName} on ${row.trips} trips and never wore it.`,
      effect: 'Stop adding it automatically. You can turn it back on in Packing rules.',
    })
  }

  return proposals.sort((a, b) => b.trips - a.trips || a.itemName.localeCompare(b.itemName))
}
