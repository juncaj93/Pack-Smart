import { beforeAll, describe, expect, it } from 'vitest'
import { activityFit, relevantUses } from '@shared/activity-fit'
import { contextForLevel } from '@shared/dressiness'
import { UNRECORDED_TRAITS, type Item } from '@shared/items'
import {
  OUTFIT_TEMPLATES,
  assign,
  passesFilters,
  planGroups,
  rank,
  versatilitySignal,
} from '@shared/outfits'
import { named, realCloset } from './real-closet'

/**
 * A garment has to suit what Alex is DOING, not merely what he is dressed for
 * (V1.1).
 *
 * ## The defect, as it came out of the real closet
 *
 * ```
 * GROUP Beach
 *     swim       Swim Trunks
 *     top        Button-Up Shirt      <- a smart-casual shirt, on sand
 *     footwear   White Sneakers       <- sneakers, on sand
 * ```
 *
 * Three faults, compounding, and none of them a rule misfiring:
 *
 *   1. **Over-inclusion.** `Casual / Smart Casual` parses to
 *      `['casual','dressy']`, and the lone `casual` satisfied the beach
 *      template's coarse `uses` gate.
 *   2. **Under-inclusion.** Three of the four `Athletic Tank Top` rows were
 *      REJECTED — their only tag is `athletic`, which the beach template does
 *      not list. The best beach tops in the closet were ineligible.
 *   3. **Perverse ranking.** Inferred versatility is `typicalUses.length`, so
 *      the `dressy` tag was worth a point: Button-Up scored 2 against a plain
 *      casual tee's 1. *Being dressy is what won the beach slot.* The identical
 *      arithmetic put `White Sneakers` (`casual`+`dressy`) above `Sandals`.
 *
 * Every assertion here runs on the REAL workbook through the REAL importer.
 * That matters: fault 2 is not a defect anyone would have written a fixture
 * for, because nobody believed it until the real rows produced it.
 */

let closet: Item[]

beforeAll(async () => {
  closet = await realCloset()
})

const beach = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'beach')!
const pool = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'swimming')!
const dinner = OUTFIT_TEMPLATES.find((t) => t.activityTag === 'nice_dinner')!

function eligible(role: 'top' | 'footwear' | 'swim', template = beach): Item[] {
  return closet.filter((item) => passesFilters(item, { role, template }).ok)
}

const names = (items: Item[]) => items.map((i) => i.displayName)

/** A garment built to order, for the cases the real closet does not contain. */
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
    dressinessContexts:
      partial.dressinessContexts ?? (context === null ? [] : [context]),
  } as Item
}

/* ------------------------------------------------------------------ */
/* the reported defect                                                 */
/* ------------------------------------------------------------------ */

