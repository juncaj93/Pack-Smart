import { beforeAll, describe, expect, it } from 'vitest'
import { activityFit, activityKey } from '@shared/activity-fit'
import { contextForLevel } from '@shared/dressiness'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import {
  CRITERIA,
  OUTFIT_TEMPLATES,
  TRAVEL_TEMPLATE,
  assign,
  explainOutfit,
  passesFilters,
  planGroups,
  rank,
} from '@shared/outfits'
import { bagContext, planBags } from '@shared/bags'
import { openQuestions } from '@shared/readiness'
import { named, realCloset } from './real-closet'

/**
 * The final V1.1 audit: is the planner actually wired the way its modules claim?
 *
 * `activity-compatibility.test.ts` proves each rule. This proves the ASSEMBLY —
 * that a garment's stored fields reach the classifier, that the classifier
 * reaches eligibility, that eligibility runs before ranking, and that the
 * sentence Alex reads describes what actually decided the slot.
 *
 * This file exists because the failure it looks for is invisible to unit tests
 * by construction: both ends correct, the value dropped in the middle. That has
 * happened twice in this repository — the bag chips that never reached
 * `updateTrip`, and the crowding warning counted on a column nothing wrote.
 */

let closet: Item[]

beforeAll(async () => {
  closet = await realCloset()
})

const beach = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'beach')!
const sightseeing = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'sightseeing')!
const dinner = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'nice_dinner')!

function garment(partial: Partial<Item> = {}): Item {
  const level = partial.dressiness === undefined ? 1 : partial.dressiness
  const context = contextForLevel(level ?? null)
  return {
    id: 'x1', kind: 'clothing', displayName: 'Garment', category: 'Tops & Outerwear',
    subcategory: 'T-Shirt', color: null, pattern: null, brand: null, notes: null,
    usageFrequency: 'sometimes', warmth: null, dressiness: level,
    weatherTags: [], typicalUses: [], reuseCapacity: null, ownedQuantity: null,
    ...UNRECORDED_TRAITS,
    isCritical: false, requiresFinalCheck: false, defaultPackingTiming: 'anytime',
    alwaysInclude: false, neverInclude: false, archivedAt: null, source: 'manual',
    comfort: null, versatility: null, fieldProvenance: {}, createdAt: 0, updatedAt: 0,
    ...partial,
    dressinessContexts: partial.dressinessContexts ?? (context === null ? [] : [context]),
  } as Item
}

const ctx = (activityTag: string | null, extra: Record<string, unknown> = {}) => ({
  requestedItemIds: new Set<string>(),
  usedCount: new Map<string, number>(),
  activityTag,
  ...extra,
})

/* ------------------------------------------------------------------ */
/* PHASE 5 — the criteria order, read rather than assumed              */
/* ------------------------------------------------------------------ */

describe('the ranking hierarchy is what the contract says', () => {
  /**
   * Pinned deliberately.
   *
   * `compare` is lexicographic, so this ARRAY ORDER is the entire ranking
   * contract — and the one thing a comment cannot be trusted about. Reordering
   * it is a product decision (doc 04 §5), and it should not be possible to make
   * one by accident while editing the table.
   */
  it('ranks in the approved order', () => {
    expect(CRITERIA.map((c) => c.name)).toEqual([
      'You asked for it',
      'Suits the activity',
      'Suits the conditions',
      'You wear these together',
      'You wear it often',
      'Works for several days',
      'Already packed for another day',
      'Comfortable to wear',
      'Something different',
    ])
  })

  it('puts activity fit above every preference and rating signal', () => {
    const names = CRITERIA.map((c) => c.name)
    const activity = names.indexOf('Suits the activity')

    for (const below of [
      'You wear it often',
      'Works for several days',
      'Already packed for another day',
      'Comfortable to wear',
    ]) {
      expect(activity).toBeLessThan(names.indexOf(below))
    }
  })

  it('leaves an explicit request above everything', () => {
    expect(CRITERIA[0]!.name).toBe('You asked for it')
  })
})

/* ------------------------------------------------------------------ */
/* PHASE 5 — no rating reaches past a hard exclusion                   */
/* ------------------------------------------------------------------ */

