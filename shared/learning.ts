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

/* ------------------------------------------------------------------ */
/* the same correction, trip after trip                                */
/* ------------------------------------------------------------------ */

/**
 * Learning from what Alex CHANGES, rather than from what he leaves out (P4c).
 *
 * The two families above both watch an absence — a row taken off the list, a
 * garment that came home unworn. These three watch a correction: a bag he moves,
 * a timing he shifts, a number he sets. Every one of them is already recorded on
 * `checklist_entry` and has been read by nothing across trips, which is the same
 * gap `removalProposals` was written to close for `excluded_at`.
 *
 * ## The standing rule, and where it is enforced
 *
 *   Behaviour creates a proposal. Alex creates truth.
 *
 * Nothing here writes anything. These are pure functions over counted rows, and
 * the count is recomputed on every read — so a proposal cannot go stale against
 * the history that produced it, and accepting one is a separate deliberate act
 * with an exact inverse in the screen it lands on.
 *
 * ## Why a correction is weaker evidence than a removal, and what guards it
 *
 * A correction has a REASON, and the reason may be about the trip rather than
 * about the item. Four guards, each killing a specific false positive:
 *
 * - **Three distinct trips**, the same threshold as everything else here. One
 *   winter trip where the sunscreen went in the hold is not a habit.
 * - **Consistency.** Two different answers that both reach the threshold produce
 *   NO proposal. A garment moved to the personal bag on three trips and to the
 *   carry-on on three others has no preference to learn, and picking the larger
 *   count would be inventing a winner out of a tie.
 * - **Nothing already true.** A correction matching what the default already
 *   says is not a correction; it is the default working.
 * - **Nothing said no to.** A declined suggestion stops being offered, and the
 *   topic carries the VALUE so a later, different habit is still asked once.
 */

/** The three things a repeated correction is allowed to become. */
export type LearnedChange =
  | { kind: 'default_timing'; itemId: string; to: string }
  | { kind: 'default_bag'; itemId: string; to: string }
  | { kind: 'usual_amount'; ruleId: string; to: number }

export interface OverrideProposal {
  /**
   * What a decision is recorded against, with `topic`.
   *
   * The topic carries the VALUE (`bag:checked`, not `bag`) so that saying no to
   * *put this in the hold* does not silence a later observation that he now
   * keeps it in the cabin. One no must not become permanent deafness.
   */
  subject: string
  topic: string
  itemId: string
  itemName: string
  /** Distinct trips the same correction was made on. Never a score. */
  trips: number
  /** What was observed, in Alex's terms. */
  message: string
  /** What accepting does, stated before he does it. */
  effect: string
  change: LearnedChange
}

/** One (item, corrected value) pair, and how many trips carried it. */
export interface OverrideRow {
  itemId: string
  itemName: string
  /** The value Alex corrected TO. */
  value: string
  trips: number
  /** What the catalog says today, so a no-op is never proposed. */
  current: string | null
}

/**
 * Drops every item whose corrections do not agree with each other.
 *
 * The tie is the case worth stating: a garment moved to the personal bag on
 * three trips and to the carry-on on three others produces two rows that both
 * clear the threshold, and there is no honest way to choose between them.
 * Proposing the larger count would read a coincidence as a preference; proposing
 * both would ask Alex to arbitrate a question the app invented.
 *
 * Rows below the threshold are not evidence of inconsistency — they are not
 * evidence of anything — so they are dropped before the check rather than
 * counted against it.
 */
function consistent<T extends OverrideRow>(rows: T[], threshold: number): T[] {
  const strong = rows.filter((row) => row.trips >= threshold)
  const perItem = new Map<string, number>()
  for (const row of strong) perItem.set(row.itemId, (perItem.get(row.itemId) ?? 0) + 1)
  return strong.filter((row) => perItem.get(row.itemId) === 1)
}

/** Strongest evidence first, then by name so the order never wobbles. */
function byStrength(a: OverrideProposal, b: OverrideProposal): number {
  return b.trips - a.trips || a.itemName.localeCompare(b.itemName)
}

/* --- when to pack it ----------------------------------------------- */

/**
 * "You moved this to Morning of on 3 trips. Make that the default?"
 *
 * Lands on `item.default_packing_timing`, which has existed since migration 0002
 * and is already what seeds the timing on a new checklist row. Accepting changes
 * what future trips start from and touches no trip that already exists — a
 * finished trip's record of when he packed something is history.
 */
export function timingProposals(
  rows: OverrideRow[],
  labelFor: (timing: string) => string,
  threshold: number = REMOVAL_THRESHOLD,
): OverrideProposal[] {
  return consistent(rows, threshold)
    .filter((row) => row.value !== row.current)
    .map((row) => ({
      subject: row.itemId,
      topic: `timing:${row.value}`,
      itemId: row.itemId,
      itemName: row.itemName,
      trips: row.trips,
      message: `You moved ${row.itemName} to ${labelFor(row.value)} on ${row.trips} trips.`,
      effect: `Start it at ${labelFor(row.value)} on new trips. You can change it in My Stuff.`,
      change: { kind: 'default_timing' as const, itemId: row.itemId, to: row.value },
    }))
    .sort(byStrength)
}

/* --- which bag ------------------------------------------------------ */

