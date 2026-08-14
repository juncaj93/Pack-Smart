import type { ItemTraits } from './bags'
import { greySpelling } from './items'
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
  /**
   * Who made it and which one it is — "Columbia · Black" (G6).
   *
   * The name says what a thing IS and no longer repeats the row's own brand and
   * colour, which means seven quarter-zips would otherwise be seven identical
   * rows. Snapshotted beside the name, so a finished trip reads the way it read
   * when it was packed, and null on every row written before G6 — see
   * `migrations/0018`.
   */
  detail: string | null
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
  /**
   * The seven bag-relevant facts, read LIVE from the catalog row (P3).
   *
   * Not a snapshot, unlike `name` and `category`: those record what Alex took,
   * this feeds a recommendation that is computed on read. Every field is
   * `null` when not recorded, and nothing may read that as a negative.
   * Absent on rows built before P3 and on trip-only rows, so it is optional.
   */
  traits?: ItemTraits
  /**
   * The bag Alex's own history has taught, or null (P4c, migration 0028).
   *
   * Joined live from the catalog row beside `traits`, and for the same reason:
   * accepting a proposal should improve every trip rather than the next one.
   * It is NOT a trait — the traits describe the object, and this describes a
   * habit — so it sits beside them rather than among them.
   *
   * `recommendBag` reads it after the safety floor and after the delayed-bag
   * set, and before every trait rule. An explicit per-trip choice still wins
   * over it, because that is `bagFor`'s first branch and this never reaches it.
   */
  learnedBag?: BagKey | null
  /**
   * When the server last wrote this row, in Unix seconds.
   *
   * The version a conditional write is made against (F2). A change queued on a
   * plane carries the value it saw; if the row has moved on since, the server
   * refuses rather than letting hours-old intent overwrite something newer.
   *
   * Deliberately the row's own `updated_at` rather than a counter: the column
   * already exists and every setter already maintains it, so nothing had to be
   * migrated and no second source of truth was created.
   */
  updatedAt: number
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
/**
 * How long the trip is, for deciding whether a count is surprising.
 *
 * Optional at every call site: without it `rowSecondaryParts` behaves exactly as
 * it did, which is what every caller that is not the packing list wants.
 */
export interface TripLength {
  days: number
  nights: number
}

/**
 * Whether this many is a number Alex would not have predicted (P4f).
 *
 * ## The problem this solves, and the one it must not recreate
 *
 * The arithmetic came off the row in V1.1 for a good reason: forty rows each
 * carrying `12 days × 1 + spare for 2 extra days = 14` turned the packing list
 * into a document, and the rows stopped being even enough to scan. Putting it
 * back on every row is not an option.
 *
 * But some numbers genuinely need a word. `24 needed` beside a pair of boxer
 * briefs on a twelve-night trip is arithmetic Alex cannot do at a glance, and
 * `5 needed` on the same trip is stranger still — it is the laundry rule, and
 * without a word it reads as a mistake. Doc 03 §12 wants the surprising ones
 * explained and the obvious ones left alone; this decides which is which.
 *
 * ## The test is the number, not the words
 *
 * A quantity is OBVIOUS when it is one of the three Alex would guess without
 * being told: **one** of the thing, **one per day**, or **one per night**.
 * Anything else — a spare, a floor, a cap, a laundry reduction, a second pair
 * for one activity, two a day for rotation — lands on a number he did not
 * predict, and that is exactly the set doc 03 §12 calls surprising.
 *
 * Deliberately derived from the COUNT rather than from the breakdown's wording.
 * `qty_breakdown_json` holds a rendered sentence rather than the structured
 * parts, so reading the shape of the arithmetic would mean matching our own
 * prose — and this file already has a note about how copy matching silently
 * stops working the first time a word changes.
 *
 * A quantity Alex set HIMSELF is never surprising to him. He chose it, and
 * `rowExplanationParts` already declines to show a breakdown that argues with
 * an override.
 */
export function quantityIsSurprising(entry: ChecklistEntry, trip: TripLength): boolean {
  if (entry.qtyOverride !== null) return false
  const quantity = entry.requiredQty
  if (quantity <= 1) return false
  return quantity !== trip.days && quantity !== trip.nights
}

