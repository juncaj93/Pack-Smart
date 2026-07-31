import { describe, expect, it } from 'vitest'
import {
  computeQuantity,
  describeCondition,
  evaluate,
  isPacked,
  needsFinalCheck,
  renderBreakdown,
  sectionFor,
  type EngineContext,
  type PackingRule,
} from '@shared/rules'

/** The approved worked example: 31 Jul - 11 Aug international, 12 days, 11 nights. */
const TRIP: Record<string, unknown> = {
  trip_days: 12,
  nights: 11,
  international: true,
  flight_hours: 15,
  activities: ['safari', 'winery'],
  laundry_available: false,
}

function context(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    facts: TRIP,
    includedItemIds: new Set<string>(),
    preferences: {},
    ...overrides,
  }
}

function rule(partial: Partial<PackingRule>): PackingRule {
  return {
    id: 'r1', itemId: 'i1', ruleType: 'fixed_per_trip', quantityValue: 1, buffer: null,
    condition: null, dependsOnItemId: null, enabled: true, originalText: null,
    // A seeded rule that replaces nothing, which is what every rule was before
    // migration 0011 and what all of these are about.
    source: 'system', supersedesRuleId: null,
    ...partial,
  }
}

describe('condition evaluation is three-valued', () => {
  it('answers true, false, or unknown — never guesses', () => {
    expect(evaluate({ fact: 'nights', gte: 3 }, TRIP)).toBe(true)
    expect(evaluate({ fact: 'nights', gte: 30 }, TRIP)).toBe(false)
    // The trip never recorded this fact.
    expect(evaluate({ fact: 'has_pool', eq: true }, TRIP)).toBe('unknown')
  })

  it('treats a missing fact as unknown, not false', () => {
    expect(evaluate({ fact: 'laundry_available', eq: true }, {})).toBe('unknown')
  })

  it('matches activities by membership', () => {
    expect(evaluate({ fact: 'activities', contains: 'safari' }, TRIP)).toBe(true)
    expect(evaluate({ fact: 'activities', contains: 'skiing' }, TRIP)).toBe(false)
  })

  it('propagates unknown through and/or/not correctly', () => {
    const known = { fact: 'nights', gte: 3 } as const
    const unknown = { fact: 'mystery', eq: 1 } as const

    // A definite false short-circuits `all`, even alongside an unknown.
    expect(evaluate({ all: [{ fact: 'nights', gte: 99 }, unknown] }, TRIP)).toBe(false)
    expect(evaluate({ all: [known, unknown] }, TRIP)).toBe('unknown')

    // A definite true short-circuits `any`.
    expect(evaluate({ any: [known, unknown] }, TRIP)).toBe(true)
    expect(evaluate({ any: [{ fact: 'nights', gte: 99 }, unknown] }, TRIP)).toBe('unknown')

    expect(evaluate({ not: known }, TRIP)).toBe(false)
    expect(evaluate({ not: unknown }, TRIP)).toBe('unknown')
  })
})

