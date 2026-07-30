import type { Condition } from './rules'

/**
 * The one number in a rule that Alex might reasonably want to change.
 *
 * *"Add a Neck Pillow when any flight is at least 5 hours"* — the 5 is the part
 * worth editing, and the only part. Doc 09 §18 is explicit that this must not
 * become a generic rule builder exposing raw database fields, and a condition is
 * a recursive `all` / `any` / `not` tree: perfectly capable of expressing things
 * no sensible editor could show.
 *
 * So this is deliberately narrow. A rule has an editable threshold **only when
 * the whole condition contains exactly one numeric comparison.** One threshold,
 * one field, no ambiguity about which number moved. Anything else — two
 * comparisons, a nested `any`, a condition of a kind that has no number at all —
 * returns `null`, and the interface says the rule cannot be edited here rather
 * than guessing which number was meant.
 *
 * That is a smaller feature than "edit any rule", and it is the whole of the case
 * the brief actually names.
 */

/** The comparisons worth offering. `eq` and `contains` are not thresholds. */
const NUMERIC_OPERATORS = ['gt', 'gte', 'lt', 'lte'] as const

export type ThresholdOperator = (typeof NUMERIC_OPERATORS)[number]

export interface RuleThreshold {
  /** The trip fact being compared — `flight_hours`, `nights`, `trip_days`. */
  fact: string
  operator: ThresholdOperator
  value: number
}

function isLeaf(condition: Condition): condition is Extract<Condition, { fact: string }> {
  return 'fact' in condition
}

/** Every numeric comparison anywhere in the tree, in document order. */
function collect(condition: Condition, found: RuleThreshold[]): void {
  if ('all' in condition) {
    for (const child of condition.all) collect(child, found)
    return
  }
  if ('any' in condition) {
    for (const child of condition.any) collect(child, found)
    return
  }
  if ('not' in condition) {
    collect(condition.not, found)
    return
  }
  if (!isLeaf(condition)) return

  for (const operator of NUMERIC_OPERATORS) {
    const value = (condition as Record<string, unknown>)[operator]
    if (typeof value === 'number' && Number.isFinite(value)) {
      found.push({ fact: condition.fact, operator, value })
    }
  }
}

/**
 * The rule's threshold, or `null` when there is not exactly one.
 *
 * `null` for none (nothing to edit) and `null` for several (nothing unambiguous
 * to edit) on purpose: an editor that quietly changed the first of two
 * comparisons would be worse than one that declines.
 */
export function readThreshold(json: string | null): RuleThreshold | null {
  if (!json) return null
  try {
    const found: RuleThreshold[] = []
    collect(JSON.parse(json) as Condition, found)
    return found.length === 1 ? found[0]! : null
  } catch {
    return null
  }
}

/**
 * Rewrites the threshold, returning new condition JSON — or `null` if the rule
 * has no single threshold to rewrite.
 *
 * Rebuilt from the parsed tree rather than by string substitution, so a rule
 * whose stored JSON has an unexpected shape fails to parse and is refused
 * instead of being corrupted. The rest of the condition is preserved exactly:
 * this changes one number and nothing else.
 */
export function writeThreshold(json: string | null, value: number): string | null {
  const current = readThreshold(json)
  if (!current || !json) return null

  let replaced = false
  const rewrite = (condition: Condition): Condition => {
    if ('all' in condition) return { all: condition.all.map(rewrite) }
    if ('any' in condition) return { any: condition.any.map(rewrite) }
    if ('not' in condition) return { not: rewrite(condition.not) }
    if (!isLeaf(condition)) return condition

    if (condition.fact === current.fact && current.operator in condition) {
      replaced = true
      return { ...condition, [current.operator]: value }
    }
    return condition
  }

  const next = rewrite(JSON.parse(json) as Condition)
  return replaced ? JSON.stringify(next) : null
}

/**
 * How the threshold reads on screen, as a unit rather than a field name.
 *
 * `hours` for a flight, `nights` for a stay. Anything unrecognised gets no unit
 * at all rather than a guessed one — doc 09 §25 forbids confident language the
 * data does not support, and that applies to a noun as much as to a number.
 */
export function thresholdUnit(fact: string, value = 2): string | null {
  const plural = value !== 1
  if (fact === 'flight_hours') return plural ? 'hours' : 'hour'
  if (fact === 'nights') return plural ? 'nights' : 'night'
  if (fact === 'trip_days') return plural ? 'days' : 'day'
  return null
}
