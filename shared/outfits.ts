import { DRESSINESS_LABELS, type Item } from './items'
import {
  acceptableContexts,
  fitsContexts,
  highestContext,
  levelOf,
} from './dressiness'
import { hasWeatherCapability, type ConditionDemand, type WeatherCapability } from './weather-fit'
import { activityFit, relevantUses } from './activity-fit'

/**
 * Outfit planning.
 *
 * Two stages, never one score (03_INTELLIGENCE_DESIGN.md §7). Hard filters
 * eliminate; scoring only orders what survived. A single weighted score is what
 * produces plausible-looking nonsense — a loungewear quarter-zip winning a nice
 * dinner because it scored well on a popularity signal — and filtering first makes
 * "specialised suitability may override popularity" structurally true rather
 * than an accident of weight tuning.
 *
 * A slot that cannot be filled is left EMPTY with a reason. It is never filled
 * with an approximation (doc 04 §15).
 */

export type SlotRole = 'top' | 'mid' | 'outer' | 'bottom' | 'footwear' | 'accessory' | 'swim'

export const SLOT_LABELS: Record<SlotRole, string> = {
  top: 'Top',
  mid: 'Layer',
  outer: 'Jacket',
  bottom: 'Bottoms',
  footwear: 'Shoes',
  accessory: 'Accessory',
  swim: 'Swimwear',
}

/**
 * Which slot a garment can fill, from its subcategory.
 *
 * Subcategory rather than category: "Tops & Outerwear" holds tees, shirts,
 * mid-layers and jackets, and a jacket standing in for a t-shirt would be
 * exactly the kind of confident wrong answer this system must not give.
 */
const SUBCATEGORY_SLOTS: Record<string, SlotRole> = {
  't-shirt': 'top',
  'tank top': 'top',
  shirt: 'top',
  'mid-layer': 'mid',
  outerwear: 'outer',
  pants: 'bottom',
  shorts: 'bottom',
  swimwear: 'swim',
  shoes: 'footwear',
  sandals: 'footwear',
  accessories: 'accessory',
  basics: 'accessory',
  underwear: 'accessory',
}

export function slotFor(item: Item): SlotRole | null {
  const key = (item.subcategory ?? '').trim().toLowerCase()
  return SUBCATEGORY_SLOTS[key] ?? null
}

/**
 * What a garment of each kind is called inside a sentence.
 *
 * `SLOT_LABELS` are headings — "Layer", "Jacket" — and reading one back in prose
 * gives "Jacket, not Layer", which is a field name with a comma in it. These
 * carry their own article so the sentence comes out in English.
 */
const SLOT_NOUNS: Record<SlotRole, string> = {
  top: 'a top',
  mid: 'a layer',
  outer: 'a jacket',
  bottom: 'bottoms',
  footwear: 'shoes',
  accessory: 'an accessory',
  swim: 'swimwear',
}

/**
 * Why a garment is not what usually goes in this slot (G3).
 *
 * `passesFilters` answers "wrong kind of garment", which is true and useless on
 * a screen — it does not say what the thing IS, and the whole point of reaching
 * past the slot filter is that Alex already knows he is picking something
 * unusual and wants to see it named. "A jacket, not a layer" is an answer.
 *
 * Deliberately the ONLY thing said about a garment from another slot. Running
 * the warmth and rain filters over it as well would be judging it against
 * conditions that apply to a slot it is not in — a jacket declined for not
 * keeping rain out, in a Layer slot where rain was never the question. Nothing
 * here invents a capability, and nothing here judges one that was not asked for.
 */
export function slotMismatch(itsRole: SlotRole | null, role: SlotRole): string {
  if (itsRole === null) return 'Pack Smart does not know where this one goes'
  const noun = SLOT_NOUNS[itsRole]
  return `${noun[0]!.toUpperCase()}${noun.slice(1)}, not ${SLOT_NOUNS[role]}`
}

/* ------------------------------------------------------------------ */
/* outfit groups                                                       */
/* ------------------------------------------------------------------ */

export interface SlotSpec {
  role: SlotRole
  required: boolean
}

export interface OutfitTemplate {
  /** Matches a trip activity tag, or null for the everyday group. */
  activityTag: string | null
  name: string
  slots: SlotSpec[]
  /** Inclusive dressiness band this group will accept. */
  dressiness: [number, number]
  /** Typical-use tags a garment may carry to qualify. Empty = no constraint. */
  uses: string[]
  /** How constrained this group is; the most constrained are assigned first. */
  specificity: number
}

const STANDARD: SlotSpec[] = [
  { role: 'top', required: true },
  { role: 'bottom', required: true },
  { role: 'footwear', required: true },
]

/**
 * The outfit groups Pack Smart knows how to plan.
 *
 * Grouped by activity rather than one per calendar day, per doc 04 §2 — twelve
 * near-identical "Day 7" cards is busywork, not planning.
 */
export const OUTFIT_TEMPLATES: OutfitTemplate[] = [
  {
    activityTag: 'wedding',
    name: 'Wedding',
    slots: [...STANDARD, { role: 'mid', required: false }],
    dressiness: [3, 4],
    uses: ['dressy'],
    specificity: 6,
  },
  {
    activityTag: 'business',
    name: 'Business',
    slots: [...STANDARD, { role: 'mid', required: false }],
    dressiness: [2, 4],
    uses: ['work', 'dressy'],
    specificity: 5,
  },
  {
    activityTag: 'nice_dinner',
    name: 'Nice dinners',
    slots: [...STANDARD, { role: 'mid', required: false }],
    dressiness: [2, 4],
    uses: ['dressy'],
    specificity: 5,
  },
  {
    activityTag: 'safari',
    name: 'Safari',
    slots: [...STANDARD, { role: 'outer', required: false }],
    dressiness: [0, 2],
    uses: ['casual', 'athletic', 'travel'],
    specificity: 4,
  },
  {
    activityTag: 'hiking',
    name: 'Hiking',
    slots: [...STANDARD, { role: 'outer', required: false }],
    dressiness: [0, 1],
    uses: ['athletic', 'casual'],
    specificity: 4,
  },
  {
    activityTag: 'gym',
    name: 'Workouts',
    slots: STANDARD,
    dressiness: [0, 1],
    uses: ['athletic'],
    specificity: 4,
  },
  {
    activityTag: 'swimming',
    name: 'Pool and downtime',
    slots: [
      { role: 'swim', required: true },
      { role: 'top', required: false },
      { role: 'footwear', required: false },
    ],
    dressiness: [0, 2],
    uses: ['swim', 'warm_weather', 'casual'],
    specificity: 5,
  },
  {
    activityTag: 'beach',
    name: 'Beach',
    slots: [
      { role: 'swim', required: true },
      { role: 'top', required: false },
      { role: 'footwear', required: false },
    ],
    dressiness: [0, 2],
    uses: ['swim', 'warm_weather', 'casual'],
    specificity: 5,
  },
  {
    activityTag: 'winery',
    name: 'Winery',
    slots: [...STANDARD, { role: 'mid', required: false }],
    dressiness: [1, 3],
    uses: ['casual', 'dressy'],
    specificity: 3,
  },
  {
    activityTag: 'road_trip',
    name: 'Road trip',
    slots: [...STANDARD, { role: 'mid', required: false }],
    dressiness: [0, 2],
    uses: ['travel', 'casual'],
    specificity: 3,
  },
  {
    activityTag: 'sightseeing',
    name: 'Sightseeing',
    slots: [...STANDARD, { role: 'outer', required: false }],
    dressiness: [0, 2],
    uses: ['casual', 'travel'],
    specificity: 2,
  },
]

/** Always planned: the flight out and back, and ordinary days. */
export const TRAVEL_TEMPLATE: OutfitTemplate = {
  activityTag: null,
  name: 'Travel days',
  slots: [...STANDARD, { role: 'mid', required: false }],
  dressiness: [0, 2],
  uses: ['travel', 'casual', 'loungewear'],
  specificity: 3,
}

export const EVERYDAY_TEMPLATE: OutfitTemplate = {
  activityTag: null,
  name: 'Casual days',
  slots: [...STANDARD, { role: 'mid', required: false }],
  dressiness: [0, 2],
  uses: [],
  specificity: 1,
}

export interface PlannedGroup {
  template: OutfitTemplate
  name: string
  /** How many times this outfit is worn across the trip. */
  occurrences: number
  /**
   * The exact dates this group covers, when Alex has said which days are what.
   * Empty when he has not — the occurrences are then a count with no calendar
   * behind them, and During Trip spreads them in planned order instead.
   */
  dates: string[]
}

/** One date and what Alex said he is doing on it. */
export interface DayActivity {
  date: string
  activityTag: string | null
}

/**
 * Turns a trip into the outfit groups to plan.
 *
 * Two modes, and the difference is whether Alex has said which days are what.
 *
 * With days: every group's occurrences are counted from the calendar. Four
 * safari days plan four safari outfits. This is the behaviour worth having —
 * without it, a twelve-day trip with one safari tag planned exactly one safari
 * outfit and quietly turned the other eleven days into casual ones.
 *
 * Without days: one outfit per activity, and the rest of the trip is casual.
 * That under-plans a repeated activity, so the outfits screen says so and
 * points at the day planner rather than pretending the number is considered.
 * Guessing a spread would be inventing a fact Alex never gave, which is the one
 * thing this engine must not do.
 *
 * Travel days take the first and last dates in both modes, unless Alex has put
 * an activity on them.
 */
export function planGroups(
  activities: string[],
  tripDays: number,
  days: DayActivity[] = [],
): PlannedGroup[] {
  return days.length > 0 ? planFromDays(days) : planFromCounts(activities, tripDays)
}

function bySpecificity(groups: PlannedGroup[]): PlannedGroup[] {
  // Most constrained first, so a specialised group takes the one garment that
  // suits it before a generic group consumes it (03 §8).
  return groups.sort((a, b) => b.template.specificity - a.template.specificity)
}

function planFromCounts(activities: string[], tripDays: number): PlannedGroup[] {
  const groups: PlannedGroup[] = []

  const travelDays = tripDays === 1 ? 1 : 2
  groups.push({
    template: TRAVEL_TEMPLATE,
    name: TRAVEL_TEMPLATE.name,
    occurrences: travelDays,
    dates: [],
  })

  for (const template of OUTFIT_TEMPLATES) {
    if (template.activityTag && activities.includes(template.activityTag)) {
      groups.push({ template, name: template.name, occurrences: 1, dates: [] })
    }
  }

  const spoken = groups.reduce((sum, g) => sum + g.occurrences, 0)
  const remaining = tripDays - spoken
  if (remaining > 0) {
    groups.push({
      template: EVERYDAY_TEMPLATE,
      name: EVERYDAY_TEMPLATE.name,
      occurrences: remaining,
      dates: [],
    })
  }

  return bySpecificity(groups)
}