describe('M4 acceptance — the approved worked example', () => {
  it('gives contacts 24 for a 12-day trip', () => {
    // 2 per INCLUSIVE CALENDAR DAY. Nights x 2 would give 22.
    const result = computeQuantity([rule({ ruleType: 'per_day', quantityValue: 2 })], context())
    expect(result.quantity).toBe(24)
    expect(renderBreakdown(result)).toBe('12 days × 2 = 24')
  })

  it('gives underwear 24 on the same basis', () => {
    const result = computeQuantity([rule({ ruleType: 'per_day', quantityValue: 2 })], context())
    expect(result.quantity).toBe(24)
  })

  it('gives Synthroid trip days plus a two-day buffer', () => {
    const result = computeQuantity(
      [rule({ ruleType: 'duration_plus_buffer', quantityValue: 1, buffer: 2 })],
      context(),
    )
    expect(result.quantity).toBe(14)
    expect(renderBreakdown(result)).toContain('12 days × 1')
    expect(renderBreakdown(result)).toContain('2 extra days')
  })

  it('includes the passport for an international trip', () => {
    const result = computeQuantity(
      [rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: true } })],
      context(),
    )
    expect(result.quantity).toBe(1)
    expect(result.source).toBe('trip_triggered')
    expect(result.reason).toBe('International travel')
  })

  it('leaves the passport out of a domestic trip', () => {
    const result = computeQuantity(
      [rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: true } })],
      context({ facts: { ...TRIP, international: false } }),
    )
    expect(result.quantity).toBeNull()
  })

  it('includes the shaver at exactly 3 nights and not at 2', () => {
    const shaver = [rule({ ruleType: 'conditional_include', condition: { fact: 'nights', gte: 3 } })]

    expect(computeQuantity(shaver, context({ facts: { ...TRIP, nights: 2 } })).quantity).toBeNull()
    expect(computeQuantity(shaver, context({ facts: { ...TRIP, nights: 3 } })).quantity).toBe(1)
  })

  it('includes a charger only when its device is included', () => {
    const charger = [rule({ ruleType: 'dependency_include', dependsOnItemId: 'shaver-id' })]

    expect(computeQuantity(charger, context()).quantity).toBeNull()

    const withDevice = context({ includedItemIds: new Set(['shaver-id']) })
    const result = computeQuantity(charger, withDevice)
    expect(result.quantity).toBe(1)
    expect(result.source).toBe('dependency_triggered')
  })

  it('includes binoculars for a safari and not otherwise', () => {
    const binoculars = [
      rule({ ruleType: 'conditional_include', condition: { fact: 'activities', contains: 'safari' } }),
    ]
    expect(computeQuantity(binoculars, context()).quantity).toBe(1)
    expect(
      computeQuantity(binoculars, context({ facts: { ...TRIP, activities: ['sightseeing'] } })).quantity,
    ).toBeNull()
  })

  it('includes a neck pillow only for a long flight', () => {
    const pillow = [
      rule({ ruleType: 'conditional_include', condition: { fact: 'flight_hours', gt: 5 } }),
    ]
    expect(computeQuantity(pillow, context()).quantity).toBe(1)
    expect(computeQuantity(pillow, context({ facts: { ...TRIP, flight_hours: 2 } })).quantity).toBeNull()
  })
})

describe('the engine never packs on a guess', () => {
  it('does not include an item whose condition cannot be answered', () => {
    const result = computeQuantity(
      [rule({ ruleType: 'conditional_include', condition: { fact: 'has_pool', eq: true } })],
      context(),
    )
    expect(result.quantity).toBeNull()
    // Flagged so the UI can ask, rather than silently dropped.
    expect(result.incomplete).toBe(true)
  })

  it('distinguishes "answered no" from "never asked"', () => {
    const laundryRule = [
      rule({ ruleType: 'conditional_include', condition: { fact: 'laundry_available', eq: true } }),
    ]

    const answeredNo = computeQuantity(laundryRule, context())
    expect(answeredNo.quantity).toBeNull()
    expect(answeredNo.incomplete).toBe(false)

    const neverAsked = computeQuantity(laundryRule, context({ facts: { trip_days: 12, nights: 11 } }))
    expect(neverAsked.quantity).toBeNull()
    expect(neverAsked.incomplete).toBe(true)
  })

  it('returns nothing at all when an item has no rules', () => {
    expect(computeQuantity([], context()).quantity).toBeNull()
  })

  it('ignores disabled rules', () => {
    expect(
      computeQuantity([rule({ ruleType: 'per_day', quantityValue: 2, enabled: false })], context())
        .quantity,
    ).toBeNull()
  })
})

