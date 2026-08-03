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
  /** Which bag this goes in, or null while nothing has decided (doc 09 §11). */
  bag: BagKey | null
  /** Whether that was Pack Smart's suggestion or Alex's choice. */
  bagSource: BagSource | null
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
  const parts = rowSecondaryParts(entry)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * The same line, still in its separate facts.
 *
 * The screen needs the parts rather than the joined string, because `·` is not
 * spoken at VoiceOver's default punctuation level: joined, `3 of 5 packed` and
 * `12 nights × 2 = 24` fuse into one unpunctuated run with no pause anywhere.
 * The row renders the middot for the eye and a real comma for the ear.
 */
export function rowSecondaryParts(entry: ChecklistEntry): string[] {
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

  /*
   * The bag, when Alex has chosen one (doc 09 §11).
   *
   * On the existing secondary line rather than as a new control, because §11
   * asks for compact and doc 02 §2 keeps a forty-row list from growing a
   * permanent five-way widget per row. Tapping the row's ⋯ is where it changes.
   *
   * Only his OWN choice is shown. A recommendation on every document, pill and
   * charger would put "Personal item" beside half the list and say nothing —
   * the suggestion is worth reading in the sheet, where it can explain itself,
   * and worth acting on in a bag filter, where it does real work.
   */
  if (entry.bag && entry.bagSource === 'user') parts.push(BAG_SHORT[entry.bag])

  return parts
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

/* ------------------------------------------------------------------ */
/* which bag                                                           */
/* ------------------------------------------------------------------ */

/**
 * The five places a thing can be, from doc 09 §11.
 *
 * Five and no more, and deliberately not a luggage optimiser. The question this
 * answers is the one Alex has with one bag open in front of him — *does this go
 * in here* — and a sixth option is another decision to make rather than one
 * fewer.
 */
export type BagKey = 'wear' | 'personal_item' | 'carry_on' | 'checked' | 'either'

/**
 * Who decided.
 *
 * `recommended` is Pack Smart's deterministic suggestion and can be replaced by
 * a better rule in a later release. `user` is Alex, and is never overwritten by
 * anything — which is the whole reason these are two columns rather than one.
 */
export type BagSource = 'recommended' | 'user'

export const BAG_LABELS: Record<BagKey, string> = {
  wear: 'Wearing it',
  personal_item: 'Personal item',
  carry_on: 'Carry-on',
  checked: 'Checked bag',
  either: 'Either bag',
}

/**
 * The order the choices are offered in, which is the order you pack in: what is
 * on you, then what stays with you, then the overhead bin, then the hold — and
 * "either" last, because it is the answer for a thing that does not care.
 */
export const BAG_ORDER: BagKey[] = ['wear', 'personal_item', 'carry_on', 'checked', 'either']

/** Short, for a row. "Personal item" is already short enough to say in full. */
export const BAG_SHORT: Record<BagKey, string> = {
  wear: 'Wearing',
  personal_item: 'Personal item',
  carry_on: 'Carry-on',
  checked: 'Checked',
  either: 'Either',
}

/**
 * The categories that must stay within reach, and why.
 *
 * **Recommendations, not restrictions.** Nothing here is forced: doc 09 §11 asks
 * that a recommendation, a hard restriction and a user override be told apart,
 * and Pack Smart has no approved hard rule — so every one of these can be
 * overridden, and the sentence explains itself rather than asserting.
 *
 * Read from `category`, which is recorded catalog data. **Never from a brand or
 * a name.** "Rolex" is not evidence that something is valuable, and neither is
 * the word "passport" in a note Alex typed — the category is what the workbook
 * actually classified.
 */
const REACHABLE_CATEGORIES: Record<string, string> = {
  Documents: 'You need it before you reach the bag.',
  Medication: 'Medication stays with you — a checked bag can go astray.',
  Vision: 'You would not want to land without it.',
  Electronics: 'Batteries are not allowed in the hold, and you will want it on the flight.',
}

/**
 * What Pack Smart suggests for a row, or null when it has nothing to say.
 *
 * Deliberately quiet. A suggestion for every row is a screen full of advice, and
 * §11's list is short on purpose: the things that hurt to lose, and the things
 * you need before the bag is reachable. Everything else Alex knows better than
 * the app does, and an unrecommended row simply says nothing.
 *
 * Returns the reason with the bag, because a recommendation that cannot say why
 * is indistinguishable from a rule — and this is not a rule.
 */
export function recommendBag(entry: ChecklistEntry): { bag: BagKey; why: string } | null {
  const reachable = REACHABLE_CATEGORIES[entry.category]
  if (reachable) return { bag: 'personal_item', why: reachable }

  /*
   * A critical item Pack Smart cannot categorise still travels with him.
   *
   * `is_critical` is Alex's own flag on the catalog row, so this is his
   * judgement rather than an inference — and the fallback is the cautious
   * direction: within reach costs a little space, in the hold costs the trip.
   */
  if (entry.isCritical) {
    return { bag: 'personal_item', why: 'You marked this essential, so it travels with you.' }
  }

  return null
}

/**
 * The bag a row should show, and where that answer came from.
 *
 * An explicit choice always wins. A recommendation fills the gap when Alex has
 * not said — and it is computed rather than stored, so improving the rules
 * improves every existing trip without a migration and without touching a single
 * decision he made.
 */
export function bagFor(entry: ChecklistEntry): {
  bag: BagKey | null
  source: BagSource | null
  why: string | null
} {
  if (entry.bag && entry.bagSource === 'user') {
    return { bag: entry.bag, source: 'user', why: null }
  }

  const suggested = recommendBag(entry)
  if (suggested) return { bag: suggested.bag, source: 'recommended', why: suggested.why }

  // A stored recommendation from an earlier release whose rule has since gone.
  if (entry.bag) return { bag: entry.bag, source: entry.bagSource ?? 'recommended', why: null }

  return { bag: null, source: null, why: null }
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
export type ChecklistFilter =
  | 'all'
  | 'unpacked'
  | 'packed'
  | 'day_of'
  | 'essentials'
  | 'bag_wear'
  | 'bag_personal_item'
  | 'bag_carry_on'
  | 'bag_checked'

/**
 * The five that were always here, plus one per bag.
 *
 * The bag filters are what makes assignment worth anything: packing one physical
 * bag means seeing only what goes in it. Doc 09 §9 makes them conditional on bag
 * assignment existing, and it does now — so they are listed, and `Either bag`
 * deliberately has no filter of its own because a thing that does not care is
 * not a bag you are standing over.
 */
export const CHECKLIST_FILTERS: Array<{ key: ChecklistFilter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'unpacked', label: 'Still to pack' },
  { key: 'packed', label: 'Packed' },
  { key: 'day_of', label: 'Pack day of' },
  { key: 'essentials', label: 'Essentials' },
  { key: 'bag_wear', label: BAG_LABELS.wear },
  { key: 'bag_personal_item', label: BAG_LABELS.personal_item },
  { key: 'bag_carry_on', label: BAG_LABELS.carry_on },
  { key: 'bag_checked', label: BAG_LABELS.checked },
]

/** The bag a `bag_*` filter is about, or null for the other five. */
export function bagOfFilter(filter: ChecklistFilter): BagKey | null {
  if (!filter.startsWith('bag_')) return null
  const key = filter.slice(4) as BagKey
  return BAG_ORDER.includes(key) ? key : null
}

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
    default: {
      /*
       * A bag filter reads the RESOLVED bag, so a recommendation Alex has not
       * touched still shows up under the bag it recommends. Filtering on the
       * stored column alone would hide everything he has not personally
       * assigned, which is most of the list and is the opposite of useful.
       *
       * `Either` appears under both cabin bags, because that is what it means:
       * the answer to "does this go in here" is yes for either of them.
       */
      const wanted = bagOfFilter(filter)
      if (!wanted) return entries

      return bringing.filter((entry) => {
        const { bag } = bagFor(entry)
        if (bag === wanted) return true
        return bag === 'either' && (wanted === 'carry_on' || wanted === 'personal_item')
      })
    }
  }
}

