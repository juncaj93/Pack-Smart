/**
 * Review Closet Items — which question is worth asking, and in what order
 * (H1d).
 *
 * The whole feature turns on one sentence from the brief: **do not ask
 * low-value questions merely because a field is empty.** A queue built by
 * scanning for nulls would open on 119 cards, every one of them worth the same,
 * and Alex would answer four and never come back. That is homework, and doc 09
 * §7 rules it out by name.
 *
 * So the queue is ordered by the VALUE OF THE ANSWER rather than by the
 * emptiness of the field, and the top four ranks are not properties of a
 * garment at all — they are evidence from Alex's own trips that an answer would
 * change something:
 *
 * | | Ask about this first | Because |
 * |---|---|---|
 * | 1 | he keeps packing it | a rating on a garment he actually travels with is a rating the planner keeps using |
 * | 2 | the ranker keeps tying | comfort is the criterion that would break the tie, and it is the one nothing can infer |
 * | 3 | he keeps choosing it himself | the planner is not offering what he wants, and the ratings are how he says why |
 * | 4 | he keeps taking it off | the same, in the other direction |
 *
 * Ranks 5–7 are the bare missing fields, which is the honest place for them:
 * worth asking when nothing better is left, and never worth interrupting a
 * higher-value question for.
 *
 * ## Nothing here touches a database
 *
 * Every input is a value — the wardrobe, three counts read from tables that
 * already exist, and the decisions Alex has already made. That keeps the
 * ordering a pure function, which is what lets each row of the table above be a
 * unit test rather than an integration one, exactly as `shared/provenance.ts`
 * and `shared/dressiness.ts` are.
 *
 * ## One card per garment, never three
 *
 * A garment can be all of: frequently packed, unrated, oddly named and a
 * possible duplicate. That is ONE card carrying every one of those, not four
 * appearances of the same shirt — "one focused item at a time" is the brief's
 * words, and a queue that shows the same thing repeatedly is the fastest way to
 * teach someone to stop trusting it.
 */

import { garmentDetail, type Item } from './items'
import { DRESSINESS_CONTEXT_LABELS, type DressinessContext } from './dressiness'
import { SOURCE_LABELS, SOURCE_RANK, type ProvenancedField, type ValueSource } from './provenance'
import { slotFor, versatilitySignal, type SlotRole } from './outfits'

/* ------------------------------------------------------------------ */
/* what makes a garment worth asking about                             */
/* ------------------------------------------------------------------ */

export type ReviewReason =
  /** Packed on trips he actually took. */
  | 'often_packed'
  /** The ranker cannot separate it from garments just like it. */
  | 'ties'
  /** He keeps picking it himself, over what was offered. */
  | 'swapped_in'
  /** He keeps taking it off the list. */
  | 'removed'
  | 'no_comfort'
  | 'no_versatility'
  | 'no_contexts'
  /** The name repeats fields the row already holds. */
  | 'repetitive_name'
  /** Two things share a name and nothing tells them apart. */
  | 'missing_detail'
  | 'possible_duplicate'
  /** A value the spreadsheet wanted and a confirmation refused. */
  | 'disagreement'

/**
 * The order, and the only place it is written down.
 *
 * Numbers rather than array positions, for the same reason `SOURCE_RANK` uses
 * them: a reason can be slotted between two existing ones without renumbering
 * anything that compares them.
 */
export const REASON_RANK: Record<ReviewReason, number> = {
  often_packed: 1,
  ties: 2,
  swapped_in: 3,
  removed: 4,
  no_comfort: 5,
  no_versatility: 6,
  no_contexts: 7,
  repetitive_name: 8,
  missing_detail: 9,
  possible_duplicate: 10,
  disagreement: 11,
}

/**
 * How many times counts as *frequently* and *repeatedly*.
 *
 * Two, and stated as a constant rather than inlined three times, because it is
 * a product judgement rather than an implementation detail: once is an
 * occasion, twice is a habit. Set it to 1 and every garment that has ever been
 * on a trip claims the top of the queue, which is the same failure as sorting
 * by emptiness with extra steps.
 */
export const REPEATEDLY = 2

