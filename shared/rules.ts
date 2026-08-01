/**
 * The deterministic packing-rules engine.
 *
 * Pure functions from (rules, trip facts, preferences) to quantities with a
 * human-readable derivation attached. No randomness, no heuristics, no
 * inference from prose — everything here is arithmetic over structured facts,
 * which is what makes the output explainable rather than merely confident.
 *
 * Three invariants govern the whole file:
 *
 *   1. A rule whose condition cannot be evaluated does NOT fire. It never
 *      guesses, never defaults to true, and never quietly includes an item
 *      (03_INTELLIGENCE_DESIGN.md §12).
 *   2. Every quantity carries the steps that produced it. `qtyBreakdown` IS the
 *      explanation shown to Alex — there is no second explanation path that can
 *      drift out of sync (02_DATA_MODEL.md §6).
 *   3. The answer does not depend on the order the rules arrived in. Two rules
 *      for one item are two opinions, not a race, and a packing list whose
 *      quantity changes because a database returned its rows differently is not
 *      explainable (11_RULE_PRECEDENCE.md §1).
 */

export type RuleType =
  | 'fixed_per_trip'
  | 'per_day'
  | 'per_night'
  | 'per_activity_occurrence'
  | 'per_outfit_group'
  | 'minimum'
  | 'maximum'
  | 'spare'
  | 'duration_plus_buffer'
  | 'conditional_include'
  | 'dependency_include'

export type ItemSource =
  | 'always_packed'
  | 'trip_triggered'
  | 'outfit_generated'
  | 'user_added'
  | 'dependency_triggered'

/**
 * Who decided a rule.
 *
 * The distinction the schema could not make until migration 0011: "a user rule
 * beats a default for the same item" is unimplementable against rows that all
 * look alike. Additive and forward-only — `learned` is declared here and in the
 * database CHECK before anything writes it, so admitting a further source later
 * is a migration rather than a redesign.
 */
export const RULE_SOURCES = ['system', 'user', 'learned'] as const

export type RuleSource = (typeof RULE_SOURCES)[number]

/**
 * The kinds of rule Alex can write from scratch.
 *
 * Four, not eleven. `per_day` and `per_night` are absent because they already
 * have a friendlier door — `Your usual amounts`, which Settings describes as
 * "how much you pack per day" — and two screens that create the same row in the
 * same table is how they start disagreeing about what a duplicate is.
 *
 * The conditional kinds are absent for a different reason: authoring a
 * condition needs a vocabulary of trip facts on screen, and doc 09 §18 is
 * explicit that this must not become a generic rule builder over raw database
 * fields. The number inside an existing conditional rule is editable (PR #27);
 * writing a new one is not part of A4b.
 */
export const CREATABLE_RULE_TYPES = ['fixed_per_trip', 'minimum', 'maximum', 'spare'] as const

export type CreatableRuleType = (typeof CREATABLE_RULE_TYPES)[number]

export function isCreatableRuleType(value: unknown): value is CreatableRuleType {
  return typeof value === 'string' && (CREATABLE_RULE_TYPES as readonly string[]).includes(value)
}

export interface PackingRule {
  id: string
  itemId: string
  ruleType: RuleType
  quantityValue: number | null
  buffer: number | null
  condition: Condition | null
  dependsOnItemId: string | null
  enabled: boolean
  originalText: string | null
  /** Who decided it. Everything seeded or imported is `system`. */
  source: RuleSource
  /**
   * The system default this rule replaces, or null when it replaces nothing.
   *
   * The whole of the override mechanism. A rule that names a default REPLACES
   * it — which is what lets Alex ask for fewer than the default, and equally
   * what stops an unrelated rule from being read as a silent reduction: a rule
   * that supersedes nothing can only ever combine.
   */
  supersedesRuleId: string | null
}

/**
 * Drops every rule that another rule in the set explicitly replaces.
 *
 * Deliberately blind to `enabled` on the replacing rule. A DISABLED override is
 * how "turn this default off" is stored — the default is superseded by a
 * decision that contributes nothing — so skipping disabled rules here would
 * quietly resurrect the default it was written to switch off.
 *
 * Idempotent, so a caller that has already resolved a set can pass it through
 * `computeQuantity` without the resolution happening twice to different effect.
 */
