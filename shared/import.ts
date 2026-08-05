/**
 * Workbook import: normalization, deduplication, and rule parsing.
 *
 * All pure functions over already-parsed rows, so every rule in
 * technical-docs/04_IMPORT_PLAN.md is directly testable without a database or a
 * file picker.
 *
 * The governing principle (product doc 05 §4): nothing ambiguous is silently
 * discarded and nothing missing is invented. A row that will not parse cleanly
 * still imports — it is the *rule* that gets flagged, never the item dropped.
 */

import type { ItemInput } from './items'

/* ------------------------------------------------------------------ */
/* clothing                                                            */
/* ------------------------------------------------------------------ */

export interface ClothingSource {
  majorCategory: string
  subcategory: string
  description: string
  brand: string
  color: string
  styleUse: string
  notes: string
  rowNumber: number
}

export interface NormalizedGarment {
  source: ClothingSource
  displayName: string
  category: string
  subcategory: string
  brand: string | null
  color: string | null
  pattern: string | null
  ownedQuantity: number | null
  typicalUses: string[]
  warmth: number | null
  dressiness: number | null
  notes: string | null
  /**
   * The colour exactly as the spreadsheet wrote it, lower-cased.
   *
   * Deduplication compares THIS, never the split colour. Splitting first is what
   * makes "Black" and "Black & Gray" look identical, which silently merged two
   * genuinely different Columbia jackets into one and lost a garment.
   */
  rawColor: string
  /** Non-blocking notes for the review screen — derived values, not source data. */
  derived: string[]
  /** Identity used by dedup tier 2. */
  identityHash: string
}

const PLACEHOLDER_COLORS = new Set(['unspecified', 'n/a', 'na', 'none', '', '-'])
const NON_BRANDS = new Set(['unbranded', ''])

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Pulls a count out of a description, e.g. "Boxer Briefs (~15 Pairs)".
 *
 * "Multiple" is deliberately *not* guessed at — it becomes a review note with a
 * null quantity, because inventing "several = 5" is exactly the fabrication the
 * product forbids.
 */
export function extractQuantity(description: string): {
  name: string
  quantity: number | null
  unknownQuantity: boolean
} {
  const bracket = /\s*\(([^)]*)\)\s*$/.exec(description)
  if (!bracket?.[1]) return { name: squash(description), quantity: null, unknownQuantity: false }

  const inner = bracket[1]
  const name = squash(description.slice(0, bracket.index))

  const number = /~?\s*(\d+)\s*(pair|pairs|pcs|pieces)?/i.exec(inner)
  if (number?.[1]) return { name, quantity: Number(number[1]), unknownQuantity: false }

  if (/multiple|several|many|various/i.test(inner)) {
    return { name, quantity: null, unknownQuantity: true }
  }

  // A bracket that is not a quantity — a qualifier like "(New)". Keep it.
  return { name: squash(description), quantity: null, unknownQuantity: false }
}

/** "Green / White" -> colour Green, pattern White. "Black" -> colour Black. */
export function splitColor(raw: string): { color: string | null; pattern: string | null } {
  const value = squash(raw)
  if (PLACEHOLDER_COLORS.has(value.toLowerCase())) return { color: null, pattern: null }

  const parts = value.split(/\s*(?:\/|&|\+)\s*/).filter(Boolean)
  if (parts.length <= 1) return { color: value, pattern: null }
  return { color: parts[0] ?? null, pattern: parts.slice(1).join(' / ') || null }
}

/**
 * Composes what Alex reads, e.g. "Black Arc'teryx Zip-Up Jacket".
 *
 * `Unspecified` must never reach a display name — nobody owns an "Unspecified
 * Slides" (04 §5). Brand is dropped when it is a placeholder. The colour is
 * dropped when it would merely repeat a word already in the description.
 */
export function composeDisplayName(
  description: string,
  brand: string | null,
  color: string | null,
): string {
  const parts: string[] = []
  if (color && !description.toLowerCase().includes(color.toLowerCase())) parts.push(color)
  if (brand) parts.push(brand)
  parts.push(description)
  return squash(parts.join(' '))
}

