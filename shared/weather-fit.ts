import type { Item } from './items'

/**
 * Whether a garment is recorded as handling rain or wind.
 *
 * The rule that matters here is what this must NOT do. It must not decide that
 * a jacket keeps rain out because it is a jacket. Product doc 01 §4 is "smart,
 * not magical", and telling Alex his quilted jacket is a rain layer is exactly
 * the confident wrong answer this product exists to avoid — he would find out
 * on a wet safari morning.
 *
 * So capability comes only from things Alex himself recorded:
 *
 *   1. `weatherTags` — the explicit field, edited in My Stuff. Authoritative.
 *   2. The words in the item's own name and notes, which came from his
 *      spreadsheet. "Gore-Tex" written by him is evidence; "Outerwear" as a
 *      subcategory is not.
 *
 * Nothing else. A garment with neither is treated as having no recorded
 * capability, and the planner says so rather than guessing.
 *
 * The word lists deliberately match `coverageWarnings()` in `import.ts`, which
 * already warns at import time that nothing in the wardrobe is described as
 * waterproof. That warning becomes consequential here.
 */

export type WeatherCapability = 'rain' | 'wind'

/*
 * "shell" appears in both lists on purpose: a shell is defined by what it keeps
 * out, and a spreadsheet that says "shell" means the weather kind. It is the
 * one word carrying both, which is why it is stated rather than left implicit.
 */
const CAPABILITY_WORDS: Record<WeatherCapability, RegExp> = {
  rain: /\b(rain|rainproof|waterproof|water[-\s]?resistant|gore[-\s]?tex|shell|poncho|hardshell)\b/i,
  wind: /\b(wind|windproof|windbreaker|windbreak|shell|softshell|hardshell)\b/i,
}

/** The tag values My Stuff writes, kept separate from the prose matching. */
const CAPABILITY_TAGS: Record<WeatherCapability, string[]> = {
  rain: ['rain', 'rainproof', 'waterproof', 'water-resistant', 'gore-tex', 'shell'],
  wind: ['wind', 'windproof', 'windbreaker', 'shell'],
}

export interface CapabilityFinding {
  yes: boolean
  /** Where it came from, so an explanation can quote it rather than assert it. */
  evidence: string | null
}

export function weatherCapability(item: Item, capability: WeatherCapability): CapabilityFinding {
  const wanted = CAPABILITY_TAGS[capability]
  const tag = item.weatherTags.find((t) => wanted.includes(t.trim().toLowerCase()))
  if (tag) return { yes: true, evidence: `tagged ${tag}` }

  const pattern = CAPABILITY_WORDS[capability]

  // Name before notes: it is the shorter, more deliberate description, so the
  // quoted evidence reads better when both match.
  for (const [source, text] of [
    ['name', item.displayName],
    ['notes', item.notes ?? ''],
  ] as const) {
    const match = pattern.exec(text)
    if (match) return { yes: true, evidence: `your ${source} say “${match[0]}”` }
  }

  return { yes: false, evidence: null }
}

export function hasWeatherCapability(item: Item, capability: WeatherCapability): boolean {
  return weatherCapability(item, capability).yes
}

/**
 * What the conditions of a set of days actually demand.
 *
 * Rain is a DEMAND — it makes an outer layer required — because arriving
 * without one is a real problem. Wind is a PREFERENCE, because being slightly
 * cold in a breeze is not, and promoting it to a requirement would empty the
 * jacket slot on trips where nothing is tagged for wind.
 */
export interface ConditionDemand {
  rain: boolean
  wind: boolean
  /** The dates that triggered it, for the explanation line. */
  rainDates: string[]
}

export const WIND_THRESHOLD_KPH = 35