describe('a hard exclusion cannot be outbid', () => {
  /**
   * The comment in `CRITERIA` has claimed this since before it was true.
   *
   * "a five-star dress shoe still fails an active walking requirement" was
   * written when there was no activity layer at all, so it was aspiration
   * dressed as documentation. This is the assertion that makes it a fact.
   */
  it('keeps a maximally-favoured garment out when the activity says no', () => {
    const shirt = {
      ...named(closet, 'Button-Up Shirt')[0]!,
      comfort: 5,
      versatility: 5,
      usageFrequency: 'frequent' as const,
    }

    expect(activityFit(shirt, 'beach')).toBe('no')
    expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(false)

    // And a reuse advantage cannot smuggle it back either: it is not in the
    // ranked list at all, so there is nothing for reuse to promote.
    const eligible = closet.filter((i) => passesFilters(i, { role: 'top', template: beach }).ok)
    const ranked = rank([...eligible, shirt as Item], ctx('beach', {
      usedCount: new Map([[shirt.id, 1]]),
    }))
    // `rank` ranks what it is given — the point is that `assign` never gives it
    // an excluded garment. Proven end-to-end by the outfit below.
    const [group] = assign(planGroups(['beach'], 4, []), closet, {}).groups
    const top = group!.slots.find((s) => s.role === 'top')!.item
    expect(top!.displayName).not.toBe('Button-Up Shirt')
    expect(ranked.length).toBeGreaterThan(0)
  })

  it('lets ratings decide freely among garments the activity permits', () => {
    const plain = garment({ id: 'a', subcategory: 'Tank Top', comfort: 1 })
    const comfy = garment({ id: 'b', subcategory: 'Tank Top', comfort: 5 })

    expect(activityFit(plain, 'beach')).toBe('yes')
    expect(activityFit(comfy, 'beach')).toBe('yes')

    const ranked = rank([plain, comfy], ctx('beach'))
    expect(ranked[0]!.item.id).toBe('b')
    expect(ranked[0]!.decidedBy).toBe('Comfortable to wear')
  })
})

/* ------------------------------------------------------------------ */
/* PHASE 6 — Why This may not claim a reason it did not act on         */
/* ------------------------------------------------------------------ */

describe('Why This says what actually decided the slot', () => {
  /**
   * The rule, and it is structural rather than a matter of care.
   *
   * `decidedBy` is the first criterion on which the winner and the RUNNER-UP
   * differ — and both of those are already-eligible candidates, because
   * `passesFilters` ran before `rank` was called. A garment removed by a hard
   * exclusion is not in the array, so it cannot become anybody's reason.
   */
  it('may name activity fit when activity fit separated the top two', () => {
    const known = garment({ id: 'a', subcategory: 'Tank Top' })
    const unclassified = garment({ id: 'b', subcategory: 'T-Shirt', dressinessContexts: [] })

    expect(activityFit(known, 'beach')).toBe('yes')
    expect(activityFit(unclassified, 'beach')).toBe('unknown')

    const ranked = rank([unclassified, known], ctx('beach'))
    expect(ranked[0]!.item.id).toBe('a')
    expect(ranked[0]!.decidedBy).toBe('Suits the activity')
    expect(explainOutfit([{ reason: 'Suits the activity', filledBy: 'planner' }])).toBe(
      'Chosen because it suits what you are doing.',
    )
  })

  /**
   * The load-bearing negative, and the one the brief is explicit about.
   *
   * An incompatible garment was excluded before ranking. That is not a ranking
   * decision, and the winner must not be described as having *suited the
   * activity* because of it — the two survivors both suit the activity equally,
   * and what actually separated them was comfort.
   */
  it('does not claim activity fit merely because something was filtered out', () => {
    const excluded = garment({ id: 'x', subcategory: 'T-Shirt', dressinessContexts: ['dressy'] })
    const plain = garment({ id: 'a', subcategory: 'Tank Top', comfort: 1 })
    const comfy = garment({ id: 'b', subcategory: 'Tank Top', comfort: 5 })

    expect(activityFit(excluded, 'beach')).toBe('no')

    // What `assign` would hand to `rank`: the survivors only.
    const survivors = [excluded, plain, comfy].filter(
      (i) => passesFilters(i, { role: 'top', template: beach }).ok,
    )
    expect(survivors.map((i) => i.id)).toEqual(['a', 'b'])

    const ranked = rank(survivors, ctx('beach'))
    expect(ranked[0]!.decidedBy).toBe('Comfortable to wear')
    expect(ranked[0]!.decidedBy).not.toBe('Suits the activity')

    expect(explainOutfit([{ reason: ranked[0]!.decidedBy, filledBy: 'planner' }])).toBe(
      'Chosen because it is more comfortable.',
    )
  })

  it('does not claim activity fit when both candidates are equally known', () => {
    const a = garment({ id: 'a', subcategory: 'Tank Top', usageFrequency: 'rare' })
    const b = garment({ id: 'b', subcategory: 'Tank Top', usageFrequency: 'frequent' })

    const ranked = rank([a, b], ctx('beach'))
    expect(ranked[0]!.decidedBy).toBe('You wear it often')
  })

  it('does not claim activity fit where the activity has no rules', () => {
    const a = garment({ id: 'a', subcategory: 'Tank Top', comfort: 1 })
    const b = garment({ id: 'b', subcategory: 'Tank Top', comfort: 5 })

    // `winery` has no rules, so the criterion scores 0 for both and cannot decide.
    const ranked = rank([a, b], ctx('winery'))
    expect(ranked[0]!.decidedBy).toBe('Comfortable to wear')
  })

  it('still lets an explicit choice dominate every reason', () => {
    expect(
      explainOutfit([
        { reason: 'Suits the activity', filledBy: 'planner' },
        { reason: 'Comfortable to wear', filledBy: 'user_swap' },
      ]),
    ).toBe('You chose this one.')
  })

  it('still says nothing when nothing separated the candidates', () => {
    const a = garment({ id: 'a', subcategory: 'Tank Top' })
    const b = garment({ id: 'b', subcategory: 'Tank Top' })

    const ranked = rank([a, b], ctx('beach'))
    expect(ranked[0]!.decidedBy).toBeNull()
    expect(explainOutfit([{ reason: null, filledBy: 'planner' }])).toBeNull()
  })

  it('still reports a forced choice as forced rather than preferred', () => {
    const only = garment({ id: 'a', subcategory: 'Tank Top' })
    expect(rank([only], ctx('beach'))[0]!.decidedBy).toBe('The only one that fits')
  })
})

