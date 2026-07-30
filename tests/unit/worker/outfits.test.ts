import { describe, expect, it } from 'vitest'
import { assignDays } from '../../../shared/during-trip'
import type { Item } from '@shared/items'
import {
  OUTFIT_TEMPLATES,
  assign,
  clothingDemand,
  joinNames,
  passesFilters,
  planGroups,
  rank,
  reuseCapacity,
  slotFor,
  type OutfitTemplate,
} from '@shared/outfits'

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

const dinner = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'nice_dinner')!
const gym = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'gym')!
const safari = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'safari')!

function context(template: OutfitTemplate, role: Parameters<typeof passesFilters>[1]['role']) {
  return { role, template }
}

describe('garments map to slots by subcategory, not category', () => {
  it('does not let a jacket stand in for a t-shirt', () => {
    // Both live in "Tops & Outerwear". Only the subcategory separates them, and
    // getting this wrong puts a parka in the top slot on a beach day.
    expect(slotFor(garment({ subcategory: 'T-Shirt' }))).toBe('top')
    expect(slotFor(garment({ subcategory: 'Outerwear' }))).toBe('outer')
    expect(slotFor(garment({ subcategory: 'Mid-Layer' }))).toBe('mid')
    expect(slotFor(garment({ subcategory: 'Swimwear' }))).toBe('swim')
  })

  it('returns null for a garment it cannot place', () => {
    expect(slotFor(garment({ subcategory: null }))).toBeNull()
    expect(slotFor(garment({ subcategory: 'Something New' }))).toBeNull()
  })
})

describe('stage 1 — hard filters eliminate, they do not nudge', () => {
  it('keeps loungewear out of a nice dinner no matter how well liked', () => {
    const loved = garment({ dressiness: 0, favorite: true, usageFrequency: 'frequent' })
    expect(passesFilters(loved, context(dinner, 'top')).ok).toBe(false)
  })

  it('admits a garment that suits the occasion', () => {
    expect(passesFilters(garment({ dressiness: 3 }), context(dinner, 'top')).ok).toBe(true)
  })

  it('never offers an archived garment', () => {
    expect(passesFilters(garment({ archivedAt: 1 }), context(safari, 'top')).ok).toBe(false)
  })

  it('never offers something marked never-pack', () => {
    expect(passesFilters(garment({ neverInclude: true }), context(safari, 'top')).ok).toBe(false)
  })

  it('applies warmth as a hard filter to jackets and layers only', () => {
    const summerShell = garment({ subcategory: 'Outerwear', warmth: 0, dressiness: 1 })
    const warmTee = garment({ subcategory: 'T-Shirt', warmth: 3, dressiness: 1 })
    const cold: [number, number] = [2, 3]

    // A summer shell in the cold is wrong.
    expect(passesFilters(summerShell, { ...context(safari, 'outer'), warmthBand: cold }).ok).toBe(false)
    // A warm tee under a jacket is fine — warmth is only a preference for tops.
    expect(passesFilters(warmTee, { ...context(safari, 'top'), warmthBand: cold }).ok).toBe(true)
  })

  it('does not punish a garment for missing data', () => {
    // The spreadsheet often says nothing about use or dressiness. Absent data is
    // not evidence of unsuitability, and excluding on it would shrink the
    // wardrobe to whatever happened to be well documented.
    const undocumented = garment({ dressiness: null, typicalUses: [] })
    expect(passesFilters(undocumented, context(gym, 'top')).ok).toBe(true)
  })

  it('excludes a garment whose recorded uses do not include this one', () => {
    const dressy = garment({ typicalUses: ['dressy'], dressiness: 1 })
    expect(passesFilters(dressy, context(gym, 'top')).ok).toBe(false)
  })

  it('refuses anything not packed once the trip has started', () => {
    const packed = garment({ id: 'in-bag' })
    const athome = garment({ id: 'at-home' })
    const during = { ...context(safari, 'top'), packedItemIds: new Set(['in-bag']) }

    expect(passesFilters(packed, during).ok).toBe(true)
    expect(passesFilters(athome, during).ok).toBe(false)
  })
})