export function rowSecondaryParts(entry: ChecklistEntry, trip?: TripLength): string[] {
  const parts: string[] = []

  /*
   * Which one of them this is, first (G6).
   *
   * The name stopped repeating the row's own brand and colour, and Alex owns
   * seven quarter-zips — so on a list this is what tells one row from the next,
   * and everything after it is a fact about a garment already identified.
   *
   * Null on every row written before G6, whose snapshotted name still contains
   * both words. Those rows read exactly as they always have.
   */
  /*
   * Respelled here as well as in `garmentDetail`, and not redundantly: this is
   * a SNAPSHOT, written when the row was created, so rows already on a trip
   * carry whatever the catalog said at the time. Mapping only at the point the
   * string is composed would leave every existing packing list saying `Gray`
   * while My Stuff beside it said `Grey`. Idempotent on a row written since.
   */
  if (entry.detail) parts.push(greySpelling(entry.detail))

  /*
   * The count is NOT here any more. It is in `rowQuantityLabel`, and it is on
   * the right-hand end of the row rather than on the line below the name.
   *
   * It was the commonest reason a row had a second line at all — most rows
   * carry no brand, no colour and no bag, so `5 needed` alone was making
   * forty-odd rows unequal in height for eight characters. A quantity is also
   * the one fact on the row that is a NUMBER against a fixed vocabulary, which
   * is what makes a right-hand column work for it and not for the rest: the
   * counts line up under each other and can be read as a column, while
   * `AG · Standard Blue` could not be.
   */

  /*
   * The derivation is NOT here any more. It is in `rowExplanationParts`, and it
   * is on the row's sheet.
   *
   * `12 days × 2 = 24` is the answer to "why that number", and doc 03 §8 is
   * right that it has to be answerable. It does not follow that it has to be
   * printed on every one of forty rows, permanently, in the screen's most
   * contested space — a checklist row carrying a full sentence of arithmetic is
   * taller than its neighbours, and forty of them turned the packing list into
   * a document rather than a list of things to tick (§16 of the V1.1 visual
   * pass). The row now says `24 needed`; the row's sheet says where the 24 came
   * from, under `Why this many`, which is where it already said it.
   *
   * Nothing deterministic was removed. The same two fields, chosen by the same
   * rule, one tap away instead of always on.
   */

  /*
   * The bag, when Alex has chosen one (doc 09 §11).
   *
   * On the existing secondary line rather than as a new control, because §11
   * asks for compact and doc 02 §2 keeps a forty-row list from growing a
   * permanent five-way widget per row. Tapping the row's ⋯ is where it changes.
   *
   * Only his OWN choice is shown. A recommendation on every document, pill and
   * charger would put "Personal bag" beside half the list and say nothing —
   * the suggestion is worth reading in the sheet, where it can explain itself,
   * and worth acting on in a bag filter, where it does real work.
   */
  if (entry.bag && entry.bagSource === 'user') parts.push(BAG_SHORT[entry.bag])

  /*
   * Why THIS many, on the rows where the number is not one Alex would guess
   * (P4f).
   *
   * Last, because it is the longest thing the line can carry and the least
   * likely to be what he is scanning for. Only when a caller passes the trip's
   * length — the packing list does; the departure screen and the bag lens do
   * not, because neither is a screen for asking "why that number".
   *
   * The sentence is `rowExplanationParts`, unchanged: the same field the sheet
   * shows under *Why this many*, chosen by the same rule. There is no second
   * wording here that could come to disagree with it, and nothing new is
   * computed — this only decides WHERE it is shown.
   */
  if (trip && quantityIsSurprising(entry, trip)) {
    parts.push(...rowExplanationParts(entry))
  }

  return parts
}

/**
 * How many, for the right-hand end of the row — or null when the row is a one.
 *
 * Split out of `rowSecondaryParts` so the count can sit beside the item instead
 * of under it. The two branches are exactly the ones it had there, in the same
 * order and with the same wording, so a row says the same thing it always said;
 * only where it says it has changed.
 *
 * Null rather than an empty string: most rows want ONE of something and have
 * nothing to report, and a row that renders `1` beside every toothbrush would
 * be a column of noise — the number is worth printing only where it is not the
 * number you would assume.
 */