/** Free-text "Style / Use Case" into the tag vocabulary the ranker understands. */
export function parseTypicalUses(styleUse: string): string[] {
  const tags = new Set<string>()
  const text = styleUse.toLowerCase()

  const map: Array<[RegExp, string]> = [
    [/travel/, 'travel'],
    [/casual/, 'casual'],
    [/dress|smart/, 'dressy'],
    [/work/, 'work'],
    [/athletic|sport|gym|running/, 'athletic'],
    [/lounge|home/, 'loungewear'],
    [/cold|warm layer/, 'cold_weather'],
    [/cool/, 'cool_weather'],
    [/warm weather|summer|beach/, 'warm_weather'],
    [/swim/, 'swim'],
    [/hik|outdoor/, 'outdoor'],
  ]
  for (const [re, tag] of map) if (re.test(text)) tags.add(tag)
  return [...tags]
}

/** Coarse warmth from the use-case text. Null when the source says nothing. */
export function inferWarmth(styleUse: string, notes: string): number | null {
  const text = `${styleUse} ${notes}`.toLowerCase()
  if (/very cold|parka|heavy/.test(text)) return 3
  if (/cold|warm layer|winter/.test(text)) return 2
  if (/cool/.test(text)) return 1
  if (/summer|warm weather|swim|tank/.test(text)) return 0
  return null
}

export function inferDressiness(styleUse: string): number | null {
  const text = styleUse.toLowerCase()
  if (/formal|suit/.test(text)) return 4
  if (/dressy|dress/.test(text)) return 3
  if (/smart/.test(text)) return 2
  if (/lounge|home/.test(text)) return 0
  if (/casual|travel|work|athletic/.test(text)) return 1
  return null
}

export function normalizeGarment(source: ClothingSource): NormalizedGarment {
  const { name, quantity, unknownQuantity } = extractQuantity(source.description)
  const { color, pattern } = splitColor(source.color)

  const rawBrand = squash(source.brand)
  const brand = NON_BRANDS.has(rawBrand.toLowerCase()) ? null : rawBrand

  const rawColorText = squash(source.color).toLowerCase()
  const rawColor = PLACEHOLDER_COLORS.has(rawColorText) ? '' : rawColorText

  const derived: string[] = []
  if (unknownQuantity) {
    derived.push(`"${squash(source.description)}" does not say how many — set a count if you want one.`)
  }
  if (PLACEHOLDER_COLORS.has(squash(source.color).toLowerCase()) && squash(source.color)) {
    derived.push('Colour was "Unspecified" in the spreadsheet, so it has been left blank.')
  }

  const warmth = inferWarmth(source.styleUse, source.notes)
  const dressiness = inferDressiness(source.styleUse)
  if (warmth !== null || dressiness !== null) {
    derived.push('Warmth and dressiness were guessed from the Style / Use Case column.')
  }

  return {
    source,
    displayName: composeDisplayName(name, brand, color),
    category: squash(source.majorCategory),
    subcategory: squash(source.subcategory),
    brand,
    color,
    pattern,
    ownedQuantity: quantity,
    typicalUses: parseTypicalUses(source.styleUse),
    warmth,
    dressiness,
    notes: squash(source.notes) || null,
    rawColor,
    derived,
    identityHash: [squash(name).toLowerCase(), (brand ?? '').toLowerCase(), rawColor].join('|'),
  }
}

/* ------------------------------------------------------------------ */
/* deduplication — three tiers                                         */
/* ------------------------------------------------------------------ */

export interface ReviewCard {
  kind: 'near_duplicate'
  description: string
  brand: string | null
  colors: string[]
  rowNumbers: number[]
  why: string
}

export interface DedupeResult {
  unique: NormalizedGarment[]
  exactDuplicates: NormalizedGarment[]
  identityDuplicates: NormalizedGarment[]
  reviewCards: ReviewCard[]
}

/**
 * Colour is the tier-3 discriminator, and it is the important refinement.
 *
 * A naive "same description and brand" rule flags 13 groups covering ~30 rows in
 * this workbook — and a review queue that cries wolf gets clicked through
 * blindly, which is functionally the same as auto-merging (risk R5).
 *
 * So two garments sharing a description and brand are only ambiguous when their
 * colours might be describing the same thing: one is missing, they are equal, or
 * one string contains the other ("Black" vs "Black & Gray"). Genuinely different
 * colours are accepted as genuinely different garments, with no question asked.
 */
function coloursAmbiguous(a: string, b: string): boolean {
  if (!a || !b) return true
  return a === b || a.includes(b) || b.includes(a)
}