describe('stage 2 — ranking is ordered, not summed', () => {
  const empty = { requestedItemIds: new Set<string>(), usedCount: new Map<string, number>() }

  it('puts a requested item first even when everything else favours another', () => {
    const requested = garment({ id: 'asked-for' })
    const popular = garment({ id: 'popular', favorite: true, usageFrequency: 'frequent', typicalUses: ['a', 'b', 'c'] })

    const ranked = rank([popular, requested], {
      requestedItemIds: new Set(['asked-for']),
      usedCount: new Map(),
    })

    expect(ranked[0]?.item.id).toBe('asked-for')
    expect(ranked[0]?.decidedBy).toBe('You asked for it')
  })

  it('prefers a favourite over a merely frequent garment', () => {
    // Three weaker signals must not outvote a stronger one, which is exactly
    // what a weighted sum would allow.
    const favourite = garment({ id: 'fav', favorite: true, usageFrequency: 'rare' })
    const frequent = garment({ id: 'freq', usageFrequency: 'frequent', typicalUses: ['a', 'b', 'c', 'd'] })

    expect(rank([frequent, favourite], empty)[0]?.item.id).toBe('fav')
  })

  it('names the criterion that decided it', () => {
    const ranked = rank(
      [garment({ id: 'a', favorite: true }), garment({ id: 'b' })],
      empty,
    )
    expect(ranked[0]?.decidedBy).toBe('A favourite')
  })

  it('breaks exact ties on id so the same trip always ranks the same way', () => {
    const first = rank([garment({ id: 'bbb' }), garment({ id: 'aaa' })], empty)
    const second = rank([garment({ id: 'aaa' }), garment({ id: 'bbb' })], empty)

    expect(first.map((r) => r.item.id)).toEqual(['aaa', 'bbb'])
    expect(second.map((r) => r.item.id)).toEqual(['aaa', 'bbb'])
    expect(first[0]?.decidedBy).toBeNull()
  })
})

describe('reuse capacity', () => {
  it('uses the per-category defaults when the item says nothing', () => {
    expect(reuseCapacity(garment({ subcategory: 'T-Shirt' }))).toBe(1)
    expect(reuseCapacity(garment({ subcategory: 'Pants' }))).toBe(3)
    expect(reuseCapacity(garment({ subcategory: 'Outerwear' }))).toBe(99)
  })

  it('lets the item override the default', () => {
    expect(reuseCapacity(garment({ subcategory: 'T-Shirt', reuseCapacity: 2 }))).toBe(2)
  })
})

describe('planning groups', () => {
  it('plans by activity rather than one outfit per day', () => {
    const groups = planGroups(['safari', 'nice_dinner'], 12)
    const names = groups.map((g) => g.name)

    expect(names).toContain('Safari')
    expect(names).toContain('Nice dinners')
    expect(names).toContain('Travel days')
    // Twelve near-identical "Day 7" cards would be busywork, not planning.
    expect(groups.length).toBeLessThan(6)
  })

  it('accounts for every day of the trip', () => {
    const groups = planGroups(['safari'], 12)
    expect(groups.reduce((sum, g) => sum + g.occurrences, 0)).toBe(12)
  })

  it('orders the most constrained group first', () => {
    const groups = planGroups(['sightseeing', 'wedding'], 8)
    expect(groups[0]?.name).toBe('Wedding')
  })

  it('handles a single-day trip without inventing a return flight outfit', () => {
    const groups = planGroups([], 1)
    expect(groups.reduce((sum, g) => sum + g.occurrences, 0)).toBe(1)
  })
})

/**
 * The gap this closes: a twelve-day trip with one "safari" tag planned exactly
 * ONE safari outfit and turned the other days casual, however many of them were
 * actually safari days. Once Alex says which days are what, the count has to
 * come from the calendar.
 */
