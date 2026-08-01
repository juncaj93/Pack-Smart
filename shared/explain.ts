import type { Condition, PackingRule, RuleType } from './rules'
import { describeCondition } from './rules'

/**
 * Why a row is on the packing list, in Alex's words rather than the engine's.
 *
 * ## Why this is a separate module from the arithmetic
 *
 * `rules.ts` decides *how many*. This decides *what to say about it*. Keeping
 * them apart is not tidiness: the quantity is a contract pinned by the M4
 * expectations and by `rule-precedence.test.ts`, and copy changes must be
 * provably unable to move a number. Everything here reads the engine's own
 * result and returns a string; nothing here can change a quantity.
 *
 * ## The precedence, and why it is this order
 *
 * The most SPECIFIC honest fact wins, because a vaguer true sentence is still a
 * worse answer to "why is this here?":
 *
 *   1. **The calculation that produced the number** — `12 nights × 2`. When
 *      arithmetic decided the quantity, the arithmetic IS the reason.
 *   2. **The condition that let it on the trip** — `International trip`. No
 *      arithmetic, but a real, checkable fact about this trip.
 *   3. **A user's own words** — if Alex wrote the rule, his sentence is the
 *      best statement of his intent, and better than anything derived from it.
 *   4. **A system rule's own words**, but only if they survive `usableRuleText`.
 *   5. **The rule kind, stated plainly** — `One per trip`.
 *
 * ## Level 4 is almost always skipped, and that is a finding rather than a bug
 *
 * The brief for this slice assumed `originalText` "already stores useful
 * human-readable rule language". Measured against the real workbook, mostly it
 * does not. That column is `Default Priority / Quantity Rule`, and it holds
 * priority-tier shorthand:
 *
 * | Item | `originalText` |
 * |---|---|
 * | Phone, Wallet, ID, Toothbrush | `Critical (Always)` |
 * | Glasses, Deodorant, Toothpaste | `Always` |
 * | Rogaine, Hair Gel, Floss | `Usually` |
 * | Apple Watch | `Almost always` |
 * | Apple Watch Charger | `Explicit Item: Packed if Apple Watch is brought` |
 *
 * `Usually` is not an explanation — it is the tier that *produced* the rule.
 * `Critical (Always)` mixes a priority with a frequency. `Explicit Item:` is
 * importer vocabulary and would leak implementation terminology onto a row.
 * Surfacing these verbatim would have satisfied the letter of "surface
 * originalText" and delivered exactly the vague filler this slice forbids.
 *
 * So level 4 is gated by `usableRuleText`, and for the seeded catalog it
 * declines nearly every value — which is why the seeded rows land on level 5
 * and read `One per trip`. The level is kept, and kept above the fallback,
 * because a **user-written** rule's text is genuinely the best explanation of
 * itself, and that is the case level 3 exists for.
 *
 * ## What never appears
 *
 * No rule ids, no item ids, no column names, no rule-type identifiers, no fold
 * order, no condition JSON. `forbidsInternals` is the assertion, and
 * `explain.test.ts` runs it over every phrase this module can produce.
 */

/** How the row came to be on the list, for rows the engine did not generate. */
export type EntrySource =
  | 'always_packed'
  | 'trip_triggered'
  | 'outfit_generated'
  | 'user_added'
  | 'dependency_triggered'

/**
 * One rule's contribution to the quantity, as the fold saw it.
 *
 * `value` is what this rule alone asked for — before floors, spares and caps —
 * which is what makes "the rule that produced 20" answerable. A `fixed_per_trip`
 * of 3 alongside a `per_day` of 2 over ten days contributes 3 and 20; the
 * explanation has to name the second.
 */
export interface RuleContribution {
  rule: PackingRule
  value: number
  /** The arithmetic, when this kind of rule does any. */
  calculation: string | null
}

/** Everything the phrasing needs that is not on the rule itself. */
export interface ExplainContext {
  days: number
  nights: number
  /** Display names by item id, so a dependency can say what it depends on. */
  itemNames?: Record<string, string>
}

/* ------------------------------------------------------------------ */
/* the fifth level: a rule kind, stated plainly                        */
/* ------------------------------------------------------------------ */