/** What a card can ask Alex to fill in. Clothing only — see `ratingAsks`. */
export type RatingAsk = 'comfort' | 'versatility' | 'contexts'

/* ------------------------------------------------------------------ */
/* the durable decisions                                               */
/* ------------------------------------------------------------------ */

/**
 * The three answers that are not an edit.
 *
 * `answered` is Alex settling a question — *keep this name*, *keep both of
 * these*, *keep my value* — where the row itself does not change enough for the
 * card to stop qualifying. Without a record, `Keep as is` would be a button
 * that puts the same card back on screen.
 *
 * `not_sure` is "I cannot answer this", and it is honoured rather than nagged:
 * the topic leaves the queue until Alex asks for it back. The brief lists *Not
 * sure* beside *Skip* precisely because they are different, and treating them
 * the same is how a queue starts feeling like it is not listening.
 *
 * `skipped` is "not now". It does NOT remove the card — it moves it behind
 * everything unskipped, so a skipped question is always still reachable and
 * nothing is quietly lost.
 */
export type ReviewDecision = 'answered' | 'not_sure' | 'skipped'

/**
 * What a decision is ABOUT, as a string rather than an enum.
 *
 * `ratings`, `name`, `duplicate:<other item id>`, `disagreement:<field>`. The
 * last two carry their subject because *these two are the same garment* is a
 * statement about a PAIR — recording it against one id alone would suppress the
 * card for every other duplicate that garment has.
 */
export type ReviewTopic = string

export const TOPIC_RATINGS = 'ratings'
export const TOPIC_NAME = 'name'
export const duplicateTopic = (otherItemId: string) => `duplicate:${otherItemId}`
export const disagreementTopic = (field: ProvenancedField) => `disagreement:${field}`

export interface DecisionRow {
  itemId: string
  topic: ReviewTopic
  decision: ReviewDecision
}

/* ------------------------------------------------------------------ */
/* the card                                                            */
/* ------------------------------------------------------------------ */

/** A rename Pack Smart can justify from the row's own fields. Never a guess. */
export interface NameSuggestion {
  /** What the garment would be called. */
  displayName: string
  /** The words being taken out, in the order they appeared. */
  removed: string[]
  /** Where each of them already lives, for the explanation. */
  keptAs: string
}

export interface DuplicateCandidate {
  itemId: string
  displayName: string
  detail: string | null
  /** What each one has been packed on, so *keep this one* is an informed tap. */
  packedTrips: number
  otherPackedTrips: number
  why: string
}

/** One field the spreadsheet wanted and a confirmation would not give up. */
export interface Disagreement {
  field: ProvenancedField
  label: string
  /** What the row holds, in words. */
  mine: string
  /** What the spreadsheet said, in words. */
  theirs: string
  /** Who wrote the value Alex's confirmation replaced. */
  theirsSource: ValueSource
}

export interface ReviewCard {
  item: Item
  /** The highest-value reason that applies. Drives the order and the line. */
  reason: ReviewReason
  /** One sentence: why answering THIS is worth Alex's time. */
  why: string
  /** The ratings this card asks for. Empty when there is nothing to rate. */
  asks: RatingAsk[]
  nameSuggestion: NameSuggestion | null
  duplicate: DuplicateCandidate | null
  disagreements: Disagreement[]
  /** Skipped before, so it sits behind everything else rather than vanishing. */
  skipped: boolean
}

export interface ReviewSignals {
  /** Trips each item was actually packed on — `packedTripCounts`. */
  packedTrips: Record<string, number>
  /** Times Alex filled a slot with this himself (`outfit_slot.filled_by`). */
  manualSwaps: Record<string, number>
  /** Times a checklist row for this was taken off a trip. */
  removals: Record<string, number>
}

export interface ReviewInput {
  items: Item[]
  signals: ReviewSignals
  decisions: DecisionRow[]
}

export interface ReviewQueue {
  cards: ReviewCard[]
  /**
   * Topics Alex answered *Not sure* to, so the empty state can offer them back.
   *
   * A count rather than the cards themselves: the offer is "ask me again about
   * the 12 I was not sure about", and building 12 suppressed cards to render a
   * number nobody expands is work for nothing.
   */
  notSure: number
}

