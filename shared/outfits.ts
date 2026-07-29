import type { Item } from './items'
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
}

export interface RankedCandidate {
  item: Item
  scores: number[]
  /** Which criterion put this item on top. Empty when nothing distinguished it. */
  decidedBy: string | null
}

const CRITERIA: Array<{ name: string; score: (item: Item, context: RankContext) => number }> = [
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
  { name: 'A favourite', score: (i) => (i.favorite ? 1 : 0) },
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
    winner.decidedBy = index >= 0 ? (CRITERIA[index]?.name ?? null) : null
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

    const rankContext: RankContext = {
      requestedItemIds: options.requestedItemIds ?? new Set(),
      usedCount,
      preferredCapabilities,
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
