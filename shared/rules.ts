/**
 * The deterministic packing-rules engine.
 *
 * Pure functions from (rules, trip facts, preferences) to quantities with a
 * human-readable derivation attached. No randomness, no heuristics, no
 * inference from prose — everything here is arithmetic over structured facts,
 * which is what makes the output explainable rather than merely confident.
 *
 * Two invariants govern the whole file:
 *
 *   1. A rule whose condition cannot be evaluated does NOT fire. It never
 *      guesses, never defaults to true, and never quietly includes an item
 *      (03_INTELLIGENCE_DESIGN.md §12).
 *   2. Every quantity carries the steps that produced it. `qtyBreakdown` IS the
 *      explanation shown to Alex — there is no second explanation path that can
 *      drift out of sync (02_DATA_MODEL.md §6).
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
}

/* ------------------------------------------------------------------ */
/* condition predicates                                                */
/* ------------------------------------------------------------------ */

export type Condition =
  | { fact: string; eq: unknown }
  | { fact: string; gt: number }
  | { fact: string; gte: number }
  | { fact: string; lt: number }
  | { fact: string; lte: number }
  | { fact: string; contains: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }

/**
 * Three-valued on purpose: true, false, or UNKNOWN.
 *
 * "Unknown" is the whole point. If the trip never recorded whether laundry is
 * available, a laundry-dependent rule must not fire *or* be actively excluded —
 * it simply has no answer, and the caller treats that as "do not include".
 * Collapsing unknown into false would be almost right; collapsing it into true
 * would pack things Alex never asked for.
 */
export type Truth = true | false | 'unknown'

export function evaluate(condition: Condition, facts: Record<string, unknown>): Truth {
  if ('all' in condition) {
    let sawUnknown = false
    for (const child of condition.all) {
      const result = evaluate(child, facts)
      if (result === false) return false
      if (result === 'unknown') sawUnknown = true
    }
    return sawUnknown ? 'unknown' : true
  }

  if ('any' in condition) {
    let sawUnknown = false
    for (const child of condition.any) {
      const result = evaluate(child, facts)
      if (result === true) return true
      if (result === 'unknown') sawUnknown = true
    }
    return sawUnknown ? 'unknown' : false
  }

  if ('not' in condition) {
    const result = evaluate(condition.not, facts)
    return result === 'unknown' ? 'unknown' : !result
  }

  const value = facts[condition.fact]
  if (value === undefined || value === null) return 'unknown'

  if ('eq' in condition) return value === condition.eq
  if ('contains' in condition) {
    return Array.isArray(value) ? value.includes(condition.contains) : 'unknown'
  }

  if (typeof value !== 'number') return 'unknown'
  if ('gt' in condition) return value > condition.gt
  if ('gte' in condition) return value >= condition.gte
  if ('lt' in condition) return value < condition.lt
  if ('lte' in condition) return value <= condition.lte

  return 'unknown'
}

/** Renders a condition as a sentence, for the explanation line. */
export function describeCondition(condition: Condition): string {
  if ('all' in condition) return condition.all.map(describeCondition).join(' and ')
  if ('any' in condition) return condition.any.map(describeCondition).join(' or ')
  if ('not' in condition) return `not ${describeCondition(condition.not)}`

  const name: Record<string, string> = {
    nights: 'nights',
    trip_days: 'days',
    international: 'international travel',
    flight_hours: 'hours flying',
    activities: 'activities',
    laundry_available: 'laundry',
  }
  const label = name[condition.fact] ?? condition.fact.replace(/_/g, ' ')

  if ('eq' in condition) {
    if (typeof condition.eq === 'boolean') return condition.eq ? label : `no ${label}`
    return `${label} is ${String(condition.eq)}`
  }
  if ('contains' in condition) return `${condition.contains.replace(/_/g, ' ')}`
  if ('gt' in condition) return `more than ${condition.gt} ${label}`
  if ('gte' in condition) return `${condition.gte} or more ${label}`
  if ('lt' in condition) return `fewer than ${condition.lt} ${label}`
  if ('lte' in condition) return `${condition.lte} or fewer ${label}`
  return label
}

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
  /** One concise line, or null when the item needs no explaining. */
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
}

