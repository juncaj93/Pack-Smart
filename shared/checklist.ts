import type { ChecklistSection } from './rules'
import { isPacked, needsFinalCheck, sectionFor } from './rules'

/**
 * The checklist as both sides see it.
 *
 * Lives in `shared` because the sections, the packed test, and the final-check
 * test must give the same answer in the Worker and in the browser. Two
 * implementations of "is this packed?" is exactly how a checklist starts
 * disagreeing with itself.
 */

export interface ChecklistEntry {
  id: string
  tripId: string
  itemId: string | null
  name: string
  category: string
  /** Already resolved: an override wins over the derived quantity. */
  requiredQty: number
  qtyBreakdown: string | null
  qtyOverride: number | null
  packedQty: number
  packingTiming: string
  requiresFinalCheck: boolean
  finalCheckedAt: number | null
  excludedAt: number | null
  source: string
  reason: string | null
  isCritical: boolean
  tripOnly: boolean
  sortOrder: number
}

export const SECTION_LABELS: Record<ChecklistSection, string> = {
  pack_now: 'Pack now',
  pack_later: 'Pack later',
  final_check: 'Final check',
  not_bringing: 'Not bringing',
}

export const SECTION_HINTS: Record<ChecklistSection, string> = {
  pack_now: 'Everything that can go in the bag today.',
  pack_later: 'Still in use — pack these on the day.',
  final_check: 'Confirm these are actually in the bag before you leave.',
  not_bringing: 'Kept here so you can put anything back.',
}

export interface GroupedChecklist {
  packNow: ChecklistEntry[]
  packLater: ChecklistEntry[]
  finalCheck: ChecklistEntry[]
  notBringing: ChecklistEntry[]
}

/**
 * Splits a checklist into the four sections.
 *
 * Final Check is an *additional* appearance, not a move: a passport shows up
 * under Pack later AND under Final check, because when to pack it and whether
 * it made it into the bag are different questions (product doc 03 §8).
 */
export function groupChecklist(entries: ChecklistEntry[]): GroupedChecklist {
  const grouped: GroupedChecklist = { packNow: [], packLater: [], finalCheck: [], notBringing: [] }

  for (const entry of entries) {
    switch (sectionFor(entry)) {
      case 'not_bringing':
        grouped.notBringing.push(entry)
        break
      case 'pack_later':
        grouped.packLater.push(entry)
        break
      default:
        grouped.packNow.push(entry)
    }
    if (needsFinalCheck(entry)) grouped.finalCheck.push(entry)
  }

  return grouped
}

export interface ChecklistProgress {
  packed: number
  total: number
  /** Critical items still not fully packed. Drives the honest warning. */
  criticalOutstanding: ChecklistEntry[]
  finalCheckOutstanding: number
}

/**
 * Progress counts only what is actually being brought.
 *
 * Leaving Not Bringing rows in the denominator would make the bar stall at 90%
 * for the rest of the trip, which reads as a bug and erodes trust in the number.
 */
export function checklistProgress(entries: ChecklistEntry[]): ChecklistProgress {
  const bringing = entries.filter((e) => e.excludedAt === null)
  return {
    packed: bringing.filter(isPacked).length,
    total: bringing.length,
    criticalOutstanding: bringing.filter((e) => e.isCritical && !isPacked(e)),
    finalCheckOutstanding: bringing.filter(needsFinalCheck).length,
  }
}

/** "14 of 24 packed" — never a bare percentage, which hides how much is left. */
export function progressLabel(progress: ChecklistProgress): string {
  if (progress.total === 0) return 'Nothing to pack yet'
  return `${progress.packed} of ${progress.total} packed`
}

/**
 * "3 essentials still to pack — Passport, Phone and Wallet."
 *
 * Proportionate on purpose. The old line listed every outstanding essential, so
 * on day one of a trip it named eleven items in a red panel and read as an alarm
 * about nothing — the alarm fatigue doc 06 §3 rules out. Naming three and
 * counting the rest keeps it specific without shouting, and it shrinks to nothing
 * as Alex packs.
 *
 * Shared because Home and the trip screen must say the same thing; two
 * implementations of "what is still missing" is how they start disagreeing.
 */
export function outstandingEssentialsLine(entries: ChecklistEntry[]): string | null {
  const outstanding = checklistProgress(entries).criticalOutstanding
  if (outstanding.length === 0) return null

  const names = outstanding.slice(0, 3).map((entry) => entry.name)
  const rest = outstanding.length - names.length
  const listed =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  const noun = outstanding.length === 1 ? 'essential' : 'essentials'
  const tail = rest > 0 ? `${listed}, and ${rest} more` : listed
  return `${outstanding.length} ${noun} still to pack — ${tail}.`
}