/**
 * What a rule kind means, with no arithmetic to show for it.
 *
 * Deliberately covers every `RuleType`, so adding one to the engine without
 * deciding what it says on a row is a type error rather than a silent blank.
 */
function plainly(rule: PackingRule, context: ExplainContext): string {
  const value = rule.quantityValue ?? 1

  const phrases: Record<RuleType, () => string> = {
    fixed_per_trip: () => (value === 1 ? 'One per trip' : `At least ${value} per trip`),
    per_day: () => `${value} per day`,
    per_night: () => `${value} per night`,
    duration_plus_buffer: () => `${value} per day, plus spares`,
    per_activity_occurrence: () => describeActivity(rule.condition) ?? 'A planned activity',
    per_outfit_group: () => 'Needed by an outfit',
    minimum: () => `At least ${value}`,
    maximum: () => `No more than ${value}`,
    spare: () => (value === 1 ? 'One spare' : `${value} spares`),
    conditional_include: () =>
      rule.condition ? describeTrigger(rule.condition) : 'A fact about this trip',
    dependency_include: () => dependencyPhrase(rule, context),
  }

  return phrases[rule.ruleType]()
}

function dependencyPhrase(rule: PackingRule, context: ExplainContext): string {
  const name = rule.dependsOnItemId ? context.itemNames?.[rule.dependsOnItemId] : undefined
  // The item's own name, never its id — an id on a row would be exactly the
  // internal identifier this module exists to keep off the screen.
  return name ? `Because you are packing ${name}` : 'Because of something else you are packing'
}

function describeActivity(condition: Condition | null): string | null {
  if (!condition || !('contains' in condition)) return null
  return `${humanise(condition.contains)} on this trip`
}

/* ------------------------------------------------------------------ */
/* the second level: what a condition means on a row                   */
/* ------------------------------------------------------------------ */

/**
 * A condition as a row would say it.
 *
 * Separate from `describeCondition`, which the rules editor uses, because the
 * two are answering different questions. There, the sentence completes "pack
 * this when…" and reads `more than 5 hours flying`. Here it stands alone as the
 * whole answer to "why is this here?", where the same words read like a
 * fragment. `International trip` and `Any flight is at least 5 hours` are the
 * same facts in the register of the screen they appear on.
 *
 * Anything not worth a bespoke phrase falls through to `describeCondition`, so
 * the two can never disagree about a fact — only about how to say it.
 */
export function describeTrigger(condition: Condition): string {
  if ('all' in condition) return condition.all.map(describeTrigger).join(' and ')
  if ('any' in condition) return condition.any.map(describeTrigger).join(' or ')
  // `not` has no row-facing rephrasing worth inventing, and narrowing to the
  // leaf shapes below needs it gone anyway.
  if ('not' in condition) return capitalise(describeCondition(condition))

  if ('eq' in condition && typeof condition.eq === 'boolean') {
    if (condition.fact === 'international') {
      return condition.eq ? 'International trip' : 'Trip inside the country'
    }
    if (condition.fact === 'laundry_available') {
      return condition.eq ? 'Laundry where you are staying' : 'No laundry where you are staying'
    }
  }

  if ('contains' in condition) return `${humanise(condition.contains)} on this trip`

  if (condition.fact === 'flight_hours') {
    if ('gt' in condition) return `Flying more than ${condition.gt} hours`
    if ('gte' in condition) return `Any flight is at least ${condition.gte} hours`
  }

  if (condition.fact === 'nights') {
    if ('gt' in condition) return `More than ${condition.gt} nights away`
    if ('gte' in condition) return `${condition.gte} nights away or more`
  }

  if (condition.fact === 'trip_days') {
    if ('gt' in condition) return `Longer than ${condition.gt} days`
    if ('gte' in condition) return `${condition.gte} days or more`
  }

  return capitalise(describeCondition(condition))
}

/* ------------------------------------------------------------------ */
/* the fourth level: a rule's own words, if they are worth showing     */
/* ------------------------------------------------------------------ */

