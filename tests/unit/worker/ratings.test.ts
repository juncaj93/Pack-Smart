import { describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { COMFORT_LABELS, VERSATILITY_LABELS, validateItemInput } from '@shared/items'
import { contextForLevel } from '@shared/dressiness'
import {
  OUTFIT_TEMPLATES,
  comfortSignal,
  passesFilters,
  rank,
  versatilitySignal,
  type RankContext,
} from '@shared/outfits'

/**
 * Comfort and versatility, where they may reach the planner and where they may
 * not (H1b).
 *
 * The product ruling, in one line: **a user-confirmed versatility rating
 * REPLACES the inferred `typicalUses.length` for ranking, and is never added to
 * it.** Comfort is a new signal with no proxy at all, so an unrated comfort is
 * silent rather than zero.
 *
 * Neither may reach eligibility. `passesFilters` runs first, does not look at
 * either, and that is asserted here rather than assumed — a rating that could
 * make an unsuitable garment suitable is the one failure mode this slice had to
 * avoid.
 */

function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: 1,
    weatherTags: [], typicalUses: [], reuseCapacity: null, ownedQuantity: null,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    comfort: null, versatility: null, fieldProvenance: {},
    createdAt: 0, updatedAt: 0,
    ...partial,
    /*
     * The contexts the level means, unless the test named them (H1c).
     *
     * A fixture has to be the row the database would hold, and after migration
     * 0022 a row with a dressiness carries the matching context. Without this a
     * fixture reads as "formality not recorded", which passes every filter — so
     * a test asserting loungewear is kept out of a nice dinner would go green
     * for the wrong reason.
     */
    dressinessContexts:
      partial.dressinessContexts ?? contextsFor(partial.dressiness === undefined ? 1 : partial.dressiness),
  }
}

function contextsFor(level: number | null | undefined) {
  const context = contextForLevel(level ?? null)
  return context === null ? [] : [context]
}

const casual = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'casual_day')!
const gym = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'gym')!

function context(partial: Partial<RankContext> = {}): RankContext {
  return {
    requestedItemIds: new Set<string>(),
    usedCount: new Map<string, number>(),
    ...partial,
  }
}

const order = (items: Item[], ctx: RankContext = context()) =>
  rank(items, ctx).map((candidate) => candidate.item.id)

/* ------------------------------------------------------------------ */
/* versatility — substitution, never a sum                             */
/* ------------------------------------------------------------------ */

describe('the versatility signal', () => {
  it('is the inferred count when Alex has not rated it', () => {
    expect(versatilitySignal(garment({ typicalUses: [] }))).toBe(0)
    expect(versatilitySignal(garment({ typicalUses: ['casual'] }))).toBe(1)
    expect(versatilitySignal(garment({ typicalUses: ['casual', 'travel'] }))).toBe(2)
  })

  it('is the rating when he has, at every value', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(versatilitySignal(garment({ versatility: rating, typicalUses: [] }))).toBe(rating)
    }
  })

  it('REPLACES the inferred count rather than adding to it', () => {
    /*
     * The whole ruling, as arithmetic. Two recorded uses and a rating of 3: the
     * signal is 3, not 5. A sum would also mean a rated garment beat an
     * identical unrated one purely for having been reviewed, which is the
     * double-count doc 09 §7 warned about.
     */
    const rated = garment({ versatility: 3, typicalUses: ['casual', 'travel'] })
    expect(versatilitySignal(rated)).toBe(3)
    expect(versatilitySignal(rated)).not.toBe(5)
  })

  it('lets a low rating override a high inferred count, because Alex knows better', () => {
    const item = garment({ versatility: 1, typicalUses: ['casual', 'travel', 'work'] })
    expect(versatilitySignal(item)).toBe(1)
  })

  it('falls back to inference again the moment the rating is cleared', () => {
    const rated = garment({ versatility: 5, typicalUses: ['casual'] })
    expect(versatilitySignal(rated)).toBe(5)
    expect(versatilitySignal({ ...rated, versatility: null })).toBe(1)
  })

  it('changes nothing at all on a wardrobe nobody has rated', () => {
    /*
     * The safety property that made this shippable, and the same one the
     * pairings criterion was built on: with no ratings anywhere, every score is
     * the number the planner produced yesterday.
     */
    const wardrobe = [
      garment({ id: 'a', typicalUses: [] }),
      garment({ id: 'b', typicalUses: ['casual'] }),
      garment({ id: 'c', typicalUses: ['casual', 'travel'] }),
    ]
    for (const item of wardrobe) {
      expect(versatilitySignal(item)).toBe(item.typicalUses.length)
    }
  })
})