describe('planning from the days Alex has spoken for', () => {
  const AUGUST = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']

  function days(tags: Array<string | null>) {
    return AUGUST.map((date, i) => ({ date, activityTag: tags[i] ?? null }))
  }

  it('plans one outfit per stated day of an activity, not one per activity', () => {
    const groups = planGroups(['safari'], 5, days([null, 'safari', 'safari', 'safari', null]))
    const safari = groups.find((g) => g.name === 'Safari')

    expect(safari?.occurrences).toBe(3)
    expect(safari?.dates).toEqual(['2026-08-02', '2026-08-03', '2026-08-04'])
  })

  it('still accounts for every day of the trip', () => {
    const groups = planGroups(['safari'], 5, days([null, 'safari', 'safari', null, null]))
    expect(groups.reduce((sum, g) => sum + g.occurrences, 0)).toBe(5)
  })

  it('gives the first and last unspoken days to travel', () => {
    const groups = planGroups(['safari'], 5, days([null, 'safari', null, null, null]))
    const travel = groups.find((g) => g.name === 'Travel days')

    expect(travel?.dates).toEqual(['2026-08-01', '2026-08-05'])
    expect(groups.find((g) => g.name === 'Casual days')?.dates).toEqual([
      '2026-08-03',
      '2026-08-04',
    ])
  })

  /*
   * An activity Alex put on the last day wins. He said what he is doing; the
   * travel-day assumption is only there to fill a day he has not spoken for.
   */
  it('lets an activity on the last day beat the travel-day assumption', () => {
    const groups = planGroups(['wedding'], 5, days([null, null, null, null, 'wedding']))

    expect(groups.find((g) => g.name === 'Wedding')?.dates).toEqual(['2026-08-05'])
    expect(groups.find((g) => g.name === 'Travel days')?.dates).toEqual(['2026-08-01'])
  })

  it('falls back to the old counting when no day has been spoken for', () => {
    const withDays = planGroups(['safari'], 5, [])
    const withoutDays = planGroups(['safari'], 5)
    expect(withDays).toEqual(withoutDays)
  })

  it('ignores a tag with no outfit template behind it', () => {
    const groups = planGroups([], 5, days([null, 'moon_landing', null, null, null]))

    expect(groups.map((g) => g.name)).not.toContain('moon_landing')
    // The day is not silently reassigned either — it belongs to no group, and
    // the plan says so by not covering it.
    expect(groups.reduce((sum, g) => sum + g.occurrences, 0)).toBe(4)
  })
})

describe('assignment', () => {
  const wardrobe = [
    garment({ id: 'tee1', subcategory: 'T-Shirt', dressiness: 1, typicalUses: ['casual'] }),
    garment({ id: 'tee2', subcategory: 'T-Shirt', dressiness: 1, typicalUses: ['casual'] }),
    garment({ id: 'pants', subcategory: 'Pants', dressiness: 1, typicalUses: ['casual'] }),
    garment({ id: 'shoes', subcategory: 'Shoes', dressiness: 1, typicalUses: ['casual'] }),
  ]

  it('fills every slot it can', () => {
    const { groups } = assign(planGroups([], 3), wardrobe)
    const filled = groups.flatMap((g) => g.slots).filter((s) => s.item)
    expect(filled.length).toBeGreaterThan(0)
  })

  it('leaves a slot empty and says why rather than approximating', () => {
    // Nothing in this wardrobe is dressy.
    const { groups, unmet } = assign(planGroups(['wedding'], 3), wardrobe)
    const wedding = groups.find((g) => g.name === 'Wedding')!
    const top = wedding.slots.find((s) => s.role === 'top')!

    expect(top.item).toBeNull()
    expect(top.unmetReason).toMatch(/no top in your wardrobe suits wedding/i)
    expect(unmet.some((u) => u.group === 'Wedding')).toBe(true)
  })

  it('does not wear one t-shirt on every day of the trip', () => {
    const { groups } = assign(planGroups([], 4), wardrobe)
    const tops = groups.flatMap((g) => g.slots).filter((s) => s.role === 'top' && s.item)
    const distinct = new Set(tops.map((s) => s.item!.id))

    // Two tees, capacity 1 each — the second group must reach for the second tee.
    expect(distinct.size).toBe(2)
  })

  it('reuses trousers and shoes across groups', () => {
    const { groups } = assign(planGroups(['safari'], 6), wardrobe)
    const bottoms = groups.flatMap((g) => g.slots).filter((s) => s.role === 'bottom' && s.item)
    expect(new Set(bottoms.map((s) => s.item!.id)).size).toBe(1)
  })

  it('honours a requested item', () => {
    const { groups } = assign(planGroups([], 2), wardrobe, { requestedItemIds: new Set(['tee2']) })
    const tops = groups.flatMap((g) => g.slots).filter((s) => s.role === 'top' && s.item)
    expect(tops.some((s) => s.item!.id === 'tee2')).toBe(true)
  })

  it('offers nothing at all when the trip has not packed it', () => {
    const { groups } = assign(planGroups([], 2), wardrobe, { packedItemIds: new Set(['pants']) })
    const chosen = groups.flatMap((g) => g.slots).filter((s) => s.item).map((s) => s.item!.id)
    expect(new Set(chosen)).toEqual(new Set(['pants']))
  })
})