/* ------------------------------------------------------------------ */
/* building it                                                         */
/* ------------------------------------------------------------------ */

const EMPTY_SIGNALS: ReviewSignals = { packedTrips: {}, manualSwaps: {}, removals: {} }

export function buildReviewQueue(input: ReviewInput): ReviewQueue {
  const signals = { ...EMPTY_SIGNALS, ...input.signals }

  /*
   * Archived garments are not in the queue at all (doc 09 §7).
   *
   * They stay visible on the trips that used them — that rule is unchanged and
   * lives in `listActiveCandidates` — but asking Alex how comfortable something
   * he has retired is, is the definition of a low-value question.
   */
  const active = input.items.filter((item) => item.archivedAt === null)

  const settled = new Map<string, ReviewDecision>()
  for (const row of input.decisions) settled.set(`${row.itemId} ${row.topic}`, row.decision)
  const decisionFor = (itemId: string, topic: ReviewTopic) =>
    settled.get(`${itemId} ${topic}`) ?? null

  /**
   * **Only `answered` and `not_sure` withdraw a question.**
   *
   * `skipped` deliberately does not, and the first version of this got it
   * wrong: it treated ANY recorded decision as settled, so skipping a card
   * deleted it from the queue. That is the one thing Skip must never do —
   * *return later without losing progress* is the acceptance criterion, and a
   * skip that loses the question fails it while looking like it worked. The
   * ordering test below is what caught it, not review.
   */
  const withdrawn = (itemId: string, topic: ReviewTopic) => {
    const decision = decisionFor(itemId, topic)
    return decision === 'answered' || decision === 'not_sure'
  }

  const ties = tieGroups(active)
  const duplicates = duplicatePairs(active, signals)
  const sharedNames = nameCounts(active)

  const cards: ReviewCard[] = []

  for (const item of active) {
    const asks = withdrawn(item.id, TOPIC_RATINGS) ? [] : ratingAsks(item)
    const suggestion = withdrawn(item.id, TOPIC_NAME) ? null : suggestName(item)

    const duplicate = duplicates.get(item.id) ?? null
    const duplicateAsked =
      duplicate !== null && !withdrawn(item.id, duplicateTopic(duplicate.itemId))
        ? duplicate
        : null

    const disagreements = findDisagreements(item).filter(
      (d) => !withdrawn(item.id, disagreementTopic(d.field)),
    )

    const reason = pickReason({
      item,
      asks,
      signals,
      ties,
      sharedNames,
      suggestion,
      duplicate: duplicateAsked,
      disagreements,
    })
    if (reason === null) continue

    cards.push({
      item,
      reason,
      why: explain(reason, { item, signals, ties, sharedNames, suggestion, duplicate: duplicateAsked }),
      asks,
      nameSuggestion: suggestion,
      duplicate: duplicateAsked,
      disagreements,
      /*
       * Skipped is per-GARMENT rather than per-topic, because Skip means "not
       * this card". Recording it against `ratings` alone would put the same
       * garment straight back for its name a moment later, which is not what
       * anybody means by skip.
       */
      skipped:
        decisionFor(item.id, TOPIC_RATINGS) === 'skipped' ||
        decisionFor(item.id, TOPIC_NAME) === 'skipped',
    })
  }

  cards.sort(byValue)

  let notSure = 0
  for (const decision of settled.values()) if (decision === 'not_sure') notSure += 1

  return { cards, notSure }
}

/**
 * Skipped cards last, then by reason, then by the strength of the evidence,
 * then by id.
 *
 * The id tiebreak is not decoration. Without it two identically-placed cards
 * come back in whatever order the wardrobe query felt like, so reopening the
 * queue would reshuffle it and Alex would lose his place in a list he is trying
 * to work through — the same argument My Stuff's sort makes for falling back to
 * the name.
 */
function byValue(a: ReviewCard, b: ReviewCard): number {
  if (a.skipped !== b.skipped) return a.skipped ? 1 : -1
  const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason]
  if (rank !== 0) return rank
  return a.item.id.localeCompare(b.item.id)
}

