/**
 * The My Stuff domain: one unified catalog of clothing and gear.
 *
 * Product doc 02 §10 makes My Stuff a single management area rather than
 * separate Clothing and Non-Clothing destinations, so the API is one shape with
 * a `kind` discriminator and nullable kind-specific fields.
 */

export type ItemKind = 'clothing' | 'gear'

export type UsageFrequency = 'frequent' | 'sometimes' | 'rare' | 'new'

/**
 * When something gets packed. Two answers, because there were only ever two.
 *
 * This used to offer four — `anytime`, `night_before`, `day_of`, `last_minute` —
 * and `sectionFor` folded them into two: the first pair both meant *Pack now* and
 * the second pair both meant *Pack later*. Choosing "Night before" over "Pack
 * anytime" changed nothing the app did, on any screen, ever. Four chips, two
 * outcomes, and no way for Alex to tell which pairs were the same.
 *
 * `night_before` normalises to `anytime` and `last_minute` to `day_of`, which is
 * exactly the grouping the engine was already applying — so no packing list, no
 * section, and no row moves as a result of this change.
 */
export type PackingTiming = 'anytime' | 'day_of'

/** What the removed values mean now. Behaviour-preserving, by construction. */
export const RETIRED_TIMINGS: Record<string, PackingTiming> = {
  night_before: 'anytime',
  last_minute: 'day_of',
}

/**
 * Reads a stored timing, including one written before the vocabulary shrank.
 *
 * There is no migration rewriting the old rows, deliberately. The CHECK
 * constraints still admit all four values, the route layer refuses to write a
 * retired one, and this turns whatever is stored into one of the two survivors —
 * so a `night_before` sitting in the database from before the change is invisible
 * rather than wrong. Rewriting those rows would be the first data rewrite in this
 * repository's history in exchange for tidiness in a column nobody reads directly:
 * the wrong side of "delete code, not data".
 *
 * Every read goes through here rather than trusting the column.
 */
export function readTiming(stored: string): PackingTiming {
  if (stored === 'anytime' || stored === 'day_of') return stored
  return RETIRED_TIMINGS[stored] ?? 'anytime'
}

/** Filter buckets, from product doc 02 §10. */
export const CLOTHING_CATEGORIES = [
  'Tops & Outerwear',
  'Bottoms & Swimwear',
  'Footwear',
  'Accessories & Undergarments',
] as const

export const GEAR_CATEGORIES = [
  'Toiletries',
  'Electronics',
  'Medication',
  'Documents',
  'Travel Gear',
  'Vision',
  'Grooming',
] as const

export const ALL_CATEGORIES = [...CLOTHING_CATEGORIES, ...GEAR_CATEGORIES] as const

export function categoryKind(category: string): ItemKind {
  return (CLOTHING_CATEGORIES as readonly string[]).includes(category) ? 'clothing' : 'gear'
}

/**
 * Warmth and dressiness are small ordered scales rather than free text, because
 * the outfit ranker compares them numerically. The labels are what Alex sees.
 */
export const WARMTH_LABELS = ['Cool', 'Light', 'Warm', 'Very warm'] as const
export const DRESSINESS_LABELS = [
  'Loungewear',
  'Casual',
  'Smart casual',
  'Dressy',
  'Formal',
] as const

export const USAGE_FREQUENCY_LABELS: Record<UsageFrequency, string> = {
  frequent: 'Frequently used',
  sometimes: 'Sometimes used',
  rare: 'Rarely used',
  new: 'New / not sure',
}

export const PACKING_TIMING_LABELS: Record<PackingTiming, string> = {
  anytime: 'Anytime',
  day_of: 'Day of Departure',
}

/** What the API returns. */
export interface Item {
  id: string
  kind: ItemKind
  displayName: string
  category: string
  subcategory: string | null
  color: string | null
  pattern: string | null
  brand: string | null
  notes: string | null
  favorite: boolean
  usageFrequency: UsageFrequency
  warmth: number | null
  dressiness: number | null
  weatherTags: string[]
  typicalUses: string[]
  reuseCapacity: number | null
  ownedQuantity: number | null
  isCritical: boolean
  requiresFinalCheck: boolean
  defaultPackingTiming: PackingTiming
  alwaysInclude: boolean
  neverInclude: boolean
  archivedAt: number | null
  source: 'seed_import' | 'manual' | 'trip_promoted'
  createdAt: number
  updatedAt: number
}

/** What the client sends when creating or editing. */
export interface ItemInput {
  kind?: ItemKind
  displayName: string
  category: string
  subcategory?: string | null
  color?: string | null
  pattern?: string | null
  brand?: string | null
  notes?: string | null
  favorite?: boolean
  usageFrequency?: UsageFrequency
  warmth?: number | null
  dressiness?: number | null
  weatherTags?: string[]
  typicalUses?: string[]
  reuseCapacity?: number | null
  ownedQuantity?: number | null
  isCritical?: boolean
  requiresFinalCheck?: boolean
  defaultPackingTiming?: PackingTiming
  alwaysInclude?: boolean
  neverInclude?: boolean
}