/**
 * Words that look like an explanation rather than like a spreadsheet cell.
 *
 * Returns null for anything that would read as filler, leak vocabulary, or
 * simply be too long for a row. See the module note: the seeded catalog's
 * `originalText` is priority shorthand, so this declines nearly all of it and
 * the row falls through to `plainly` — which is the better sentence anyway.
 */
export function usableRuleText(text: string | null | undefined): string | null {
  if (!text) return null

  let cleaned = text.replace(/\s+/g, ' ').trim()

  // Importer and spreadsheet vocabulary, stripped where it prefixes something
  // real and rejected where it is the whole value.
  cleaned = cleaned.replace(/^(explicit item|quantity rule|rule|note)\s*:\s*/i, '')
  cleaned = cleaned.replace(/^critical\s*[.:]\s*/i, '')
  cleaned = cleaned.replace(/[.\s]+$/, '')

  if (cleaned.length < 4 || cleaned.length > 72) return null

  // A priority tier or a frequency is not a reason. These are the actual
  // values in the seeded workbook, and `Usually` answers nothing.
  const TIERS = /^(critical|essential|important|optional)?\s*\(?\s*(always|usually|almost always|frequently|sometimes|rarely|never)\s*\)?$/i
  if (TIERS.test(cleaned)) return null

  // Anything that smells of the implementation rather than the trip.
  if (/[{}[\]<>|]|::|\b(null|undefined|json|sql|uuid|item_?id|rule_?id|rule_?type|_id)\b/i.test(cleaned)) {
    return null
  }
  // A bare identifier, or something that is mostly punctuation.
  if (/^[a-f0-9-]{8,}$/i.test(cleaned)) return null
  if (!/[a-z]{3}/i.test(cleaned)) return null

  return capitalise(cleaned)
}

/* ------------------------------------------------------------------ */
/* the whole precedence                                                */
/* ------------------------------------------------------------------ */

export interface ExplainInput {
  /** Every quantity rule that actually spoke, in the engine's fold order. */
  contributions: RuleContribution[]
  /** Conditions that fired to let the item onto the trip at all. */
  gates: PackingRule[]
  /** The base the fold settled on, before floors, spares and caps. */
  base: number | null
  context: ExplainContext
  /**
   * True when Alex set the quantity by hand, so the engine's arithmetic no
   * longer produces the number on the row.
   *
   * The explanation must agree with the quantity shown. `11 nights × 2` beside
   * a 7 is a sentence that contradicts the figure next to it, which is worse
   * than a vaguer reason — so level 1 is skipped and the row explains its
   * INCLUSION instead, which an override does not change.
   */
  quantityIsUsers?: boolean
}

/**
 * The one line a row shows, and the whole of C1.
 *
 * Two parts at most. The **primary** accounts for the number: it is the
 * contribution whose own value reached the base, so `2 per day` over ten days
 * beats a `fixed_per_trip` floor of 3 and the row says `10 days × 2` rather
 * than the misleading `At least 3 per trip`.
 *
 * The **secondary** is added only when it says something the primary does not:
 * the trip fact that let the item on at all. `12 nights × 2` explains the
 * quantity but not why contacts are on a trip; `International trip` alongside
 * it does. When the primary IS the gate, there is no second part, because
 * repeating it would be padding.
 *
 * Deterministic by construction: the contributions arrive in the engine's fold
 * order, which is sorted by rule type then id, so the same rules produce the
 * same sentence whatever order the database returned them in.
 */
export function explainQuantity({
  contributions,
  gates,
  base,
  context,
  quantityIsUsers = false,
}: ExplainInput): string | null {
  const primary = decidingContribution(contributions, base)
  /*
   * `plainly`, not `describeTrigger`, because a gate is not always a condition.
   *
   * A `dependency_include` rule carries no condition at all — it names another
   * item — so filtering gates down to the ones with conditions left the three
   * charger rows with nothing to say, which is how the audit's nineteen
   * unexplained rows became three rather than none on the first run. `plainly`
   * covers every rule kind by construction, so a gate can no longer be silent.
   */
  const gateReasons = gates.map((rule) => plainly(rule, context))

  const primaryPhrase = primary
    ? phraseFor(primary, context, quantityIsUsers)
    : (gateReasons[0] ?? null)

  if (!primaryPhrase) return null

  // The gate is only worth adding when the number came from somewhere else.
  const secondary = primary ? gateReasons.find((phrase) => phrase !== primaryPhrase) : undefined

  return secondary ? `${primaryPhrase} · ${secondary}` : primaryPhrase
}