export function applyPrecedence(rules: PackingRule[]): PackingRule[] {
  const superseded = new Set<string>()
  for (const rule of rules) {
    if (rule.supersedesRuleId) superseded.add(rule.supersedesRuleId)
  }
  if (superseded.size === 0) return rules
  return rules.filter((rule) => !superseded.has(rule.id))
}

/* ------------------------------------------------------------------ */
/* condition predicates                                                */
/* ------------------------------------------------------------------ */

export type { Condition, Truth } from './conditions'
export { describeCondition, evaluate } from './conditions'

import type { Condition } from './conditions'
import { describeCondition, evaluate } from './conditions'
import { explainQuantity, type RuleContribution } from './explain'

/* ------------------------------------------------------------------ */
/* quantities                                                          */
/* ------------------------------------------------------------------ */

export interface BreakdownStep {
  label: string
  value: number
}

export interface QuantityResult {
  /** Null means "this item should not be packed for this trip". */
  quantity: number | null
  breakdown: BreakdownStep[]
  source: ItemSource
  /**
   * Why this row is on the list, in one line.
   *
   * Non-null for every included row as of C1. It used to come only from a
   * firing condition, which left every `fixed_per_trip` row — nineteen of the
   * thirty-two on the worked example — saying nothing at all. `explain.ts`
   * owns the wording and the precedence; this field is where it lands.
   */
  reason: string | null
  /** True when a rule referenced something the trip does not know. */
  incomplete: boolean
}

export interface EngineContext {
  facts: Record<string, unknown>
  /** Item ids already included, for dependency rules. */
  includedItemIds: Set<string>
  /** Preference overrides keyed like `contacts_basis`. */
  preferences: Record<string, { per: string; multiplier: number }>
  /**
   * Display names by item id, so a dependency rule can name what it depends on.
   *
   * Optional because every caller that only wants a quantity should not have to
   * load the catalog to get one. Absent, a dependency row says "because of
   * something else you are packing" rather than naming it — vaguer, still true,
   * and never an item id on screen.
   */
  itemNames?: Record<string, string>
}

function activityCount(facts: Record<string, unknown>, tag: string): number {
  const activities = facts.activities
  return Array.isArray(activities) && activities.includes(tag) ? 1 : 0
}

/**
 * The order rules are folded in, which is NOT the order they arrive in.
 *
 * Sorting first is what makes the answer independent of however the database
 * happened to return the rows — including the explanation, which is assembled
 * as the fold proceeds and would otherwise read differently for the same
 * quantity. Within a type, the id breaks the tie, so the order is total.
 *
 * The sequence itself is the composition order doc 02 §6 already states: base
 * demand, then floors, then spares, then caps.
 */
const FOLD_ORDER: RuleType[] = [
  'fixed_per_trip',
  'per_day',
  'per_night',
  'duration_plus_buffer',
  'per_activity_occurrence',
  'per_outfit_group',
  'minimum',
  'spare',
  'maximum',
  'conditional_include',
  'dependency_include',
]

