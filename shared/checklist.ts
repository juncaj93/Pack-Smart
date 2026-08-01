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

/**
 * The one secondary line a checklist row shows, or null for a bare row.
 *
 * Shared and pure so the Worker, the tests and the screen agree about it, and
 * so the judgement below is somewhere it can be argued with rather than buried
 * in JSX.
 *
 * ## Why the reason is not on every row
 *
 * Every generated row HAS a reason as of C1 — that is the slice, and the ⋯
 * sheet shows it for all of them under *Why it is here*. Printing it on every
 * row is a different question, and the answer is no for one specific case.
 *
 * A row whose source is `always_packed` with a quantity of one reads
 * `One per trip`. The row already shows exactly one of the item and no
 * quantity, so that line restates what is on screen — and on the seeded catalog
 * it would repeat, word for word, down nineteen consecutive rows. Nineteen
 * identical lines is not explanation, it is wallpaper, and it is the "vague
 * filler" failure wearing a true sentence.
 *
 * Everything trip-specific DOES earn the row: `International trip`,
 * `Flying more than 5 hours`, `Because you are packing Apple Watch`,
 * `You added this for this trip`. Those differ per row and answer a question
 * Alex might actually be asking.
 *
 * The test is the model's own `source`, not a list of blessed phrases — copy
 * matching would silently stop working the first time a word changed.
 */
export function rowSecondaryLine(entry: ChecklistEntry): string | null {
  const parts: string[] = []

  if (entry.packedQty > 0 && entry.packedQty < entry.requiredQty) {
    parts.push(`${entry.packedQty} of ${entry.requiredQty} packed`)
  } else if (entry.requiredQty > 1) {
    parts.push(`${entry.requiredQty} needed`)
  }

  /*
   * The breakdown wins over the reason when both exist, and it is not a
   * ranking: for a counted row the arithmetic IS the reason, and printing
   * `12 nights × 2 = 24 · 12 nights × 2` would be the same fact twice.
   *
   * Except when Alex set the number himself. The stored breakdown is then the
   * arithmetic for a quantity that is no longer on the row — `7 needed ·
   * 11 nights × 2 = 22` is a line that argues with itself. His own figure needs
   * no derivation, so the row falls back to why the item is on the trip.
   */
  if (entry.qtyOverride === null && entry.qtyBreakdown) parts.push(entry.qtyBreakdown)
  else if (entry.reason && entry.source !== 'always_packed') parts.push(entry.reason)

  return parts.length > 0 ? parts.join(' · ') : null
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

/**
 * The cuts worth making across a packing list.
 *
 * Search answers "where is the thing I am thinking of". These answer the
 * question Alex actually has standing over an open suitcase — *what is left* —
 * which search cannot, because he does not know the names of the things he has
 * not packed yet.
 *
 * Five and no more. Every one of these is a question with a moment attached:
 * `Unpacked` is the whole of packing night, `Pack day of` is departure morning,
 * `Essentials` is the last look before the door. A filter without a moment is a
 * control to scroll past.
 */
export type ChecklistFilter = 'all' | 'unpacked' | 'packed' | 'day_of' | 'essentials'

export const CHECKLIST_FILTERS: Array<{ key: ChecklistFilter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'unpacked', label: 'Still to pack' },
  { key: 'packed', label: 'Packed' },
  { key: 'day_of', label: 'Pack day of' },
  { key: 'essentials', label: 'Essentials' },
]

/**
 * Applies one filter.
 *
 * **Not Bringing rows are excluded from every filter except `all`.** They are
 * not unpacked — they are not coming, and counting them as "still to pack" would
 * put the one number Alex reads under pressure permanently out by however many
 * things he has deliberately left behind.
 */
export function filterChecklist(
  entries: ChecklistEntry[],
  filter: ChecklistFilter,
): ChecklistEntry[] {
  if (filter === 'all') return entries

  const bringing = entries.filter((entry) => entry.excludedAt === null)
  switch (filter) {
    case 'unpacked':
      return bringing.filter((entry) => !isPacked(entry))
    case 'packed':
      return bringing.filter(isPacked)
    case 'day_of':
      // The same test `sectionFor` uses, so "Pack day of" and the Pack later
      // section can never disagree about which rows they mean.
      return bringing.filter((entry) => sectionFor(entry) === 'pack_later')
    case 'essentials':
      return bringing.filter((entry) => entry.isCritical)
    default:
      return entries
  }
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

/**
 * "14 of 24 packed" — never a bare percentage, which hides how much is left.
 *
 * Takes the two numbers it reads rather than the whole `ChecklistProgress`, so
 * the readiness model — which carries only those two — can label its own
 * progress without either reconstructing a shape it does not need or growing a
 * second copy of this sentence.
 */
export function progressLabel(progress: { packed: number; total: number }): string {
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