export function dedupe(garments: NormalizedGarment[]): DedupeResult {
  const unique: NormalizedGarment[] = []
  const exactDuplicates: NormalizedGarment[] = []
  const identityDuplicates: NormalizedGarment[] = []

  const seenExact = new Set<string>()
  const seenIdentity = new Set<string>()

  for (const g of garments) {
    // Tier 1: the entire normalized row is identical.
    const exactKey = [
      g.category, g.subcategory, g.source.description, g.brand ?? '',
      g.source.color, g.source.styleUse, g.source.notes,
    ].join('|').toLowerCase()

    if (seenExact.has(exactKey)) {
      exactDuplicates.push(g)
      continue
    }
    seenExact.add(exactKey)

    // Tier 2: same description + brand + colour.
    if (seenIdentity.has(g.identityHash)) {
      identityDuplicates.push(g)
      continue
    }
    seenIdentity.add(g.identityHash)

    unique.push(g)
  }

  // Tier 3: same description + brand, colours possibly describing one garment.
  const groups = new Map<string, NormalizedGarment[]>()
  for (const g of unique) {
    const key = `${squash(g.source.description).toLowerCase()}|${(g.brand ?? '').toLowerCase()}`
    groups.set(key, [...(groups.get(key) ?? []), g])
  }

  const reviewCards: ReviewCard[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue

    const ambiguous = new Set<NormalizedGarment>()
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i]!
        const b = members[j]!
        if (coloursAmbiguous(a.rawColor, b.rawColor)) {
          ambiguous.add(a)
          ambiguous.add(b)
        }
      }
    }
    if (ambiguous.size === 0) continue

    const list = [...ambiguous]
    const first = list[0]!
    reviewCards.push({
      kind: 'near_duplicate',
      description: squash(first.source.description),
      brand: first.brand,
      colors: list.map((g) => g.source.color || '(none)'),
      rowNumbers: list.map((g) => g.source.rowNumber),
      why: 'Same item and brand, and the colors overlap — these may be one garment or two.',
    })
  }

  return { unique, exactDuplicates, identityDuplicates, reviewCards }
}

/* ------------------------------------------------------------------ */
/* gear and rules                                                      */
/* ------------------------------------------------------------------ */

export interface GearSource {
  item: string
  category: string
  rule: string
  rowNumber: number
}

export type Criticality = 'critical' | 'almost_always' | 'frequent' | 'usually' | 'conditional'

export interface ParsedGear {
  source: GearSource
  displayName: string
  category: string
  secondaryCategory: string | null
  criticality: Criticality
  isCritical: boolean
  requiresFinalCheck: boolean
  alwaysInclude: boolean
  /** Structured rule, or null when the text could not be parsed cleanly. */
  rule: ParsedRule | null
  /** True when the rule text needs a human — the item still imports. */
  needsRuleReview: boolean
  originalText: string
  derived: string[]
}

export interface ParsedRule {
  ruleType:
    | 'fixed_per_trip'
    | 'per_day'
    | 'per_night'
    | 'duration_plus_buffer'
    | 'conditional_include'
    | 'dependency_include'
  quantityValue: number | null
  buffer: number | null
  condition: Record<string, unknown> | null
  dependsOn: string | null
}

/** The five phrasings the sheet uses for how essential something is. */
export function parseCriticality(text: string): Criticality {
  const t = text.toLowerCase()
  if (t.includes('critical')) return 'critical'
  if (t.includes('almost always')) return 'almost_always'
  if (t.includes('frequently')) return 'frequent'
  if (t.includes('usually')) return 'usually'
  if (t.includes('always')) return 'critical'
  return 'conditional'
}

/** "Toiletries / Gear" -> primary Toiletries, secondary Gear. */
export function splitCategory(raw: string): { primary: string; secondary: string | null } {
  const parts = squash(raw).split(/\s*\/\s*/).filter(Boolean)
  return { primary: parts[0] ?? 'Travel Gear', secondary: parts[1] ?? null }
}

/**
 * Maps the free-text rule column onto the structured predicate DSL.
 *
 * Every approved resolution from 04 §7 lives here, and each keeps the original
 * string. Anything that does not match a known shape returns null and is flagged
 * for review — the item is still imported, the rule is simply not invented.
 */