describe('clothing demand', () => {
  const tee = garment({ id: 'tee', subcategory: 'T-Shirt' })
  const jacket = garment({ id: 'jacket', subcategory: 'Outerwear' })

  it('packs one jacket for six days of wearing it', () => {
    const demand = clothingDemand([
      {
        name: 'Casual days', activityTag: null, dates: [], occurrences: 6,
        slots: [{ role: 'outer', required: false, item: jacket, wearings: 6, unmetReason: null, reason: null }],
      },
    ])
    expect(demand.get('jacket')?.quantity).toBe(1)
  })

  it('packs three t-shirts for three days of wearing one each', () => {
    const demand = clothingDemand([
      {
        name: 'Casual days', activityTag: null, dates: [], occurrences: 3,
        slots: [{ role: 'top', required: true, item: tee, wearings: 3, unmetReason: null, reason: null }],
      },
    ])
    expect(demand.get('tee')?.quantity).toBe(3)
  })

  it('records which outfits need each garment, so removing one can name them', () => {
    const demand = clothingDemand([
      {
        name: 'Safari', activityTag: 'safari', dates: [], occurrences: 1,
        slots: [{ role: 'top', required: true, item: tee, wearings: 3, unmetReason: null, reason: null }],
      },
      {
        name: 'Casual days', activityTag: null, dates: [], occurrences: 1,
        slots: [{ role: 'top', required: true, item: tee, wearings: 3, unmetReason: null, reason: null }],
      },
    ])
    expect(demand.get('tee')?.groups).toEqual(['Safari', 'Casual days'])
  })
})

/**
 * Which outfit lands on which date.
 *
 * Without stated days this spreads groups in planned order, which is a guess
 * dressed as a plan — good enough when Alex has said nothing, wrong the moment
 * he has. With stated days it simply obeys him.
 */
describe('putting outfits on dates', () => {
  const groups = [
    { id: 'travel', name: 'Travel days', occurrences: 2, activityTag: null },
    { id: 'safari', name: 'Safari', occurrences: 2, activityTag: 'safari' },
    { id: 'casual', name: 'Casual days', occurrences: 1, activityTag: null },
  ]

  it('puts the safari outfit on the safari days', () => {
    const assignments = assignDays('2026-08-01', '2026-08-05', groups, [
      { date: '2026-08-02', activityTag: 'safari' },
      { date: '2026-08-04', activityTag: 'safari' },
    ])

    expect(assignments.map((a) => a.groupName)).toEqual([
      'Travel days',
      'Safari',
      'Casual days',
      'Safari',
      'Travel days',
    ])
  })

  /*
   * A day whose group was never approved stays empty and Today says so. Filling
   * it with the nearest approved outfit would put Alex in clothes he did not
   * pick for that day.
   */
  it('leaves a day empty when its outfit is not among the approved groups', () => {
    const assignments = assignDays(
      '2026-08-01',
      '2026-08-03',
      [{ id: 'travel', name: 'Travel days', occurrences: 2, activityTag: null }],
      [{ date: '2026-08-02', activityTag: 'wedding' }],
    )

    expect(assignments[1]?.outfitGroupId).toBeNull()
  })

  it('spreads in planned order when no day has been spoken for', () => {
    const assignments = assignDays('2026-08-01', '2026-08-05', groups)

    expect(assignments[0]?.groupName).toBe('Travel days')
    expect(assignments[4]?.groupName).toBe('Travel days')
    expect(assignments.slice(1, 4).every((a) => a.outfitGroupId !== null)).toBe(true)
  })
})

/*
 * Doc 04 §8's "identify outfits using it" — read out loud rather than counted.
 * "2 outfits use this" makes Alex go and look for which two.
 */
describe('naming the outfits affected by a removal', () => {
  it('says nothing at all for nothing', () => {
    expect(joinNames([])).toBe('')
  })

  it('names one plainly, with no list punctuation', () => {
    expect(joinNames(['Nice dinners'])).toBe('Nice dinners')
  })

  it('joins two with "and", not a comma', () => {
    expect(joinNames(['Nice dinners', 'Safari'])).toBe('Nice dinners and Safari')
  })

  it('joins three the way a sentence would', () => {
    expect(joinNames(['Nice dinners', 'Safari', 'Travel days'])).toBe(
      'Nice dinners, Safari and Travel days',
    )
  })

  // One garment can fill two slots of the same outfit — a shirt as the top and
  // the layer. Naming it twice reads as a bug.
  it('names an outfit once however many of its slots the garment fills', () => {
    expect(joinNames(['Nice dinners', 'Nice dinners'])).toBe('Nice dinners')
  })
})