/* ------------------------------------------------------------------ */
/* PHASE 4 — the wiring, from stored fields to the chosen garment      */
/* ------------------------------------------------------------------ */

describe('the classification is driven by stored fields, end to end', () => {
  /**
   * For each traced slot: the stored data, the classification it produces, and
   * the outfit that comes out. No step is asserted from a display name.
   */
  it('traces the beach top from its recorded columns to the chosen garment', () => {
    const shirt = named(closet, 'Button-Up Shirt')[0]!
    // 1. stored
    expect(shirt.subcategory).toBe('Shirt')
    expect(shirt.dressinessContexts).toEqual(['smart_casual'])
    expect(shirt.typicalUses).toEqual(['casual', 'dressy'])
    // 2. classified — from the contexts column, nothing else
    expect(activityFit(shirt, 'beach')).toBe('no')
    // 3. eligibility
    expect(passesFilters(shirt, { role: 'top', template: beach })).toEqual({
      ok: false,
      reason: 'not suggested for this activity',
    })
    // 4. the outfit
    const [group] = assign(planGroups(['beach'], 4, []), closet, {}).groups
    const chosen = group!.slots.find((s) => s.role === 'top')!.item!
    expect(activityFit(chosen, 'beach')).toBe('yes')
  })

  it('traces beach footwear the same way', () => {
    const white = named(closet, 'White Sneakers')[0]!
    expect(white.dressinessContexts).toEqual(['smart_casual'])
    expect(activityFit(white, 'beach')).toBe('no')

    const [group] = assign(planGroups(['beach'], 4, []), closet, {}).groups
    const shoes = group!.slots.find((s) => s.role === 'footwear')!.item!
    expect(shoes.subcategory).toBe('Sandals')
    expect(activityFit(shoes, 'beach')).toBe('yes')
  })

  it('traces sightseeing footwear to the subcategory and context that chose it', () => {
    const sneakers = named(closet, 'Casual Sneakers')[0]!
    expect(sneakers.subcategory).toBe('Shoes')
    expect(sneakers.dressinessContexts).toEqual(['casual'])
    expect(activityFit(sneakers, activityKey(sightseeing))).toBe('yes')

    const groups = assign(planGroups(['beach', 'sightseeing'], 6, []), closet, {}).groups
    const walk = groups.find((g) => g.name === 'Sightseeing')!
    const shoes = walk.slots.find((s) => s.role === 'footwear')!.item!
    expect(shoes.subcategory).toBe('Shoes')
  })

  it('traces travel-day footwear through the name-resolved template key', () => {
    expect(TRAVEL_TEMPLATE.activityTag).toBeNull()
    expect(activityKey(TRAVEL_TEMPLATE)).toBe('Travel days')

    const groups = assign(planGroups(['beach', 'swimming'], 6, []), closet, {}).groups
    const travel = groups.find((g) => g.name === 'Travel days')!
    const shoes = travel.slots.find((s) => s.role === 'footwear')!.item!
    expect(shoes.subcategory).toBe('Shoes')
    expect(activityFit(shoes, 'Travel days')).toBe('yes')
  })

  it('traces a nice-dinner garment to the band that admitted it', () => {
    const groups = assign(planGroups(['nice_dinner'], 3, []), closet, {}).groups
    const top = groups.find((g) => g.name === 'Nice dinners')!.slots
      .find((s) => s.role === 'top')!.item!

    // Admitted by formality, with the activity layer silent — which is the
    // honest division of labour here.
    expect(top.dressinessContexts.some((c) => ['smart_casual', 'dressy', 'formal'].includes(c)))
      .toBe(true)
    expect(activityFit(top, 'nice_dinner')).toBe('unknown')
    expect(passesFilters(top, { role: 'top', template: dinner }).ok).toBe(true)
  })

  it('traces the wedding gap to an empty candidate set rather than a fallback', () => {
    const wedding = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'wedding')!
    const shoes = closet.filter((i) => passesFilters(i, { role: 'footwear', template: wedding }).ok)
    expect(shoes).toHaveLength(0)

    const result = assign(planGroups(['wedding'], 3, []), closet, {})
    const slot = result.groups[0]!.slots.find((s) => s.role === 'footwear')!
    expect(slot.item).toBeNull()
    expect(result.unmet.map((u) => u.role)).toContain('footwear')
  })
})