describe('versatility in the ranking', () => {
  it('orders eligible casual tops by the confirmed rating', () => {
    const items = [
      garment({ id: 'low', versatility: 2 }),
      garment({ id: 'high', versatility: 5 }),
      garment({ id: 'mid', versatility: 3 }),
    ]
    expect(order(items)).toEqual(['high', 'mid', 'low'])
  })

  it('lets a rated garment beat one with more recorded uses', () => {
    const items = [
      garment({ id: 'counted', typicalUses: ['casual', 'travel', 'work'] }),
      garment({ id: 'rated', versatility: 5, typicalUses: [] }),
    ]
    expect(order(items)[0]).toBe('rated')
  })

  it('uses inference for the unrated garment in the same comparison', () => {
    const items = [
      garment({ id: 'counted', typicalUses: ['casual', 'travel', 'work'] }),
      garment({ id: 'rated', versatility: 1, typicalUses: [] }),
    ]
    // 3 inferred beats a confirmed 1. Substitution cuts both ways.
    expect(order(items)[0]).toBe('counted')
  })

  it('never makes an ineligible garment eligible', () => {
    /*
     * Alex's two examples, verbatim: a five-star winter parka cannot satisfy a
     * hot-weather outfit, and a five-star dress shoe cannot satisfy an active
     * walking requirement.
     */
    const parka = garment({
      id: 'parka', versatility: 5, comfort: 5,
      subcategory: 'Jacket', warmth: 3, typicalUses: ['cold_weather'],
    })
    const hot = passesFilters(parka, {
      role: 'outer', template: casual, warmthBand: [0, 1],
      needsRainLayer: false, maxDressiness: null,
    })
    expect(hot.ok).toBe(false)

    const dressShoe = garment({
      id: 'oxford', versatility: 5, comfort: 5,
      category: 'Footwear', subcategory: 'Shoes', dressiness: 3, typicalUses: ['dressy'],
    })
    const walking = passesFilters(dressShoe, {
      role: 'footwear', template: gym, warmthBand: null,
      needsRainLayer: false, maxDressiness: null,
    })
    expect(walking.ok).toBe(false)
  })

  it('leaves typicalUses in charge of eligibility, rating or no rating', () => {
    // A rating cannot buy its way past the activity filter…
    const wrongUse = garment({ versatility: 5, typicalUses: ['swim'] })
    expect(passesFilters(wrongUse, {
      role: 'top', template: gym, warmthBand: null,
      needsRainLayer: false, maxDressiness: null,
    }).ok).toBe(false)

    // …and a low rating cannot cost a garment its eligibility either.
    const rightUse = garment({ versatility: 1, typicalUses: ['athletic'] })
    expect(passesFilters(rightUse, {
      role: 'top', template: gym, warmthBand: null,
      needsRainLayer: false, maxDressiness: null,
    }).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* comfort — a modest signal, and silent when unknown                  */
/* ------------------------------------------------------------------ */

describe('the comfort signal', () => {
  it('is the rating at every value, and null when unrated', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(comfortSignal(garment({ comfort: rating }))).toBe(rating)
    }
    expect(comfortSignal(garment())).toBeNull()
  })

  it('is not silently three', () => {
    // The one thing the ruling forbids by name.
    expect(comfortSignal(garment())).not.toBe(3)
    expect(comfortSignal(garment())).not.toBe(0)
  })
})

describe('comfort in the ranking', () => {
  it('orders otherwise identical garments by comfort', () => {
    const items = [
      garment({ id: 'stiff', comfort: 1 }),
      garment({ id: 'soft', comfort: 5 }),
      garment({ id: 'fine', comfort: 3 }),
    ]
    expect(order(items)).toEqual(['soft', 'fine', 'stiff'])
  })

  it('says NOTHING about an unrated garment, rather than ranking it worst', () => {
    /*
     * The case the whole `null` design exists for.
     *
     * Scoring unknown as 0 would put `unrated` below `uncomfortable`, which is a
     * judgement invented out of an absence — and it would make later rating that
     * garment `1` look like a promotion. With comfort silent, the two fall
     * through to the deterministic id tie-break instead.
     */
    const items = [
      garment({ id: 'b-unrated' }),
      garment({ id: 'a-uncomfortable', comfort: 1 }),
    ]
    expect(order(items)).toEqual(['a-uncomfortable', 'b-unrated'])

    // …and the order is the id tie-break, not comfort. Flip the ids and it flips.
    const flipped = [
      garment({ id: 'z-uncomfortable', comfort: 1 }),
      garment({ id: 'a-unrated' }),
    ]
    expect(order(flipped)).toEqual(['a-unrated', 'z-uncomfortable'])
  })

  it('never outranks the conditions', () => {
    const uncomfortableButRight = garment({
      id: 'right', comfort: 1, weatherTags: ['rain'],
    })
    const comfortableButWrong = garment({ id: 'wrong', comfort: 5, weatherTags: [] })

    const ranked = order([comfortableButWrong, uncomfortableButRight],
      context({ preferredCapabilities: ['rain'] }))
    expect(ranked[0]).toBe('right')
  })

  it('never outranks how often it is worn, or versatility', () => {
    const comfortable = garment({ id: 'comfy', comfort: 5 })

    const often = garment({ id: 'often', usageFrequency: 'frequent', comfort: 1 })
    expect(order([comfortable, often])[0]).toBe('often')

    const versatile = garment({ id: 'versatile', versatility: 5, comfort: 1 })
    const cosy = garment({ id: 'cosy', versatility: 1, comfort: 5 })
    expect(order([cosy, versatile])[0]).toBe('versatile')
  })

  it('never outranks something already packed', () => {
    /*
     * A packing app before a wardrobe app: a comfortable shirt must not add a
     * garment to the bag when one already in it would serve.
     */
    const alreadyPacked = garment({ id: 'packed', comfort: 1, reuseCapacity: 3 })
    const comfortableAndNew = garment({ id: 'new', comfort: 5, reuseCapacity: 3 })
    const ctx = context({ usedCount: new Map([['packed', 1]]) })
    expect(order([comfortableAndNew, alreadyPacked], ctx)[0]).toBe('packed')
  })

  it('never outranks what Alex explicitly asked for', () => {
    const asked = garment({ id: 'asked', comfort: 1, versatility: 1 })
    const comfortable = garment({ id: 'comfy', comfort: 5, versatility: 5 })
    const ctx = context({ requestedItemIds: new Set(['asked']) })
    expect(order([comfortable, asked], ctx)[0]).toBe('asked')
  })

  it('cannot reach eligibility', () => {
    const comfortableParka = garment({ comfort: 5, subcategory: 'Jacket', warmth: 3 })
    expect(passesFilters(comfortableParka, {
      role: 'outer', template: casual, warmthBand: [0, 1],
      needsRainLayer: false, maxDressiness: null,
    }).ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* explanations, and determinism                                       */
/* ------------------------------------------------------------------ */

describe('what the card says decided it', () => {
  it('names comfort only when comfort actually separated them', () => {
    const ranked = rank([
      garment({ id: 'a', comfort: 5 }),
      garment({ id: 'b', comfort: 2 }),
    ], context())
    expect(ranked[0]!.decidedBy).toBe('Comfortable to wear')
  })

  it('does not name comfort when one side was unrated', () => {
    /*
     * `decidedBy` has to use the same silence rule as `compare`, or it prints a
     * reason the sort never used. Reading `?? 0` here — which is what this code
     * did before H1b — finds a "difference" between null and 2 that the
     * comparison deliberately skipped.
     */
    const ranked = rank([garment({ id: 'a' }), garment({ id: 'b', comfort: 2 })], context())
    expect(ranked[0]!.decidedBy).not.toBe('Comfortable to wear')
  })

  it('still names versatility, whichever signal supplied the number', () => {
    const inferred = rank([
      garment({ id: 'a', typicalUses: ['casual', 'travel'] }),
      garment({ id: 'b', typicalUses: [] }),
    ], context())
    expect(inferred[0]!.decidedBy).toBe('Works for several days')

    const rated = rank([
      garment({ id: 'a', versatility: 5 }),
      garment({ id: 'b', versatility: 1 }),
    ], context())
    expect(rated[0]!.decidedBy).toBe('Works for several days')
  })
})

describe('determinism', () => {
  it('breaks a complete tie by id, not by input order', () => {
    const a = garment({ id: 'aaa', comfort: 3, versatility: 3 })
    const b = garment({ id: 'bbb', comfort: 3, versatility: 3 })
    expect(order([a, b])).toEqual(['aaa', 'bbb'])
    expect(order([b, a])).toEqual(['aaa', 'bbb'])
  })

  it('gives the same order every time, ratings or not', () => {
    const items = [
      garment({ id: 'a', comfort: 4 }),
      garment({ id: 'b' }),
      garment({ id: 'c', comfort: 4, versatility: 2 }),
      garment({ id: 'd', typicalUses: ['casual', 'travel'] }),
    ]
    const first = order(items)
    for (let i = 0; i < 5; i += 1) expect(order([...items].reverse())).toEqual(first)
  })
})

/* ------------------------------------------------------------------ */
/* the values themselves                                               */
/* ------------------------------------------------------------------ */

describe('the ratings as data', () => {
  it('gives every value a sentence, because a number is not a rating', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(COMFORT_LABELS[rating]).toBeTruthy()
      expect(VERSATILITY_LABELS[rating]).toBeTruthy()
    }
    expect(COMFORT_LABELS[1]).toBe('Uncomfortable')
    expect(COMFORT_LABELS[5]).toBe('One of my most comfortable items')
    expect(VERSATILITY_LABELS[1]).toBe('Very specific use')
    expect(VERSATILITY_LABELS[5]).toBe('Works almost anywhere appropriate for this item type')
  })

  it('accepts 1–5 and a cleared rating, and refuses anything else', () => {
    const base = { displayName: 'Tee', category: 'Tops & Outerwear' }
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(validateItemInput({ ...base, comfort: rating }).ok).toBe(true)
      expect(validateItemInput({ ...base, versatility: rating }).ok).toBe(true)
    }

    // Clearing is an edit, not a validation failure — *Clear rating* depends on it.
    expect(validateItemInput({ ...base, comfort: null, versatility: null }).ok).toBe(true)

    for (const bad of [0, 6, -1, 2.5]) {
      expect(validateItemInput({ ...base, comfort: bad }).ok).toBe(false)
      expect(validateItemInput({ ...base, versatility: bad }).ok).toBe(false)
    }
  })
})
