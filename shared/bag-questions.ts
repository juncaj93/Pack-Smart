import {
  NO_TRAITS,
  bagFor,
  resilienceSet,
  type BagContext,
  type ItemTraits,
} from './bags'
import type { BagKey, ChecklistEntry } from './checklist'
import { slotFor } from './outfits'
import type { Item } from './items'

/**
 * When a bag question is worth asking — and the answer is almost never "because
 * the field is empty" (P3b).
 *
 * Every one of the seven traits is null on every row in the closet, so a queue
 * built by scanning for nulls would open on 119 garments times five questions.
 * That is the exact failure H1d was built to avoid, arriving through a new door:
 * not *this garment is unrated* but *this garment has no liquid status*, which
 * on a wardrobe of shirts is a question with no possible use.
 *
 * ## The rule, stated once
 *
 * **A question is asked only when its possible answers would put the item in
 * different bags, on a trip Alex is actually taking.**
 *
 * Not "the trait is missing". Not "the item is a toiletry". The gate SIMULATES
 * every answer through the real planner, against the real checklist row, on the
 * real trip — and asks only when the answers disagree with each other about
 * where the thing goes. If shampoo would land in the same place whether it is
 * full-size or not, there is nothing to learn and nothing is asked.
 *
 * The brief's five conditions are each an instance of that one rule rather than
 * five separate rules, and this is worth being precise about because it is what
 * keeps them honest:
 *
 * | brief | why the simulation already says it |
 * |---|---|
 * | liquids only when flying | `recommendBag` reads liquids only when `flying`, so on a drive every answer returns the same thing |
 * | fragility only where it changes cabin vs hold | `fragile` only fires when a cabin bag exists |
 * | transit need only where the recommendation is ambiguous | an item the floor already claims answers identically either way |
 * | delayed-bag only when a checked bag exists | `resilienceSet` returns empty without one |
 * | bulk only where it affects the bag choice | `bulky` only fires when a hold exists |
 *
 * A rule written twice is a rule that comes to disagree with itself. These are
 * written once, in `shared/bags.ts`, and read from here.
 *
 * ## What the simulation does NOT do
 *
 * It does not decide whether the question makes SENSE. Asking a T-shirt whether
 * it is a full-size liquid would change its recommendation — `liquid: true` is
 * a fact the planner would act on — and it is still an absurd question. So
 * plausibility is a separate, deliberately conservative gate, and it comes
 * first. Between them: the plausibility list says what could be true, and the
 * simulation says whether knowing would matter.
 */

export type BagQuestionKey = 'liquid' | 'fragile' | 'transit' | 'delay' | 'bulky'

/**
 * A trip that has not happened yet, and what is on its list.
 *
 * Live rather than all trips, because "would change a recommendation" is a
 * claim about advice Alex can still act on. A question whose answer would have
 * changed where something went on a trip he took in March is not a question, it
 * is a quiz.
 */
export interface LiveTrip {
  tripId: string
  tripName: string
  context: BagContext
  entries: ChecklistEntry[]
}

/** One tappable answer, and exactly what it records. */
export interface BagAnswer {
  label: string
  /** The traits this answer writes. Never more than the question asked about. */
  traits: Partial<ItemTraits>
}

export interface BagQuestion {
  key: BagQuestionKey
  /** The question, in Alex's words. */
  prompt: string
  /** Why it is being asked now. Names the trip, so it is never abstract. */
  because: string
  answers: BagAnswer[]
}

/**
 * How many bag questions one card may carry.
 *
 * H1d measured an ordinary review card at 2,700px — four screens — and cut it
 * back by asking only what the card actually asks about. Five bag questions
 * stacked under three ratings would put every pixel of that back. Two is what
 * fits above the fold beside a rating, and the third question is not lost: it
 * is asked on the next pass, once the first two stop qualifying.
 */
export const MAX_BAG_QUESTIONS = 2

/* ------------------------------------------------------------------ */
/* what could plausibly be true                                        */
/* ------------------------------------------------------------------ */

/**
 * Categories where the question is not absurd.
 *
 * Conservative on purpose. A category missing from one of these lists costs a
 * question that would have been useful; a category wrongly present costs Alex's
 * trust in the whole queue, and those two are not the same size of mistake.
 *
 * Clothing is absent from `liquid` and `fragile` because no garment is either,
 * and present in `transit` only through the layers rule below — a jumper for
 * the plane is a real case, a pair of socks is not.
 */
const PLAUSIBLE_CATEGORIES: Record<Exclude<BagQuestionKey, 'delay'>, ReadonlySet<string>> = {
  liquid: new Set(['Toiletries', 'Grooming', 'Medication']),
  fragile: new Set(['Toiletries', 'Grooming', 'Travel Gear', 'Electronics', 'Vision']),
  transit: new Set(['Toiletries', 'Grooming', 'Travel Gear', 'Electronics', 'Documents', 'Medication', 'Vision']),
  bulky: new Set(['Footwear', 'Tops & Outerwear', 'Travel Gear']),
}

