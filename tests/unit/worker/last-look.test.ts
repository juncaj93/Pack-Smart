import { describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { reviewWardrobe } from '@shared/last-look'

function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    favorite: false, usageFrequency: 'sometimes', warmth: null, dressiness: 1,
    weatherTags: [], typicalUses: [], reuseCapacity: null, ownedQuantity: null,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    createdAt: 0, updatedAt: 0,
    ...partial,
  }
}

const EMPTY = {
  plannedItemIds: new Set<string>(),
  unfilledRoles: [],
  usedRoles: new Set<never>(),
}

describe('One Last Look does not lead with the closet', () => {
  it('puts a garment that fills a real gap first, above favourites', () => {
    // Doc 04 §9: the useful suggestion is the gap, not the wardrobe.
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [
        garment({ id: 'loafers', displayName: 'Loafers', subcategory: 'Shoes' }),
        garment({ id: 'fav', displayName: 'Favourite Tee', favorite: true }),
        garment({ id: 'plain', displayName: 'Plain Tee' }),
      ],
      unfilledRoles: [{ role: 'footwear', groupName: 'Wedding' }],
      usedRoles: new Set(['top', 'footwear']),
    })

    expect(result.nearMatches.map((m) => m.name)).toEqual(['Loafers'])
    expect(result.nearMatches[0]?.reason).toBe('Your wedding outfit has no shoes.')
    expect(result.favourites.map((f) => f.name)).toEqual(['Favourite Tee'])
    // Everything else stays behind the search.
    expect(result.remaining.map((r) => r.name)).toEqual(['Plain Tee'])
  })

  it('says plainly why a favourite is being shown', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [garment({ id: 'fav', displayName: 'Linen Shirt', favorite: true })],
    })
    expect(result.favourites[0]?.reason).toBe('A favourite you have not packed.')
  })

  it('never offers something already planned', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [garment({ id: 'packed', displayName: 'Packed Tee', favorite: true })],
      plannedItemIds: new Set(['packed']),
    })
    expect(result.favourites).toHaveLength(0)
    expect(result.remaining).toHaveLength(0)
  })

  it('never offers an archived garment or one marked never-pack', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [
        garment({ id: 'old', displayName: 'Old Tee', favorite: true, archivedAt: 1 }),
        garment({ id: 'never', displayName: 'Never Tee', favorite: true, neverInclude: true }),
      ],
    })
    expect(result.favourites).toHaveLength(0)
    expect(result.remaining).toHaveLength(0)
  })

  it('offers nothing at all when everything is planned', () => {
    const result = reviewWardrobe({
      ...EMPTY,
      wardrobe: [garment({ id: 'a' }), garment({ id: 'b' })],
      plannedItemIds: new Set(['a', 'b']),
    })
    expect(result).toEqual({ favourites: [], nearMatches: [], remaining: [] })
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
