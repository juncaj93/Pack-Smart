import { describe, expect, it } from 'vitest'
import type { Item } from '@shared/items'
import { rank, type PairingIndex, type RankContext } from '@shared/outfits'

/**
 * Doc 04 §5 criterion 3 — the approved saved outfit relationship.
 *
 * The load-bearing test is the LAST one: with no pairing history the ranking
 * must be byte-for-byte what it was before this criterion existed. That is the
 * property that makes it safe to add to a planner that already works.
 */

function garment(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'clothing',
    displayName: id,
    category: 'Tops & Outerwear',
    subcategory: 'T-Shirt',
    color: null,
    brand: null,
    favorite: false,
    usageFrequency: 'sometimes',
    warmth: null,
    dressiness: 1,
    weatherTags: [],
    typicalUses: ['casual'],
    reuseCapacity: null,
    isCritical: false,
    requiresFinalCheck: false,
    defaultPackingTiming: 'anytime',
    alwaysInclude: false,
    neverInclude: false,
    notes: null,
    archivedAt: null,
    ...overrides,
  } as Item
}

/** A pairing index built from plain pairs, mirroring what the repo produces. */
function pairingsFrom(pairs: Array<[string, string, number]>): PairingIndex {
  const counts = new Map<string, number>()
  for (const [a, b, times] of pairs) {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`
    counts.set(key, times)
  }
  return {
    count(a, b) {
      if (a === b) return 0
      return counts.get(a < b ? `${a} ${b}` : `${b} ${a}`) ?? 0
    },
  }
}

function context(overrides: Partial<RankContext> = {}): RankContext {
  return { requestedItemIds: new Set(), usedCount: new Map(), ...overrides }
}

describe('what Alex approved together', () => {
  it('prefers the garment he has worn with what is already chosen', () => {
    const ranked = rank([garment('navy-tee'), garment('white-tee')], context({
      chosenInGroup: [{ id: 'olive-jacket', displayName: 'Olive Quilted Jacket' }],
      pairings: pairingsFrom([['white-tee', 'olive-jacket', 3]]),
    }))

    expect(ranked[0]!.item.id).toBe('white-tee')
  })

  /*
   * A sum, not a boolean. Two approvals is better evidence than one, and a
   * garment paired with several of the chosen items is better still.
   */
  it('counts the evidence rather than treating any pairing as equal', () => {
    const ranked = rank([garment('a'), garment('b')], context({
      chosenInGroup: [
        { id: 'jacket', displayName: 'Jacket' },
        { id: 'boots', displayName: 'Boots' },
      ],
      pairings: pairingsFrom([
        ['a', 'jacket', 1],
        ['b', 'jacket', 1],
        ['b', 'boots', 2],
      ]),
    }))

    expect(ranked[0]!.item.id).toBe('b')
  })

  /*
   * Doc 04 §5 requires the pairing be traceable to something Alex did. A score
   * that cannot name its evidence is not an explanation.
   */
  it('names the garment it was approved with', () => {
    const ranked = rank([garment('white-tee'), garment('navy-tee')], context({
      chosenInGroup: [{ id: 'olive', displayName: 'Olive Quilted Jacket' }],
      pairings: pairingsFrom([['white-tee', 'olive', 2]]),
    }))

    expect(ranked[0]!.decidedBy).toBe('You approved this with Olive Quilted Jacket before')
  })

  /*
   * Position in the criteria list, asserted through behaviour rather than by
   * reading the array. A habit must never dress Alex wrongly for the weather.
   */
  it('does not outrank suitability for the conditions', () => {
    const ranked = rank(
      [
        garment('waterproof-shell', { weatherTags: ['rain'] }),
        garment('favourite-hoodie'),
      ],
      context({
        preferredCapabilities: ['rain'],
        chosenInGroup: [{ id: 'jeans', displayName: 'Jeans' }],
        // Heavily paired, and it still must not win against rain.
        pairings: pairingsFrom([['favourite-hoodie', 'jeans', 9]]),
      }),
    )

    expect(ranked[0]!.item.id).toBe('waterproof-shell')
  })

  it('outranks a favourite, which is weaker evidence than what he actually wore', () => {
    const ranked = rank(
      [garment('starred', { favorite: true }), garment('actually-worn')],
      context({
        chosenInGroup: [{ id: 'jeans', displayName: 'Jeans' }],
        pairings: pairingsFrom([['actually-worn', 'jeans', 1]]),
      }),
    )

    expect(ranked[0]!.item.id).toBe('actually-worn')
  })

  it('never pairs a garment with itself', () => {
    const index = pairingsFrom([['a', 'b', 4]])
    expect(index.count('a', 'a')).toBe(0)
  })

  it('reads the same pair whichever way round it is asked', () => {
    const index = pairingsFrom([['zebra', 'apple', 5]])
    expect(index.count('apple', 'zebra')).toBe(5)
    expect(index.count('zebra', 'apple')).toBe(5)
  })
})

describe('no history, no effect', () => {
  /*
   * THE test. A first trip, and any garment never approved with another, must
   * rank exactly as they did before this criterion existed.
   */
  it('ranks identically with no pairings and with an empty index', () => {
    const wardrobe = [
      garment('c', { favorite: true }),
      garment('a', { usageFrequency: 'frequent' }),
      garment('b'),
    ]

    const without = rank(wardrobe, context()).map((r) => r.item.id)
    const withEmpty = rank(
      wardrobe,
      context({
        chosenInGroup: [{ id: 'jeans', displayName: 'Jeans' }],
        pairings: pairingsFrom([]),
      }),
    ).map((r) => r.item.id)

    expect(withEmpty).toEqual(without)
  })

  it('leaves the explanation alone when nothing was paired', () => {
    const ranked = rank([garment('a', { favorite: true }), garment('b')], context({
      chosenInGroup: [{ id: 'jeans', displayName: 'Jeans' }],
      pairings: pairingsFrom([]),
    }))

    // Falls through to the criterion that actually decided it.
    expect(ranked[0]!.decidedBy).toBe('A favorite')
  })

  it('has no effect on the first slot, which has nothing to pair with', () => {
    const ranked = rank([garment('a', { favorite: true }), garment('b')], context({
      chosenInGroup: [],
      pairings: pairingsFrom([['b', 'anything', 9]]),
    }))

    expect(ranked[0]!.item.id).toBe('a')
  })
})