function planFromDays(days: DayActivity[]): PlannedGroup[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]?.date
  const last = sorted[sorted.length - 1]?.date

  const travelDates: string[] = []
  const byTag = new Map<string, string[]>()
  const casualDates: string[] = []

  for (const day of sorted) {
    if (day.activityTag) {
      byTag.set(day.activityTag, [...(byTag.get(day.activityTag) ?? []), day.date])
      continue
    }
    // An unspoken-for first or last day is a travel day; that is what those days
    // are for. An activity on them wins, because Alex said so explicitly.
    if (day.date === first || day.date === last) travelDates.push(day.date)
    else casualDates.push(day.date)
  }

  const groups: PlannedGroup[] = []

  if (travelDates.length > 0) {
    groups.push({
      template: TRAVEL_TEMPLATE,
      name: TRAVEL_TEMPLATE.name,
      occurrences: travelDates.length,
      dates: travelDates,
    })
  }

  for (const template of OUTFIT_TEMPLATES) {
    const dates = template.activityTag ? byTag.get(template.activityTag) : undefined
    if (dates && dates.length > 0) {
      groups.push({ template, name: template.name, occurrences: dates.length, dates })
    }
  }

  if (casualDates.length > 0) {
    groups.push({
      template: EVERYDAY_TEMPLATE,
      name: EVERYDAY_TEMPLATE.name,
      occurrences: casualDates.length,
      dates: casualDates,
    })
  }

  return bySpecificity(groups)
}

/* ------------------------------------------------------------------ */
/* stage 1 — hard filters                                              */
/* ------------------------------------------------------------------ */

export interface FilterContext {
  role: SlotRole
  template: OutfitTemplate
  /** Warmth band the conditions call for, or null when unknown. */
  warmthBand?: [number, number] | null
  /** During Trip only: the ids confirmed packed. Undefined before the trip. */
  packedItemIds?: Set<string>
  /**
   * Rain is likely on this group's days, so its outer layer must actually keep
   * rain out. A HARD filter, and only on the outer slot.
   */
  needsRainLayer?: boolean
  /**
   * The dressiest thing Alex said he is doing on this trip, capping every
   * template band. Never applied below a template's own MINIMUM — saying
   * "nothing formal" about a trip that includes a wedding must not put him in
   * loungewear at the wedding. It caps the ceiling, it cannot lower the floor.
   */
  maxDressiness?: number | null
}

export type FilterResult = { ok: true } | { ok: false; reason: string }

/**
 * Eliminating filters. Every one of these is a fact, not a preference.
 *
 * Nothing here is a tiebreak or a nudge — if a garment fails any of these it
 * cannot appear in this slot at all, which is what keeps a loungewear tee out of
 * a wedding regardless of how much Alex likes it.
 */
