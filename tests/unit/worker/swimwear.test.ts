import { contextForLevel } from '@shared/dressiness'
import { describe, expect, it } from 'vitest'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import {
  SWIM_FOOTWEAR_SUBCATEGORY,
  SWIM_SUBCATEGORY,
  assign,
  clothingDemand,
  ensureSwimFootwear,
  planGroups,
  type FilledGroup,
} from '@shared/outfits'
import { parseItinerary } from '@shared/itinerary'

/**
 * Swimwear, and the sandals that go with it.
 *
 * ## What was already true before any of this was written
 *
 * Most of it. The outfit engine already had a `swim` slot role, a `Swimwear`
 * subcategory mapped to it, `Beach` and `Pool and downtime` templates with the
 * swim slot required, and `REUSE_DEFAULTS.swim = 2`. Measured against the brief
 * before a line changed, seven of its ten cases already passed — including the
 * one it warns hardest about, beach *and* pool on the same date, which comes out
 * as ONE swimsuit because `assign` reuses the garment across both groups and
 * `ceil(2 / 2)` is 1.
 *
 * So most of this file is a **lock**, not a fix. Those behaviours are load-
 * bearing, they were never asserted anywhere, and nothing would have noticed if
 * a change to reuse defaults or group planning quietly doubled Alex's swimwear.
 *
 * ## The tank top, and the rule Alex retired
 *
 * There used to be a second rule here: one tank top packed for every swimsuit
 * packed, topped up from the wardrobe, with a `coverageGaps` sentence wherever
 * the drawer could not close the gap. Alex retired it (doc 09 §0x) — a t-shirt
 * over a swimsuit is as often what he wears, so the rule produced quantities
 * and warnings that no decision of his stood behind.
 *
 * What is asserted instead is the thing that is still true: a swim outfit comes
 * with a top because the template has a top slot, whatever ends up in it, and
 * one garment is never worn twice on the same day.
 */

function garment(partial: Partial<Item> = {}): Item {
  return {
    id: 'g1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: 1,
    weatherTags: [], typicalUses: [], reuseCapacity: null, ownedQuantity: null,
    ...UNRECORDED_TRAITS,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    comfort: null, versatility: null,
    fieldProvenance: {},
    createdAt: 0, updatedAt: 0,
    ...partial,
    dressinessContexts:
      partial.dressinessContexts ??
      (contextForLevel(partial.dressiness === undefined ? 1 : partial.dressiness) === null
        ? []
        : [contextForLevel(partial.dressiness === undefined ? 1 : partial.dressiness)!]),
  }
}

function swimsuit(id: string, over: Partial<Item> = {}) {
  return garment({
    id,
    displayName: 'Swim Trunks',
    category: 'Bottoms & Swimwear',
    subcategory: 'Swimwear',
    /*
     * Loungewear, which is what Alex actually marks his swimwear as — and the
     * separation the brief is emphatic about. Dressiness answers "is this right
     * for the occasion"; it must never answer "does this trip need swimwear".
     * Every zero-swim-day case below is really a test of that.
     */
    dressiness: 0,
    typicalUses: ['swim', 'warm_weather'],
    ...over,
  })
}

function tankTop(id: string, over: Partial<Item> = {}) {
  return garment({
    id,
    displayName: 'Athletic Tank Top',
    subcategory: 'Tank Top',
    dressiness: 1,
    typicalUses: ['warm_weather', 'casual'],
    ...over,
  })
}

function birkenstocks(id: string, over: Partial<Item> = {}) {
  return garment({
    id,
    displayName: 'Sandals',
    category: 'Footwear',
    subcategory: 'Sandals',
    brand: 'Birkenstock',
    typicalUses: ['casual'],
    ...over,
  })
}

function slides(id: string, over: Partial<Item> = {}) {
  return garment({
    id,
    displayName: 'Slides',
    category: 'Footwear',
    subcategory: 'Sandals',
    brand: 'Nike',
    dressiness: 0,
    typicalUses: ['casual', 'loungewear'],
    ...over,
  })
}

/** Closet-sized: three swimsuits, two tank tops, and ordinary clothes. */
function closet(swimsuits = 3, tanks = 2): Item[] {
  return [
    ...Array.from({ length: swimsuits }, (_, i) => swimsuit(`swim${i + 1}`)),
    ...Array.from({ length: tanks }, (_, i) => tankTop(`tank${i + 1}`)),
    garment({ id: 'tee1', subcategory: 'T-Shirt', typicalUses: ['casual'] }),
    garment({ id: 'tee2', subcategory: 'T-Shirt', typicalUses: ['casual'] }),
    garment({ id: 'tee3', subcategory: 'T-Shirt', typicalUses: ['casual'] }),
    garment({ id: 'pants', subcategory: 'Pants', typicalUses: ['casual'] }),
    garment({ id: 'shorts', subcategory: 'Shorts', typicalUses: ['casual', 'warm_weather'] }),
    garment({ id: 'shoes', subcategory: 'Shoes', typicalUses: ['casual'] }),
    birkenstocks('sandals'),
  ]
}