/**
 * "You moved your glasses to your personal item on 3 flights. Remember that?"
 *
 * Lands on `item.default_bag` (migration 0028), which `recommendBag` reads
 * BEFORE the trait rules and AFTER an explicit per-trip choice.
 *
 * ## The safety floor cannot be learned around, and not by a filter here
 *
 * There is deliberately no clause below excluding the hold for a passport.
 * `recommendBag` refuses to place a floor item anywhere but the cabin, and
 * `mustStayWithYou` is consulted again on every read — so a learned default
 * saying `checked` could not put one there even if Alex had somehow produced
 * three trips of evidence for it. A second, weaker copy of the floor here would
 * be a rule that has to be kept in step with the real one.
 */
export function bagProposals(
  rows: OverrideRow[],
  labelFor: (bag: string) => string,
  threshold: number = REMOVAL_THRESHOLD,
): OverrideProposal[] {
  return consistent(rows, threshold)
    .filter((row) => row.value !== row.current)
    .map((row) => ({
      subject: row.itemId,
      topic: `bag:${row.value}`,
      itemId: row.itemId,
      itemName: row.itemName,
      trips: row.trips,
      message: `You put ${row.itemName} in your ${labelFor(row.value).toLowerCase()} on ${row.trips} trips.`,
      effect: 'Suggest that bag from now on. A bag you choose on a trip still wins.',
      change: { kind: 'default_bag' as const, itemId: row.itemId, to: row.value },
    }))
    .sort(byStrength)
}

/* --- how many ------------------------------------------------------- */

export interface QuantityOverrideRow extends OverrideRow {
  /** The rule the correction would land on, or null when there is none. */
  ruleId: string | null
  /** What that rule says today, so a no-op is never proposed. */
  ruleQuantity: number | null
  /**
   * Whether the rule's answer depends on how long the trip is.
   *
   * The guard that makes this family honest. `per_day` and `per_night` produce a
   * different number for every trip, so "he set it to 7 on three trips" says
   * nothing about the rule — seven pairs of socks is a correction on a week and
   * a shortfall on a fortnight. Only a rule that answers the same number for
   * every trip can be corrected by a number.
   */
  scalesWithTrip: boolean
}

/**
 * "You lowered this quantity on 3 similar trips. Pack fewer next time?"
 *
 * Lands on the rule's `quantity_value`, written through `editRule` as a
 * `learned` override — the same mechanism `acceptRemovalProposal` already uses
 * to disable a rule without overwriting a seeded default. Reversible in Packing
 * rules, and distinguishable there from a rule Alex wrote himself.
 */
export function quantityProposals(
  rows: QuantityOverrideRow[],
  threshold: number = REMOVAL_THRESHOLD,
): OverrideProposal[] {
  return consistent(rows, threshold)
    .filter((row) => {
      // Nothing to write to. A quantity arriving from somewhere other than a
      // rule cannot be corrected by changing a rule.
      if (!row.ruleId) return false
      if (row.scalesWithTrip) return false
      const wanted = Number(row.value)
      if (!Number.isInteger(wanted) || wanted < 0) return false
      return wanted !== row.ruleQuantity
    })
    .map((row) => {
      const wanted = Number(row.value)
      const fewer = row.ruleQuantity !== null && wanted < row.ruleQuantity
      return {
        subject: row.ruleId!,
        topic: `amount:${wanted}`,
        itemId: row.itemId,
        itemName: row.itemName,
        trips: row.trips,
        message: fewer
          ? `You packed fewer ${row.itemName} than suggested on ${row.trips} trips — ${wanted} each time.`
          : `You packed more ${row.itemName} than suggested on ${row.trips} trips — ${wanted} each time.`,
        effect: `Make ${wanted} the usual amount. You can change it back in Packing rules.`,
        change: { kind: 'usual_amount' as const, ruleId: row.ruleId!, to: wanted },
      }
    })
    .sort(byStrength)
}

/* ------------------------------------------------------------------ */
/* what Alex has already said about a suggestion                       */
/* ------------------------------------------------------------------ */

/**
 * A decision about a SUGGESTION, as opposed to about a garment.
 *
 * `declined` is *no*: this exact suggestion stops being offered, and because the
 * topic carries the value, a later and different habit is still asked about
 * once. `not_sure` is *not now*: withdrawn until Alex asks for it back, which is
 * the same vocabulary and the same reversibility `closet_review_decision` uses.
 *
 * There is deliberately no `accepted`. Accepting writes the preference, and the
 * preference is then what the proposal is compared against — so an accepted
 * proposal stops being derived without anything having to remember that it was.
 * A stored `accepted` would be a second record of the same fact, free to drift.
 */
export type LearningDecision = 'declined' | 'not_sure'

export interface DecidedProposal {
  subject: string
  topic: string
  decision: LearningDecision
}

/**
 * Removes the suggestions Alex has already answered.
 *
 * `includeSetAside` is how *Not sure* comes back: the sheet's empty state offers
 * it, so a question put off is findable rather than lost — the same escape hatch
 * Review Closet Items has.
 */
export function undecided(
  proposals: OverrideProposal[],
  decisions: DecidedProposal[],
  includeSetAside = false,
): OverrideProposal[] {
  const said = new Map(decisions.map((d) => [`${d.subject} ${d.topic}`, d.decision]))
  return proposals.filter((proposal) => {
    const decision = said.get(`${proposal.subject} ${proposal.topic}`)
    if (decision === undefined) return true
    if (decision === 'not_sure') return includeSetAside
    return false
  })
}