describe('the beach outfit Alex actually saw', () => {
  it('no longer offers the smart-casual button-up as a beach top', () => {
    const buttonUps = named(closet, 'Button-Up Shirt')
    expect(buttonUps).toHaveLength(2)

    for (const shirt of buttonUps) {
      // The evidence, stated: it is excluded for what it RECORDS, not its name.
      expect(shirt.dressinessContexts).toEqual(['smart_casual'])
      expect(activityFit(shirt, 'beach')).toBe('no')
      expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(false)
    }
  })

  it('no longer offers the smart-casual sneakers as beach footwear', () => {
    const white = named(closet, 'White Sneakers')[0]!
    expect(white.dressinessContexts).toEqual(['smart_casual'])
    expect(passesFilters(white, { role: 'footwear', template: beach }).ok).toBe(false)
  })

  /**
   * 3A — the nuance the brief is explicit about.
   *
   * `Button-Up Shirt` is not excluded for being a button-up. Two other
   * button-ups in the same closet, recorded `Casual`, stay eligible — which is
   * the whole difference between a rule about structure and a blacklist about
   * names. A casual linen short-sleeve button-up is a good beach shirt.
   */
  it('keeps the casual button-ups, because the rule is not about the word', () => {
    for (const shirt of [...named(closet, 'Plaid Button-Up'), ...named(closet, 'Denim Button-Up')]) {
      expect(shirt.dressinessContexts).toEqual(['casual'])
      expect(activityFit(shirt, 'beach')).not.toBe('no')
      expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(true)
    }
  })

  /** 3B — the under-inclusion. All four, not one. */
  it('makes every athletic tank top eligible, including the three it rejected', () => {
    const tanks = named(closet, 'Athletic Tank Top')
    expect(tanks).toHaveLength(4)

    // Three of these are tagged `athletic` only, and the beach template's uses
    // are ['swim','warm_weather','casual'] — no intersection at all.
    const athleticOnly = tanks.filter((t) => t.typicalUses.join() === 'athletic')
    expect(athleticOnly).toHaveLength(3)

    for (const tank of tanks) {
      expect(activityFit(tank, 'beach')).toBe('yes')
      expect(passesFilters(tank, { role: 'top', template: beach }).ok).toBe(true)
    }
  })

  /**
   * The end-to-end claim, on the real closet: what the planner now picks.
   *
   * Deliberately NOT pinned to one exact outfit. Several tops here are
   * genuinely reasonable and asserting a single winner would make this a change
   * detector for the tie-break. What is asserted is what Alex would notice.
   */
  it('plans a beach outfit that is not absurd', () => {
    const [group] = assign(planGroups(['beach'], 4, []), closet, {}).groups
    const picked = Object.fromEntries(
      group!.slots.map((slot) => [slot.role, slot.item?.displayName ?? null]),
    )

    expect(picked.swim).toBe('Swim Trunks')

    // The two garments Alex reported. Neither may be chosen automatically.
    expect(picked.top).not.toBe('Button-Up Shirt')
    expect(picked.footwear).not.toBe('White Sneakers')

    // And what IS chosen has positive grounds rather than merely surviving.
    const top = group!.slots.find((s) => s.role === 'top')?.item
    const shoes = group!.slots.find((s) => s.role === 'footwear')?.item
    expect(activityFit(top!, 'beach')).toBe('yes')
    expect(activityFit(shoes!, 'beach')).toBe('yes')
  })

  /** 3C — sandals beat sneakers, without sneakers becoming forbidden. */
  it('prefers open footwear, while leaving casual sneakers available', () => {
    const shoes = eligible('footwear')
    // Casual sneakers are still ELIGIBLE — some beach days sensibly use them.
    expect(names(shoes)).toContain('Casual Sneakers')
    expect(names(shoes)).toContain('Retro Sneakers')

    const ranked = rank(shoes, {
      requestedItemIds: new Set(),
      usedCount: new Map(),
      activityTag: 'beach',
    })
    // ...but something open wins.
    expect(['Sandals', 'Slides']).toContain(ranked[0]!.item.displayName)
  })

  it('treats the pool exactly as it treats the beach', () => {
    const shirt = named(closet, 'Button-Up Shirt')[0]!
    expect(activityFit(shirt, 'swimming')).toBe('no')
    expect(passesFilters(shirt, { role: 'top', template: pool }).ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* eligibility before ranking (2C)                                     */
/* ------------------------------------------------------------------ */

describe('no rating can rescue an incompatible garment', () => {
  const original = () => named(closet, 'Button-Up Shirt')[0]!

  it('cannot be bought back with five-star comfort', () => {
    const shirt = { ...original(), comfort: 5 }
    expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(false)
  })

  it('cannot be bought back with five-star versatility', () => {
    const shirt = { ...original(), versatility: 5 }
    expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(false)
  })

  it('cannot be bought back by being worn constantly', () => {
    const shirt = { ...original(), usageFrequency: 'frequent' as const }
    expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(false)
  })

  it('cannot be bought back by all three at once', () => {
    const shirt = {
      ...original(),
      comfort: 5,
      versatility: 5,
      usageFrequency: 'frequent' as const,
    }
    expect(passesFilters(shirt, { role: 'top', template: beach }).ok).toBe(false)
    // And it is genuinely absent from the ranked list, not merely last.
    const ranked = rank(eligible('top'), {
      requestedItemIds: new Set(),
      usedCount: new Map(),
      activityTag: 'beach',
    })
    expect(names(ranked.map((r) => r.item))).not.toContain('Button-Up Shirt')
  })
})

/* ------------------------------------------------------------------ */
/* the versatility correction (phase 4)                                */
/* ------------------------------------------------------------------ */

describe('an irrelevant dressy tag cannot make a garment better for the beach', () => {
  /**
   * The exact vectors observed in production, side by side.
   *
   * `['casual','dressy']` scored 2 and `['casual']` scored 1, so the dressier
   * garment won a slot on sand. The tag the beach cannot use is no longer
   * counted, and the two now tie — which is the honest answer, because on the
   * evidence they are equally versatile *for a beach day*.
   */
  it('scores the observed button-up and tee vectors equally for the beach', () => {
    const dressy = garment({ typicalUses: ['casual', 'dressy'] })
    const plain = garment({ typicalUses: ['casual'] })

    expect(versatilitySignal(dressy)).toBe(2) // unchanged with no activity
    expect(versatilitySignal(plain)).toBe(1)

    expect(versatilitySignal(dressy, 'beach')).toBe(versatilitySignal(plain, 'beach'))
  })

  it('leaves the signal untouched where the activity has no rules', () => {
    const dressy = garment({ typicalUses: ['casual', 'dressy'] })
    expect(versatilitySignal(dressy, 'nice_dinner')).toBe(2)
    expect(versatilitySignal(dressy, null)).toBe(2)
  })

  /** Alex's own rating is an answer about the garment, and never discounted. */
  it('never discounts a rating Alex gave', () => {
    const rated = garment({ typicalUses: ['casual', 'dressy'], versatility: 5 })
    expect(versatilitySignal(rated, 'beach')).toBe(5)
  })

  it('discounts only the tags the activity cannot use', () => {
    const item = garment({ typicalUses: ['casual', 'dressy', 'swim'] })
    expect(relevantUses(item, 'beach')).toEqual(['casual', 'swim'])
    expect(relevantUses(item, null)).toEqual(['casual', 'dressy', 'swim'])
  })
})

/* ------------------------------------------------------------------ */
/* yes beats unknown, and unknown is not no (2B, 2D)                   */
/* ------------------------------------------------------------------ */

describe('unknown is not the same as no', () => {
  it('keeps an unclassified garment eligible', () => {
    // Five rows in the real closet record neither contexts nor uses.
    const layering = named(closet, 'Layering T-Shirt')
    expect(layering.length).toBeGreaterThan(0)

    for (const tee of layering) {
      expect(tee.dressinessContexts).toEqual([])
      expect(tee.typicalUses).toEqual([])
      expect(activityFit(tee, 'beach')).toBe('unknown')
      expect(passesFilters(tee, { role: 'top', template: beach }).ok).toBe(true)
    }
  })

  it('ranks a known-suitable garment above an unclassified one', () => {
    const tank = named(closet, 'Athletic Tank Top')[0]!
    const layering = named(closet, 'Layering T-Shirt')[0]!

    const ranked = rank([layering, tank], {
      requestedItemIds: new Set(),
      usedCount: new Map(),
      activityTag: 'beach',
    })

    expect(ranked[0]!.item.displayName).toBe('Athletic Tank Top')
  })

  it('says nothing about an activity it has no rules for', () => {
    for (const item of closet) {
      expect(activityFit(item, 'sightseeing')).toBe('unknown')
      expect(activityFit(item, null)).toBe('unknown')
    }
  })
})

/* ------------------------------------------------------------------ */
/* what the exclusions actually key on                                 */
/* ------------------------------------------------------------------ */

describe('the exclusions read recorded structure, never a name', () => {
  it('excludes a garment recorded only outside the activity contexts', () => {
    expect(activityFit(garment({ dressinessContexts: ['smart_casual'] }), 'beach')).toBe('no')
    expect(activityFit(garment({ dressinessContexts: ['dressy'] }), 'beach')).toBe('no')
    expect(activityFit(garment({ dressinessContexts: ['formal'] }), 'beach')).toBe('no')
  })

  it('admits a garment that shares any compatible context', () => {
    expect(activityFit(garment({ dressinessContexts: ['casual', 'dressy'] }), 'beach')).not.toBe('no')
    // Loungewear is compatible with a pool, and that is not a lesser answer.
    expect(activityFit(garment({ dressinessContexts: ['loungewear'] }), 'beach')).not.toBe('no')
  })

  it('excludes a garment too warm for the activity', () => {
    const heavy = named(closet, 'Heavy Sweater')[0]!
    expect(heavy.warmth).toBe(2)
    expect(activityFit(heavy, 'beach')).toBe('no')
  })

  /**
   * The order of the two halves, asserted.
   *
   * Positive evidence is a reason to prefer; disqualifying evidence is a reason
   * it cannot be worn. When a garment carries both, the exclusion wins.
   */
  it('lets an exclusion beat positive evidence when they disagree', () => {
    const formalSwim = garment({
      subcategory: 'Swimwear',
      typicalUses: ['swim'],
      dressinessContexts: ['formal'],
    })
    expect(activityFit(formalSwim, 'beach')).toBe('no')
  })

  it('does not read a display name', () => {
    // Identical structure, opposite-sounding names. Same answer.
    const shape = { subcategory: 'Tank Top', dressinessContexts: ['casual' as const] }
    expect(activityFit(garment({ ...shape, displayName: 'Formal Evening Tank' }), 'beach')).toBe('yes')
    expect(activityFit(garment({ ...shape, displayName: 'Beach Tank' }), 'beach')).toBe('yes')
  })
})

/* ------------------------------------------------------------------ */
/* nothing else moved                                                  */
/* ------------------------------------------------------------------ */

describe('the templates with no activity rules are untouched', () => {
  it('still admits the smart-casual button-up to a nice dinner', () => {
    const shirt = named(closet, 'Button-Up Shirt')[0]!
    expect(passesFilters(shirt, { role: 'top', template: dinner }).ok).toBe(true)
  })

  it('still applies the coarse uses gate where the activity has no opinion', () => {
    // `athletic` does not intersect the dinner template's ['dressy'], and with
    // no activity rules to override it, the veto stands exactly as before.
    const tank = named(closet, 'Athletic Tank Top').find((t) => t.typicalUses.join() === 'athletic')!
    expect(passesFilters(tank, { role: 'top', template: dinner }).ok).toBe(false)
  })
})