export function parseGearRule(text: string): { rule: ParsedRule | null; note: string | null } {
  const t = squash(text)
  const lower = t.toLowerCase()

  // Contacts: the sheet says "Nights x 2". The approved product decision is
  // 2 per INCLUSIVE CALENDAR TRIP DAY, which outranks it. The original string is
  // preserved by the caller.
  if (/nights?\s*[x×*]\s*2/i.test(lower)) {
    return {
      rule: { ruleType: 'per_day', quantityValue: 2, buffer: null, condition: null, dependsOn: null },
      note: 'The spreadsheet said "Nights × 2". Pack Smart uses 2 per calendar day, which is the approved rule.',
    }
  }

  // "Trip Days + 2 days buffer"
  const buffer = /trip\s*days?\s*\+\s*(\d+)/i.exec(t)
  if (buffer?.[1]) {
    return {
      rule: {
        ruleType: 'duration_plus_buffer',
        quantityValue: 1,
        buffer: Number(buffer[1]),
        condition: null,
        dependsOn: null,
      },
      note: null,
    }
  }

  // "Packed if X is brought" -> a dependency on another item.
  const dependency = /packed if (?:the )?(.+?) is brought/i.exec(t)
  if (dependency?.[1]) {
    return {
      rule: {
        ruleType: 'dependency_include',
        quantityValue: 1,
        buffer: null,
        condition: null,
        dependsOn: squash(dependency[1]),
      },
      note: null,
    }
  }

  // The shaver contradicts itself: the item row says "> 2-3 nights" while the
  // trigger table says "> 3 Nights" and a third row says skip at 1-2. Approved
  // resolution: nights >= 3. Both source strings are preserved.
  if (/trips?\s*>\s*2-3\s*nights?/i.test(lower)) {
    return {
      rule: {
        ruleType: 'conditional_include',
        quantityValue: 1,
        buffer: null,
        condition: { fact: 'nights', gte: 3 },
        dependsOn: null,
      },
      note: 'The spreadsheet was ambiguous ("> 2-3 nights"). Pack Smart uses 3 nights or more.',
    }
  }

  if (/international/i.test(lower)) {
    return {
      rule: {
        ruleType: 'conditional_include',
        quantityValue: 1,
        buffer: null,
        condition: { fact: 'international', eq: true },
        dependsOn: null,
      },
      note: null,
    }
  }

  const hours = /(?:>|longer than|over)\s*(\d+)\s*hours?/i.exec(t)
  if (hours?.[1]) {
    return {
      rule: {
        ruleType: 'conditional_include',
        quantityValue: 1,
        buffer: null,
        condition: { fact: 'flight_hours', gt: Number(hours[1]) },
        dependsOn: null,
      },
      note: null,
    }
  }

  const activity: Array<[RegExp, string]> = [
    [/safari|wildlife/i, 'safari'],
    [/hiking/i, 'hiking'],
    [/outdoor/i, 'outdoor'],
    [/driving|road trip/i, 'road_trip'],
    [/warm weather/i, 'warm_weather'],
    [/swim/i, 'swimming'],
  ]
  for (const [re, tag] of activity) {
    if (re.test(t)) {
      return {
        rule: {
          ruleType: 'conditional_include',
          quantityValue: 1,
          buffer: null,
          condition: { fact: 'activities', contains: tag },
          dependsOn: null,
        },
        note: null,
      }
    }
  }

  if (/^(critical\s*\(always\)|always|usually|frequently|almost always)$/i.test(t)) {
    return {
      rule: { ruleType: 'fixed_per_trip', quantityValue: 1, buffer: null, condition: null, dependsOn: null },
      note: null,
    }
  }

  return { rule: null, note: null }
}

export function parseGear(source: GearSource): ParsedGear {
  const { primary, secondary } = splitCategory(source.category)
  const criticality = parseCriticality(source.rule)
  const { rule, note } = parseGearRule(source.rule)

  const derived: string[] = []
  if (note) derived.push(note)

  // "Electric toothbrush trips" depends on a distinction the data does not make
  // (04 §7). Modelled as a dependency and surfaced, never rewritten.
  const ambiguous = /electric toothbrush/i.test(source.rule)
  if (ambiguous) {
    derived.push('The spreadsheet conditions this on "electric toothbrush trips", but nothing records whether your toothbrush is electric. Treated as depending on the toothbrush.')
  }

  if (!rule) {
    derived.push(`Could not turn "${squash(source.rule)}" into a rule. The item is saved; the rule needs a look.`)
  }

  // "Medicine Wheel" is an ambiguous display name (04 §7).
  if (/medicine wheel/i.test(source.item)) {
    derived.push('"Medicine Wheel" is ambiguous — rename it if it means something more specific to you.')
  }

  return {
    source,
    displayName: squash(source.item),
    category: primary,
    secondaryCategory: secondary,
    criticality,
    isCritical: criticality === 'critical',
    requiresFinalCheck: criticality === 'critical',
    alwaysInclude: /always/i.test(source.rule) && criticality === 'critical',
    rule: rule ?? (ambiguous
      ? { ruleType: 'dependency_include', quantityValue: 1, buffer: null, condition: null, dependsOn: 'Toothbrush' }
      : null),
    needsRuleReview: !rule,
    originalText: squash(source.rule),
    derived,
  }
}