/* ------------------------------------------------------------------ */
/* what a garment can be asked                                         */
/* ------------------------------------------------------------------ */

/**
 * Comfort, versatility and dressiness are questions about WEARING something.
 *
 * A passport has none of them, and asking would be the irrelevant-trait noise
 * doc 09 §7 rules out — the same restriction `ItemSheet` already applies to the
 * controls themselves. Gear reaches the queue only through its name, a
 * duplicate or a disagreement.
 */
export function ratingAsks(item: Item): RatingAsk[] {
  if (item.kind !== 'clothing') return []
  const asks: RatingAsk[] = []
  if (item.comfort === null) asks.push('comfort')
  if (item.versatility === null) asks.push('versatility')
  if (item.dressinessContexts.length === 0 || onlyEverGuessed(item)) asks.push('contexts')
  return asks
}

/**
 * A recorded set of contexts that nobody has actually confirmed.
 *
 * "Empty" is not the only state worth asking about here, and treating it as if
 * it were would have made this the weakest question in the queue. Migration
 * 0022 gave every imported garment the ONE context its guessed dressiness
 * meant, so almost nothing in Alex's wardrobe is empty — and almost none of it
 * is right either. An Oxford shirt filed as Smart casual is not a garment that
 * has been classified; it is a garment `inferDressiness` had a look at.
 *
 * Widening that guess is what H1c's multi-select exists for, so a set standing
 * at `inferred` or below is a question, and a set Alex confirmed is not. The
 * distinction is free: it is the provenance H1a already records.
 */
function onlyEverGuessed(item: Item): boolean {
  const source = item.fieldProvenance.dressinessContexts?.source ?? 'system_default'
  return SOURCE_RANK[source] <= SOURCE_RANK.inferred
}

/* ------------------------------------------------------------------ */
/* ties — rank 2, and the one that needed defining rather than counting */
/* ------------------------------------------------------------------ */

/**
 * Garments the ranker genuinely cannot separate.
 *
 * Not a guess at what "a tie" means: it is read off `CRITERIA` in
 * `shared/outfits.ts`. Two garments tie when every criterion ABOVE comfort that
 * is a property of the garment alone scores the same — the slot they fill,
 * their weather capabilities, how often Alex wears them, and their versatility
 * signal. The criteria that depend on the trip (`You asked for it`, `Already
 * packed for another day`) or on history (`You wear these together`) are not in
 * the key, because they score equally for both garments whenever they score at
 * all in this comparison.
 *
 * Where the contexts differ the garments compete for different occasions, so
 * they are not in the same group — which is what keeps this from flagging the
 * whole wardrobe.
 *
 * The value of the answer is then exact: `Comfortable to wear` is the very next
 * criterion, so a comfort rating on one of these garments is a rating that
 * changes an outcome. That is rank 2 earned rather than asserted.
 */
export function tieGroups(items: Item[]): Map<string, number> {
  const groups = new Map<string, string[]>()

  for (const item of items) {
    if (item.kind !== 'clothing') continue
    const role = slotFor(item)
    if (role === null) continue
    const key = [
      role,
      [...item.weatherTags].sort().join(','),
      item.usageFrequency,
      versatilitySignal(item),
      [...item.dressinessContexts].join(','),
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), item.id])
  }

  /** For each item, how many OTHERS it cannot be told apart from. */
  const rivals = new Map<string, number>()
  for (const members of groups.values()) {
    if (members.length < 2) continue
    for (const id of members) rivals.set(id, members.length - 1)
  }
  return rivals
}

/** The slot's name inside "cannot tell this from 4 other ___". */
const SLOT_PLURALS: Record<SlotRole, string> = {
  top: 'tops',
  mid: 'layers',
  outer: 'jackets',
  bottom: 'pairs of bottoms',
  footwear: 'pairs of shoes',
  accessory: 'accessories',
  swim: 'pieces of swimwear',
}

/* ------------------------------------------------------------------ */
/* names — rank 8, and never a rename Pack Smart invented              */
/* ------------------------------------------------------------------ */

