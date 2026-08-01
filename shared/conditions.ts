/**
 * Trip facts as structured conditions: the type, the three-valued evaluator,
 * and the sentence a condition reads as in the rules editor.
 *
 * Extracted from `rules.ts` in C1 so that `explain.ts` — which turns a rule
 * into the line a checklist row shows — can reuse the vocabulary without the
 * two modules importing each other. A cycle between the arithmetic and the copy
 * would work today and break the first time either is loaded in a different
 * order, which is not a debt worth taking for one import.
 *
 * `rules.ts` re-exports everything here, so nothing outside had to change.
 */

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