/** The garment slots worth asking "will you want this on the way?" about. */
const TRANSIT_SLOTS = new Set(['outer', 'mid'])

function plausible(item: Item, key: BagQuestionKey): boolean {
  // `delay` has no category list: whether something is worth protecting from a
  // late bag depends on the trip, so its gate is the resilience set itself.
  if (key === 'delay') return true

  if (PLAUSIBLE_CATEGORIES[key].has(item.category)) return true

  if (key === 'transit' && item.kind === 'clothing') {
    const slot = slotFor(item)
    return slot !== null && TRANSIT_SLOTS.has(slot)
  }

  return false
}

/* ------------------------------------------------------------------ */
/* what is already known                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether the trait behind a question is still unrecorded.
 *
 * `liquid` needs both halves: a bottle recorded as a liquid whose SIZE is
 * unknown is the case the security queue cares about, and treating "we know it
 * is a liquid" as an answer would retire the question having learned the
 * useless half of it.
 */
function unanswered(traits: ItemTraits, key: BagQuestionKey): boolean {
  switch (key) {
    case 'liquid':
      return traits.liquid === null || (traits.liquid === true && traits.liquidSize === null)
    case 'fragile':
      return traits.fragile === null
    case 'transit':
      return traits.transitNeeded === null
    case 'delay':
      return traits.delaySensitive === null
    case 'bulky':
      return traits.bulky === null
  }
}

/* ------------------------------------------------------------------ */
/* the answers, and what each one records                              */
/* ------------------------------------------------------------------ */

/**
 * Every answer a question can be given, in the order they are shown.
 *
 * *Not sure* is deliberately absent: it is not an answer that records a trait,
 * it is a decision that withdraws the question, and it is handled by the same
 * `not_sure` path every other card in the queue already uses. Putting it here
 * would be a second mechanism for a thing that already has one.
 */
const ANSWERS: Record<BagQuestionKey, BagAnswer[]> = {
  liquid: [
    { label: 'Yes, full size', traits: { liquid: true, liquidSize: 'full' } },
    { label: 'No, travel size', traits: { liquid: true, liquidSize: 'cabin' } },
    { label: 'Not a liquid', traits: { liquid: false, liquidSize: null } },
  ],
  fragile: [
    { label: 'Yes', traits: { fragile: true } },
    { label: 'No', traits: { fragile: false } },
  ],
  transit: [
    { label: 'Yes', traits: { transitNeeded: true } },
    { label: 'No', traits: { transitNeeded: false } },
  ],
  delay: [
    { label: 'Yes', traits: { delaySensitive: true } },
    { label: 'No', traits: { delaySensitive: false } },
  ],
  bulky: [
    { label: 'Yes', traits: { bulky: true } },
    { label: 'No', traits: { bulky: false } },
  ],
}

const PROMPTS: Record<BagQuestionKey, string> = {
  liquid: 'Is this a full-size liquid?',
  fragile: 'Is this breakable?',
  transit: 'Do you need this with you while traveling?',
  delay: 'Would it be a major problem if your checked bag arrived a day late?',
  bulky: 'Is this bulky to pack?',
}

/**
 * The order questions are asked in when a card qualifies for several.
 *
 * Safety first, then space. `liquid` leads because its wrong answer has an
 * airport security queue at the end of it; `transit` and `delay` are about
 * being without something; `fragile` and `bulky` are about comfort and room.
 */
const QUESTION_ORDER: BagQuestionKey[] = ['liquid', 'transit', 'delay', 'fragile', 'bulky']

/* ------------------------------------------------------------------ */
/* the simulation                                                      */
/* ------------------------------------------------------------------ */

/** The trait reader for a trip, with one item's traits overridden. */
function withOverride(
  itemId: string,
  patch: Partial<ItemTraits>,
): (entry: ChecklistEntry) => ItemTraits {
  return (entry) => {
    const base = entry.traits ?? NO_TRAITS
    return entry.itemId === itemId ? { ...base, ...patch } : base
  }
}

/**
 * Where this item's rows would land on this trip, given one answer.
 *
 * The whole trip is replanned rather than the single row, because the answer
 * can move the resilience set — and a rule that reads its neighbours has to be
 * given them. Only THIS item's placements come back: an answer that shuffles
 * which of two identical vests is protected has not changed the advice Alex
 * reads about the thing he was asked about.
 */