function inFoldOrder(rules: PackingRule[]): PackingRule[] {
  return [...rules].sort((a, b) => {
    const byType = FOLD_ORDER.indexOf(a.ruleType) - FOLD_ORDER.indexOf(b.ruleType)
    if (byType !== 0) return byType
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** What the gates decided, before any arithmetic happens. */
interface GateVerdict {
  /** True when some gate says this item does not belong on this trip. */
  blocked: boolean
  /** True when a gate could not be decided because a fact was never recorded. */
  incomplete: boolean
  source: ItemSource
  reasons: string[]
  /** The conditional rules that actually fired, for the explanation. */
  fired: PackingRule[]
  /** The quantity a firing gate implies, when no quantity rule produces one. */
  impliedBase: number | null
}

/**
 * Decides inclusion before deciding how many, over ALL the gates at once.
 *
 * Separated from the fold on purpose. Evaluating gates inline meant the first
 * failing gate returned immediately, so with two of them — one answering "no"
 * and one answering "the trip never said" — whether the row came back marked
 * incomplete depended on which rule the database listed first. The verdict is
 * the same either way now: a gate that cannot be decided marks the row, even if
 * another gate had already ruled the item out.
 */
function evaluateGates(rules: PackingRule[], context: EngineContext): GateVerdict {
  const verdict: GateVerdict = {
    blocked: false,
    incomplete: false,
    source: 'always_packed',
    reasons: [],
    fired: [],
    impliedBase: null,
  }

  for (const rule of rules) {
    if (!rule.enabled) continue

    if (rule.ruleType === 'conditional_include') {
      // A conditional rule with no stored condition gates nothing. It cannot
      // fire, so it also cannot veto — the alternative is an unreadable
      // condition silently emptying a packing list.
      if (!rule.condition) continue
      const result = evaluate(rule.condition, context.facts)
      if (result === true) {
        if (verdict.source === 'always_packed') verdict.source = 'trip_triggered'
        verdict.reasons.push(describeCondition(rule.condition))
        verdict.fired.push(rule)
        verdict.impliedBase = Math.max(verdict.impliedBase ?? 0, rule.quantityValue ?? 1)
      } else {
        // Both false and unknown mean "do not include". Unknown especially:
        // packing something because a fact was missing is exactly the
        // confident-but-unsupported behaviour this engine must not have.
        verdict.blocked = true
        if (result === 'unknown') verdict.incomplete = true
      }
      continue
    }

    if (rule.ruleType === 'dependency_include') {
      if (!rule.dependsOnItemId || !context.includedItemIds.has(rule.dependsOnItemId)) {
        verdict.blocked = true
        continue
      }
      verdict.source = 'dependency_triggered'
      verdict.fired.push(rule)
      verdict.impliedBase = Math.max(verdict.impliedBase ?? 0, rule.quantityValue ?? 1)
      continue
    }

    if (rule.ruleType === 'per_activity_occurrence') {
      const tag = rule.condition && 'contains' in rule.condition ? rule.condition.contains : null
      if (!tag) continue
      if (activityCount(context.facts, tag) === 0) verdict.blocked = true
    }
  }

  return verdict
}

/**
 * Applies every rule attached to one item and folds them into a single answer.
 *
 * Composition order is fixed (02_DATA_MODEL.md §6):
 *   base demand -> minimum floors -> spares -> maximum caps
 *
 * A `conditional_include` or `dependency_include` that does not fire vetoes the
 * item outright, because those rules express "only pack this when...", not
 * "prefer zero".
 *
 * Overrides are resolved first: a rule that names a system default replaces it
 * outright, which is the only way Alex can ask for FEWER of something than the
 * default without turning the default off. Everything that survives that
 * resolution still combines, so writing an unrelated rule can never reduce what
 * he packs (11_RULE_PRECEDENCE.md §3).
 */
export function computeQuantity(
  unresolved: PackingRule[],
  context: EngineContext,
  /**
   * Set when the row carries a hand-set quantity, so the explanation stops
   * offering arithmetic that no longer produces the number on screen. The
   * quantity returned here is unaffected — only what the row says about it.
   */
  options: { quantityIsUsers?: boolean } = {},
): QuantityResult {
  const rules = inFoldOrder(applyPrecedence(unresolved))

  const breakdown: BreakdownStep[] = []
  /*
   * What each rule asked for on its own, before floors, spares and caps.
   *
   * The fold takes a maximum, so the final base names exactly one rule — and
   * that is the rule the explanation has to credit. Without this the row could
   * only say "at least 3" for a quantity of 20, which is true of the floor and
   * misleading about the number beside it.
   */
  const contributions: RuleContribution[] = []
  let base: number | null = null
  let minimum: number | null = null
  let maximum: number | null = null
  let spares = 0

  const days = Number(context.facts.trip_days ?? 0)
  const nights = Number(context.facts.nights ?? 0)

  const gates = evaluateGates(rules, context)
  if (gates.blocked) {
    return {
      quantity: null,
      breakdown: [],
      source: gates.source,
      reason: null,
      incomplete: gates.incomplete,
    }
  }

  const source = gates.source
  const incomplete = false

  for (const rule of rules) {
    if (!rule.enabled) continue

    switch (rule.ruleType) {
      // Gates, already decided above. Listed rather than defaulted so a new
      // rule type cannot be silently ignored by both halves of this function.
      case 'conditional_include':
      case 'dependency_include':
        break

      /*
       * A floor, not an assignment — Alex's ruling, and the gap doc 11 §1.1
       * recorded.
       *
       * "Always pack 3" reads as "pack at least 3". It is not an instruction to
       * throw away a larger number another applicable rule worked out, which is
       * what assigning did: `per_day: 2` then `fixed_per_trip: 3` gave 3 on a
       * ten-day trip, and the same pair the other way round gave 20. If an exact
       * replacement quantity is ever wanted, it gets an explicit user-facing
       * mode rather than this one secretly depending on row order.
       */
      case 'fixed_per_trip': {
        const value = rule.quantityValue ?? 1
        base = Math.max(base ?? 0, value)
        breakdown.push({ label: value === 1 ? 'Always packed' : `at least ${value}`, value })
        contributions.push({ rule, value, calculation: null })
        break
      }

      case 'per_day': {
        const per = rule.quantityValue ?? 1
        const label = `${days} ${days === 1 ? 'day' : 'days'} × ${per}`
        base = Math.max(base ?? 0, per * days)
        breakdown.push({ label, value: per * days })
        contributions.push({ rule, value: per * days, calculation: label })
        break
      }

      case 'per_night': {
        const per = rule.quantityValue ?? 1
        const label = `${nights} ${nights === 1 ? 'night' : 'nights'} × ${per}`
        base = Math.max(base ?? 0, per * nights)
        breakdown.push({ label, value: per * nights })
        contributions.push({ rule, value: per * nights, calculation: label })
        break
      }

      case 'duration_plus_buffer': {
        const per = rule.quantityValue ?? 1
        const buffer = rule.buffer ?? 0
        const total = per * days + buffer
        base = Math.max(base ?? 0, total)
        breakdown.push({ label: `${days} days × ${per}`, value: per * days })
        breakdown.push({ label: `spare for ${buffer} extra ${buffer === 1 ? 'day' : 'days'}`, value: buffer })
        contributions.push({
          rule,
          value: total,
          calculation: `${days} days × ${per}, plus ${buffer} spare`,
        })
        break
      }

      case 'per_activity_occurrence': {
        const tag =
          rule.condition && 'contains' in rule.condition ? rule.condition.contains : null
        if (!tag) break
        // Zero occurrences already vetoed the item in `evaluateGates`, so
        // reaching here means the activity is on the trip.
        const occurrences = activityCount(context.facts, tag)
        const per = rule.quantityValue ?? 1
        base = Math.max(base ?? 0, per * occurrences)
        breakdown.push({ label: `${tag.replace(/_/g, ' ')} × ${per}`, value: per * occurrences })
        contributions.push({
          rule,
          value: per * occurrences,
          // One occurrence times one is not arithmetic worth showing; the
          // activity itself is the reason, and `plainly` says it better.
          calculation: per > 1 ? `${tag.replace(/_/g, ' ')} × ${per}` : null,
        })
        break
      }

      case 'minimum':
        minimum = Math.max(minimum ?? 0, rule.quantityValue ?? 0)
        // A floor is a contribution only when it is what the row ends up at,
        // which `decidingContribution` settles by comparing values.
        contributions.push({ rule, value: rule.quantityValue ?? 0, calculation: null })
        break

      case 'maximum':
        maximum = maximum === null ? (rule.quantityValue ?? 0) : Math.min(maximum, rule.quantityValue ?? 0)
        break

      case 'spare':
        spares += rule.quantityValue ?? 1
        break

      case 'per_outfit_group':
        // Filled in by the outfit engine, which knows how many groups exist.
        break
    }
  }

  /*
   * A gate that fired says "pack this", and on its own that is a quantity of
   * one. Applied only once the quantity rules have had their say, so a rule
   * that actually counts always decides — and so the outcome no longer depends
   * on whether the condition or the count was listed first.
   */
  if (base === null && gates.impliedBase !== null) base = gates.impliedBase

  if (base === null && minimum === null) {
    return { quantity: null, breakdown: [], source, reason: null, incomplete }
  }

  let quantity = base ?? 0

  if (minimum !== null && quantity < minimum) {
    breakdown.push({ label: `at least ${minimum}`, value: minimum })
    quantity = minimum
  }

  if (spares > 0) {
    breakdown.push({ label: `${spares} spare`, value: spares })
    quantity += spares
  }

  if (maximum !== null && quantity > maximum) {
    breakdown.push({ label: `capped at ${maximum}`, value: maximum })
    quantity = maximum
  }

  const settled = Math.max(0, Math.round(quantity))

  return {
    quantity: settled,
    breakdown,
    source,
    /*
     * The explanation is derived from the same fold that produced the number,
     * in the same call, so the two cannot drift — invariant 2 at the top of
     * this file, extended from the arithmetic to the sentence.
     *
     * `base ?? settled` because a row whose quantity came only from a floor has
     * no base, and the floor is then the contribution that accounts for it.
     */
    reason: explainQuantity({
      contributions,
      gates: gates.fired,
      base: base ?? settled,
      context: { days, nights, itemNames: context.itemNames },
      quantityIsUsers: options.quantityIsUsers,
    }),
    incomplete,
  }
}

/**
 * Renders the arithmetic as one line, e.g. "12 days × 2 = 24".
 *
 * Suppressed entirely for a plain quantity of 1 — doc 03 §12 is explicit that
 * obvious items should not be explained, and a row that justifies "Toothbrush:
 * 1" is noise that trains Alex to ignore the useful explanations.
 */
export function renderBreakdown(result: QuantityResult): string | null {
  if (result.quantity === null) return null
  if (result.breakdown.length === 0) return null
  if (result.quantity === 1 && result.breakdown.length === 1) return null

  const parts = result.breakdown.map((s) => s.label)
  return `${parts.join(' + ')} = ${result.quantity}`
}

/* ------------------------------------------------------------------ */
/* ordering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which checklist section a row belongs in.
 *
 * Derived, never stored. Storing both a timing and a section is the
 * two-sources-of-truth bug in miniature (02_DATA_MODEL.md §5).
 *
 * Final Check is deliberately shown IN ADDITION to a row's timing section, not
 * instead of it: packing timing and final verification are separate concepts
 * (product doc 03 §8).
 */
export type ChecklistSection = 'pack_now' | 'pack_later' | 'final_check' | 'not_bringing'

export function sectionFor(entry: {
  excludedAt: number | null
  packingTiming: string
  requiresFinalCheck: boolean
  finalCheckedAt: number | null
}): ChecklistSection {
  if (entry.excludedAt !== null) return 'not_bringing'
  // `last_minute` is gone from the vocabulary but may still sit in a stored row,
  // and it has always meant the same thing as `day_of` here. Reading it directly
  // rather than through `readTiming` keeps this function free of imports and
  // total over whatever the column happens to hold.
  if (entry.packingTiming === 'day_of' || entry.packingTiming === 'last_minute') return 'pack_later'
  return 'pack_now'
}

export function needsFinalCheck(entry: {
  excludedAt: number | null
  requiresFinalCheck: boolean
  finalCheckedAt: number | null
}): boolean {
  return entry.excludedAt === null && entry.requiresFinalCheck && entry.finalCheckedAt === null
}

/** Packed is derived from the quantities, so a tap and an edit cannot disagree. */
export function isPacked(entry: { packedQty: number; requiredQty: number }): boolean {
  return entry.requiredQty > 0 && entry.packedQty >= entry.requiredQty
}