const WEEK = [
  '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
  '2026-08-05', '2026-08-06', '2026-08-07',
]

/** Plans the trip and reports what is actually going in the bag. */
function plan(
  activities: string[],
  days: Array<{ date: string; activityTag: string | null }>,
  wardrobe = closet(),
) {
  const { groups } = assign(planGroups(activities, WEEK.length, days), wardrobe)
  const demand = clothingDemand(groups as unknown as FilledGroup[])

  const count = (subcategory: string) =>
    [...demand.values()]
      .filter((d) => d.item.subcategory === subcategory)
      .reduce((n, d) => n + d.quantity, 0)

  return { groups, swimsuits: count(SWIM_SUBCATEGORY) }
}

function on(pairs: Array<[number, string]>) {
  return pairs.map(([i, tag]) => ({ date: WEEK[i]!, activityTag: tag }))
}

/* ------------------------------------------------------------------ */

describe('when a trip needs swimwear at all', () => {
  it('packs none for a trip of sightseeing, dinners and flights', () => {
    const result = plan(['sightseeing', 'nice_dinner'], on([[1, 'sightseeing'], [3, 'nice_dinner']]))
    expect(result.swimsuits).toBe(0)
  })

  /*
   * The separation stated as its own test, because it is the one the brief
   * returns to three times: swimwear marked Loungewear, and nothing in the
   * itinerary that gets Alex into water. Dressiness must not be a trigger.
   */
  it('packs none when swimwear is Loungewear and there are no swim days', () => {
    const wardrobe = closet()
    expect(wardrobe.filter((i) => i.subcategory === 'Swimwear').every((i) => i.dressiness === 0))
      .toBe(true)

    expect(plan(['sightseeing'], on([[1, 'sightseeing']]), wardrobe).swimsuits).toBe(0)
  })

  it('works on a road trip, with no flight anywhere near it', () => {
    expect(plan(['road_trip', 'swimming'], on([[0, 'road_trip'], [2, 'swimming']])).swimsuits).toBe(1)
  })
})

describe('how many swimsuits, from how many swim-use days', () => {
  it('one pool day is one swimsuit', () => {
    expect(plan(['swimming'], on([[2, 'swimming']])).swimsuits).toBe(1)
  })

  /*
   * The case the brief is most specific about. Two water phrases on ONE date is
   * one swim-use day, and one swimsuit — not two.
   */
  it('a beach morning and a pool afternoon on one day is still one swimsuit', () => {
    const sameDay = [
      { date: WEEK[2]!, activityTag: 'beach' },
      { date: WEEK[2]!, activityTag: 'swimming' },
    ]
    const result = plan(['beach', 'swimming'], sameDay)

    expect(result.swimsuits).toBe(1)

    // And it really did plan both outfits — the count is collapsed by reuse,
    // not by the second activity having been dropped on the floor.
    const { groups } = assign(planGroups(['beach', 'swimming'], 7, sameDay), closet())
    expect(groups.map((g) => g.name).sort()).toContain('Beach')
    expect(groups.map((g) => g.name).sort()).toContain('Pool and downtime')
  })

  it('three separate swim days rotate through two swimsuits', () => {
    expect(plan(['swimming'], on([[1, 'swimming'], [3, 'swimming'], [5, 'swimming']])).swimsuits)
      .toBe(2)
  })

  it('a pool-heavy trip packs more than one, and never one per day', () => {
    const fiveDays = on([[1, 'swimming'], [2, 'swimming'], [3, 'swimming'], [4, 'swimming'], [5, 'swimming']])
    const result = plan(['swimming'], fiveDays)

    expect(result.swimsuits).toBeGreaterThan(1)
    expect(result.swimsuits).toBeLessThan(5)
  })

  /*
   * Owned quantity is a hard ceiling, and the wardrobe is the only place the
   * number can come from. Two swimsuits owned, five swim days: two, and the plan
   * says so rather than inventing a third.
   */
  it('never recommends more swimsuits than Alex owns', () => {
    const twoOwned = closet(2)
    const fiveDays = on([[1, 'swimming'], [2, 'swimming'], [3, 'swimming'], [4, 'swimming'], [5, 'swimming']])

    expect(plan(['swimming'], fiveDays, twoOwned).swimsuits).toBe(2)
  })
})