function placements(trip: LiveTrip, itemId: string, patch: Partial<ItemTraits>): Array<BagKey | null> {
  const traitsOf = withOverride(itemId, patch)
  const resilience = resilienceSet(trip.entries, trip.context, traitsOf)

  return trip.entries
    .filter((entry) => entry.itemId === itemId && entry.excludedAt === null)
    .map((entry) => bagFor(entry, trip.context, traitsOf(entry), resilience).bag)
}

/**
 * Whether the possible answers actually disagree about where this goes.
 *
 * Compared to EACH OTHER rather than to the current unknown state, and that is
 * the correct comparison: Alex cannot answer "unknown". What matters is whether
 * the answers he CAN give lead anywhere different — if `full size` and `travel
 * size` and `not a liquid` all leave the bottle exactly where it is, the
 * question has nothing to teach and is not asked.
 */
function answersDisagree(item: Item, key: BagQuestionKey, trips: LiveTrip[]): boolean {
  for (const trip of trips) {
    const outcomes = new Set(
      ANSWERS[key].map((answer) => placements(trip, item.id, answer.traits).join('|')),
    )
    // One outcome means every answer agrees. Zero means the item is not on this
    // trip at all, which is not a disagreement either.
    if (outcomes.size > 1) return true
  }
  return false
}

/**
 * Whether the automatic rules are already protecting this from a late bag.
 *
 * `delay`'s plausibility gate, and it is a trip fact rather than a category
 * one. Asking is a CONFIRMATION — *we are keeping this out of the hold, is that
 * right?* — which bounds the question to the four rows the rules picked instead
 * of every garment on the list. Alex can still mark anything else himself in My
 * Stuff; the queue only asks where it already has an opinion to check.
 */
function alreadyProtected(item: Item, trips: LiveTrip[]): boolean {
  for (const trip of trips) {
    const chosen = resilienceSet(trip.entries, trip.context)
    for (const entry of trip.entries) {
      if (entry.itemId === item.id && chosen.has(entry.id)) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* the questions for one item                                          */
/* ------------------------------------------------------------------ */

/**
 * The bag questions worth asking about one item, highest value first.
 *
 * Empty for almost everything, which is the intended result: an item that is
 * not on any live trip's list produces nothing at all, so the queue is bounded
 * by what Alex is actually packing rather than by the size of his closet.
 */
export function bagQuestionsFor(
  item: Item,
  trips: LiveTrip[],
  traits: ItemTraits,
  /**
   * Questions Alex has already said he cannot answer.
   *
   * Applied INSIDE the loop rather than to the result, so a withdrawn question
   * does not consume one of the two slots and silently suppress the one queued
   * behind it. Filtering afterwards reads as equivalent and is not.
   */
  withdrawn: (key: BagQuestionKey) => boolean = () => false,
): BagQuestion[] {
  if (item.archivedAt !== null) return []
  if (trips.length === 0) return []

  const questions: BagQuestion[] = []

  for (const key of QUESTION_ORDER) {
    if (withdrawn(key)) continue
    if (!unanswered(traits, key)) continue
    if (!plausible(item, key)) continue
    if (key === 'delay' && !alreadyProtected(item, trips)) continue
    if (!answersDisagree(item, key, trips)) continue

    questions.push({
      key,
      prompt: PROMPTS[key],
      because: because(key, trips),
      answers: ANSWERS[key],
    })

    if (questions.length >= MAX_BAG_QUESTIONS) break
  }

  return questions
}

/**
 * The one sentence that says why this is being asked NOW.
 *
 * It names the trip, because that is the entire justification for interrupting
 * him: this is not closet admin, it is a decision Pack Smart is about to make
 * on a list he is looking at. A question that cannot name the trip should not
 * have passed the gate.
 */
function because(key: BagQuestionKey, trips: LiveTrip[]): string {
  const name = trips[0]?.tripName ?? 'your next trip'
  switch (key) {
    case 'liquid':
      return `You are flying on ${name}, and this decides whether it can go in your cabin bag.`
    case 'transit':
      return `This decides whether ${name} keeps it within reach or packs it away.`
    case 'delay':
      return `Pack Smart is keeping this out of the hold on ${name}.`
    case 'fragile':
      return `This decides whether ${name} keeps it with you or packs it below.`
    case 'bulky':
      return `This decides which bag it goes in on ${name}.`
  }
}

/**
 * The traits an item currently holds, read off the catalog row.
 *
 * The checklist carries a `traits` object because it joins them; the catalog
 * row carries the columns themselves. One reader rather than two spreads, so a
 * trait added later cannot be picked up in one place and forgotten in the other.
 */
export function traitsOfItem(item: Item): ItemTraits {
  return {
    liquid: item.isLiquid,
    liquidSize: item.liquidSize,
    fragile: item.isFragile,
    valuable: item.isValuable,
    medical: item.isMedical,
    transitNeeded: item.isTransitNeeded,
    bulky: item.isBulky,
    delaySensitive: item.isDelaySensitive,
  }
}
