import { contextForLevel } from '@shared/dressiness'
import { describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { assign, planGroups, passesFilters, rank, reuseCapacity } from '@shared/outfits'
import { demandFor, type WeatherDay } from '@shared/weather'
import { hasWeatherCapability, weatherCapability } from '@shared/weather-fit'

/**
 * Rain, wind, and what the wardrobe is recorded as being able to do.
 *
 * The load-bearing test here is the one that proves capability is NEVER
 * inferred from a garment's type. Telling Alex his quilted jacket keeps rain
 * out because it is a jacket is the confident wrong answer this product exists
 * to avoid, and he would find out on a wet safari morning.
 */

function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'Outerwear', color: null, pattern: null, brand: null, notes: null,
    favorite: false, usageFrequency: 'sometimes', warmth: 1, dressiness: 1,
    weatherTags: [], typicalUses: [], reuseCapacity: null, ownedQuantity: null,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    comfort: null, versatility: null,
    fieldProvenance: {},
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

function day(partial: Partial<WeatherDay> = {}): WeatherDay {
  return {
    date: '2026-08-02', tempMinC: 10, tempMaxC: 18,
    precipitationProbability: null, windKph: null, source: 'forecast',
    ...partial,
  }
}

describe('what a garment is recorded as handling', () => {
  it('believes the explicit tag', () => {
    const found = weatherCapability(garment({ weatherTags: ['waterproof'] }), 'rain')
    expect(found.yes).toBe(true)
    expect(found.evidence).toBe('tagged waterproof')
  })

  it('reads the words Alex wrote in the name or the notes', () => {
    expect(hasWeatherCapability(garment({ displayName: 'Arc’teryx Gore-Tex Shell' }), 'rain')).toBe(true)
    expect(hasWeatherCapability(garment({ notes: 'fully waterproof, taped seams' }), 'rain')).toBe(true)
    expect(hasWeatherCapability(garment({ displayName: 'Patagonia Windbreaker' }), 'wind')).toBe(true)
  })

  it('quotes where it got that from, rather than just asserting it', () => {
    const found = weatherCapability(garment({ notes: 'water-resistant finish' }), 'rain')
    expect(found.evidence).toContain('notes')
    expect(found.evidence).toContain('water-resistant')
  })

  /*
   * The one that matters. A jacket is not a rain layer because it is a jacket.
   */
  it('never infers capability from the kind of garment', () => {
    const plainJacket = garment({
      displayName: 'Olive Quilted Jacket',
      subcategory: 'Outerwear',
      notes: 'warm, good for evenings',
    })

    expect(hasWeatherCapability(plainJacket, 'rain')).toBe(false)
    expect(hasWeatherCapability(plainJacket, 'wind')).toBe(false)
  })

  it('does not fire on a word inside another word', () => {
    expect(hasWeatherCapability(garment({ displayName: 'Trainers' }), 'rain')).toBe(false)
    expect(hasWeatherCapability(garment({ notes: 'from Windermere' }), 'wind')).toBe(false)
  })
})

describe('what the conditions demand', () => {
  it('calls rain likely only above the threshold', () => {
    expect(demandFor([day({ precipitationProbability: 80 })]).rain).toBe(true)
    expect(demandFor([day({ precipitationProbability: 20 })]).rain).toBe(false)
  })

  it('names the days that triggered it', () => {
    const demand = demandFor([
      day({ date: '2026-08-02', precipitationProbability: 90 }),
      day({ date: '2026-08-03', precipitationProbability: 10 }),
    ])
    expect(demand.rainDates).toEqual(['2026-08-02'])
  })

  it('notices wind, separately from rain', () => {
    expect(demandFor([day({ windKph: 45 })])).toMatchObject({ wind: true, rain: false })
  })

  it('demands nothing when the forecast says nothing', () => {
    expect(demandFor([day()])).toMatchObject({ rain: false, wind: false })
    expect(demandFor([])).toMatchObject({ rain: false, wind: false })
  })
})

describe('rain as a hard filter on the outer layer', () => {
  const context = {
    role: 'outer' as const,
    template: { activityTag: 'hiking', name: 'Hiking', slots: [], dressiness: [0, 2] as [number, number], uses: [], specificity: 4 },
    needsRainLayer: true,
  }

  it('keeps out a jacket with nothing recorded about rain', () => {
    const result = passesFilters(garment({ displayName: 'Quilted Jacket' }), context)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'not recorded as keeping rain out' })
  })

  it('admits one that is', () => {
    expect(passesFilters(garment({ weatherTags: ['waterproof'] }), context).ok).toBe(true)
  })

  it('does not apply the filter to any other slot', () => {
    expect(passesFilters(garment({ subcategory: 'T-Shirt' }), { ...context, role: 'top' }).ok).toBe(true)
  })
})