describe('a swim outfit comes with something to wear over it', () => {
  /*
   * The swim template's own top slot, which is the whole of the rule now that
   * the tank-top pairing is gone. This is the assertion that would fail if the
   * slot were ever dropped from the template — and it deliberately does NOT
   * assert which kind of top lands in it, because that is the opinion Alex
   * retired (doc 09 §0x).
   */
  it('gives the swim outfit a top', () => {
    const { groups } = plan(['swimming'], on([[2, 'swimming']]))
    const pool = groups.find((g) => g.name === 'Pool and downtime')!
    const top = pool.slots.find((s) => s.role === 'top')

    expect(top?.item).toBeTruthy()
  })

  /*
   * "One physical garment should not satisfy multiple simultaneous required
   * counts." `assign` tracks `usedCount` against reuse capacity, so the pool
   * outfit and the travel outfit on the same trip get different tops rather
   * than the same one counted twice.
   */
  it('never wears one top in two outfits at once', () => {
    const { groups } = plan(['swimming'], on([[2, 'swimming']]))
    const topIds = groups
      .flatMap((g) => g.slots)
      .filter((s) => s.role === 'top' && s.item)
      .map((s) => s.item!.id)

    expect(new Set(topIds).size).toBe(topIds.length)
  })

  /*
   * The retired rule, asserted as retired.
   *
   * Two swimsuits and a wardrobe full of tank tops used to force two tank tops
   * into the bag whatever the outfits wanted. Nothing tops the count up now, so
   * the only tank tops packed are the ones an outfit actually put on.
   */
  it('does not add a tank top the outfits never asked for', () => {
    const { groups } = plan(
      ['swimming'],
      on([[1, 'swimming'], [3, 'swimming'], [5, 'swimming']]),
    )

    const wornTankIds = new Set(
      groups
        .flatMap((g) => g.slots)
        .filter((s) => s.item?.subcategory === 'Tank Top')
        .map((s) => s.item!.id),
    )

    const demand = clothingDemand(groups as unknown as FilledGroup[])
    const packedTankIds = [...demand.values()]
      .filter((d) => d.item.subcategory === 'Tank Top')
      .map((d) => d.item.id)

    for (const id of packedTankIds) expect(wornTankIds.has(id)).toBe(true)
  })
})

describe('reading swimming out of an itinerary', () => {
  const YEAR = 2026

  function tags(line: string) {
    return parseItinerary(`Destination: Lisbon\n2026-08-03 ${line}`, { referenceYear: YEAR })
      .activities.map((a) => a.tag)
  }

  it('recognises getting into the water, however the line words it', () => {
    for (const [line, expected] of [
      ['Pool day at the hotel', 'swimming'],
      ['Beach morning', 'beach'],
      ['Snorkelling trip', 'swimming'],
      ['Hot tub in the evening', 'swimming'],
      ['Jacuzzi and sauna', 'swimming'],
      ['Water park with the family', 'swimming'],
      ['Swimming lessons', 'swimming'],
      // `pool` is what carries this one. Bare `spa` is deliberately not a
      // signal — see the pattern's own comment.
      ['Spa with pool access', 'swimming'],
    ] as const) {
      expect(tags(line), line).toContain(expected)
    }
  })

  /*
   * The other half, and the more important one. These describe a PLACE, and a
   * swimsuit packed because a hotel had a name with "resort" in it is the
   * confident-wrong answer doc 03 exists to prevent.
   */
  it('does not read a swimsuit out of a place name', () => {
    for (const line of [
      'Check in at the resort',
      'Hotel with an ocean view',
      'Dinner on the waterfront',
      'Beachfront apartment, keys from reception',
      'Boat to the island',
      'Yacht charter, 3pm',
      'Spa treatment booked',
    ]) {
      // `toContain`, not `not.toEqual(arrayContaining(...))` — the latter passes
      // against almost anything and was caught doing exactly that: adding
      // `resort` to the swim pattern left this test green.
      expect(tags(line), line).not.toContain('swimming')
      expect(tags(line), line).not.toContain('beach')
    }
  })
})

/**
 * One pair of sandals for the trip, not one per swimsuit.
 *
 * The asymmetry with the tank tops is Alex's ruling rather than an inference: a
 * swimsuit is worn wet and a second earns its place in the bag, while one pair
 * of slides walks to the pool every day. So this asks a yes/no question where
 * the tank-top rule counts — and these tests exist mostly to stop somebody
 * "tidying" the two rules into one.
 */
