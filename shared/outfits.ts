import { DRESSINESS_LABELS, type Item } from './items'
import { hasWeatherCapability, type ConditionDemand, type WeatherCapability } from './weather-fit'

/**
 * Outfit planning.
 *
 * Two stages, never one score (03_INTELLIGENCE_DESIGN.md §7). Hard filters
 * eliminate; scoring only orders what survived. A single weighted score is what
 * produces plausible-looking nonsense — a loungewear quarter-zip winning a nice
 * dinner because it scored well on "favorite" — and filtering first makes
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

  const [minDress, templateMax] = context.template.dressiness
  const cap = context.maxDressiness
  // Never below the template's own floor — see the note on maxDressiness.
  const maxDress = cap === null || cap === undefined ? templateMax : Math.max(minDress, Math.min(templateMax, cap))

  if (item.dressiness !== null && (item.dressiness < minDress || item.dressiness > maxDress)) {
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

  // A garment with no recorded uses is not excluded — the spreadsheet simply did
  // not say. Excluding it would punish missing data rather than unsuitability.
  const wanted = context.template.uses
  if (wanted.length > 0 && item.typicalUses.length > 0) {
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
  scores: number[]
  /** Which criterion put this item on top. Empty when nothing distinguished it. */
  decidedBy: string | null
}

const CRITERIA: Array<{
  name: string
  score: (item: Item, context: RankContext) => number
  /**
   * A sentence naming the specific evidence, when the criterion has any.
   *
   * `name` alone answers "why this one?" for criteria that are properties of the
   * garment ("A favourite"). A pairing is a RELATIONSHIP, so the useful answer
   * names the other garment. Falls back to `name` when this returns null.
   */
  explain?: (item: Item, context: RankContext) => string | null
}> = [
  { name: 'You asked for it', score: (i, c) => (c.requestedItemIds.has(i.id) ? 1 : 0) },
  /*
   * Doc 04 §5 criterion 2 — "activity and weather suitability" — which until now
   * had no representation here at all. Activity suitability is a hard filter in
   * stage 1 and rightly so; weather suitability could not be, because wind is
   * not worth emptying the jacket slot over. So it lands here, above favourite,
   * exactly where the approved order puts it.
   *
   * Scores 0 for everything when the conditions ask for nothing, so a trip with
   * no forecast ranks precisely as it did before.
   */
  {
    name: 'Suits the conditions',
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
   * "A favourite", because what he actually wore together is better evidence
   * than what he once starred.
   *
   * With no pairing history every score here is 0 and `compare` moves straight
   * to the next criterion — so a first trip ranks exactly as it did before this
   * existed. That property is what makes it safe to add to a working planner.
   */
  {
    name: 'You wear these together',
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
  { name: 'A favorite', score: (i) => (i.favorite ? 1 : 0) },
  { name: 'You wear it often', score: (i) => FREQUENCY_RANK[i.usageFrequency] ?? 0 },
  // Versatility: a garment usable for more of this trip earns its place in the bag.
  { name: 'Works for several days', score: (i) => i.typicalUses.length },
  // Reuse efficiency: prefer something already packed over adding another item,
  // but only while it has capacity left.
  {
    name: 'Already packed for another day',
    score: (i, c) => {
      const used = c.usedCount.get(i.id) ?? 0
      const capacity = reuseCapacity(i, c.reuseDefaults)
      return used > 0 && used < capacity ? 1 : 0
    },
  },
  // Variety: all else equal, do not wear the same thing every day.
  { name: 'Something different', score: (i, c) => -(c.usedCount.get(i.id) ?? 0) },
]

function compare(a: RankedCandidate, b: RankedCandidate): number {
  for (let i = 0; i < a.scores.length; i += 1) {
    const diff = (b.scores[i] ?? 0) - (a.scores[i] ?? 0)
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
    const index = winner.scores.findIndex((value, i) => value !== (runnerUp.scores[i] ?? 0))
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
  const usedCount = new Map<string, number>()
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
      preferredCapabilities,
      chosenInGroup,
      ...(options.pairings ? { pairings: options.pairings } : {}),
      ...(options.reuseDefaults ? { reuseDefaults: options.reuseDefaults } : {}),
    }

    const specs = demand?.rain
      ? [
          ...group.template.slots.filter((s) => s.role !== 'outer'),
          { role: 'outer' as SlotRole, required: true },
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
        slots.push({
          role: spec.role, required: spec.required, item: null,
          wearings: 0, unmetReason: reason, reason: null,
        })
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

      while (covered < target) {
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
      lines.push(
        `${widest.count} changes of ${widest.label.toLowerCase()} across the ${group.occurrences} days.`,
      )
    } else if (widest) {
      lines.push(`The same pieces across all ${group.occurrences} days.`)
    }
  }

  return lines
}

/**
 * How many of each garment the trip needs, from the assignment.
 *
 * This is what the clothing half of the checklist is built from: approved
 * outfits are the source of truth for clothing (doc 04 §8), so the quantity is
 * simply how many times the plan calls for the item, capped by reuse.
 */
export function clothingDemand(groups: FilledGroup[]): Map<string, { item: Item; quantity: number; groups: string[] }> {
  const demand = new Map<string, { item: Item; quantity: number; groups: string[] }>()

  for (const group of groups) {
    for (const slot of group.slots) {
      if (!slot.item) continue
      const wearings = slot.wearings

      const existing = demand.get(slot.item.id)
      if (existing) {
        existing.quantity += wearings
        if (!existing.groups.includes(group.name)) existing.groups.push(group.name)
      } else {
        demand.set(slot.item.id, { item: slot.item, quantity: wearings, groups: [group.name] })
      }
    }
  }

  // Wearing a jacket on six days does not mean packing six jackets.
  for (const entry of demand.values()) {
    entry.quantity = Math.max(1, Math.ceil(entry.quantity / reuseCapacity(entry.item)))
  }

  return demand
}