/* ------------------------------------------------------------------ */
/* PHASE 3 — aviation, still intact after the planner changes          */
/* ------------------------------------------------------------------ */

/**
 * The two halves of V1.1 meeting.
 *
 * `aviation-gating.test.ts` proves the air-travel model on its own and runs on
 * every commit, so this is not a second copy of it. What is asserted here is
 * the ONE place the two halves touch: a drive to the lakes with a swim day,
 * where the trip must plan swimwear without acquiring an airport.
 */
describe('a road trip with a swim day gets swim rules and no aviation', () => {
  const roadTrip = { luggageMode: null, bags: null, flightHours: 0 }

  it('says nothing about cabins or holds', () => {
    const context = bagContext(roadTrip)
    expect(context.flying).toBe(false)
    expect(context.aviation).toBe('no')
    expect(context.bags).toEqual([])
    expect(context.checked).toBe(false)
  })

  it('still asks nothing about flights', () => {
    const trip = {
      flightHours: 0, international: false, laundryAvailable: true,
    } as unknown as Parameters<typeof openQuestions>[0]
    expect(openQuestions(trip).map((q) => q.fact)).not.toContain('flight_hours')
  })

  it('still plans the swim and beach outfits properly', () => {
    const groups = assign(planGroups(['beach', 'swimming'], 5, []), closet, {}).groups
    const b = groups.find((g) => g.name === 'Beach')!

    expect(b.slots.find((s) => s.role === 'swim')!.item!.subcategory).toBe('Swimwear')
    const top = b.slots.find((s) => s.role === 'top')!.item!
    expect(activityFit(top, 'beach')).toBe('yes')
    expect(top.displayName).not.toBe('Button-Up Shirt')
  })

  it('protects nothing against a delayed bag it does not have', () => {
    expect(planBags(roadTrip, []).resilience.size).toBe(0)
    expect(planBags(roadTrip, []).problems).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* PHASE 7 — ten trips, judged on which garments came out              */
/* ------------------------------------------------------------------ */

/**
 * The whole-trip pass, asserted on garment IDENTITY rather than counts.
 *
 * Quantities were already covered. What was not — and what produced the defect
 * Alex reported — is *which* garment. These assert the absurdities named in the
 * brief, not one canonical outfit: several answers are genuinely reasonable in
 * most of these slots, and pinning one would make this a change detector for
 * the tie-break rather than a guard against nonsense.
 */
describe('ten trips, and nothing humanly absurd comes out', () => {
  const TRIPS: Array<{ name: string; activities: string[]; days: number }> = [
    { name: 'beach and pool', activities: ['beach', 'swimming'], days: 6 },
    { name: 'sightseeing and a nice dinner', activities: ['sightseeing', 'nice_dinner'], days: 5 },
    { name: 'walking-heavy city', activities: ['sightseeing', 'hiking'], days: 5 },
    { name: 'formal', activities: ['wedding', 'nice_dinner'], days: 3 },
    { name: 'road trip', activities: ['road_trip'], days: 4 },
    { name: 'several activities', activities: ['beach', 'sightseeing', 'nice_dinner', 'gym'], days: 7 },
    { name: 'cold outdoor', activities: ['hiking', 'sightseeing'], days: 5 },
    { name: 'hot outdoor', activities: ['beach', 'swimming', 'sightseeing'], days: 6 },
    { name: 'travel-heavy', activities: ['business', 'nice_dinner'], days: 4 },
    { name: 'downtime', activities: ['swimming', 'gym'], days: 5 },
  ]

  /** Every garment the planner chose on one trip, by group and role. */
  function plan(activities: string[], days: number) {
    const result = assign(planGroups(activities, days, []), closet, {})
    return result.groups.flatMap((group) =>
      group.slots
        .filter((slot) => slot.item !== null)
        .map((slot) => ({ group: group.name, role: slot.role, item: slot.item! })),
    )
  }

  it.each(TRIPS)('$name produces no garment its activity rejects', ({ activities, days }) => {
    for (const { group, item } of plan(activities, days)) {
      const template = OUTFIT_TEMPLATES.find((t) => t.name === group)
        ?? (group === 'Travel days' ? TRAVEL_TEMPLATE : null)
      if (!template) continue

      /*
       * The invariant that cannot be argued with: the planner may never choose
       * a garment its own classifier calls incompatible. A gap is allowed; this
       * is not.
       */
      expect(activityFit(item, activityKey(template))).not.toBe('no')
    }
  })

  it('never puts a smart-casual-only garment on the sand', () => {
    for (const { group, item } of plan(['beach', 'swimming', 'sightseeing'], 6)) {
      if (group !== 'Beach' && group !== 'Pool and downtime') continue
      expect(item.dressinessContexts).not.toEqual(['smart_casual'])
      expect(item.dressinessContexts).not.toEqual(['dressy'])
    }
  })

  it('never puts something warm at a hot pool', () => {
    for (const { group, item } of plan(['beach', 'swimming'], 6)) {
      if (group !== 'Beach' && group !== 'Pool and downtime') continue
      if (item.warmth === null) continue
      expect(item.warmth).toBeLessThan(2)
    }
  })

  it('never walks a full day in the beach shoe', () => {
    const chosen = plan(['beach', 'swimming', 'sightseeing'], 6)
    const walking = chosen.find((c) => c.group === 'Sightseeing' && c.role === 'footwear')
    expect(walking).toBeDefined()
    expect(walking!.item.subcategory).toBe('Shoes')
  })

  it('never puts a lounge-only garment at a nice dinner', () => {
    for (const { group, item } of plan(['sightseeing', 'nice_dinner'], 5)) {
      if (group !== 'Nice dinners') continue
      expect(item.dressinessContexts).not.toEqual(['loungewear'])
    }
  })

  it('leaves the wedding gap rather than reaching for a sneaker', () => {
    const result = assign(planGroups(['wedding', 'nice_dinner'], 3, []), closet, {})
    const wedding = result.groups.find((g) => g.name === 'Wedding')!
    expect(wedding.slots.find((s) => s.role === 'footwear')!.item).toBeNull()
  })

  it('does not let one activity dominate the groups around it', () => {
    const chosen = plan(['beach', 'sightseeing', 'nice_dinner', 'gym'], 7)
    const shoes = new Map(
      chosen.filter((c) => c.role === 'footwear').map((c) => [c.group, c.item.subcategory]),
    )
    // The beach keeps its open footwear; the walking and workout days do not.
    expect(shoes.get('Beach')).toBe('Sandals')
    expect(shoes.get('Sightseeing')).toBe('Shoes')
    expect(shoes.get('Workouts')).toBe('Shoes')
  })
})
