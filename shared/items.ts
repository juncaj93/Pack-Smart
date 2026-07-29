/**
 * The My Stuff domain: one unified catalog of clothing and gear.
 *
 * Product doc 02 §10 makes My Stuff a single management area rather than
 * separate Clothing and Non-Clothing destinations, so the API is one shape with
 * a `kind` discriminator and nullable kind-specific fields.
 */

export type ItemKind = 'clothing' | 'gear'

export type UsageFrequency = 'frequent' | 'sometimes' | 'rare' | 'new'

export type PackingTiming = 'anytime' | 'night_before' | 'day_of' | 'last_minute'

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
  anytime: 'Pack anytime',
  night_before: 'Night before',
  day_of: 'Day of departure',
  last_minute: 'Last minute',
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
    case 'Documents':
      return { kind: 'gear', isCritical: true, requiresFinalCheck: true, defaultPackingTiming: 'last_minute' }
    case 'Electronics':
      return { kind: 'gear', defaultPackingTiming: 'night_before' }
    case 'Vision':
      return { kind: 'gear', isCritical: true, requiresFinalCheck: true }
    default:
      return { kind: 'gear' }
  }
}