export function rowQuantityLabel(entry: ChecklistEntry): string | null {
  if (entry.packedQty > 0 && entry.packedQty < entry.requiredQty) {
    return `${entry.packedQty} of ${entry.requiredQty} packed`
  }
  if (entry.requiredQty > 1) return `${entry.requiredQty} needed`
  return null
}

/**
 * Why the row says what it says — the part that moved off the list.
 *
 * Exactly the fields `rowSecondaryParts` used to end with, chosen by exactly
 * the same rule, so the sheet and the row cannot come to disagree about which
 * of the two applies:
 *
 * The breakdown wins over the reason when both exist, and it is not a ranking.
 * For a counted row the arithmetic IS the reason, and printing
 * `12 nights × 2 = 24 · 12 nights × 2` would be the same fact twice. Except
 * when Alex set the number himself: the stored breakdown is then the arithmetic
 * for a quantity that is no longer on the row — `7 needed · 11 nights × 2 = 22`
 * is a line that argues with itself — so it falls back to why the item is on
 * the trip at all.
 *
 * `EntrySheet` renders these two under their own labels and has since long
 * before this pass; this function exists so that the choice between them lives
 * in one place, and so a test can ask for the explanation a row is hiding.
 */
export function rowExplanationParts(entry: ChecklistEntry): string[] {
  if (entry.qtyOverride === null && entry.qtyBreakdown) return [entry.qtyBreakdown]
  if (entry.reason && entry.source !== 'always_packed') return [entry.reason]
  return []
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

/**
 * Which sections are the work right now, and which are waiting their turn (P4b).
 *
 * ## This is not a third timing model
 *
 * Nothing new is stored and no new vocabulary is invented. `packing_timing` is
 * still `anytime` or `day_of`, `sectionFor` still derives the four sections from
 * it, and this only says which of those four Alex can act on **today**. It is
 * presentation over an existing model, which is why it lives beside
 * `SECTION_LABELS` rather than beside the timing enum.
 *
 * ## The question the packing screen should answer
 *
 * *What do I physically pack next.* Before the day he leaves, that is **Pack
 * now** and nothing else: `Pack later` is by definition the things still in use
 * until the morning, and `Final check` is an act performed at the door — the
 * departure screen exists for both of them. Rendering all four expanded made the
 * screen a document of everything the trip involves, with the answer at the top
 * and three sections of not-yet underneath it. On the seeded trip `Final check`
 * alone is a dozen rows, every one of which is a second copy of a row above.
 *
 * Once departure is imminent they become the work, and they open. Nothing is
 * ever hidden: a waiting section keeps its heading, its count and one tap.
 */
export type SectionStage = 'now' | 'later' | 'shelf'

export function sectionStage(
  section: ChecklistSection,
  options: { departureImminent: boolean },
): SectionStage {
  // A shelf, never work. Nothing in it is packed or unpacked — it is where
  // things go when Alex has decided against them, and where he takes them back.
  if (section === 'not_bringing') return 'shelf'
  if (section === 'pack_now') return 'now'
  /*
   * `pack_later` and `final_check` are both departure-day acts, and they become
   * the work on the same day for the same reason. `isDepartureImminent` is what
   * decides when that is — the same function the `Before you go` button and the
   * readiness model already use, so the three cannot start disagreeing about
   * when the morning begins.
   */
  return options.departureImminent ? 'now' : 'later'
}

/**
 * Whether a section is the ONLY place its rows appear.
 *
 * Three of the four partition the list: a row is in `pack_now` or `pack_later`
 * or `not_bringing`, never two of them. `final_check` is different by design —
 * `groupChecklist` lists a row there IN ADDITION to its timing section, because
 * when to pack a passport and whether it made it into the bag are different
 * questions.
 *
 * That distinction decides one thing, and it is not cosmetic: a search must open
 * any section that could be HIDING a match, and `final_check` cannot hide one —
 * every row in it is also above. Opening it on a narrowed list would show the
 * same passport twice under `Still to pack`, which is a worse answer than a
 * closed heading.
 */
export function sectionIsSoleHome(section: ChecklistSection): boolean {
  return section !== 'final_check'
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

/*
 * The bag rules live in `shared/bags.ts` (P3) and are re-exported here.
 *
 * They moved because they stopped being a property of a checklist row: they now
 * read which bags the trip is bringing, whether there is a flight, and seven
 * facts about the item. Re-exported rather than relocated with a rename,
 * because a dozen call sites import them from here and a silent rename is a
 * worse change than a longer file.
 */
export { bagFor, recommendBag } from './bags'
import { bagFor } from './bags'

/**
 * Who decided.
 *
 * `recommended` is Pack Smart's deterministic suggestion and can be replaced by
 * a better rule in a later release. `user` is Alex, and is never overwritten by
 * anything — which is the whole reason these are two columns rather than one.
 */
export type BagSource = 'recommended' | 'user'

/**
 * "Either cabin bag", not "Either".
 *
 * `Either` on its own says nothing about which two, and it has to be told apart
 * from *unassigned* — which is also a row with no particular bag against it. It
 * means the personal bag or the carry-on, whichever has room, and the sheet
 * says that in a sentence when it is chosen rather than leaving the word to
 * carry it alone.
 */
export const BAG_LABELS: Record<BagKey, string> = {
  wear: 'Wearing it',
  personal_item: 'Personal bag',
  carry_on: 'Carry-on',
  checked: 'Checked bag',
  either: 'Either cabin bag',
}

/**
 * The order the choices are offered in, which is the order you pack in: what is
 * on you, then what stays with you, then the overhead bin, then the hold — and
 * "either" last, because it is the answer for a thing that does not care.
 */
export const BAG_ORDER: BagKey[] = ['wear', 'personal_item', 'carry_on', 'checked', 'either']

/**
 * What a chosen bag means, where the label alone cannot say it.
 *
 * Only `either` needs one: the other four name a physical place.
 */
/**
 * What Pack Smart means by each bag, in Alex's words rather than an airline's.
 *
 * The three carried bags are here for P3c and the reason is that the NAMES are
 * borrowed from aviation while the concept is not: "personal item" is airline
 * language for the thing under the seat, and on a train it is just the bag you
 * keep with you. Renaming them per trip would give the data model a second
 * vocabulary and the screens two words for one column; saying what each one
 * means costs a line and stays true on a drive.
 */
export const BAG_MEANING: Partial<Record<BagKey, string>> = {
  personal_item: 'The small bag you keep with you.',
  carry_on: 'The main bag you keep with you.',
  checked: 'A larger bag stored away from you.',
  either: 'The personal bag or the carry-on, whichever has room.',
}

/** Short, for a row. "Personal bag" is already short enough to say in full. */
/**
 * The same five, in a sentence.
 *
 * "All of it goes in your personal bag" — lower case and no article of its
 * own, because a chip's label and a clause of prose are not the same string,
 * and `Personal bag` mid-sentence reads like a proper noun. `Either cabin bag`
 * keeps its own wording because there is no shorter true way to say it.
 */
export const BAG_SENTENCE: Record<BagKey, string> = {
  wear: 'on you',
  personal_item: 'personal bag',
  carry_on: 'carry-on',
  checked: 'checked bag',
  either: 'personal bag or carry-on',
}

export const BAG_SHORT: Record<BagKey, string> = {
  wear: 'Wearing',
  personal_item: 'Personal bag',
  carry_on: 'Carry-on',
  checked: 'Checked',
  either: 'Either cabin bag',
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
/**
 * The cuts worth making across a packing list.
 *
 * Search answers "where is the thing I am thinking of". These answer the
 * question Alex actually has standing over an open suitcase — *what is left*,
 * and *what goes in the bag in front of me* — neither of which search can,
 * because he does not know the names of the things he has not packed yet.
 *
 * **Five, down from nine (G4).** Four were retired because the list already
 * answered their question somewhere better, and a filter without a moment is a
 * control to scroll past:
 *
 * - `Packed` is the inverse of *Still to pack*, on a list whose packed rows
 *   already sink to the bottom (D2).
 * - `Pack day of` is exactly the **Pack later** section — the same test — and
 *   `Before you go` is the screen for that moment.
 * - `Essentials` already sort to the top of every section and carry the
 *   `· Essential` marker.
 * - `Wearing it` is not a bag you pack. A bag filter answers *what goes in
 *   here*, and nothing goes in this one.
 *
 * `Either cabin bag` still has no filter of its own, and now has a second
 * reason: it appears under **both** cabin filters, because that is what it
 * means.
 */
export type ChecklistFilter =
  | 'all'
  | 'unpacked'
  | 'bag_personal_item'
  | 'bag_carry_on'
  | 'bag_checked'

export const CHECKLIST_FILTERS: Array<{ key: ChecklistFilter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'unpacked', label: 'Still to pack' },
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
 * The order the categories come in, essentials first and clothing last (G4).
 *
 * The shape of the list Alex asked for: the things that end the trip if they
 * are missing, then the things that make it uncomfortable, then the bulk. It is
 * also the order the bag fills in — documents and pills go in the small bag by
 * the door, clothes go in the big one at the end.
 *
 * The clothing block is head-to-toe rather than alphabetical, which is §6a's
 * *a stable order rather than alphabetical*: alphabetical puts
 * `Accessories & Undergarments` above `Tops & Outerwear` for no reason anyone
 * packing a bag would recognise.
 */
export const CATEGORY_ORDER: string[] = [
  'Documents',
  'Medication',
  'Medication Storage',
  'Vision',
  'Electronics',
  'Toiletries',
  'Grooming',
  'Travel Gear',
  'Tops & Outerwear',
  'Bottoms & Swimwear',
  'Accessories & Undergarments',
  'Footwear',
]

/** Where `Travel Gear` sits — and where anything unrecognised sits with it. */
const UNKNOWN_CATEGORY_RANK = CATEGORY_ORDER.indexOf('Travel Gear')

/**
 * How far down a section a category belongs.
 *
 * An unrecognised category — a custom one, or one a later import introduces —
 * lands **with Travel Gear**, ahead of the clothing block, rather than at either
 * end. At the top it would outrank a passport; at the bottom it would be buried
 * under twelve t-shirts. Ties among unknowns fall through to the arrival order,
 * which is `sort_order` then name, so they stay predictable rather than
 * arbitrary.
 */
export function categoryRank(entry: ChecklistEntry): number {
  const at = CATEGORY_ORDER.indexOf(entry.category)
  return at === -1 ? UNKNOWN_CATEGORY_RANK : at
}

/**
 * Orders one section's rows, stably.
 *
 * **Three keys, and the order of them is the design.**
 *
 * `orderRank` first, so D2's completed-to-bottom and the essentials-first band
 * are untouched: category grouping happens *within* a band and never across
 * one. A packed toothbrush does not climb over an unpacked t-shirt because
 * Toiletries outranks Tops.
 *
 * `categoryRank` second (G4), so a section reads as the order the bag fills in
 * rather than as whatever `sort_order` happened to be.
 *
 * **Stable last, on purpose.** Rows equal on both keep the order they arrived
 * in, which is `sort_order` then name — so checking one thing never reshuffles
 * anything else beside it, and the list Alex is reading stays the list he was
 * reading.
 */
export function orderSection(entries: ChecklistEntry[]): ChecklistEntry[] {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      rank: orderRank(entry),
      category: categoryRank(entry),
    }))
    .sort((a, b) => a.rank - b.rank || a.category - b.category || a.index - b.index)
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
  /**
   * Critical items still not fully packed.
   *
   * Intelligence, not a headline. This is what `essentialsUrgent` reads to
   * decide when "Pack the essentials" is the one recommended action, and what
   * the departure screen names at the door. What it is NOT is a standing alert
   * on the trip screen — see the note under `progressLabel`.
   */
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

/*
 * There is deliberately no `outstandingEssentialsLine` here any more, and the
 * absence is the rule rather than an omission.
 *
 * It built "10 essentials still to pack — Bite Guard, Deodorant and Glasses, and
 * 7 more." for a red panel at the top of the trip screen. Three things were
 * wrong with it at once: the rows it named are already sitting a few hundred
 * pixels below in Pack Now, sorted to the top for being essentials; it took the
 * most valuable strip of an iPhone screen to say so; and an unfinished packing
 * list is the NORMAL state of a trip Alex has not finished packing, which is not
 * an alert — it is the reason he opened the app.
 *
 * None of the intelligence went with it. `criticalOutstanding` above still
 * counts them, `essentialsUrgent` still decides when they become the one
 * recommended action, `orderRank` still floats them to the top of the list, and
 * the departure screen still names them at the door — because on the morning of
 * the flight an unpacked essential IS something wrong.
 *
 * Doc 09 §0q: persistent above-the-fold iPhone UI must earn its space.
 */