/* ------------------------------------------------------------------ */
/* order within a section                                              */
/* ------------------------------------------------------------------ */

/**
 * How far down a section a row belongs. Lower sorts first.
 *
 * Doc 09 §4.2: unpacked essentials, then everything else unpacked, then what is
 * deliberately left for the day, then what is already packed. It is the order of
 * the question Alex is actually asking while he stands over the bag — *what is
 * left, and what of it matters* — and packed rows sink because they have been
 * answered, not because they stop mattering.
 *
 * A rank rather than a comparator so the reason for each row's position is one
 * readable number, and so "is this row above that one" is decidable without
 * running a sort.
 */
export function orderRank(entry: ChecklistEntry): number {
  if (isPacked(entry)) return 3
  // Pack later is a decision Alex made about WHEN, not a thing left undone
  // tonight — so it sits below tonight's work and above what is finished.
  if (sectionFor(entry) === 'pack_later') return 2
  return entry.isCritical ? 0 : 1
}

/**
 * Orders one section's rows, stably.
 *
 * **Stable on purpose.** Rows of equal rank keep the order they arrived in,
 * which is `sort_order` then name — so checking one thing never reshuffles
 * anything else in its band, and the list Alex is reading stays the list he was
 * reading.
 */
export function orderSection(entries: ChecklistEntry[]): ChecklistEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: orderRank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((held) => held.entry)
}

/**
 * Re-applies an order Alex is already looking at, appending anything new.
 *
 * The settle half of doc 09 §4.2. Reordering the instant a box is ticked makes
 * the row under his thumb jump away mid-tap, and doing it four times while he
 * works down a run of adjacent items turns the list into a slot machine. So the
 * screen holds a SNAPSHOT of the order and only recomputes it once the tapping
 * has stopped — this applies that snapshot to whatever the rows currently are.
 *
 * Anything not in the snapshot is new since it was taken and goes to the end of
 * its rank band rather than being dropped: a row that appears has to appear
 * somewhere, and somewhere predictable beats somewhere clever.
 */
export function applyOrder(entries: ChecklistEntry[], order: string[]): ChecklistEntry[] {
  if (order.length === 0) return orderSection(entries)

  const position = new Map(order.map((id, index) => [id, index]))
  const known = entries.filter((entry) => position.has(entry.id))
  const fresh = entries.filter((entry) => !position.has(entry.id))

  known.sort((a, b) => position.get(a.id)! - position.get(b.id)!)
  if (fresh.length === 0) return known

  return orderSection([...known, ...fresh])
    .map((entry) => entry)
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