describe('the sandals that go with the swimwear', () => {
  const packing = (...items: Array<[string, Item]>) =>
    new Map(items.map(([id, item]) => [
      id,
      { item, quantity: 1, groups: ['Beach'], daysOfWear: 1, laundryCapped: false },
    ]))

  it('asks for none when no swimsuit is packed', () => {
    const result = ensureSwimFootwear(packing(['tee1', garment({ id: 'tee1' })]), closet())

    expect(result.swimwear).toBe(0)
    expect(result.added).toBeNull()
    expect(result.short).toBe(false)
  })

  it('adds one qualifying pair for one swimsuit', () => {
    const result = ensureSwimFootwear(packing(['swim1', swimsuit('swim1')]), closet())

    expect(result.added?.subcategory).toBe(SWIM_FOOTWEAR_SUBCATEGORY)
    expect(result.short).toBe(false)
  })

  /* The whole point of the rule being yes/no. */
  it('still adds only one pair for three swimsuits', () => {
    const result = ensureSwimFootwear(
      packing(
        ['swim1', swimsuit('swim1')],
        ['swim2', swimsuit('swim2')],
        ['swim3', swimsuit('swim3')],
      ),
      closet(),
    )

    expect(result.swimwear).toBe(3)
    expect(result.added).not.toBeNull()

    /*
     * And the pair it just added satisfies the rule outright — a second pass
     * over the resulting plan wants nothing more. That is what "one pair for the
     * trip" means operationally, and it is what a per-swimsuit rewrite of this
     * function would break.
     */
    const settled = packing(
      ['swim1', swimsuit('swim1')],
      ['swim2', swimsuit('swim2')],
      ['swim3', swimsuit('swim3')],
      [result.added!.id, result.added!],
    )
    expect(ensureSwimFootwear(settled, closet()).added).toBeNull()
  })

  it('adds nothing when the Birkenstocks are already packed', () => {
    const result = ensureSwimFootwear(
      packing(['swim1', swimsuit('swim1')], ['birks', birkenstocks('birks')]),
      closet(),
    )

    expect(result.alreadyPacked).toBe(true)
    expect(result.added).toBeNull()
    expect(result.short).toBe(false)
  })

  it('adds nothing when the slides are already packed', () => {
    const result = ensureSwimFootwear(
      packing(['swim1', swimsuit('swim1')], ['slides', slides('slides')]),
      closet(),
    )

    expect(result.alreadyPacked).toBe(true)
    expect(result.added).toBeNull()
  })

  /*
   * Both owned, and the answer must be the same every time. Ordered by what
   * Alex actually wears — `usageFrequency` is his own recorded answer — then
   * comfort, then the id, so no wardrobe ordering can change the outcome.
   */
  it('chooses deterministically when he owns both', () => {
    const wardrobe = [
      ...closet(),
      birkenstocks('birks', { usageFrequency: 'rare' }),
      slides('slides', { usageFrequency: 'frequent' }),
    ]

    const first = ensureSwimFootwear(packing(['swim1', swimsuit('swim1')]), wardrobe)
    const second = ensureSwimFootwear(packing(['swim1', swimsuit('swim1')]), [...wardrobe].reverse())

    expect(first.added?.id).toBe('slides')
    expect(second.added?.id).toBe(first.added?.id)
  })

  it('reports a shortfall rather than inventing a pair he does not own', () => {
    const barefoot = closet().filter((i) => i.subcategory !== SWIM_FOOTWEAR_SUBCATEGORY)
    const result = ensureSwimFootwear(packing(['swim1', swimsuit('swim1')]), barefoot)

    expect(result.added).toBeNull()
    expect(result.short).toBe(true)
  })

  it('is not coupled to flying: a road trip with a pool asks for a pair too', () => {
    const { groups } = assign(
      planGroups(['road_trip', 'swimming'], WEEK.length, on([[0, 'road_trip'], [2, 'swimming']])),
      closet(),
    )
    const demand = clothingDemand(groups as unknown as FilledGroup[])
    const result = ensureSwimFootwear(demand, closet())

    expect(result.swimwear).toBeGreaterThan(0)
    expect(result.alreadyPacked || result.added !== null).toBe(true)
  })

  /*
   * Loungewear swimwear, zero swim days: no swimsuit reaches the plan, so no
   * footwear requirement follows. The trigger is the itinerary, never a
   * garment's dressiness — asserted here as well as for the tank tops because
   * this is a second rule that could quietly acquire its own trigger.
   */
  it('asks for nothing when Loungewear swimwear meets a trip with no water', () => {
    const { groups } = assign(
      planGroups(['sightseeing'], WEEK.length, on([[1, 'sightseeing']])),
      closet(),
    )
    const demand = clothingDemand(groups as unknown as FilledGroup[])

    expect(ensureSwimFootwear(demand, closet()).swimwear).toBe(0)
    expect(ensureSwimFootwear(demand, closet()).added).toBeNull()
  })
})