/**
 * The rule that accounts for the final quantity.
 *
 * The greatest contribution, because the fold takes a maximum — and ties break
 * on fold order, which is already the array order, so the choice is total and
 * order-independent.
 */
function decidingContribution(
  contributions: RuleContribution[],
  base: number | null,
): RuleContribution | null {
  if (contributions.length === 0 || base === null) return null

  let best: RuleContribution | null = null
  for (const contribution of contributions) {
    if (!best || contribution.value > best.value) best = contribution
  }
  return best
}

/** Levels 1, 3, 4 and 5, applied to the rule that decided the number. */
function phraseFor(
  contribution: RuleContribution,
  context: ExplainContext,
  quantityIsUsers: boolean,
): string {
  /*
   * A hand-set quantity skips straight to the plain statement of the rule.
   *
   * Levels 1, 3 and 4 are all skipped together, and for one reason: each can
   * express a derivation. Level 1 obviously — `11 nights × 2`. But so can the
   * rule's own words, and in the real catalog they do: Contacts carries
   * `Quantity Rule: Nights × 2`. Beside a 7 that Alex typed, any of them invites
   * him to do the multiplication and wonder which number is wrong.
   *
   * `plainly` states the RULE as a rate — `2 per night` — which sits honestly
   * next to a total he chose himself. It describes what the app would do, not
   * what it did.
   */
  if (quantityIsUsers) return plainly(contribution.rule, context)

  // 1. The calculation, when this kind of rule did any.
  if (contribution.calculation) return capitalise(contribution.calculation)

  /*
   * 3 and 4. The rule's own words.
   *
   * One branch, not two, and the collapse is deliberate: `usableRuleText` is
   * the whole difference between the levels. A user's sentence survives it
   * because a person writing a rule writes a reason; the workbook's column is
   * priority shorthand and does not. Splitting them into separate branches
   * would have implied a distinction the gate already makes better.
   */
  const own = usableRuleText(contribution.rule.originalText)
  if (own) return own

  // 5. The kind, stated plainly.
  return plainly(contribution.rule, context)
}

/* ------------------------------------------------------------------ */
/* rows the engine did not generate                                    */
/* ------------------------------------------------------------------ */

/**
 * Why a row is here when no packing rule put it there.
 *
 * These are facts the database actually records, not guesses: a trip-only item
 * carries `trip_only`, an outfit's garment carries `outfit_generated`. Where
 * nothing is recorded this returns null and the row simply says nothing, which
 * is the honest outcome — inventing a system reason for something Alex added by
 * hand would be the product claiming a decision it did not make.
 */
export function explainEntrySource(entry: {
  source: string
  tripOnly: boolean
  reason: string | null
}): string | null {
  if (entry.reason) return entry.reason

  if (entry.source === 'user_added') return 'You added this for this trip'
  if (entry.source === 'outfit_generated') return 'Needed by one of your outfits'
  if (entry.tripOnly) return 'You added this for this trip'

  return null
}

/* ------------------------------------------------------------------ */

/**
 * The assertion the tests run over every phrase this module can produce.
 *
 * Exported because a guarantee that only exists inside a test file is a
 * guarantee the next contributor has to rediscover.
 */
export function forbidsInternals(phrase: string): boolean {
  return !/[{}[\]<>|]|::|\b(null|undefined|json|sql|uuid|item_?id|rule_?id|rule_?type|fixed_per_trip|per_day|per_night|duration_plus_buffer|per_activity_occurrence|per_outfit_group|conditional_include|dependency_include|supersedes|_id)\b/i.test(
    phrase,
  )
}

function humanise(tag: string): string {
  return tag.replace(/_/g, ' ')
}

function capitalise(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text
}