/* ------------------------------------------------------------------ */
/* summary                                                             */
/* ------------------------------------------------------------------ */

export interface ImportSummary {
  clothingRows: number
  clothingUnique: number
  exactDuplicates: number
  identityDuplicates: number
  reviewCards: ReviewCard[]
  gearItems: number
  triggerRules: number
  rulesNeedingReview: string[]
  /** Honest coverage gaps — reported, never guessed around. */
  coverageWarnings: string[]
}

/**
 * Reports what the wardrobe cannot do.
 *
 * Risk R1: no garment in this workbook mentions rain, waterproofing, a shell or
 * Gore-Tex. The Arc'teryx is the tempting case, but its own note reads
 * "Versatile lightweight black jacket", and promoting brand reputation into a
 * weather tag is precisely the fabricated inference doc 03 §5 forbids. The gap
 * is stated plainly instead.
 */
export function coverageWarnings(garments: NormalizedGarment[]): string[] {
  const warnings: string[] = []

  const rainWords = /rain|waterproof|water-resistant|gore-?tex|shell|poncho|umbrella/i
  const hasRainLayer = garments.some(
    (g) => rainWords.test(g.source.description) || rainWords.test(g.source.notes) || rainWords.test(g.source.styleUse),
  )
  if (!hasRainLayer) {
    warnings.push(
      'None of your clothing is described as waterproof. On a wet trip Pack Smart will say it has no suitable rain layer rather than suggest something that is not one.',
    )
  }

  return warnings
}

/**
 * The one seeded quantity rule that lands on a garment rather than on gear.
 *
 * `underwear_basis` is an approved preference — 2 per inclusive trip day
 * (03_INTELLIGENCE_DESIGN.md §6) — but preferences are not a second engine. The
 * only mechanism that produces a quantity is a rule, so the preference is
 * realised as a rule at import and stays editable in one place afterwards.
 *
 * Deliberately narrow. It matches boxer briefs and nothing else in the Underwear
 * subcategory: socks and compression shorts are worn per outfit, and the docs
 * state no basis for them. Inventing 2-per-day for socks would be exactly the
 * confident-but-unsupported quantity this engine must never produce — they reach
 * the list through outfit planning instead.
 */
export function garmentRule(g: NormalizedGarment): ParsedRule | null {
  const isUnderwearDrawer = g.subcategory.toLowerCase() === 'underwear'
  const isBoxerBriefs = /boxer\s*brief/i.test(g.source.description)

  if (isUnderwearDrawer && isBoxerBriefs) {
    return { ruleType: 'per_day', quantityValue: 2, buffer: null, condition: null, dependsOn: null }
  }
  return null
}

export function toItemInput(g: NormalizedGarment): ItemInput {
  return {
    kind: 'clothing',
    displayName: g.displayName,
    category: g.category,
    subcategory: g.subcategory,
    color: g.color,
    pattern: g.pattern,
    brand: g.brand,
    notes: g.notes,
    warmth: g.warmth,
    dressiness: g.dressiness,
    typicalUses: g.typicalUses,
    ownedQuantity: g.ownedQuantity,
  }
}

export function gearToItemInput(g: ParsedGear): ItemInput {
  return {
    kind: 'gear',
    displayName: g.displayName,
    category: g.category,
    notes: g.originalText || null,
    isCritical: g.isCritical,
    requiresFinalCheck: g.requiresFinalCheck,
    alwaysInclude: g.alwaysInclude,
  }
}


/* ------------------------------------------------------------------ */
/* reconciliation against the catalog that is already there            */
/* ------------------------------------------------------------------ */

