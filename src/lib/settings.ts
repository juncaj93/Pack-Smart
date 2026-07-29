import { apiFetch } from '@/lib/api'

/**
 * A "how many per day" amount.
 *
 * This is a packing rule seen from the friendly end. The number here is the
 * number the packing list uses — there is no separate preference behind it.
 */
export interface Amount {
  ruleId: string
  itemId: string
  itemName: string
  category: string
  ruleType: string
  multiplier: number
  buffer: number | null
  unit: string
}

export interface PackingRule {
  id: string
  itemId: string
  itemName: string
  ruleType: string
  quantityValue: number | null
  buffer: number | null
  condition: string | null
  dependsOnName: string | null
  enabled: boolean
  needsReview: boolean
  originalText: string | null
}

export function fetchAmounts(): Promise<{ amounts: Amount[] }> {
  return apiFetch<{ amounts: Amount[] }>('/api/settings/amounts')
}

export function saveAmount(ruleId: string, multiplier: number): Promise<Amount> {
  return apiFetch<Amount>(`/api/settings/amounts/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify({ multiplier }),
  })
}

export function addAmount(itemId: string, multiplier: number): Promise<Amount> {
  return apiFetch<Amount>('/api/settings/amounts', {
    method: 'POST',
    body: JSON.stringify({ itemId, multiplier }),
  })
}

export function removeAmount(ruleId: string): Promise<{ ruleId: string }> {
  return apiFetch<{ ruleId: string }>(`/api/settings/amounts/${ruleId}`, { method: 'DELETE' })
}

export function restoreAmount(ruleId: string): Promise<Amount> {
  return apiFetch<Amount>(`/api/settings/amounts/${ruleId}/restore`, { method: 'POST' })
}

export function fetchRules(): Promise<{ rules: PackingRule[] }> {
  return apiFetch<{ rules: PackingRule[] }>('/api/settings/rules')
}

export function updateRule(
  id: string,
  patch: { enabled?: boolean; quantityValue?: number },
): Promise<PackingRule> {
  return apiFetch<PackingRule>(`/api/settings/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * Describes a stored rule in the words Alex would use.
 *
 * The rule types are an internal vocabulary; nothing on screen should say
 * "duration_plus_buffer". Doc 06 rules out developer-facing language.
 */
export function describeRule(rule: PackingRule): string {
  const n = rule.quantityValue ?? 1

  switch (rule.ruleType) {
    case 'per_day':
      return `${n} per day`
    case 'per_night':
      return `${n} per night`
    case 'duration_plus_buffer':
      return `${n} per day, plus ${rule.buffer ?? 0} spare`
    case 'fixed_per_trip':
      return n === 1 ? 'Always packed' : `${n}, always packed`
    case 'conditional_include':
      return describeCondition(rule.condition)
    case 'dependency_include':
      return rule.dependsOnName
        ? `Only when you pack your ${rule.dependsOnName.toLowerCase()}`
        : 'Only alongside another item — which one is not set'
    case 'minimum':
      return `At least ${n}`
    case 'maximum':
      return `No more than ${n}`
    case 'spare':
      return `${n} spare`
    default:
      return rule.originalText ?? 'A packing rule'
  }
}

function describeCondition(json: string | null): string {
  if (!json) return 'Only in certain conditions'
  try {
    const condition = JSON.parse(json) as Record<string, unknown>
    if (condition.fact === 'international') return 'Only when leaving the country'
    if (condition.fact === 'nights' && typeof condition.gte === 'number') {
      return `Only on trips of ${condition.gte} nights or more`
    }
    if (condition.fact === 'flight_hours' && typeof condition.gt === 'number') {
      return `Only on flights over ${condition.gt} hours`
    }
    if (condition.fact === 'activities' && typeof condition.contains === 'string') {
      return `Only for ${String(condition.contains).replace(/_/g, ' ')}`
    }
    return 'Only in certain conditions'
  } catch {
    return 'Only in certain conditions'
  }
}