/**
 * A name that repeats what the row already says beside it.
 *
 * The brief's example is real and from the workbook: `Various colors Pair of
 * Thieves boxer briefs`, where `brand` already holds *Pair of Thieves* and
 * `color` already holds *Various colors*. The suggestion is `Boxer briefs`, and
 * nothing was invented to produce it — the words removed are exactly the words
 * the row stores elsewhere.
 *
 * **This is the only kind of rename offered.** It never parses a name for
 * something that looks like a brand, never splits on capitalisation, never
 * guesses. That is G6's rule for wardrobe naming, unchanged: correct against
 * the row's structured data, never against a pattern. A garment Alex called
 * `The North Face Shirt Jacket` with no recorded brand is what he wrote, and it
 * stands.
 *
 * Returns null when nothing would change, when the removal would leave nothing,
 * or when the row simply does not repeat itself — which is the overwhelming
 * majority after `migrations/0018`.
 */
export function suggestName(item: Item): NameSuggestion | null {
  const fields: Array<{ value: string | null; where: string }> = [
    { value: item.color, where: 'Color' },
    { value: item.pattern, where: 'Pattern' },
    { value: item.brand, where: 'Brand' },
  ]

  let name = item.displayName
  const removed: string[] = []
  const keptAs: string[] = []

  for (const { value, where } of fields) {
    const needle = (value ?? '').trim()
    if (needle.length < 2) continue
    const stripped = removePhrase(name, needle)
    if (stripped === null) continue
    name = stripped
    removed.push(needle)
    keptAs.push(where)
  }

  const cleaned = squash(name)
  if (removed.length === 0 || cleaned.length === 0) return null
  if (cleaned.toLowerCase() === item.displayName.toLowerCase()) return null

  return {
    displayName: capitaliseFirst(cleaned),
    removed,
    keptAs: keptAs.join(' and '),
  }
}

/**
 * Removes one phrase from a name, on word boundaries, case-insensitively.
 *
 * Word boundaries matter more than they look: without them, a colour of `Red`
 * would turn `Shredded Denim` into `Shded Denim`. Returns null when the phrase
 * is not there as whole words, which is the common case and the one that has to
 * be cheap.
 */
function removePhrase(name: string, phrase: string): string | null {
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(phrase)}(?=\\s|$)`, 'i')
  if (!pattern.test(name)) return null
  return name.replace(pattern, ' ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function capitaliseFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** How many active items answer to each name, for the *tell them apart* case. */
function nameCounts(items: Item[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = item.displayName.trim().toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* duplicates — rank 10, deliberately quiet                            */
/* ------------------------------------------------------------------ */

/**
 * Two stored rows that might be one garment.
 *
 * The rule is `dedupe`'s tier 3, moved from import time to standing time: same
 * name, same brand, and colours that could be describing the same thing — one
 * missing, equal, or one containing the other. That last clause is the whole
 * reason this is not a cry-wolf list. A naive *same name and brand* rule flagged
 * 13 groups covering ~30 rows of the real workbook, and doc 09's own note on
 * risk R5 is blunt about what happens next: a review queue that cries wolf gets
 * clicked through blindly, which is functionally the same as auto-merging.
 *
 * Genuinely different colours are genuinely different garments, and no question
 * is asked about them.
 *
 * Each item points at ONE partner — its first by id — so a group of three
 * produces two questions asked one at a time rather than a card with a list on
 * it.
 */
export function duplicatePairs(
  items: Item[],
  signals: ReviewSignals,
): Map<string, DuplicateCandidate> {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const key = `${item.displayName.trim().toLowerCase()}|${(item.brand ?? '').trim().toLowerCase()}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const pairs = new Map<string, DuplicateCandidate>()

  for (const members of groups.values()) {
    if (members.length < 2) continue
    const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id))

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i]!
        const b = ordered[j]!
        if (!coloursAmbiguous(a, b)) continue
        if (!pairs.has(a.id)) pairs.set(a.id, candidate(a, b, signals))
        if (!pairs.has(b.id)) pairs.set(b.id, candidate(b, a, signals))
      }
    }
  }

  return pairs
}