export function passesFilters(item: Item, context: FilterContext): FilterResult {
  if (item.kind !== 'clothing') return { ok: false, reason: 'not clothing' }
  if (item.archivedAt !== null) return { ok: false, reason: 'archived' }
  if (item.neverInclude) return { ok: false, reason: 'never packed' }
  if (slotFor(item) !== context.role) return { ok: false, reason: 'wrong kind of garment' }

  if (context.packedItemIds && !context.packedItemIds.has(item.id)) {
    // The absolute During Trip rule (doc 04 §10).
    return { ok: false, reason: 'not packed for this trip' }
  }

  /*
   * Formality, as SET INTERSECTION rather than a numeric comparison (H1c).
   *
   * `acceptableContexts` expands the template's band into the set it always
   * meant and applies the trip cap, preserving the template's floor when the
   * cap would empty it. On a garment recorded at ONE context — which is every
   * garment migration 0022 produces — this is identical to the
   * `minDress <= dressiness <= maxDress` it replaces, asserted across all five
   * levels and all thirteen templates.
   *
   * What it can now express, and the integer could not: a garment marked
   * `Smart casual + Dressy` is eligible for a Smart casual need AND a Dressy
   * one. What it can no longer get wrong: a `Formal`-only garment does not
   * satisfy a Casual need. Membership has no direction, so nothing here can
   * read Formal as *better*.
   *
   * A garment with NO recorded contexts still passes — `fitsContexts` says so —
   * because excluding it would punish missing data rather than unsuitability
   * (doc 05 §4), exactly as an unrecorded `dressiness` was never excluded.
   */
  const acceptable = acceptableContexts(context.template.dressiness, context.maxDressiness)
  if (!fitsContexts(item.dressinessContexts, acceptable.contexts)) {
    return { ok: false, reason: 'wrong level of dress' }
  }

  /*
   * Rain is a hard filter, and only on the layer that would keep it off.
   *
   * Capability is never inferred from the garment's type — a jacket is not a
   * rain layer because it is a jacket. See `weather-fit.ts`.
   */
  if (context.needsRainLayer && context.role === 'outer' && !hasWeatherCapability(item, 'rain')) {
    return { ok: false, reason: 'not recorded as keeping rain out' }
  }

  // Warmth is a hard filter for layers and jackets and a soft preference for
  // tops (03 §9) — a warm tee under a jacket is fine; a summer shell in the cold
  // is not.
  if (context.warmthBand && (context.role === 'outer' || context.role === 'mid')) {
    const [minWarmth, maxWarmth] = context.warmthBand
    if (item.warmth !== null && (item.warmth < minWarmth || item.warmth > maxWarmth)) {
      return { ok: false, reason: 'wrong warmth for the conditions' }
    }
  }

  /*
   * Whether this garment suits the ACTIVITY, as opposed to the occasion's
   * formality or the day's weather (V1.1).
   *
   * A hard filter, and it has to be one. The beach outfit picked a Smart-casual
   * button-up and a pair of white sneakers, and every gate above passed
   * honestly on both — because until this line the planner had no
   * representation of *appropriate for what Alex is doing*. Making it a
   * preference instead would leave a five-star rating able to buy its way back
   * in, which is the exact failure `CRITERIA` already refuses to allow for
   * comfort.
   *
   * `unknown` passes. Only `no` excludes, and `no` is only ever reached from
   * something the garment actually records — see `shared/activity-fit.ts`.
   */
  const fit = activityFit(item, context.template.activityTag)
  if (fit === 'no') {
    return { ok: false, reason: 'not suggested for this activity' }
  }

  /*
   * A garment with no recorded uses is not excluded — the spreadsheet simply did
   * not say. Excluding it would punish missing data rather than unsuitability.
   *
   * ## Why a positive activity fit outranks this gate (V1.1)
   *
   * This intersection is the coarsest thing in the filter, and on the real
   * closet it was wrong in both directions at once. It admitted the Smart-casual
   * `Button-Up Shirt` to the beach — `Casual / Smart Casual` parses to
   * `['casual','dressy']`, and the lone `casual` satisfied it — while rejecting
   * three of the four `Athletic Tank Top` rows, whose only tag is `athletic`.
   * The best beach tops in the closet were ineligible and a dress shirt was not.
   *
   * `athletic` is not evidence a tank top is unfit for a beach; it is evidence
   * about something else. So when the finer model has POSITIVE grounds — a
   * recorded swim use, or a garment type that is unambiguous about the activity —
   * this coarse tag intersection no longer gets a veto. It still applies in full
   * wherever the activity has no rules, which is every template but two.
   */
  const wanted = context.template.uses
  if (fit !== 'yes' && wanted.length > 0 && item.typicalUses.length > 0) {
    if (!item.typicalUses.some((use) => wanted.includes(use))) {
      return { ok: false, reason: 'not used for this' }
    }
  }

  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* stage 2 — ranking among survivors                                   */
/* ------------------------------------------------------------------ */

const FREQUENCY_RANK: Record<string, number> = { frequent: 3, sometimes: 2, new: 1, rare: 0 }

/**
 * The criteria, in the approved order (doc 04 §5).
 *
 * Compared LEXICOGRAPHICALLY, not summed. A weighted sum lets three weak signals
 * outvote a strong one, which is how "frequently used" ends up beating "suits
 * the occasion". Each entry also names itself, so the winning criterion becomes
 * the explanation line rather than being reverse-engineered.
 */
export interface RankContext {
  requestedItemIds: Set<string>
  /** Times this garment already appears in the plan; drives reuse and variety. */
  usedCount: Map<string, number>
  /**
   * What this outfit is FOR, as the template's activity tag (V1.1).
   *
   * Two criteria read it — the activity-fit preference, and the inferred half
   * of versatility, which must not count a tag the activity cannot use. Absent
   * means "no particular activity", and both fall back to exactly the numbers
   * they produced before this existed.
   */
  activityTag?: string | null
  /**
   * Capabilities the conditions would prefer, in order. Empty on a trip with no
   * forecast, which makes the criterion below a no-op and leaves the ranking
   * exactly as it was.
   */
  preferredCapabilities?: WeatherCapability[]
  /** Alex's saved reuse defaults, for the reuse-efficiency criterion. */
  reuseDefaults?: ReuseDefaults
  /**
   * Garments already chosen for THIS outfit — what a candidate is being paired
   * with. Empty for the first slot, so the first pick is never influenced by a
   * pairing; it accumulates as the outfit fills.
   */
  chosenInGroup?: Array<{ id: string; displayName: string }>
  /** Counted co-occurrence in previously approved outfits. */
  pairings?: PairingIndex
}

/**
 * How often two garments have appeared in the same approved outfit.
 *
 * An interface rather than a map so the shared engine never learns how the
 * counts are stored, and so a caller with no history can simply omit it.
 */
export interface PairingIndex {
  count(itemIdA: string, itemIdB: string): number
}

/** The strongest recorded partner among the garments already chosen. */
function bestPartner(
  item: Item,
  context: RankContext,
): { displayName: string; times: number } | null {
  let best: { displayName: string; times: number } | null = null
  for (const chosen of context.chosenInGroup ?? []) {
    const times = context.pairings?.count(item.id, chosen.id) ?? 0
    if (times > 0 && (best === null || times > best.times)) {
      best = { displayName: chosen.displayName, times }
    }
  }
  return best
}

export interface RankedCandidate {
  item: Item
  /**
   * One score per criterion, compared lexicographically.
   *
   * `null` means **this criterion has nothing to say about this garment** — not
   * zero, which is a score and would sort. Only comfort produces it today (H1b):
   * an unrated comfort is unknown, and scoring it 0 would rank a garment nobody
   * has rated BELOW one Alex called uncomfortable, which is a claim about data
   * we do not have. `compare` skips a criterion where either side is null.
   */
  scores: Array<number | null>
  /** Which criterion put this item on top. Empty when nothing distinguished it. */
  decidedBy: string | null
}

/**
 * The versatility signal, and Alex's ruling of 2026-08-06 in one function.
 *
 * **A user-confirmed rating REPLACES the inferred score. They are never added.**
 * Adding them would mean a garment could out-rank another by being rated at all,
 * and would double-count the same property under two names — doc 09 §7 flagged
 * exactly that as how two signals quietly cancel each other.
 *
 * The two scales are compatible rather than coincidentally similar, and that was
 * measured before this was written: across the 85 garments in
 * `seed-data/Master_Packing_Database_Complete.xlsx`, `typicalUses.length` is
 * **0 for 11, 1 for 40, 2 for 33 and 3 for one** — a 0–3 band sitting inside the
 * rating's 1–5. So substitution is a like-for-like swap in the same small range,
 * and the most a rating can do is lift a garment two places above anything
 * inference could express. That is deliberate: 5 is Alex answering, and 3 is us
 * counting tags.
 *
 * A rating of 1 still scores 1, above the eleven garments with no recorded uses
 * at all. "Very specific use" is knowledge; an empty tag list is an absence.
 *
 * **When nothing is rated this returns `typicalUses.length` for every garment**,
 * so a wardrobe Alex has not reviewed ranks EXACTLY as it did before H1b. That
 * is the same safety property the pairings criterion was built on, and it is
 * asserted rather than asserted-in-a-comment.
 *
 * `typicalUses` itself is untouched. It remains the eligibility filter in
 * `passesFilters` and it remains what explanations read — this function is only
 * about the ranking number.
 */
export function versatilitySignal(item: Item, activityTag: string | null = null): number {
  /*
   * Alex's own rating is never touched. `activityTag` reaches only the
   * inference below it (V1.1).
   *
   * The 1–5 rating is an answer he gave about the garment, and an answer does
   * not become less true because today is a beach day. What was wrong was the
   * FALLBACK: `typicalUses.length` counted every tag, so `Casual / Smart
   * Casual` — parsed to `['casual','dressy']` — scored 2 against a plain casual
   * tee's 1, and the beach top slot was decided by a `dressy` tag the beach
   * cannot use. The same two points put `White Sneakers` above `Sandals`.
   *
   * That is not a rounding error, it is a standing bias toward dressier
   * garments in every casual slot, and it is invisible because the criterion is
   * called "Works for several days" — which is true of breadth and false of an
   * irrelevant tag.
   *
   * With no activity, or an activity with no rules, `relevantUses` returns the
   * list unchanged and this is bit-for-bit the function it replaces.
   */
  return item.versatility ?? relevantUses(item, activityTag).length
}

/**
 * The comfort signal — a rating, or silence.
 *
 * There is no inferred comfort anywhere in this schema and nothing approximates
 * one: the retired favourite flag, `usageFrequency` and `reuseCapacity` are all adjacent and
 * none of them mean it. So unlike versatility there is no fallback, and the
 * honest answer for an unrated garment is `null` — the criterion says nothing
 * rather than guessing zero or, worse, three.
 */
export function comfortSignal(item: Item): number | null {
  return item.comfort
}

/**
 * Exported because it is the decision table itself, and the outfit sentence is
 * assembled from its `clause` fields.
 *
 * `why-this.test.ts` walks it to prove EVERY clause completes "Chosen because
 * it …" and that every combination of them still reads as English. Pinning only
 * today's six would leave the seventh criterion free to reintroduce the noun
 * phrase this grammar exists to keep out.
 */
export const CRITERIA: Array<{
  name: string
  /** `null` when this criterion has nothing to say about this garment (H1b). */
  score: (item: Item, context: RankContext) => number | null
  /**
   * A sentence naming the specific evidence, when the criterion has any.
   *
   * `name` alone answers "why this one?" for criteria that are properties of the
   * garment ("You wear it often"). A pairing is a RELATIONSHIP, so the useful answer
   * names the other garment. Falls back to `name` when this returns null.
   */
  explain?: (item: Item, context: RankContext) => string | null
  /**
   * The same reason as a PREDICATE, for the one-sentence outfit explanation.
   *
   * `name` is a whole answer — "You wear it often" — and three of those joined
   * with commas is not a sentence. This is the clause form, and it lives on the
   * criterion rather than in a lookup beside it so that a criterion cannot be
   * added, reworded or removed while a second table quietly keeps the old text.
   *
   * **Every clause must complete "Chosen because it …"**, which means starting
   * with a third-person verb. That rule is the whole grammar: it was not there
   * at first, the clauses were a mix of verb phrases ("suits the forecast"),
   * noun phrases ("things you reach for") and a bare adjective ("comfortable"),
   * and each read fine alone while together they produced *Chosen for suits the
   * forecast, things you reach for and comfortable.* Fragments that are
   * individually valid can still combine into broken English, so the constraint
   * has to be on the fragment rather than on the joining.
   *
   * Absent where the criterion should never appear in the outfit-level
   * sentence: *You asked for it* is answered by "You chose this one" instead,
   * and *Something different* is a tie-breaker about spreading wear rather than
   * anything Alex would recognise as a reason for THIS outfit.
   */
  clause?: string
}> = [
  { name: 'You asked for it', score: (i, c) => (c.requestedItemIds.has(i.id) ? 1 : 0) },
  /*
   * The other half of doc 04 §5 criterion 2 — "activity and weather
   * suitability" — which was one criterion in the approved order and only ever
   * had its weather half implemented (V1.1).
   *
   * **This is `yes` versus `unknown`, and nothing else.** `no` was excluded in
   * `passesFilters` before ranking began, so this criterion never sees an
   * incompatible garment and is not a soft substitute for that gate. What it
   * does is prefer a garment Pack Smart has POSITIVE grounds for over one it
   * simply cannot classify — a tank top over an unclassified layering tee, and
   * sandals over sneakers at the beach.
   *
   * Above the weather half deliberately. The occasion is a fact about the whole
   * outfit; a preference for a wind-resistant layer is a fact about one
   * afternoon, and a garment that suits the day but not the activity is the
   * wrong trade.
   *
   * Scores 0 for every garment where the activity has no rules, which is every
   * template but two — so the ten untouched groups rank exactly as they did.
   */
  {
    name: 'Suits the activity',
    clause: 'suits what you are doing',
    score: (i, c) => (activityFit(i, c.activityTag ?? null) === 'yes' ? 1 : 0),
  },
  /*
   * Doc 04 §5 criterion 2 — the weather half. Activity suitability is a hard
   * filter in stage 1 and rightly so; weather suitability could not be, because
   * wind is not worth emptying the jacket slot over.
   *
   * Scores 0 for everything when the conditions ask for nothing, so a trip with
   * no forecast ranks precisely as it did before.
   */
  {
    name: 'Suits the conditions',
    clause: 'suits the forecast',
    score: (i, c) =>
      (c.preferredCapabilities ?? []).filter((cap) => hasWeatherCapability(i, cap)).length,
  },
  /*
   * Doc 04 §5 criterion 3 — the last of the eight to be implemented.
   *
   * Counted co-occurrence in outfits Alex has APPROVED: never inferred from
   * colour, brand, or the words in an item's name. The score is the sum across
   * the garments already chosen for this outfit, so two approvals outrank one
   * rather than every pairing being an equal boolean.
   *
   * Position matters as much as the score. Below "Suits the conditions", so a
   * habit can never put Alex in the wrong clothes for the weather; above
   * "You wear it often", because what he actually wore together is better evidence
   * than what he once starred.
   *
   * With no pairing history every score here is 0 and `compare` moves straight
   * to the next criterion — so a first trip ranks exactly as it did before this
   * existed. That property is what makes it safe to add to a working planner.
   */
  {
    name: 'You wear these together',
    clause: 'pairs pieces you wear together',
    score: (i, c) =>
      (c.chosenInGroup ?? []).reduce(
        (total, chosen) => total + (c.pairings?.count(i.id, chosen.id) ?? 0),
        0,
      ),
    explain: (i, c) => {
      const partner = bestPartner(i, c)
      return partner ? `You approved this with ${partner.displayName} before` : null
    },
  },
  /*
   * `A favorite` used to sit here, and it is gone (H1d).
   *
   * It was one bit — starred or not — ranking above versatility and above
   * comfort, and by the time Alex could say *this is one of my most comfortable
   * items* and *this works for smart casual and dressy*, a boolean claiming to
   * outrank both of them was a signal competing with better ones rather than
   * adding to them. §8.3's ruling is that Favorite is retired here, in the
   * slice that gives it real replacements.
   *
   * Removing a criterion from a lexicographic order is a behaviour change and
   * is meant to be: two garments that used to be separated by a star now fall
   * through to how often Alex wears them, then to versatility, then to comfort.
   * That is the ordering the remaining eight criteria always described.
   */
  {
    name: 'You wear it often',
    clause: 'includes things you reach for',
    score: (i) => FREQUENCY_RANK[i.usageFrequency] ?? 0,
  },
  /*
   * Versatility: a garment usable for more of this trip earns its place.
   *
   * Alex's rating when he has given one, `typicalUses.length` when he has not —
   * substitution, never a sum. See `versatilitySignal`. The criterion keeps its
   * name because the name is what Alex reads in an explanation, and the sentence
   * *Works for several days* is true of both signals.
   */
  {
    name: 'Works for several days',
    clause: 'works across several days',
    score: (i, c) => versatilitySignal(i, c.activityTag ?? null),
  },
  // Reuse efficiency: prefer something already packed over adding another item,
  // but only while it has capacity left.
  {
    name: 'Already packed for another day',
    clause: 'is already in the bag for another day',
    score: (i, c) => {
      const used = c.usedCount.get(i.id) ?? 0
      const capacity = reuseCapacity(i, c.reuseDefaults)
      return used > 0 && used < capacity ? 1 : 0
    },
  },
  /*
   * Comfort (H1b), and its position IS its modesty.
   *
   * Seventh of eight, and it was seventh of nine until Favorite was retired
   * above it (H1d). Everything that decides whether a garment is *right* still
   * sits above it — the conditions, what Alex wears together, how often he
   * wears it, versatility, and whether something already in the bag would do.
   * Comfort speaks only when all of those tie, which is precisely the "modest
   * ranking influence" the ruling asked for, expressed as an ordering rather
   * than as a weight nobody can audit.
   *
   * Below `Already packed for another day` on purpose: a comfortable shirt must
   * not add a garment to the bag when one already packed would serve. This is a
   * packing app before it is a wardrobe app.
   *
   * It cannot reach eligibility at all. `passesFilters` runs first and does not
   * look at comfort, so no rating can make an unsuitable garment suitable — a
   * five-star parka still fails a hot-weather outfit, and a five-star dress shoe
   * still fails an active walking requirement.
   */
  {
    name: 'Comfortable to wear',
    clause: 'is more comfortable',
    score: (i) => comfortSignal(i),
  },
  // Variety: all else equal, do not wear the same thing every day.
  { name: 'Something different', score: (i, c) => -(c.usedCount.get(i.id) ?? 0) },
]

/**
 * Lexicographic, and **silent where a criterion has nothing to say** (H1b).
 *
 * `null` on either side is skipped rather than read as zero. The distinction
 * matters exactly once, and it is the case comfort was designed around: an
 * unrated garment against a rated one. Treating unknown as 0 would sort it below
 * `Uncomfortable`, inventing a judgement out of an absence — and would then make
 * rating something 1 look like a promotion.
 *
 * `?? 0` here would have been the smaller diff and the wrong one.
 */
function compare(a: RankedCandidate, b: RankedCandidate): number {
  for (let i = 0; i < a.scores.length; i += 1) {
    const mine = a.scores[i]
    const theirs = b.scores[i]
    if (mine === null || mine === undefined || theirs === null || theirs === undefined) continue
    const diff = theirs - mine
    if (diff !== 0) return diff
  }
  // Stable, reproducible ordering when nothing else separates them.
  return a.item.id.localeCompare(b.item.id)
}

export function rank(items: Item[], context: RankContext): RankedCandidate[] {
  const scored = items.map((item) => ({
    item,
    scores: CRITERIA.map((c) => c.score(item, context)),
    decidedBy: null as string | null,
  }))

  scored.sort(compare)

  const winner = scored[0]
  const runnerUp = scored[1]

  if (winner && !runnerUp) {
    // Being the only thing that fits is itself worth saying — it tells Alex the
    // choice was forced, not preferred, which is the difference between "this
    // suits you" and "this is all you have".
    winner.decidedBy = 'The only one that fits'
  } else if (winner && runnerUp) {
    /*
     * The criterion that actually decided it — using the SAME silence rule as
     * `compare` (H1b).
     *
     * A criterion where either side is null did not separate them, so naming it
     * would tell Alex the choice came down to comfort when comfort said nothing.
     * Reading `?? 0` here, as this used to, would have found a "difference"
     * between an unrated garment and a rated one that `compare` had deliberately
     * skipped, and printed the wrong reason on the card.
     */
    const index = winner.scores.findIndex((value, i) => {
      const other = runnerUp.scores[i]
      if (value === null || value === undefined || other === null || other === undefined) {
        return false
      }
      return value !== other
    })
    const criterion = index >= 0 ? CRITERIA[index] : undefined
    // The specific evidence when the criterion can name it, its label otherwise.
    winner.decidedBy = criterion
      ? (criterion.explain?.(winner.item, context) ?? criterion.name)
      : null
  }

  return scored
}

/**
 * Reuse capacity: how many times a garment can be worn before it needs washing.
 *
 * Falls back to the per-category defaults from doc 04 §6 when the item does not
 * carry its own. Jackets, shoes and belts are effectively unlimited; tops are
 * worn once.
 */
const REUSE_DEFAULTS: Record<SlotRole, number> = {
  outer: 99,
  mid: 99,
  footwear: 99,
  accessory: 99,
  bottom: 3,
  top: 1,
  swim: 2,
}

/**
 * Alex's saved per-category reuse defaults, when he has any.
 *
 * `reuse_defaults` has sat in the `preference` table since migration 0005 and
 * was read by nothing — "pack light" and "do not rewear shirts" (doc 03 §2)
 * had nowhere to land. The item's own value still wins over both.
 */
export type ReuseDefaults = Partial<Record<SlotRole, number>>

export function reuseCapacity(item: Item, preferred: ReuseDefaults = {}): number {
  if (item.reuseCapacity !== null && item.reuseCapacity > 0) return item.reuseCapacity
  const role = slotFor(item)
  if (!role) return 1
  const override = preferred[role]
  return override !== undefined && override > 0 ? override : REUSE_DEFAULTS[role]
}

/* ------------------------------------------------------------------ */
/* assignment                                                          */
/* ------------------------------------------------------------------ */

export interface FilledSlot {
  role: SlotRole
  required: boolean
  item: Item | null
  /**
   * How many of the group's occurrences this garment covers.
   *
   * A group worn nine times does not mean nine identical shirts: a slot whose
   * garments can only be worn once is filled with several different ones, and
   * this records how much of the group each of them takes care of.
   */
  wearings: number
  /** Why this slot is empty. Present only when item is null. */
  unmetReason: string | null
  /** Which criterion chose this item, when one did. */
  reason: string | null
}

export interface FilledGroup {
  name: string
  activityTag: string | null
  occurrences: number
  /** The dates this group covers, when they are known. */
  dates: string[]
  slots: FilledSlot[]
}

export interface AssignmentResult {
  groups: FilledGroup[]
  /** Slots left empty, for the honest "nothing suitable" message. */
  unmet: Array<{ group: string; role: SlotRole; reason: string }>
}

/**
 * Fills every group's slots, greedily, most-constrained group first.
 *
 * Capacity is consumed as it goes, so a shirt worn once is not silently worn
 * three times. When nothing survives the filters the slot stays empty and says
 * why — "No suitable packed rain layer found" is a real answer; guessing is not.
 */
export function assign(
  groups: PlannedGroup[],
  wardrobe: Item[],
  options: {
    requestedItemIds?: Set<string>
    packedItemIds?: Set<string>
    /**
     * Wearings already spoken for by outfits this run is not replanning.
     *
     * D1c replans the drafts and leaves the approved ones alone, so the garments
     * standing in an approved outfit are genuinely in use — and without this
     * they would look free, and the same shirt would be planned into a second
     * outfit past its reuse capacity.
     */
    alreadyUsed?: Map<string, number>
    /**
     * Days of ordinary washable clothing to plan for, or null for no cap.
     *
     * Null when Alex said there is no laundry, when he has not answered, and
     * when the trip is short enough that the cap cannot bite. Three different
     * situations that all mean "plan exactly as before".
     */
    laundryDayCap?: number | null
    warmthBand?: [number, number] | null
    /**
     * The warmth band for one specific group, from the weather on its own days.
     *
     * Takes precedence over `warmthBand`. Two groups on the same trip can face
     * genuinely different conditions — cold safari mornings and mild city
     * afternoons — and a single trip-wide band would either over-filter one or
     * under-filter the other.
     */
    warmthBandFor?: (group: PlannedGroup) => [number, number] | null
    /** What that group's own days demand — rain, wind — or nothing. */
    demandFor?: (group: PlannedGroup) => ConditionDemand | null
    /** The dressiest thing on this trip. Caps every template ceiling. */
    maxDressiness?: number | null
    reuseDefaults?: ReuseDefaults
    /** Counted co-occurrence in approved outfits (doc 04 §5 criterion 3). */
    pairings?: PairingIndex
  } = {},
): AssignmentResult {
  const usedCount = new Map<string, number>(options.alreadyUsed ?? [])
  const filled: FilledGroup[] = []
  const unmet: AssignmentResult['unmet'] = []

  for (const group of groups) {
    const slots: FilledSlot[] = []
    const groupBand = options.warmthBandFor?.(group) ?? options.warmthBand ?? null
    const demand = options.demandFor?.(group) ?? null

    /*
     * Rain makes the outer layer REQUIRED, wind only preferred.
     *
     * Arriving somewhere wet with nothing waterproof is a real problem; being
     * slightly cold in a breeze is not. Promoting wind to a requirement would
     * empty the jacket slot on every trip where nothing happens to be tagged
     * for it, which is worse than not mentioning wind at all.
     */
    const preferredCapabilities: WeatherCapability[] = []
    if (demand?.wind) preferredCapabilities.push('wind')
    if (demand?.rain) preferredCapabilities.push('rain')

    /*
     * What this outfit has picked so far, for the pairing criterion.
     *
     * Per GROUP, not per trip: "these go together" is a claim about one outfit.
     * Carrying it across groups would let a safari shirt pull a dinner jacket
     * into the winery outfit because they were once approved together.
     *
     * Mutated as slots fill and read by reference through `rankContext`, so each
     * slot ranks against everything chosen before it.
     */
    const chosenInGroup: Array<{ id: string; displayName: string }> = []

    const rankContext: RankContext = {
      requestedItemIds: options.requestedItemIds ?? new Set(),
      usedCount,
      // What this group is for, so the activity criteria can read it. The
      // template is the authority; the group's name is only a label.
      activityTag: group.template.activityTag,
      preferredCapabilities,
      chosenInGroup,
      ...(options.pairings ? { pairings: options.pairings } : {}),
      ...(options.reuseDefaults ? { reuseDefaults: options.reuseDefaults } : {}),
    }

    /*
     * Rain promotes the outer layer, and `demanded` remembers that it did.
     *
     * The flag is what the refusal below needs: a slot the TEMPLATE required is
     * a genuine hole in the outfit, and a slot the WEATHER required is a hole in
     * the wardrobe. They read alike here and mean different things downstream.
     */
    const templateOuter = group.template.slots.find((s) => s.role === 'outer')
    const specs: Array<{ role: SlotRole; required: boolean; demanded?: boolean }> = demand?.rain
      ? [
          ...group.template.slots.filter((s) => s.role !== 'outer'),
          { role: 'outer' as SlotRole, required: true, demanded: true },
        ]
      : group.template.slots

    for (const spec of specs) {
      const context: FilterContext = {
        role: spec.role,
        template: group.template,
        warmthBand: groupBand,
        needsRainLayer: demand?.rain ?? false,
        maxDressiness: options.maxDressiness ?? null,
        ...(options.packedItemIds ? { packedItemIds: options.packedItemIds } : {}),
      }

      const suitable = wardrobe.filter((item) => passesFilters(item, context).ok)

      if (suitable.length === 0) {
        const reason =
          demand?.rain && spec.role === 'outer'
            ? 'Rain is likely and nothing in your wardrobe is recorded as keeping it out.'
            : describeGap(spec.role, group.template)

        /*
         * A demand the wardrobe cannot meet ANYWHERE does not veto the outfit.
         *
         * This is the defect the seven CI flakes turned out to be, and it is a
         * product one rather than a test one. Rain promotes `outer` to required;
         * Alex owns nothing recorded as keeping rain out; so on any trip with
         * rain in the forecast EVERY group came back `incomplete`, every
         * approval was refused, and the Outfits screen offered an `Approve
         * outfit` button that silently did nothing on all four cards. That is
         * the dead end E1 spent a slice removing from Today, reappearing on a
         * different screen — and it only ever showed up on CI, because CI can
         * reach the weather service and this sandbox cannot.
         *
         * Pack Smart cannot ask him to pack a coat he does not own. So the slot
         * falls back to what the TEMPLATE asked for: the sentence is still
         * shown, the gap is still recorded, and the outfit can still be
         * approved. E2 then does the rest of the job on the day — the weather
         * conflict on Today says rain is likely and nothing packed keeps it
         * out, which is the right moment for it.
         *
         * A slot the template itself required is untouched: no top that suits a
         * nice dinner is a genuine hole in the outfit, and approving around it
         * would put a half-dressed plan on the checklist.
         */
        const required = spec.demanded ? (templateOuter?.required ?? false) : spec.required

        slots.push({
          role: spec.role, required, item: null,
          wearings: 0, unmetReason: reason, reason: null,
        })

        /*
         * Reported on what was ASKED for; vetoed on what the template required.
         *
         * The two are deliberately different here, and separating them is the
         * whole of the change. `unmet` is the report of what the plan could not
         * do — the rain gap belongs in it, because it is real — while
         * `slot.required` is what `refreshGroupStatus` reads to decide whether
         * the outfit may be approved. Collapsing them is what turned "you own no
         * raincoat" into "you cannot approve anything on this trip".
         */
        if (spec.required) unmet.push({ group: group.name, role: spec.role, reason })
        continue
      }

      /*
       * Keep choosing until the group's days are covered.
       *
       * A required slot for a group worn nine times needs nine wearings, and a
       * t-shirt provides one. Choosing a single garment and calling the slot
       * filled would quietly plan for Alex to wear the same shirt nine days
       * running. The ranking already prefers something not yet used, so this
       * spreads across the wardrobe before it repeats anything.
       *
       * Optional slots take one garment — a jacket is brought or it is not — but
       * it is still worn on every occurrence of the group, so it consumes that
       * much capacity.
       */
      const target = group.occurrences
      let covered = 0

      /*
       * Laundry stops this loop early, and only here.
       *
       * The cap is on DAYS OF CLOTHING, so it has to bite where the plan decides
       * how many changes of a garment a group needs. Applied to the finished
       * quantities instead it would do nothing at all: a twelve-day casual group
       * already picks twelve different t-shirts, one wearing each, so no single
       * garment's total ever exceeds four to be capped.
       *
       * `washableSoFar` is what keeps it honest. The cap only stops the loop
       * while everything chosen for this slot is ordinary washable clothing —
       * one garment that must not be reduced and the slot goes back to covering
       * the whole group, because a jacket in the rotation is not something a
       * washing machine replaces.
       */
      const laundryCap = options.laundryDayCap ?? null
      const roleWashable = LAUNDRY_REDUCIBLE_ROLES.has(spec.role)
      let washableSoFar = true

      while (covered < target) {
        if (laundryCap !== null && roleWashable && washableSoFar && covered >= laundryCap) break

        const available = suitable.filter(
          (item) => (usedCount.get(item.id) ?? 0) < reuseCapacity(item, options.reuseDefaults),
        )

        if (available.length === 0) {
          // Everything suitable is spoken for. Saying how short the plan falls
          // is the honest answer; wearing a shirt past its capacity is not.
          if (!spec.required) break
          const short = target - covered
          const reason = `Nothing left to wear on ${short} ${short === 1 ? 'day' : 'days'}.`
          slots.push({
            role: spec.role, required: spec.required, item: null,
            wearings: 0, unmetReason: reason, reason: null,
          })
          unmet.push({ group: group.name, role: spec.role, reason })
          break
        }

        const chosen = rank(available, rankContext)[0]!
        const capacity = reuseCapacity(chosen.item, options.reuseDefaults)
        const alreadyUsed = usedCount.get(chosen.item.id) ?? 0
        const wearings = Math.min(target - covered, capacity - alreadyUsed)

        usedCount.set(chosen.item.id, alreadyUsed + wearings)
        covered += wearings
        if (!laundryReducible(chosen.item)) washableSoFar = false

        // Later slots in this outfit now rank against it (doc 04 §5 criterion 3).
        if (!chosenInGroup.some((c) => c.id === chosen.item.id)) {
          chosenInGroup.push({ id: chosen.item.id, displayName: chosen.item.displayName })
        }

        slots.push({
          role: spec.role,
          required: spec.required,
          item: chosen.item,
          wearings,
          unmetReason: null,
          reason: chosen.decidedBy,
        })

        // One jacket covers the group however many days it runs. Only required
        // slots keep reaching for more garments to cover the remaining days.
        if (!spec.required) break
      }
    }

    filled.push({
      name: group.name,
      activityTag: group.template.activityTag,
      occurrences: group.occurrences,
      dates: group.dates,
      slots,
    })
  }

  return { groups: filled, unmet }
}

/**
 * The honest empty-slot message.
 *
 * Names the gap in Alex's wardrobe in his own terms, so the answer is
 * actionable. Never suggests a substitute — doc 04 §15 forbids inventing
 * clothing he does not own, and a near-enough jacket is exactly that.
 */
export function describeGap(role: SlotRole, template: OutfitTemplate): string {
  const what = SLOT_LABELS[role].toLowerCase()
  return `No ${what} in your wardrobe suits ${template.name.toLowerCase()}.`
}

/**
 * What an outfit was planned for, in Alex's terms (doc 04 §5 and §9).
 *
 * Doc 04 requires a card to state its occasion, its dates, where it is worn and how
 * dressy it is — otherwise a recommendation cannot be checked, only accepted. Every
 * part comes from something recorded: the dates from the days Alex named, the place
 * from the destination those dates belong to, the formality from the activity
 * template's own band. Anything not recorded is left out rather than guessed —
 * there is no "probably mild" here.
 */
export function outfitContext(input: {
  activityTag: string | null
  dates: string[]
  place: string | null
  occurrences: number
  /**
   * The group's stored name, when the caller has it.
   *
   * Only ever used to resolve the two templates that carry no activity tag —
   * "Travel days" and "Casual days" — which is why it is optional: a caller
   * that does not pass it gets exactly the behaviour it had, and a group with
   * neither an activity nor a name still says nothing about formality rather
   * than guessing one.
   */
  name?: string
}): string[] {
  const parts: string[] = []

  if (input.dates.length > 0) parts.push(describeDates(input.dates))
  else parts.push(input.occurrences === 1 ? 'Once' : `${input.occurrences} days`)

  if (input.place) parts.push(input.place)

  const template = templateFor(input.activityTag, input.name)
  if (template) parts.push(formalityLabel(template))

  return parts
}

/**
 * The template a stored group came from.
 *
 * Matched on the activity tag first, because that is the real key. The two
 * untagged templates are then resolved by NAME, which is the only thing the
 * database keeps about them — `outfit_group.activity_tag` is null for both, so
 * without this a travel outfit and an ordinary day are indistinguishable once
 * they have been written down.
 *
 * Returns null rather than a default when neither matches: doc 09 §7 asks for
 * the formality to be stated, and stating the wrong one is worse than stating
 * none.
 */
export function templateFor(activityTag: string | null, name?: string): OutfitTemplate | null {
  if (activityTag) return OUTFIT_TEMPLATES.find((t) => t.activityTag === activityTag) ?? null
  if (name === TRAVEL_TEMPLATE.name) return TRAVEL_TEMPLATE
  if (name === EVERYDAY_TEMPLATE.name) return EVERYDAY_TEMPLATE
  return null
}

/** "Dressy to Formal", or one label when the band is a single step. */
export function formalityLabel(template: OutfitTemplate): string {
  const [low, high] = template.dressiness
  return low === high
    ? DRESSINESS_LABELS[low]!
    : `${DRESSINESS_LABELS[low]} to ${DRESSINESS_LABELS[high]}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "8 Aug", "8–10 Aug", "30 Jul–2 Aug", "8 Aug, 12 Aug and 1 more". Never an ISO date. */
function describeDates(dates: string[]): string {
  const sorted = [...dates].sort()
  const parts = (iso: string) => {
    const [, month, day] = iso.split('-') as [string, string, string]
    return { day: Number(day), month: MONTHS[Number(month) - 1]! }
  }
  const label = (iso: string) => {
    const { day, month } = parts(iso)
    return `${day} ${month}`
  }

  if (sorted.length === 1) return label(sorted[0]!)

  // Consecutive dates read as a range; scattered ones are listed.
  const consecutive = sorted.every((date, index) => {
    if (index === 0) return true
    const previous = Date.parse(`${sorted[index - 1]}T00:00:00Z`)
    return Date.parse(`${date}T00:00:00Z`) - previous === 86_400_000
  })

  if (consecutive) {
    const first = parts(sorted[0]!)
    const last = parts(sorted[sorted.length - 1]!)
    // The month is said once when it does not change — "8–10 Aug", not
    // "8 Aug–10 Aug", which reads as two separate facts.
    return first.month === last.month
      ? `${first.day}–${last.day} ${last.month}`
      : `${label(sorted[0]!)}–${label(sorted[sorted.length - 1]!)}`
  }

  const named = sorted.slice(0, 2).map(label)
  const rest = sorted.length - named.length
  return rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(' and ')
}

/**
 * "Nice dinners", "Nice dinners and Safari", "Nice dinners, Safari and Travel days".
 *
 * Used for outfit names and garment names alike, because both are read out rather
 * than counted: "2 outfits use this" just makes Alex go and look for which two.
 * Duplicates are dropped — one garment can fill two slots of the same outfit, and
 * naming it twice reads as a bug.
 */
export function joinNames(names: string[]): string {
  const unique = [...new Set(names)]
  if (unique.length <= 1) return unique[0] ?? ''
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

/* ------------------------------------------------------------------ */
/* guided review                                                       */
/* ------------------------------------------------------------------ */

/**
 * An outfit as the review reads it.
 *
 * Structural rather than imported: the Worker's `OutfitGroupView` and the
 * client's `OutfitGroup` both satisfy it, and neither has to be dragged into the
 * shared engine to make the review's vocabulary usable on both sides. Everything
 * here is a stored fact — nothing derived, so nothing can be derived twice and
 * disagree.
 */
export interface ReviewableGroup {
  name: string
  activityTag: string | null
  occurrences: number
  status: 'draft' | 'approved' | 'incomplete'
  /** When Alex last said "decide later", or null. */
  deferredAt: number | null
  slots: Array<{
    roleLabel: string
    required: boolean
    itemId: string | null
    wearings: number
  }>
}

/**
 * Whether an outfit still needs a decision.
 *
 * One definition, because three screens ask it: the walkthrough uses it to
 * choose where to stop, the coverage summary counts it, and `readiness()` asks
 * the same question in its own words (`status !== 'approved'`). Deferring does
 * NOT resolve an outfit — doc 09 §7 requires a deferred outfit to stay visibly
 * unresolved, and an app that quietly counted "decide later" as done would be
 * the silent approval the same clause forbids.
 */
export function isUnresolved(group: Pick<ReviewableGroup, 'status'>): boolean {
  return group.status !== 'approved'
}

/** Whether the walkthrough should stop here on this pass. */
export function needsReviewNow(group: Pick<ReviewableGroup, 'status' | 'deferredAt'>): boolean {
  return group.status !== 'approved' && group.deferredAt === null
}

/**
 * What this outfit is, in one or two words, beyond its name.
 *
 * Doc 09 §7 asks for multi-day and travel-day outfits to be MARKED. The audit
 * found the planner already treats them differently — `TRAVEL_TEMPLATE` takes
 * the first and last unspoken-for days, and `occurrences` counts the rest — but
 * nothing said so on the screen, so grouping was doing the work of marking and
 * Alex had no way to tell a two-day travel plan from a two-day activity.
 *
 * Every marker states a fact that is already stored. None of them is a judgement.
 */
export interface OutfitMarker {
  label: string
  /** One sentence saying what the marker means. Never a field name. */
  detail: string
}

export function outfitMarkers(group: ReviewableGroup): OutfitMarker[] {
  const markers: OutfitMarker[] = []

  if (templateFor(group.activityTag, group.name) === TRAVEL_TEMPLATE) {
    markers.push({
      label: group.occurrences === 1 ? 'Travel day' : 'Travel days',
      detail: 'The days you are getting there and back.',
    })
  }

  if (group.occurrences > 1) {
    markers.push({
      label: `Worn ${group.occurrences} days`,
      detail: 'One plan covering several days, not one outfit for each.',
    })
  }

  if (group.deferredAt !== null && group.status !== 'approved') {
    markers.push({
      label: 'Decided later',
      detail: 'Not on your packing list until you approve it.',
    })
  }

  if (group.status === 'incomplete') {
    markers.push({
      label: 'Missing something',
      detail: 'It cannot be approved until every required piece is filled.',
    })
  }

  return markers
}

/**
 * How much of the trip the approved outfits actually cover.
 *
 * Two different units on purpose, which is why doc 09 §7's own example puts both
 * in one sentence: `10 outfit needs covered by 7 approved outfits`. A NEED is a
 * day that wants an outfit; an OUTFIT is one plan, which can cover several days.
 * Counting either alone gives a number that looks like progress and is not — six
 * approved outfits sounds finished until you notice they cover four days of
 * twelve.
 */
export interface OutfitCoverage {
  /** Days across every planned group. */
  needs: number
  /** Days belonging to an APPROVED group. */
  covered: number
  approvedGroups: number
  totalGroups: number
  /** Groups Alex has answered either way — approved, or explicitly deferred. */
  reviewed: number
  /** Groups still not approved, deferred ones included. */
  unresolved: number
  deferred: number
  incomplete: number
}

export function outfitCoverage(groups: ReviewableGroup[]): OutfitCoverage {
  const approved = groups.filter((g) => !isUnresolved(g))
  const deferred = groups.filter((g) => isUnresolved(g) && g.deferredAt !== null)

  return {
    needs: groups.reduce((sum, g) => sum + g.occurrences, 0),
    covered: approved.reduce((sum, g) => sum + g.occurrences, 0),
    approvedGroups: approved.length,
    totalGroups: groups.length,
    reviewed: approved.length + deferred.length,
    unresolved: groups.filter(isUnresolved).length,
    deferred: deferred.length,
    incomplete: groups.filter((g) => g.status === 'incomplete').length,
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * The closing sentence doc 09 §7 asks the review to end on.
 *
 * States the shortfall when there is one. `10 outfit needs covered by 7 approved
 * outfits` is only honest once every need IS covered; saying it while four days
 * have no outfit would be the confident-but-wrong answer doc 09 §25 rules out,
 * so the partial case says "6 of 10" and the empty case says so plainly.
 */
export function coverageSentence(coverage: OutfitCoverage): string {
  const { needs, covered, approvedGroups } = coverage
  const outfits = `${approvedGroups} approved ${plural(approvedGroups, 'outfit', 'outfits')}`

  if (needs === 0) return 'No outfits planned yet.'
  if (approvedGroups === 0) {
    return `${needs} outfit ${plural(needs, 'need', 'needs')} to cover, none approved yet.`
  }
  if (covered >= needs) {
    return `${needs} outfit ${plural(needs, 'need', 'needs')} covered by ${outfits}.`
  }
  return `${covered} of ${needs} outfit ${plural(needs, 'need', 'needs')} covered by ${outfits}.`
}

/** "2 of 4 outfits reviewed" — the compact progress line, not a wizard's chrome. */
export function reviewProgress(coverage: OutfitCoverage): string {
  return `${coverage.reviewed} of ${coverage.totalGroups} ${plural(coverage.totalGroups, 'outfit', 'outfits')} reviewed`
}

/**
 * The breakdown behind the coverage sentence, in the categories doc 09 §7 names.
 *
 * Separate parts rather than one string, because the screen puts a spoken
 * separator between them — `·` is not announced at VoiceOver's default
 * punctuation level, so two facts joined by it run together with no pause.
 * That lesson was learned on the checklist in C1 and is not being relearned
 * here.
 *
 * Only non-zero categories appear. "0 left for later" is a fact about nothing.
 */
export function coverageBreakdown(groups: ReviewableGroup[]): string[] {
  /*
   * Takes the groups rather than the coverage, because the categories OVERLAP
   * and the summed version would be wrong.
   *
   * `OutfitCoverage.deferred` and `.incomplete` both count a deferred incomplete
   * outfit — correctly, since both are true of it. A breakdown built by adding
   * those two would count that outfit twice and then report a negative
   * remainder. So each group lands in exactly one bucket here, and the parts
   * always sum to the total.
   *
   * Deferral wins over incompleteness on purpose: "left for later" is the thing
   * Alex decided, and "missing a piece" is still visible on the outfit itself.
   */
  let approved = 0
  let deferred = 0
  let incomplete = 0
  let untouched = 0

  for (const group of groups) {
    if (!isUnresolved(group)) approved += 1
    else if (group.deferredAt !== null) deferred += 1
    else if (group.status === 'incomplete') incomplete += 1
    else untouched += 1
  }

  const parts: string[] = []
  if (approved > 0) parts.push(`${approved} approved`)
  if (deferred > 0) parts.push(`${deferred} left for later`)
  if (incomplete > 0) parts.push(`${incomplete} missing ${plural(incomplete, 'a piece', 'pieces')}`)
  // "0 left for later" is a fact about nothing, so only non-zero parts appear.
  if (untouched > 0) parts.push(`${untouched} not reviewed`)

  return parts
}

/**
 * The days no approved outfit covers.
 *
 * The half of the summary that is easiest to leave out and hardest to notice
 * missing: "7 approved outfits" sounds finished, and four uncovered days do not
 * announce themselves. Returns 0 when every need is met.
 */
export function uncoveredNeeds(coverage: OutfitCoverage): number {
  return Math.max(0, coverage.needs - coverage.covered)
}

/**
 * Why this outfit fits, in one or two short lines.
 *
 * Only from what is recorded. The formality band comes from the template that
 * planned the group; the day arithmetic comes from `wearings`, which is the
 * number the assignment actually used. Nothing here reads a brand, a colour or
 * a garment's name to decide what it can do — doc 09 §7 forbids inventing
 * capability, and inferring warmth or waterproofing from a name is the most
 * tempting way to do exactly that.
 *
 * The weather and the formality band are deliberately absent: the review shows
 * both as their own labelled facts, and repeating them here makes one fact look
 * like two. The first draft did exactly that — the screenshot showed
 * "Loungewear to Smart casual" as a fact and then again as the explanation,
 * directly beneath it. What belongs here is what the FACTS do not say: that the
 * filter actually bit, and how the days are covered.
 */
export function outfitFit(group: ReviewableGroup): string[] {
  const lines: string[] = []

  const template = templateFor(group.activityTag, group.name)
  if (template) {
    /*
     * Exactly what `passesFilters` guarantees, said in Alex's words: a garment
     * outside the band for this occasion cannot appear in this outfit at all.
     * It is a claim about the process, not about any garment, which is why it
     * is safe — nothing here reads a brand, a colour or a name to decide what a
     * piece can do.
     */
    lines.push(`Every piece suits ${group.name.toLowerCase()} at that level of dress.`)
  }

  if (group.occurrences > 1) {
    /*
     * The required slot that took the most garments to fill.
     *
     * That is the one worth explaining: a jacket worn on all six days needs no
     * comment, whereas three shirts for three days is the reuse rule visible in
     * the plan, and it is the question Alex would otherwise ask.
     */
    const byRole = new Map<string, { count: number; wearings: number }>()
    for (const slot of group.slots) {
      if (!slot.required || !slot.itemId) continue
      const seen = byRole.get(slot.roleLabel) ?? { count: 0, wearings: 0 }
      byRole.set(slot.roleLabel, { count: seen.count + 1, wearings: seen.wearings + slot.wearings })
    }

    let widest: { label: string; count: number } | null = null
    for (const [label, seen] of byRole) {
      if (widest === null || seen.count > widest.count) widest = { label, count: seen.count }
    }

    if (widest && widest.count > 1) {
      /*
       * "3 changes of top", not "3 tops".
       *
       * The role labels are a mix of singular and already-plural — Top, Bottoms,
       * Shoes, Swimwear — so counting them directly needs a pluraliser, and a
       * pluraliser is a small pile of special cases that will be wrong for the
       * first label anyone adds. Phrasing around it costs nothing and cannot
       * drift.
       */
      /*
       * And when laundry is what made the count smaller than the day count, it
       * says so — because a number that does not follow from the trip's length
       * is exactly the kind Alex should be able to check.
       *
       * The sentence is about the TRIP: four days of clothing. Never about the
       * garment, because laundry does not change what a t-shirt can do.
       */
      const laundry =
        widest.count < group.occurrences
          ? ` ${widest.count} days of clothing · laundry available.`
          : ''

      lines.push(
        `${widest.count} changes of ${widest.label.toLowerCase()} across the ${group.occurrences} days.${laundry}`,
      )
    } else if (widest) {
      lines.push(`The same pieces across all ${group.occurrences} days.`)
    }
  }

  return lines
}

/**
 * Spreads a group's days across the garments it already has.
 *
 * For an outfit Alex has APPROVED whose day count changed under it. Doc 04 §8
 * asks for quantities to be recalculated when a trip changes; the choice of
 * garment is his and is not touched, so this only moves the numbers — which
 * garment covers how many of the group's days.
 *
 * Per role, in the order the slots were planned, each garment taking as many
 * days as its reuse capacity allows. A group that cannot reach its new day count
 * is left short rather than having a garment worn past its capacity: saying the
 * plan falls short is honest, and quietly wearing a t-shirt for six days is not.
 */
export function redistributeWearings(
  slots: Array<{ role: SlotRole; item: Item | null; sortOrder: number }>,
  occurrences: number,
  reuseDefaults: ReuseDefaults = {},
): Map<number, number> {
  const wearings = new Map<number, number>()
  const byRole = new Map<SlotRole, Array<{ item: Item | null; sortOrder: number }>>()

  for (const slot of [...slots].sort((a, b) => a.sortOrder - b.sortOrder)) {
    byRole.set(slot.role, [...(byRole.get(slot.role) ?? []), slot])
  }

  for (const [, group] of byRole) {
    let remaining = occurrences
    for (const slot of group) {
      if (!slot.item) {
        wearings.set(slot.sortOrder, 0)
        continue
      }
      const capacity = reuseCapacity(slot.item, reuseDefaults)
      const take = Math.max(0, Math.min(remaining, capacity))
      wearings.set(slot.sortOrder, take)
      remaining -= take
    }
  }

  return wearings
}

/* ------------------------------------------------------------------ */
/* laundry                                                             */
/* ------------------------------------------------------------------ */

/**
 * How many days of ordinary clothing to carry when laundry is available.
 *
 * Alex's ruling, and a deliberately plain number rather than a formula: with a
 * washing machine, a fifth day of t-shirts is a wash cycle rather than another
 * t-shirt. Twelve days becomes four.
 *
 * **This is not a claim about the garment.** A t-shirt's `reuseCapacity` is
 * still 1 — laundry does not make a shirt wearable twice unwashed. It changes
 * how many DAYS of clothing have to be in the bag, which is a fact about the
 * trip, and the two are kept separate because conflating them would put a lie in
 * the explanation line.
 */
export const LAUNDRY_DAY_CAP = 4

/**
 * Below this the trip is short enough that laundry changes nothing.
 *
 * At or under the cap the arithmetic already produces the same number, but
 * stating the threshold means a four-day trip never renders a laundry
 * explanation for a quantity laundry did not affect.
 */
export const LAUNDRY_MIN_TRIP_DAYS = LAUNDRY_DAY_CAP + 1

/**
 * The subcategories laundry may reduce, and nothing else.
 *
 * An allowlist, because the failure modes are asymmetric: wrongly reducing a
 * swimsuit or a jacket leaves Alex short on a trip, and wrongly leaving
 * something out of the list costs him a t-shirt of luggage. So the default for
 * anything unrecognised is **no reduction** — which is also the ruling's
 * "items whose washing suitability is unknown" clause, since a `null`
 * subcategory says nothing about whether a thing can go in a machine.
 *
 * Read from `subcategory`, which is recorded catalog data. **Never from the
 * brand or the name.** "Lululemon" is not evidence and neither is "Athletic".
 *
 * Not here, and each for its own reason:
 *
 *   Outerwear, Mid-Layer   a layer is not what gets washed daily, and it is what
 *                          has to still be there while other clothes are in the
 *                          machine. Their reuse capacity already covers rewear.
 *   Shoes, Sandals         footwear, named in the ruling
 *   Swimwear               named in the ruling; overlapping activities need it
 *   Accessories            named in the ruling
 *   null                   unknown washing suitability
 */
const LAUNDRY_REDUCIBLE_SUBCATEGORIES = new Set([
  'T-Shirt',
  'Tank Top',
  'Shirt',
  'Pants',
  'Shorts',
  'Basics',
  'Underwear',
])

/**
 * Dressier than this and laundry leaves it alone.
 *
 * "Formal or event-specific garments" from the ruling, read off the recorded
 * `dressiness` rather than guessed from a name. A dress shirt for the one nice
 * dinner is not a thing you wash and re-wear on a rotation, and cutting it is
 * how Alex arrives at the restaurant without a shirt.
 */
const LAUNDRY_MAX_DRESSINESS = 2

/**
 * The slot roles laundry may shorten.
 *
 * An outer layer, a mid layer and shoes are what has to still be there while
 * everything else is in the machine, and swimwear can be needed on two
 * overlapping days — all named in the ruling, as are accessories. That leaves
 * the two roles a washing machine is actually about.
 */
const LAUNDRY_REDUCIBLE_ROLES = new Set<SlotRole>(['top', 'bottom'])

/**
 * Whether laundry may reduce how many of this garment are carried.
 *
 * Both conditions have to hold, and an unrecorded `dressiness` is treated as
 * unknown — the same "do not reduce what you cannot judge" rule as the
 * subcategory allowlist.
 */
export function laundryReducible(item: Item): boolean {
  if (item.subcategory === null) return false
  if (!LAUNDRY_REDUCIBLE_SUBCATEGORIES.has(item.subcategory)) return false

  /*
   * The DRESSIEST context it claims, and this is the one place in the
   * repository where collapsing the set to a single level is correct (H1c).
   *
   * It is correct because the question is a CEILING rather than a membership
   * test: laundry may shorten ordinary washable clothing, and a shirt that also
   * works Dressy is the dress shirt for the one nice dinner — precisely the
   * garment the laundry ruling says must never be cut. Reading the minimum
   * would start cutting it, because `Smart casual + Dressy` has a minimum of
   * Smart casual.
   *
   * An unrecorded set is unknown, and unknown is not reduced — the same "do not
   * reduce what you cannot judge" rule as the subcategory allowlist.
   */
  const highest = highestContext(item.dressinessContexts)
  if (highest === null) return false
  return levelOf(highest) <= LAUNDRY_MAX_DRESSINESS
}

export interface DemandOptions {
  /**
   * Days of clothing to carry, or null for no cap.
   *
   * Null on a trip where Alex said there is no laundry, on one where he has not
   * answered, and on one short enough that the cap cannot bite — three different
   * situations that all mean "change nothing".
   */
  laundryDayCap?: number | null
}

export interface Demand {
  item: Item
  quantity: number
  groups: string[]
  /** Days of wear the plan asked for, before reuse divides them. */
  daysOfWear: number
  /** Whether laundry is what shortened the plan this quantity came from. */
  laundryCapped: boolean
  /**
   * Why this row is on the list, when naming the outfits does not answer it.
   *
   * Null for everything the outfits themselves ask for — "Worn for Beach and
   * Nice dinners" is the honest sentence there, and composing it where the row
   * is written keeps one wording. A tank top paired with a swimsuit is the case
   * that needs its own: it is on the list because of another GARMENT rather than
   * because an outfit named it, and "Worn for Beach" would be claiming the
   * planner put it in a slot it was never in.
   */
  reason?: string | null
}

/**
 * How many of each garment the trip needs, from the assignment.
 *
 * This is what the clothing half of the checklist is built from: approved
 * outfits are the source of truth for clothing (doc 04 §8), so the quantity is
 * simply how many times the plan calls for the item, capped by reuse.
 *
 * The laundry cap is **reported** here and **applied** in `assign`. It has to
 * bite where the plan decides how many changes of a garment a group needs, not
 * on the roll-up afterwards: a twelve-day casual group already picks twelve
 * different t-shirts at one wearing each, so no single garment's total ever
 * exceeds four to be capped.
 */
export function clothingDemand(
  groups: FilledGroup[],
  options: DemandOptions = {},
): Map<string, Demand> {
  const demand = new Map<string, Demand>()
  const cap = options.laundryDayCap ?? null

  for (const group of groups) {
    for (const slot of group.slots) {
      if (!slot.item) continue
      const wearings = slot.wearings

      const shortened =
        cap !== null &&
        group.occurrences > cap &&
        LAUNDRY_REDUCIBLE_ROLES.has(slot.role) &&
        laundryReducible(slot.item)

      const existing = demand.get(slot.item.id)
      if (existing) {
        existing.daysOfWear += wearings
        existing.laundryCapped = existing.laundryCapped || shortened
        if (!existing.groups.includes(group.name)) existing.groups.push(group.name)
      } else {
        demand.set(slot.item.id, {
          item: slot.item,
          quantity: 0,
          groups: [group.name],
          daysOfWear: wearings,
          laundryCapped: shortened,
        })
      }
    }
  }

  for (const entry of demand.values()) {
    // Wearing a jacket on six days does not mean packing six jackets.
    entry.quantity = Math.max(1, Math.ceil(entry.daysOfWear / reuseCapacity(entry.item)))
  }

  return demand
}

/* ------------------------------------------------------------------ */
/* swimwear and the tank tops that go with it                          */
/* ------------------------------------------------------------------ */

/**
 * Read from `subcategory`, which is recorded catalog data — never from a name.
 *
 * Exported because `coverageGaps` counts the same two things off the checklist
 * to report a shortfall, and two spellings of `Tank Top` is how a rule and the
 * warning about it start disagreeing.
 *
 * ## How often this rule actually does anything
 *
 * Less often than it looks, and that is the point. The ranker prefers a tank top
 * to a t-shirt for an ordinary top slot, so on most trips the travel and casual
 * days pick enough of them up and the pairing finds nothing to do — which is the
 * brief's "do not add another copy solely because the same garment already
 * fulfills the rule", arrived at by counting rather than by a special case.
 *
 * It bites on the short, swim-heavy trip: few other top slots to carry tank
 * tops, one optional swim top however many pool days there are, and a third
 * swimsuit that would otherwise go in the bag with nothing to wear over it.
 * `tests/integration/swimwear.test.ts` holds that case end to end.
 */
export const SWIM_SUBCATEGORY = 'Swimwear'
export const TANK_SUBCATEGORY = 'Tank Top'

export interface SwimPairing {
  /** Swimwear garments the plan is packing. */
  swimwear: number
  /** Tank tops already packed, for any reason at all. */
  tankTopsAlready: number
  /** Tank tops added by this rule, in the order they were drawn. */
  added: Item[]
  /**
   * How many more the pairing wanted and the wardrobe does not contain.
   *
   * Zero on every ordinary trip. Non-zero is a fact about Alex's wardrobe, and
   * `coverageGaps` is where a fact like that is said out loud — inventing a
   * garment to close it is the one thing this must never do (doc 04 §15).
   */
  short: number
}

/**
 * One tank top packed for every swimsuit packed.
 *
 * Alex's rule, and it is about **physical garments**, not checklist rows: three
 * swimsuits means three tank tops are in the bag, however many rows say so.
 * Since one catalog row is one garment — the workbook writes five Swim Trunks as
 * five rows — counting rows and counting garments are the same count here, and
 * `quantity` is what makes that true for a row that ever means more than one.
 *
 * ## Why this is a pass over demand rather than a slot
 *
 * The swim templates already carry an optional `top`, and it is not the answer.
 * `assign` takes ONE garment for an optional slot (see the `!spec.required`
 * break) and a tank top's reuse capacity is 1 — so a five-day pool trip planned
 * a single tank top, which is the under-packing this fixes. Making the slot
 * required instead would pack one per swim DAY, which is five, and Alex asked
 * for one per suit, which is three.
 *
 * ## Why it counts what is already there
 *
 * A tank top the plan is packing for hot afternoons is a tank top in the bag. It
 * satisfies this rule, and adding a second copy because two rules both want one
 * would be the duplication the brief rules out. What one garment may NOT do is
 * be worn twice at once — which is why the comparison is over counts of distinct
 * packed garments rather than over rows.
 */
export function pairTankTopsWithSwimwear(
  demand: Map<string, Demand>,
  wardrobe: Item[],
): SwimPairing {
  const packed = (subcategory: string) =>
    [...demand.values()]
      .filter((entry) => entry.item.subcategory === subcategory)
      .reduce((total, entry) => total + entry.quantity, 0)

  const swimwear = packed(SWIM_SUBCATEGORY)
  const tankTopsAlready = packed(TANK_SUBCATEGORY)

  const pairing: SwimPairing = { swimwear, tankTopsAlready, added: [], short: 0 }

  // No swimwear, no rule. This is what keeps a Loungewear marking from ever
  // reaching swim need: the trigger is the plan, and the plan comes from the
  // itinerary.
  if (swimwear === 0) return pairing

  const wanted = swimwear - tankTopsAlready
  if (wanted <= 0) return pairing

  /*
   * Drawn in catalog order rather than ranked.
   *
   * Ranking needs an occasion to rank against and there is not one — this is not
   * an outfit, it is "one more tank top in the bag". A stable order is what the
   * answer actually needs, so the same wardrobe produces the same choice twice.
   */
  const spare = wardrobe
    .filter((item) => item.subcategory === TANK_SUBCATEGORY && !demand.has(item.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  pairing.added = spare.slice(0, wanted)
  pairing.short = wanted - pairing.added.length

  return pairing
}

/**
 * What Alex puts on his feet at the pool.
 *
 * `Sandals` is the recorded subcategory, and in this wardrobe it holds exactly
 * the two garments the rule is about — the Birkenstocks and the Nike slides.
 * That is the whole reason it is read rather than the name or the brand: the
 * structured field already draws the line, and "Birkenstock" is a brand that
 * also makes closed shoes while "slides" is a word that appears in nothing.
 *
 * A dressier sandal bought later would also qualify. That is the safe direction
 * to be wrong in — it declines to raise a shortfall about footwear Alex owns,
 * rather than insisting on a specific pair he does not.
 */
export const SWIM_FOOTWEAR_SUBCATEGORY = 'Sandals'

export interface SwimFootwear {
  /** Swimwear garments the plan is packing. */
  swimwear: number
  /** True when a qualifying pair is already on the list, for any reason. */
  alreadyPacked: boolean
  /** The pair this rule added, or null. Never more than one. */
  added: Item | null
  /** True when swimwear is packed and the wardrobe has no qualifying pair. */
  short: boolean
}

/**
 * One pair of sandals for the whole trip, not one per swimsuit.
 *
 * The difference from the tank tops is the point, and it is Alex's ruling rather
 * than an inference: a swimsuit is worn wet and a second one earns its place in
 * the bag, while one pair of slides walks to the pool every day of the trip.
 * So this asks a yes/no question where `pairTankTopsWithSwimwear` counts.
 *
 * Everything else matches that rule deliberately — triggered by swimwear in the
 * PLAN rather than by any garment's dressiness, satisfied by a pair already
 * packed for another reason, drawn only from what Alex owns, and silent when
 * there is no swimwear at all.
 */
export function ensureSwimFootwear(
  demand: Map<string, Demand>,
  wardrobe: Item[],
): SwimFootwear {
  const swimwear = [...demand.values()]
    .filter((entry) => entry.item.subcategory === SWIM_SUBCATEGORY)
    .reduce((total, entry) => total + entry.quantity, 0)

  const result: SwimFootwear = { swimwear, alreadyPacked: false, added: null, short: false }
  if (swimwear === 0) return result

  /*
   * A pair already on the list settles it, whatever put it there. Adding a
   * second pair because two rules both wanted sandals is the duplication this
   * is explicitly not allowed to produce.
   */
  result.alreadyPacked = [...demand.values()].some(
    (entry) => entry.item.subcategory === SWIM_FOOTWEAR_SUBCATEGORY,
  )
  if (result.alreadyPacked) return result

  /*
   * Choosing between the Birkenstocks and the slides, from signals that already
   * exist rather than a new one invented for footwear.
   *
   * How often Alex actually wears it first — `usageFrequency` is his own
   * recorded answer and the most direct statement of preference the catalog
   * holds. Comfort breaks a tie, because this is the pair walking to the pool
   * every day. The id breaks the last one, so the same wardrobe never produces
   * two different answers.
   */
  const byPreference = wardrobe
    .filter((item) => item.subcategory === SWIM_FOOTWEAR_SUBCATEGORY && !demand.has(item.id))
    .sort((a, b) => {
      const worn = USAGE_ORDER.indexOf(a.usageFrequency) - USAGE_ORDER.indexOf(b.usageFrequency)
      if (worn !== 0) return worn
      const comfort = (b.comfort ?? 0) - (a.comfort ?? 0)
      if (comfort !== 0) return comfort
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  result.added = byPreference[0] ?? null
  result.short = result.added === null

  return result
}

/** Most worn first. `new` last, because it says nothing about preference. */
const USAGE_ORDER: Array<Item['usageFrequency']> = ['frequent', 'sometimes', 'rare', 'new']

/* ------------------------------------------------------------------ */
/* why this outfit                                                     */
/* ------------------------------------------------------------------ */

/** What the outfit-level sentence is built from. One entry per filled slot. */
export interface ExplainableSlot {
  /** The slot's stored `decidedBy` — the criterion that actually separated it. */
  reason: string | null
  /** `user_swap` when Alex put this garment in the slot himself. */
  filledBy?: string | null
}

/**
 * One sentence answering "why this outfit?", built only from what decided it.
 *
 * ## It aggregates, it does not re-reason
 *
 * Every reason here is a slot's `decidedBy` — the criterion that actually
 * separated the chosen garment from its runner-up, computed once by `rank` and
 * stored on the slot. Nothing is recomputed and nothing is inferred from the
 * finished outfit, which is the difference between an explanation and a
 * plausible-sounding description: a garment can be comfortable, versatile and
 * warm and have been chosen for none of those things.
 *
 * `rank` is already silent where a criterion had nothing to say (H1b) — a
 * criterion where either side is null did not separate them and is not recorded.
 * So this cannot name comfort when comfort was unrated; that guarantee is
 * inherited rather than re-implemented.
 *
 * ## Alex's own choice ends the sentence
 *
 * A slot he filled himself is not a recommendation, and dressing it up in
 * planner reasons would be the app taking credit for his decision — which is
 * also how an approved outfit ends up "justified" by signals that did not select
 * it. One user-chosen slot is enough for the outfit to be his.
 *
 * ## Why the clauses are ordered by the criteria list
 *
 * `CRITERIA` is a lexicographic priority order, so a reason from an earlier
 * criterion is a stronger reason. Ordering by index rather than by how often a
 * reason appears means three slots agreeing on comfort cannot outrank the one
 * slot that was decided by the forecast.
 */
export function explainOutfit(slots: ExplainableSlot[]): string | null {
  if (slots.some((slot) => slot.filledBy === 'user_swap')) return 'You chose this one.'

  /*
   * Matched against `name`, which is what `rank` writes for every criterion but
   * one. The exception — the pairing criterion — writes the partner's name
   * through `explain`, which is a better sentence than any fragment and is
   * treated as its own clause below.
   */
  const ranked = new Map<number, string>()
  let pairing = false

  for (const slot of slots) {
    if (!slot.reason) continue

    const index = CRITERIA.findIndex((criterion) => criterion.name === slot.reason)
    if (index >= 0) {
      const clause = CRITERIA[index]!.clause
      if (clause) ranked.set(index, clause)
      continue
    }

    /*
     * An unrecognised reason is the pairing criterion's own sentence ("You
     * approved this with the Field Shell before") or a reason written by an
     * older release. Either way it is not ours to reword, and naming the
     * relationship generically is the honest summary of it.
     */
    if (slot.reason.startsWith('You approved this with')) pairing = true
  }

  if (pairing) {
    // By NAME, which is the criterion's identity. Finding it by its clause text
    // meant rewording the copy silently dropped the pairing reason from the
    // sentence, with nothing failing — the reason it is not done that way now.
    const index = CRITERIA.findIndex((criterion) => criterion.name === PAIRING_CRITERION)
    const clause = index >= 0 ? CRITERIA[index]!.clause : undefined
    if (clause) ranked.set(index, clause)
  }

  const clauses = [...ranked.entries()].sort((a, b) => a[0] - b[0]).map(([, clause]) => clause)
  if (clauses.length === 0) return null

  return `Chosen because it ${joinClauses(clauses.slice(0, MAX_REASONS))}.`
}

/** The criterion whose `explain` writes a partner's name instead of its `name`. */
const PAIRING_CRITERION = 'You wear these together'

/**
 * "a", "a, and b", "a, b, and c" — with the serial comma, unlike `joinNames`.
 *
 * Not an inconsistency with the rest of the app: `joinNames` joins NAMES, where
 * "Passport, Phone and Wallet" is unambiguous and the extra comma is clutter.
 * These are PREDICATES, and without the comma the last two run together —
 * *includes things you reach for and is more comfortable* invites a first
 * reading where the reaching and the comfort are one clause about one garment.
 *
 * Small and local for the same reason the clause text lives on the criterion:
 * this is the grammar of one sentence, and a shared helper reworded for it would
 * change every list in the app.
 */
function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? ''
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`
}

/**
 * Three, and the number is a judgement about reading rather than about data.
 *
 * A fourth clause pushes the sentence onto a third line at 390px, and by then it
 * has stopped being an explanation and become a list — which is the failure doc
 * 03 §12 describes, where an explanation nobody finishes reading is worth less
 * than a shorter one they do.
 */
const MAX_REASONS = 3
