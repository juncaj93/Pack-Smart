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

/**
 * The rule a default was before Alex changed it.
 *
 * Carried alongside the override rather than looked up separately, so the row
 * can say what it changed FROM without a second request — and so "Use the
 * default" is never offered for a default nobody can find.
 */
export interface DefaultRule {
  id: string
  ruleType: string
  quantityValue: number | null
  buffer: number | null
  condition: string | null
  enabled: boolean
  originalText: string | null
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
  /** `system` came with Pack Smart, `user` is Alex's, `learned` is accepted advice. */
  source: string
  /** Only a rule Alex wrote from scratch. A default is turned off, not deleted. */
  canDelete: boolean
  /** The default this rule replaces, or null when it replaces none. */
  overridesDefault: DefaultRule | null
}

/**
 * An edit can move the conversation to a different row.
 *
 * The first change to a default answers with a rule that did not exist when the
 * list was drawn, so the response says which id the screen ASKED about as well
 * as what it got back. Without that the row would be updated by matching an id
 * that is no longer the one in force.
 */
export type RuleChange = PackingRule & { listedRuleId: string }

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

export function updateRuleThreshold(id: string, threshold: number): Promise<RuleChange> {
  return apiFetch<RuleChange>(`/api/settings/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ threshold }),
  })
}

export function updateRule(
  id: string,
  patch: { enabled?: boolean; quantityValue?: number },
): Promise<RuleChange> {
  return apiFetch<RuleChange>(`/api/settings/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** Writes a rule of Alex's own. It combines with the defaults; it replaces none. */
export function createRule(
  itemId: string,
  ruleType: string,
  quantityValue: number,
): Promise<PackingRule> {
  return apiFetch<PackingRule>('/api/settings/rules', {
    method: 'POST',
    body: JSON.stringify({ itemId, ruleType, quantityValue }),
  })
}

/** Removes a rule Alex wrote. Refused for anything that came with Pack Smart. */
export function deleteRule(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/settings/rules/${id}`, { method: 'DELETE' })
}

/** Drops the change and puts the original default back, exactly as it was. */
export function restoreDefault(id: string): Promise<RuleChange> {
  return apiFetch<RuleChange>(`/api/settings/rules/${id}/restore`, { method: 'POST' })
}

/**
 * Describes a stored rule in the words Alex would use.
 *
 * The rule types are an internal vocabulary; nothing on screen should say
 * "duration_plus_buffer". Doc 06 rules out developer-facing language.
 *
 * Takes the fields rather than the whole rule so the same sentence can describe
 * a default Alex has replaced. Two describers would drift, and the one that
 * drifted would be the one only shown on a row he had already changed.
 */
export function describeRule(rule: {
  ruleType: string
  quantityValue: number | null
  buffer?: number | null
  condition?: string | null
  dependsOnName?: string | null
  originalText?: string | null
}): string {
  const n = rule.quantityValue ?? 1

  switch (rule.ruleType) {
    case 'per_day':
      return `${n} per day`
    case 'per_night':
      return `${n} per night`
    case 'duration_plus_buffer':
      return `${n} per day, plus ${rule.buffer ?? 0} spare`
    /*
     * "At least", not "always packed", for anything above one.
     *
     * The engine treats `fixed_per_trip` as a floor rather than an assignment
     * now (11_RULE_PRECEDENCE.md §1.1), and a row reading "3, always packed"
     * beside a list that says 20 is the kind of quiet disagreement doc 09 §25
     * exists to prevent. At one they mean the same thing, and "Always packed"
     * is the friendlier of the two.
     */
    case 'fixed_per_trip':
      return n === 1 ? 'Always packed' : `At least ${n}, always packed`
    case 'conditional_include':
      return describeCondition(rule.condition ?? null)
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

/**
 * What Alex can add, in his words and the engine's.
 *
 * Four kinds. The per-day family lives in `Your usual amounts`, and the
 * conditional kinds are not authorable here — doc 09 §18 rules out a generic
 * builder over raw trip facts, and offering half of one would be worse.
 */
export const RULE_KINDS: Array<{ ruleType: string; label: string; help: string }> = [
  { ruleType: 'fixed_per_trip', label: 'Always pack', help: 'On every trip, at least this many.' },
  { ruleType: 'minimum', label: 'At least', help: 'Never fewer than this, whatever else applies.' },
  { ruleType: 'maximum', label: 'No more than', help: 'A ceiling, however long the trip is.' },
  { ruleType: 'spare', label: 'Spare', help: 'This many on top of everything else.' },
]

function describeCondition(json: string | null): string {
  if (!json) return 'Only in certain conditions'
  try {
    const condition = JSON.parse(json) as Record<string, unknown>
    if (condition.fact === 'international') return 'Only when leaving the country'
    if (condition.fact === 'nights' && typeof condition.gte === 'number') {
      // Pluralised, because the threshold is editable now and "1 nights" is
      // reachable in one tap rather than only by an unlucky import.
      return `Only on trips of ${condition.gte} ${condition.gte === 1 ? 'night' : 'nights'} or more`
    }
    if (condition.fact === 'flight_hours' && typeof condition.gt === 'number') {
      return `Only on flights over ${condition.gt} ${condition.gt === 1 ? 'hour' : 'hours'}`
    }
    if (condition.fact === 'activities' && typeof condition.contains === 'string') {
      return `Only for ${String(condition.contains).replace(/_/g, ' ')}`
    }
    return 'Only in certain conditions'
  } catch {
    return 'Only in certain conditions'
  }
}

/* ------------------------------------------------------------------ */
/* what Alex's own history suggests changing (product doc 04 §7)        */
/* ------------------------------------------------------------------ */

import type { ClosetGapInsight } from '@shared/closet-gaps'
import type { LearnedChange, OverrideProposal } from '@shared/learning'

export interface RemovalProposal {
  itemId: string
  itemName: string
  ruleId: string
  trips: number
  message: string
  effect: string
}

export interface Suggestions {
  /** Items taken off the list on several trips. */
  removals: RemovalProposal[]
  /** Items packed on several finished trips and never worn. */
  unworn: RemovalProposal[]
  /**
   * The same correction made trip after trip — a bag, a timing, a number (P4c).
   *
   * Separate from the two above because they are a different kind of evidence
   * and a different kind of answer. Those two watch an ABSENCE and their answer
   * is "stop adding it"; these watch a CORRECTION and their answer is "make
   * that the default", which is not a thing that can be said with one button.
   */
  corrections: OverrideProposal[]
  /**
   * Holes in the wardrobe that keep coming back (P4d).
   *
   * A third kind again, and it needs its own shape because there is nothing to
   * ACCEPT: the only thing that closes a wardrobe gap is owning something, which
   * is a fact about My Stuff rather than a preference to record. It can still be
   * disagreed with, through the same decision table as a correction.
   */
  closet: ClosetGapInsight[]
  /** Whether anything has been set aside, so the way back is worth offering. */
  setAside: boolean
}

export function fetchSuggestions(setAside = false): Promise<Suggestions> {
  return apiFetch<Suggestions>(
    `/api/settings/suggestions${setAside ? '?setAside=1' : ''}`,
  )
}

/** Accepting is the explicit act; reading the proposals changes nothing. */
export function acceptRemoval(ruleId: string): Promise<Suggestions & { disabled: boolean }> {
  return apiFetch<Suggestions & { disabled: boolean }>(
    `/api/settings/suggestions/removals/${ruleId}/accept`,
    { method: 'POST' },
  )
}

/**
 * Makes a repeated correction the default.
 *
 * The change is sent back rather than re-derived on the server, so what is
 * applied is exactly the proposal that was on screen when Alex tapped.
 */
export function acceptCorrection(change: LearnedChange): Promise<Suggestions> {
  return apiFetch<Suggestions>('/api/settings/suggestions/corrections/accept', {
    method: 'POST',
    body: JSON.stringify({ change }),
  })
}

/** No, or not now. The half that did not exist until P4c. */
export function decideCorrection(
  subject: string,
  topic: string,
  decision: 'declined' | 'not_sure',
): Promise<Suggestions> {
  return apiFetch<Suggestions>('/api/settings/suggestions/corrections/decide', {
    method: 'POST',
    body: JSON.stringify({ subject, topic, decision }),
  })
}

/** Brings back everything set aside. Declines are not touched. */
export function restoreSetAside(): Promise<Suggestions> {
  return apiFetch<Suggestions>('/api/settings/suggestions/corrections/restore', {
    method: 'POST',
  })
}