/**
 * What a second import of the same workbook should do (G5b).
 *
 * `dedupe()` above compares the spreadsheet against **itself**. This compares
 * it against the **database**, which is the half that was missing: `/commit`
 * never read the catalog, so importing the same file twice added a fresh copy
 * of everything — measured at items 123 → 241 and rules 41 → 75.
 *
 * The asymmetry in the defaults is the whole safety argument. Wrongly skipping
 * a genuinely distinct garment loses something Alex cannot get back; wrongly
 * importing a duplicate costs one archive tap. So **only the class that cannot
 * be a distinct item is skipped** — an exact identity match with no differing
 * field — and everything ambiguous is imported and reported, which is what
 * `CLAUDE.md` means by surfacing likely duplicates rather than resolving them.
 */

/** An item already in the catalog, in the only fields identity is computed from. */
export interface ExistingItem {
  id: string
  displayName: string
  brand: string | null
  color: string | null
}

export type ReconcileDecision =
  /** Nothing in the catalog claims this identity. */
  | 'new'
  /** Identity matches and no structured field differs. Not imported again. */
  | 'exact_duplicate'
  /** The name matches; brand or colour does not. Imported, and reported. */
  | 'likely_duplicate'

export interface ReconciledRow<T> {
  row: T
  decision: ReconcileDecision
  /** The catalog row this matched, for an explanation the screen can show. */
  matchedItemId: string | null
  matchedName: string | null
  why: string | null
}

/** The same shape `normalizeGarment` produces, reduced to what identity needs. */
interface Identifiable {
  displayName: string
  brand: string | null
  color: string | null
}

function key(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

function identityOf(item: Identifiable): string {
  return [key(item.displayName), (item.brand ?? '').toLowerCase(), (item.color ?? '').toLowerCase()].join('|')
}

/**
 * The description without the brand the importer prefixed to it.
 *
 * `normalizeGarment` composes `displayName` as `"{Brand} {Description}"`, so
 * `Grey Tee` by Uniqlo is stored as `Uniqlo Grey Tee`. Comparing composed names
 * would therefore read *the same garment with the brand corrected* as an
 * entirely new item — which is the one case the likely-duplicate tier exists
 * for.
 *
 * This reconstructs the importer's own composition rather than guessing at a
 * name: the prefix is stripped only when it is exactly this row's own recorded
 * brand. That is the same rule G6 sets for wardrobe naming — correct against
 * the row's structured data, never against a pattern.
 */
function bareName(item: Identifiable): string {
  const name = key(item.displayName)
  const brand = key(item.brand ?? '')
  if (brand && name.startsWith(`${brand} `)) return name.slice(brand.length + 1)
  return name
}

/**
 * Classifies each incoming row against the catalog.
 *
 * Identity is the **structured fields** — name, brand, colour — and never the
 * display name alone, which is the brief's rule and also the only thing that
 * distinguishes `Black Shinola` from `White Shinola`.
 */
export function reconcile<T extends Identifiable>(
  rows: T[],
  existing: ExistingItem[],
): Array<ReconciledRow<T>> {
  const byIdentity = new Map<string, ExistingItem>()
  const byName = new Map<string, ExistingItem>()
  for (const item of existing) {
    const identity = identityOf(item)
    if (!byIdentity.has(identity)) byIdentity.set(identity, item)
    if (!byName.has(bareName(item))) byName.set(bareName(item), item)
  }

  return rows.map((row) => {
    const exact = byIdentity.get(identityOf(row))
    if (exact) {
      return {
        row,
        decision: 'exact_duplicate' as const,
        matchedItemId: exact.id,
        matchedName: exact.displayName,
        why: 'Already in your wardrobe, with the same brand and colour.',
      }
    }

    const sameName = byName.get(bareName(row))
    if (sameName) {
      const differs: string[] = []
      if ((sameName.brand ?? '') !== (row.brand ?? '')) differs.push('brand')
      if ((sameName.color ?? '') !== (row.color ?? '')) differs.push('colour')
      return {
        row,
        decision: 'likely_duplicate' as const,
        matchedItemId: sameName.id,
        matchedName: sameName.displayName,
        why: `You already have a “${sameName.displayName}” with a different ${differs.join(' and ')}.`,
      }
    }

    return { row, decision: 'new' as const, matchedItemId: null, matchedName: null, why: null }
  })
}

export interface ReconcileSummary {
  new: number
  exactDuplicates: number
  likelyDuplicates: number
  /** Rules the catalog has deliberately retired, which will not be recreated. */
  retiredRulesKept: string[]
  /** Rules an equivalent of which is already active, so nothing is added. */
  rulesAlreadyPresent: string[]
}