export interface ItemListResponse {
  items: Item[]
  /** Categories actually present, so the UI never shows an empty filter chip. */
  categories: string[]
  activeCount: number
  archivedCount: number
  /**
   * How many trips each item has actually been **packed** on, by item id.
   *
   * Beside `items` rather than on `Item`, because it is not a property of the
   * garment — it is a fact about Alex's trips that happens to be indexed by one.
   * Putting it on the row model would mean every write path had to carry a number
   * it cannot know and must never send back.
   *
   * Absent keys mean zero. Only items with at least one packed trip appear, which
   * on a wardrobe of 119 and a handful of trips is a much smaller object than a
   * full map of mostly zeroes.
   */
  packedTripCounts: Record<string, number>
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  ok: boolean
  errors: Record<string, string>
}

const MAX_NAME = 120
const MAX_NOTES = 2_000

/**
 * Deliberately permissive about optional fields.
 *
 * Product doc 05 §8: saving must not require all optional data. Only a name and
 * a real category are demanded; everything else can be filled in later or never.
 * Colour and typical use are "required" in the doc's *form* sense — the fields
 * are shown up front — but refusing to save without them would cost more than it
 * gains when Alex is adding twenty garments on a phone.
 */
export function validateItemInput(input: Partial<ItemInput>): ValidationResult {
  const errors: Record<string, string> = {}

  const name = (input.displayName ?? '').trim()
  if (name.length === 0) errors.displayName = 'Give this a name.'
  else if (name.length > MAX_NAME) errors.displayName = `Keep the name under ${MAX_NAME} characters.`

  const category = (input.category ?? '').trim()
  if (category.length === 0) errors.category = 'Pick a category.'
  else if (!(ALL_CATEGORIES as readonly string[]).includes(category)) {
    errors.category = 'That is not a category Pack Smart knows.'
  }

  if (input.notes && input.notes.length > MAX_NOTES) {
    errors.notes = `Keep notes under ${MAX_NOTES} characters.`
  }

  if (input.warmth != null && (input.warmth < 0 || input.warmth > 3)) {
    errors.warmth = 'Warmth must be between 0 and 3.'
  }

  if (input.dressiness != null && (input.dressiness < 0 || input.dressiness > 4)) {
    errors.dressiness = 'Dressiness must be between 0 and 4.'
  }

  if (input.ownedQuantity != null && (input.ownedQuantity < 0 || !Number.isInteger(input.ownedQuantity))) {
    errors.ownedQuantity = 'How many you own must be a whole number.'
  }

  if (
    input.usageFrequency != null &&
    !['frequent', 'sometimes', 'rare', 'new'].includes(input.usageFrequency)
  ) {
    errors.usageFrequency = 'Unknown usage frequency.'
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * Category defaults, so adding a garment needs as little typing as possible
 * (product doc 05 §8: "use category defaults to reduce typing").
 *
 * Everything here is a starting point Alex can override, never a claim about the
 * specific garment.
 */
export function defaultsForCategory(category: string): Partial<ItemInput> {
  switch (category) {
    case 'Tops & Outerwear':
      return { kind: 'clothing', warmth: 2, dressiness: 1, reuseCapacity: 3 }
    case 'Bottoms & Swimwear':
      return { kind: 'clothing', warmth: 1, dressiness: 1, reuseCapacity: 3 }
    case 'Footwear':
      return { kind: 'clothing', warmth: 1, dressiness: 1, reuseCapacity: 99 }
    case 'Accessories & Undergarments':
      return { kind: 'clothing', warmth: 1, dressiness: 1, reuseCapacity: 1 }
    case 'Medication':
      return { kind: 'gear', isCritical: true, requiresFinalCheck: true, defaultPackingTiming: 'anytime' }
    /*
     * Documents are packed on the day and confirmed before leaving — that is what
     * `last_minute` meant here, and `day_of` is the surviving name for it.
     */
    case 'Documents':
      return { kind: 'gear', isCritical: true, requiresFinalCheck: true, defaultPackingTiming: 'day_of' }
    /*
     * Electronics defaulted to `night_before`, which the engine has always treated
     * as Pack now. `anytime` says the same thing without pretending otherwise.
     */
    case 'Electronics':
      return { kind: 'gear', defaultPackingTiming: 'anytime' }
    case 'Vision':
      return { kind: 'gear', isCritical: true, requiresFinalCheck: true }
    default:
      return { kind: 'gear' }
  }
}

/**
 * The second line under a garment's name: who made it, and which one it is (G6).
 *
 * The title says what a thing IS. Until G6 it also said the brand and the
 * colour, because the importer composed all three into one string — so the
 * spreadsheet's `Zip-Up Jacket` / `Columbia` / `Black` became the single name
 * "Black Columbia Zip-Up Jacket", with `brand` and `color` sitting beside it
 * saying the same words again.
 *
 * Taking them out of the title is only half an answer. Alex owns seven
 * quarter-zips and five zip-up jackets; a list of seven rows all reading
 * `Quarter-Zip` is worse than the repetition it replaced. So the fields the
 * title stopped repeating are shown as their own line, from one function, so
 * that no two screens can disagree about what distinguishes two garments.
 *
 * Empty for anything with neither recorded — a bare middot under a name would
 * be a placeholder standing in for a fact nobody has.
 */
export function garmentDetail(item: {
  brand?: string | null
  color?: string | null
  pattern?: string | null
}): string | null {
  const parts = [item.brand, item.color, item.pattern]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}
