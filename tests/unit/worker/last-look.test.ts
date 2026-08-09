import { contextForLevel } from '@shared/dressiness'
import { describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { reviewWardrobe } from '@shared/last-look'

function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: 1,
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

const EMPTY = {
  plannedItemIds: new Set<string>(),
  unfilledRoles: [],
  usedRoles: new Set<never>(),
}

describe('One Last Look does not lead with the closet', () => {
  it('leads with a garment that fills a real gap, and nothing else', () => {
    // Doc 04 §9: the useful suggestion is the gap, not the wardrobe.
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [
        garment({ id: 'loafers', displayName: 'Loafers', subcategory: 'Shoes' }),
        garment({ id: 'plain', displayName: 'Plain Tee' }),
      ],
      unfilledRoles: [{ role: 'footwear', groupName: 'Wedding' }],
      usedRoles: new Set(['top', 'footwear']),
    })

    expect(result.nearMatches.map((m) => m.name)).toEqual(['Loafers'])
    expect(result.nearMatches[0]?.reason).toBe('Your wedding outfit has no shoes.')
    // Everything else stays behind the search.
    expect(result.remaining.map((r) => r.name)).toEqual(['Plain Tee'])
  })

  /*
   * The second list is gone with the star that filled it (H1d).
   *
   * Asserted rather than merely deleted, because "the section is not rendered"
   * and "the section is empty" look identical on screen and only one of them is
   * the retirement this slice promised. A garment with nothing to distinguish
   * it goes behind the search, where the whole wardrobe goes.
   */
  it('gives an unpacked garment no section of its own', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [garment({ id: 'shirt', displayName: 'Linen Shirt' })],
    })
    expect(result.nearMatches).toHaveLength(0)
    expect(result.remaining.map((r) => r.name)).toEqual(['Linen Shirt'])
    expect(result.remaining[0]?.reason).toBe('')
  })

  it('never offers something already planned', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [garment({ id: 'packed', displayName: 'Packed Tee' })],
      plannedItemIds: new Set(['packed']),
    })
    expect(result.nearMatches).toHaveLength(0)
    expect(result.remaining).toHaveLength(0)
  })

  it('never offers an archived garment or one marked never-pack', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [
        garment({ id: 'old', displayName: 'Old Tee', archivedAt: 1 }),
        garment({ id: 'never', displayName: 'Never Tee', neverInclude: true }),
      ],
    })
    expect(result.nearMatches).toHaveLength(0)
    expect(result.remaining).toHaveLength(0)
  })

  it('offers nothing at all when everything is planned', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [garment({ id: 'a' }), garment({ id: 'b' })],
      plannedItemIds: new Set(['a', 'b']),
    })
    expect(result).toEqual({ nearMatches: [], remaining: [] })
  })

  it('describes each slot in words Alex would use', () => {
    const roles = [
      { role: 'top' as const, word: 'top' },
      { role: 'outer' as const, word: 'jacket' },
      { role: 'mid' as const, word: 'layer' },
      { role: 'bottom' as const, word: 'bottoms' },
      { role: 'swim' as const, word: 'swimwear' },
    ]
    const subcategories: Record<string, string> = {
      top: 'T-Shirt', outer: 'Outerwear', mid: 'Mid-Layer', bottom: 'Pants', swim: 'Swimwear',
    }

    for (const { role, word } of roles) {
      const result = reviewWardrobe({
        ...EMPTY,
        wardrobe: [garment({ id: role, subcategory: subcategories[role]! })],
        unfilledRoles: [{ role, groupName: 'Safari' }],
        usedRoles: new Set([role]),
      })
      expect(result.nearMatches[0]?.reason).toBe(`Your safari outfit has no ${word}.`)
    }
  })
})