function candidate(item: Item, other: Item, signals: ReviewSignals): DuplicateCandidate {
  return {
    itemId: other.id,
    displayName: other.displayName,
    detail: garmentDetail(other),
    packedTrips: signals.packedTrips[item.id] ?? 0,
    otherPackedTrips: signals.packedTrips[other.id] ?? 0,
    why: 'Same name and brand, and the colours overlap — this may be one thing or two.',
  }
}

function coloursAmbiguous(a: Item, b: Item): boolean {
  const left = (a.color ?? '').trim().toLowerCase()
  const right = (b.color ?? '').trim().toLowerCase()
  if (!left || !right) return true
  return left === right || left.includes(right) || right.includes(left)
}

/* ------------------------------------------------------------------ */
/* disagreements — rank 11, read straight out of provenance            */
/* ------------------------------------------------------------------ */

/**
 * A value Alex confirmed over one the spreadsheet gave, still in disagreement.
 *
 * This needs no new storage and no new mechanism, which is the point: H1a
 * already keeps one level of undo on every provenanced field — `was` and
 * `wasSource` — precisely so *use the value from my spreadsheet* can be offered
 * afterwards. A field sitting at `user_confirmed` whose `wasSource` is an
 * importer, holding a value different from what it replaced, IS the
 * disagreement. Reading it is subtraction, not a second ledger.
 *
 * The `refusedWrites` an import commit reports are the same fact arriving live;
 * this is that fact still true tomorrow.
 */
export function findDisagreements(item: Item): Disagreement[] {
  const out: Disagreement[] = []

  for (const [field, entry] of Object.entries(item.fieldProvenance)) {
    if (!entry) continue
    if (entry.source !== 'user_confirmed') continue
    if (entry.wasSource !== 'imported' && entry.wasSource !== 'inferred') continue
    if (entry.was === undefined) continue

    const mine = describeValue(field as ProvenancedField, currentValue(item, field as ProvenancedField))
    const theirs = describeValue(field as ProvenancedField, entry.was)
    if (mine === theirs) continue

    out.push({
      field: field as ProvenancedField,
      label: FIELD_LABELS[field as ProvenancedField] ?? field,
      mine,
      theirs,
      theirsSource: entry.wasSource,
    })
  }

  // Deterministic, so two reads of the same row put the same card on screen.
  return out.sort((a, b) => a.field.localeCompare(b.field))
}

const FIELD_LABELS: Partial<Record<ProvenancedField, string>> = {
  displayName: 'Name',
  category: 'Category',
  subcategory: 'Kind',
  color: 'Colour',
  pattern: 'Pattern',
  brand: 'Brand',
  notes: 'Notes',
  warmth: 'Warmth',
  dressiness: 'Dressiness',
  dressinessContexts: 'Where it works',
  typicalUses: 'What you use it for',
  ownedQuantity: 'How many you own',
  comfort: 'Comfort',
  versatility: 'Versatility',
}

function currentValue(item: Item, field: ProvenancedField): unknown {
  return (item as unknown as Record<string, unknown>)[field]
}