describe('wind is a preference, not a requirement', () => {
  const empty = { requestedItemIds: new Set<string>(), usedCount: new Map<string, number>() }

  it('lifts a wind-capable garment above a favourite when it is windy', () => {
    const windproof = garment({ id: 'shell', displayName: 'Windproof Shell' })
    const favourite = garment({ id: 'fav', favorite: true })

    const ranked = rank([favourite, windproof], { ...empty, preferredCapabilities: ['wind'] })
    expect(ranked[0]?.item.id).toBe('shell')
    expect(ranked[0]?.decidedBy).toBe('Suits the conditions')
  })

  /*
   * The criterion must be inert with no forecast, or every trip without weather
   * would silently re-rank.
   */
  it('changes nothing when the conditions ask for nothing', () => {
    const a = garment({ id: 'a', favorite: true })
    const b = garment({ id: 'b', displayName: 'Windproof Shell' })

    expect(rank([b, a], empty)[0]?.item.id).toBe('a')
    expect(rank([b, a], { ...empty, preferredCapabilities: [] })[0]?.item.id).toBe('a')
  })
})

describe('saved reuse preferences', () => {
  it('uses the per-category default when the item says nothing', () => {
    const tee = garment({ subcategory: 'T-Shirt', reuseCapacity: null })
    expect(reuseCapacity(tee)).toBe(1)
    expect(reuseCapacity(tee, { top: 2 })).toBe(2)
  })

  it('still lets the item override the preference', () => {
    const tee = garment({ subcategory: 'T-Shirt', reuseCapacity: 3 })
    expect(reuseCapacity(tee, { top: 1 })).toBe(3)
  })
})

describe('the dressiness cap', () => {
  const dinner = {
    role: 'top' as const,
    template: { activityTag: 'nice_dinner', name: 'Nice dinners', slots: [], dressiness: [2, 4] as [number, number], uses: [], specificity: 5 },
  }

  it('rules out anything dressier than Alex said he needs', () => {
    const formal = garment({ subcategory: 'Shirt', dressiness: 4 })
    expect(passesFilters(formal, dinner).ok).toBe(true)
    expect(passesFilters(formal, { ...dinner, maxDressiness: 2 }).ok).toBe(false)
  })

  /*
   * A cap must never make an occasion unwearable. Saying "nothing formal" about
   * a trip that includes a wedding must not put Alex in loungewear at the
   * wedding — it caps the ceiling, it cannot lower the floor.
   */
  it('cannot push a band below the occasion’s own minimum', () => {
    const wedding = {
      role: 'top' as const,
      template: { activityTag: 'wedding', name: 'Wedding', slots: [], dressiness: [3, 4] as [number, number], uses: [], specificity: 6 },
      maxDressiness: 1,
    }
    expect(passesFilters(garment({ subcategory: 'Shirt', dressiness: 3 }), wedding).ok).toBe(true)
  })

  it('does nothing when the question was not answered', () => {
    const formal = garment({ subcategory: 'Shirt', dressiness: 4 })
    expect(passesFilters(formal, { ...dinner, maxDressiness: null }).ok).toBe(true)
  })
})

describe('rain reaches the plan, not just the summary', () => {
  const wardrobe = [
    garment({ id: 'tee', subcategory: 'T-Shirt', dressiness: 1 }),
    garment({ id: 'pants', subcategory: 'Pants', dressiness: 1 }),
    garment({ id: 'shoes', subcategory: 'Shoes', dressiness: 1 }),
    garment({ id: 'quilted', subcategory: 'Outerwear', displayName: 'Quilted Jacket', dressiness: 1 }),
  ]

  const wet = [day({ date: '2026-08-02', precipitationProbability: 90 })]

  it('says so plainly when nothing is recorded as waterproof', () => {
    const groups = planGroups(['hiking'], 3)
    const { unmet } = assign(groups, wardrobe, { demandFor: () => demandFor(wet) })

    const rainGap = unmet.find((u) => u.role === 'outer')
    expect(rainGap?.reason).toContain('nothing in your wardrobe is recorded as keeping it out')
  })

  it('fills it once something is', () => {
    const withShell = [...wardrobe, garment({ id: 'shell', subcategory: 'Outerwear', weatherTags: ['waterproof'], dressiness: 1 })]
    const { groups } = assign(planGroups(['hiking'], 3), withShell, { demandFor: () => demandFor(wet) })

    const outer = groups.flatMap((g) => g.slots).filter((s) => s.role === 'outer' && s.item)
    expect(outer.map((s) => s.item?.id)).toContain('shell')
  })

  it('leaves a dry trip exactly as it was', () => {
    const dry = assign(planGroups(['hiking'], 3), wardrobe, { demandFor: () => demandFor([day()]) })
    const noWeather = assign(planGroups(['hiking'], 3), wardrobe)

    expect(dry.unmet).toEqual(noWeather.unmet)
  })
})