function activityCount(facts: Record<string, unknown>, tag: string): number {
  const activities = facts.activities
  return Array.isArray(activities) && activities.includes(tag) ? 1 : 0
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
 */
export function computeQuantity(rules: PackingRule[], context: EngineContext): QuantityResult {
  const breakdown: BreakdownStep[] = []
  const reasons: string[] = []
  let base: number | null = null
  let minimum: number | null = null
  let maximum: number | null = null
  let spares = 0
  let source: ItemSource = 'always_packed'
  const incomplete = false

  const days = Number(context.facts.trip_days ?? 0)
  const nights = Number(context.facts.nights ?? 0)

  for (const rule of rules) {
    if (!rule.enabled) continue

    switch (rule.ruleType) {
      case 'conditional_include': {
        if (!rule.condition) break
        const result = evaluate(rule.condition, context.facts)
        if (result === true) {
          source = 'trip_triggered'
          reasons.push(describeCondition(rule.condition))
          if (base === null) base = rule.quantityValue ?? 1
        } else {
          // Both false and unknown mean "do not include". Unknown especially:
          // packing something because a fact was missing is exactly the
          // confident-but-unsupported behaviour this engine must not have.
          return {
            quantity: null,
            breakdown: [],
            source,
            reason: null,
            incomplete: result === 'unknown',
          }
        }
        break
      }

      case 'dependency_include': {
        if (!rule.dependsOnItemId || !context.includedItemIds.has(rule.dependsOnItemId)) {
          return { quantity: null, breakdown: [], source, reason: null, incomplete: false }
        }
        source = 'dependency_triggered'
        if (base === null) base = rule.quantityValue ?? 1
        break
      }

      case 'fixed_per_trip':
        base = rule.quantityValue ?? 1
        breakdown.push({ label: 'Always packed', value: base })
        break

      case 'per_day': {
        const per = rule.quantityValue ?? 1
        base = Math.max(base ?? 0, per * days)
        breakdown.push({ label: `${days} ${days === 1 ? 'day' : 'days'} × ${per}`, value: per * days })
        break
      }

      case 'per_night': {
        const per = rule.quantityValue ?? 1
        base = Math.max(base ?? 0, per * nights)
        breakdown.push({
          label: `${nights} ${nights === 1 ? 'night' : 'nights'} × ${per}`,
          value: per * nights,
        })
        break
      }

      case 'duration_plus_buffer': {
        const per = rule.quantityValue ?? 1
        const buffer = rule.buffer ?? 0
        const total = per * days + buffer
        base = Math.max(base ?? 0, total)
        breakdown.push({ label: `${days} days × ${per}`, value: per * days })
        breakdown.push({ label: `spare for ${buffer} extra ${buffer === 1 ? 'day' : 'days'}`, value: buffer })
        break
      }

      case 'per_activity_occurrence': {
        const tag =
          rule.condition && 'contains' in rule.condition ? rule.condition.contains : null
        if (!tag) break
        const occurrences = activityCount(context.facts, tag)
        if (occurrences === 0) {
          return { quantity: null, breakdown: [], source, reason: null, incomplete: false }
        }
        const per = rule.quantityValue ?? 1
        base = Math.max(base ?? 0, per * occurrences)
        breakdown.push({ label: `${tag.replace(/_/g, ' ')} × ${per}`, value: per * occurrences })
        break
      }

      case 'minimum':
        minimum = Math.max(minimum ?? 0, rule.quantityValue ?? 0)
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

  return {
    quantity: Math.max(0, Math.round(quantity)),
    breakdown,
    source,
    reason: reasons.length > 0 ? capitalise(reasons.join(' and ')) : null,
    incomplete,
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