/** A stored value as Alex would read it, never as a column name or a number. */
export function describeValue(field: ProvenancedField, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'nothing'

  if (field === 'dressinessContexts' && Array.isArray(value)) {
    const labels = value
      .filter((v): v is DressinessContext => typeof v === 'string' && v in DRESSINESS_CONTEXT_LABELS)
      .map((v) => DRESSINESS_CONTEXT_LABELS[v])
    return labels.length === 0 ? 'nothing' : labels.join(' + ')
  }
  if (Array.isArray(value)) return value.length === 0 ? 'nothing' : value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/** "from your spreadsheet" / "worked out from your spreadsheet". */
export function sourceLabel(source: ValueSource): string {
  return SOURCE_LABELS[source]
}

/* ------------------------------------------------------------------ */
/* choosing the reason, and saying it                                  */
/* ------------------------------------------------------------------ */

interface ReasonContext {
  item: Item
  asks: RatingAsk[]
  signals: ReviewSignals
  ties: Map<string, number>
  sharedNames: Map<string, number>
  suggestion: NameSuggestion | null
  duplicate: DuplicateCandidate | null
  disagreements: Disagreement[]
}

/**
 * The highest-value reason that actually applies, or null for no card at all.
 *
 * The first four ranks require BOTH the evidence and something to ask: a
 * garment packed on nine trips with every rating already given is not a
 * question, it is a garment Alex has already told us about. Reading the
 * evidence alone would put the best-described things in his wardrobe at the top
 * of a queue that has nothing to ask them.
 */
function pickReason(context: ReasonContext): ReviewReason | null {
  const { item, asks, signals, ties, sharedNames, suggestion, duplicate, disagreements } = context
  const has = asks.length > 0

  if (has && (signals.packedTrips[item.id] ?? 0) >= REPEATEDLY) return 'often_packed'
  if (asks.includes('comfort') && (ties.get(item.id) ?? 0) > 0) return 'ties'
  if (has && (signals.manualSwaps[item.id] ?? 0) >= REPEATEDLY) return 'swapped_in'
  if (has && (signals.removals[item.id] ?? 0) >= REPEATEDLY) return 'removed'

  if (asks.includes('comfort')) return 'no_comfort'
  if (asks.includes('versatility')) return 'no_versatility'
  if (asks.includes('contexts')) return 'no_contexts'

  if (suggestion !== null) return 'repetitive_name'
  if (sharesNameWithoutDetail(item, sharedNames)) return 'missing_detail'
  if (duplicate !== null) return 'possible_duplicate'
  if (disagreements.length > 0) return 'disagreement'

  return null
}

function sharesNameWithoutDetail(item: Item, sharedNames: Map<string, number>): boolean {
  const count = sharedNames.get(item.displayName.trim().toLowerCase()) ?? 0
  return count > 1 && garmentDetail(item) === null
}

function explain(reason: ReviewReason, context: Omit<ReasonContext, 'asks' | 'disagreements'>): string {
  const { item, signals, ties, sharedNames, suggestion, duplicate } = context

  switch (reason) {
    case 'often_packed': {
      const trips = signals.packedTrips[item.id] ?? 0
      return `You have packed this on ${trips} ${trips === 1 ? 'trip' : 'trips'}.`
    }
    case 'ties': {
      const others = ties.get(item.id) ?? 0
      const role = slotFor(item)
      const noun = role ? SLOT_PLURALS[role] : 'things'
      return `Pack Smart cannot tell this from ${others} other ${others === 1 ? oneOf(noun) : noun} you own.`
    }
    case 'swapped_in': {
      const times = signals.manualSwaps[item.id] ?? 0
      return `You have chosen this yourself ${times} times, over what was suggested.`
    }
    case 'removed': {
      const times = signals.removals[item.id] ?? 0
      return `You have taken this off ${times} packing lists.`
    }
    case 'no_comfort':
      return 'Pack Smart has no idea how comfortable this is.'
    case 'no_versatility':
      return 'Pack Smart has no idea how many situations this suits.'
    case 'no_contexts':
      return 'Pack Smart has no idea where this is smart enough to wear.'
    case 'repetitive_name':
      return `The name repeats the ${(suggestion?.keptAs ?? '').toLowerCase()} already stored beside it.`
    case 'missing_detail': {
      const count = sharedNames.get(item.displayName.trim().toLowerCase()) ?? 0
      return `You own ${count} things called “${item.displayName}”, and nothing tells this one apart.`
    }
    case 'possible_duplicate':
      return duplicate?.why ?? 'This may already be in your closet twice.'
    case 'disagreement':
      return 'Your spreadsheet disagrees with something you confirmed.'
  }
}

/** "1 other pairs of shoes" is wrong; this is the singular of each plural. */
function oneOf(plural: string): string {
  const singulars: Record<string, string> = {
    tops: 'top',
    layers: 'layer',
    jackets: 'jacket',
    'pairs of bottoms': 'pair of bottoms',
    'pairs of shoes': 'pair of shoes',
    accessories: 'accessory',
    'pieces of swimwear': 'piece of swimwear',
    things: 'thing',
  }
  return singulars[plural] ?? plural
}