describe('quantity composition order', () => {
  it('applies minimum floors above the computed base', () => {
    const result = computeQuantity(
      [rule({ ruleType: 'fixed_per_trip', quantityValue: 1 }), rule({ id: 'r2', ruleType: 'minimum', quantityValue: 2 })],
      context(),
    )
    expect(result.quantity).toBe(2)
  })

  it('adds spares after the floor', () => {
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 1 }),
        rule({ id: 'r2', ruleType: 'spare', quantityValue: 2 }),
      ],
      context(),
    )
    expect(result.quantity).toBe(14) // 12 + 2
  })

  it('applies maximum caps last', () => {
    const result = computeQuantity(
      [
        rule({ ruleType: 'per_day', quantityValue: 2 }),
        rule({ id: 'r2', ruleType: 'maximum', quantityValue: 10 }),
      ],
      context(),
    )
    expect(result.quantity).toBe(10)
    expect(renderBreakdown(result)).toContain('capped at 10')
  })

  it('handles per-night rules', () => {
    expect(
      computeQuantity([rule({ ruleType: 'per_night', quantityValue: 1 })], context()).quantity,
    ).toBe(11)
  })
})

describe('explanations', () => {
  it('shows the arithmetic that produced a calculated quantity', () => {
    const result = computeQuantity([rule({ ruleType: 'per_day', quantityValue: 2 })], context())
    expect(renderBreakdown(result)).toBe('12 days × 2 = 24')
  })

  it('says nothing for an obvious single item', () => {
    // Doc 03 §12: do not explain every obvious item. A row justifying
    // "Toothbrush: 1" trains the user to ignore the useful explanations.
    const result = computeQuantity([rule({ ruleType: 'fixed_per_trip', quantityValue: 1 })], context())
    expect(renderBreakdown(result)).toBeNull()
  })

  it('describes conditions in words rather than symbols', () => {
    expect(describeCondition({ fact: 'nights', gte: 3 })).toBe('3 or more nights')
    expect(describeCondition({ fact: 'international', eq: true })).toBe('international travel')
    expect(describeCondition({ fact: 'activities', contains: 'safari' })).toBe('safari')
    expect(describeCondition({ all: [{ fact: 'nights', gte: 3 }, { fact: 'international', eq: true }] }))
      .toBe('3 or more nights and international travel')
  })

  it('never emits a confidence percentage', () => {
    const result = computeQuantity(
      [rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: true } })],
      context(),
    )
    expect(result.reason ?? '').not.toMatch(/\d+%/)
  })
})

describe('checklist sections are derived, never stored', () => {
  const base = { excludedAt: null, packingTiming: 'anytime', requiresFinalCheck: false, finalCheckedAt: null }

  it('puts ordinary items in Pack Now', () => {
    expect(sectionFor(base)).toBe('pack_now')
  })

  it('puts day-of and last-minute items in Pack Later', () => {
    expect(sectionFor({ ...base, packingTiming: 'day_of' })).toBe('pack_later')
    expect(sectionFor({ ...base, packingTiming: 'last_minute' })).toBe('pack_later')
  })

  it('puts excluded items in Not Bringing regardless of timing', () => {
    expect(sectionFor({ ...base, excludedAt: 123, packingTiming: 'last_minute' })).toBe('not_bringing')
  })

  it('shows Final Check in addition to the timing section, not instead of it', () => {
    // Product doc 03 §8: packing timing and final verification are separate.
    const passport = { ...base, requiresFinalCheck: true, packingTiming: 'last_minute' }
    expect(sectionFor(passport)).toBe('pack_later')
    expect(needsFinalCheck(passport)).toBe(true)
  })

  it('drops an item out of Final Check once confirmed', () => {
    expect(needsFinalCheck({ excludedAt: null, requiresFinalCheck: true, finalCheckedAt: 99 })).toBe(false)
  })

  it('never asks to final-check something not being brought', () => {
    expect(needsFinalCheck({ excludedAt: 5, requiresFinalCheck: true, finalCheckedAt: null })).toBe(false)
  })
})

describe('packed status is derived from quantities', () => {
  it('is packed only when the full amount is in the bag', () => {
    expect(isPacked({ packedQty: 24, requiredQty: 24 })).toBe(true)
    expect(isPacked({ packedQty: 14, requiredQty: 24 })).toBe(false)
    expect(isPacked({ packedQty: 0, requiredQty: 1 })).toBe(false)
  })
})
