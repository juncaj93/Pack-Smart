import { describe, expect, it } from 'vitest'
import { computeQuantity, type EngineContext, type PackingRule } from '@shared/rules'
import { describeTrigger, explainEntrySource, forbidsInternals, usableRuleText } from '@shared/explain'

/**
 * What a row says, and why it says that rather than something else.
 *
 * `necessity-reasons.test.ts` proves the acceptance number against the real
 * workbook. This proves the *decisions* — one rule kind at a time, and
 * especially the case the brief singles out: when several rules apply, the
 * sentence has to credit the one that produced the number on the row.
 *
 * Everything goes through `computeQuantity`, not through the phrasing helpers
 * directly, because the guarantee worth testing is that the reason and the
 * quantity come out of the same fold. Two of these tests assert both at once
 * for exactly that reason.
 */

const TRIP: Record<string, unknown> = {
  trip_days: 10,
  nights: 9,
  international: true,
  flight_hours: 15,
  activities: ['safari', 'swimming'],
  laundry_available: false,
}

function context(overrides: Partial<EngineContext> = {}): EngineContext {
  return { facts: TRIP, includedItemIds: new Set<string>(), preferences: {}, ...overrides }
}

function rule(partial: Partial<PackingRule>): PackingRule {
  return {
    id: 'r1', itemId: 'i1', ruleType: 'fixed_per_trip', quantityValue: 1, buffer: null,
    condition: null, dependsOnItemId: null, enabled: true, originalText: null,
    source: 'system', supersedesRuleId: null,
    ...partial,
  }
}

const reasonOf = (rules: PackingRule[], ctx = context()) => computeQuantity(rules, ctx).reason

describe('one rule, stated plainly', () => {
  it('explains a fixed-per-trip necessity without restating a constant as arithmetic', () => {
    expect(reasonOf([rule({ ruleType: 'fixed_per_trip', quantityValue: 1 })])).toBe('One per trip')
  })

  it('says a fixed-per-trip floor above one is a floor', () => {
    // "At least", not "exactly": `fixed_per_trip` is a floor since A4b, and the
    // sentence has to agree with the engine rather than with the rule's name.
    expect(reasonOf([rule({ ruleType: 'fixed_per_trip', quantityValue: 3 })])).toBe(
      'At least 3 per trip',
    )
  })

  it('explains a per-day quantity with the arithmetic that produced it', () => {
    const rules = [rule({ ruleType: 'per_day', quantityValue: 2 })]
    expect(computeQuantity(rules, context()).quantity).toBe(20)
    expect(reasonOf(rules)).toBe('10 days × 2')
  })

  it('explains a per-night quantity from nights, not days', () => {
    const rules = [rule({ ruleType: 'per_night', quantityValue: 2 })]
    expect(computeQuantity(rules, context()).quantity).toBe(18)
    expect(reasonOf(rules)).toBe('9 nights × 2')
  })

  it('explains a duration-plus-buffer quantity including the spare days', () => {
    const rules = [rule({ ruleType: 'duration_plus_buffer', quantityValue: 1, buffer: 2 })]
    expect(computeQuantity(rules, context()).quantity).toBe(12)
    expect(reasonOf(rules)).toBe('10 days × 1, plus 2 spare')
  })

  it('explains a conditional inclusion as a fact about the trip', () => {
    expect(
      reasonOf([
        rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: true } }),
      ]),
    ).toBe('International trip')
  })

  it('explains a dependency by naming what it depends on', () => {
    const rules = [rule({ ruleType: 'dependency_include', dependsOnItemId: 'watch' })]
    const ctx = context({
      includedItemIds: new Set(['watch']),
      itemNames: { watch: 'Apple Watch' },
    })
    expect(reasonOf(rules, ctx)).toBe('Because you are packing Apple Watch')
  })

  it('names nothing rather than an id when the catalog was not supplied', () => {
    // Vaguer, still true, and never an internal identifier on screen.
    const rules = [rule({ ruleType: 'dependency_include', dependsOnItemId: 'watch' })]
    const ctx = context({ includedItemIds: new Set(['watch']) })
    expect(reasonOf(rules, ctx)).toBe('Because of something else you are packing')
  })
})

describe('several rules apply', () => {
  it('credits the rule that produced the number, not the floor it cleared', () => {
    /*
     * The case the brief names. `2 per day` over ten days is 20; `always pack
     * 3` is a floor of 3. Saying only "at least 3 per trip" beside a 20 would
     * be true of one rule and misleading about the row.
     */
    const rules = [
      rule({ id: 'a', ruleType: 'per_day', quantityValue: 2 }),
      rule({ id: 'b', ruleType: 'fixed_per_trip', quantityValue: 3 }),
    ]
    expect(computeQuantity(rules, context()).quantity).toBe(20)
    expect(reasonOf(rules)).toBe('10 days × 2')
  })

  it('credits the floor when the floor is what the row ended up at', () => {
    const rules = [
      rule({ id: 'a', ruleType: 'per_day', quantityValue: 1 }),
      rule({ id: 'b', ruleType: 'fixed_per_trip', quantityValue: 40 }),
    ]
    expect(computeQuantity(rules, context()).quantity).toBe(40)
    expect(reasonOf(rules)).toBe('At least 40 per trip')
  })

  it('adds the trip fact that let it on, when the number came from elsewhere', () => {
    /*
     * Two facts, and the second earns its place: the arithmetic explains how
     * many, and the condition explains why any at all. One `·` at most — a rule
     * dump would be the opposite of an explanation.
     */
    const rules = [
      rule({ id: 'a', ruleType: 'per_day', quantityValue: 2 }),
      rule({
        id: 'b',
        ruleType: 'conditional_include',
        condition: { fact: 'international', eq: true },
      }),
    ]
    expect(reasonOf(rules)).toBe('10 days × 2 · International trip')
  })

  it('does not repeat the condition when the condition IS the reason', () => {
    const rules = [
      rule({
        id: 'b',
        ruleType: 'conditional_include',
        condition: { fact: 'international', eq: true },
      }),
    ]
    expect(reasonOf(rules)).toBe('International trip')
  })

  it('says the same thing whichever order the rules arrive in', () => {
    const a = rule({ id: 'a', ruleType: 'per_day', quantityValue: 2 })
    const b = rule({ id: 'b', ruleType: 'fixed_per_trip', quantityValue: 3 })
    const c = rule({
      id: 'c',
      ruleType: 'conditional_include',
      condition: { fact: 'international', eq: true },
    })

    const forwards = reasonOf([a, b, c])
    const backwards = reasonOf([c, b, a])
    expect(backwards).toBe(forwards)
  })
})

describe('rules Alex wrote himself', () => {
  it('uses his own words in preference to anything derived from them', () => {
    // Level 3. A person writing a rule writes a reason; deriving "At least 2
    // per trip" from it would be the product paraphrasing him back at himself.
    expect(
      reasonOf([
        rule({
          ruleType: 'fixed_per_trip',
          quantityValue: 2,
          source: 'user',
          originalText: 'I always lose one of these',
        }),
      ]),
    ).toBe('I always lose one of these')
  })

  it('still shows the arithmetic when arithmetic decided the number', () => {
    // Level 1 outranks level 3, because the number on the row is the thing
    // most in need of accounting for.
    expect(
      reasonOf([
        rule({
          ruleType: 'per_day',
          quantityValue: 2,
          source: 'user',
          originalText: 'two a day',
        }),
      ]),
    ).toBe('10 days × 2')
  })

  it('explains an override with the overriding rule, not the default it replaced', () => {
    const original = rule({ id: 'sys', ruleType: 'fixed_per_trip', quantityValue: 4 })
    const override = rule({
      id: 'mine',
      ruleType: 'fixed_per_trip',
      quantityValue: 2,
      source: 'user',
      originalText: 'Two is plenty',
      supersedesRuleId: 'sys',
    })
    const result = computeQuantity([original, override], context())
    expect(result.quantity).toBe(2)
    expect(result.reason).toBe('Two is plenty')
  })
})

describe('a quantity Alex set himself', () => {
  it('states the rule as a rate rather than deriving a number he did not choose', () => {
    /*
     * The explanation has to agree with the figure beside it. `9 nights × 2`
     * next to a 7 invites the multiplication and leaves him wondering which
     * number is wrong; `2 per night` describes the rule without asserting a
     * total, which is the honest thing to say about a quantity he overrode.
     */
    const rules = [rule({ ruleType: 'per_night', quantityValue: 2 })]
    const explained = computeQuantity(rules, context(), { quantityIsUsers: true })
    expect(explained.reason).toBe('2 per night')
    // The quantity itself is untouched — this flag changes words, never numbers.
    expect(explained.quantity).toBe(18)
  })

  it('does not fall back to a rule text that hides a formula either', () => {
    // The real catalog stores Contacts as `Quantity Rule: Nights × 2`, which
    // would sail past a check that only looked at the calculated label.
    const rules = [
      rule({ ruleType: 'per_night', quantityValue: 2, originalText: 'Quantity Rule: Nights × 2' }),
    ]
    expect(computeQuantity(rules, context(), { quantityIsUsers: true }).reason).not.toMatch(/×/)
  })

  it('still says why the item is on the trip at all', () => {
    const rules = [
      rule({ id: 'a', ruleType: 'per_night', quantityValue: 2 }),
      rule({
        id: 'b',
        ruleType: 'conditional_include',
        condition: { fact: 'international', eq: true },
      }),
    ]
    expect(computeQuantity(rules, context(), { quantityIsUsers: true }).reason).toBe(
      '2 per night · International trip',
    )
  })
})

describe('a rule’s stored words are used only when they explain something', () => {
  it('declines the seeded catalog’s priority shorthand', () => {
    // The real values in the workbook's `Default Priority / Quantity Rule`
    // column. "Usually" is the tier that produced the rule, not a reason.
    for (const text of ['Always', 'Usually', 'Critical (Always)', 'Almost always', 'Frequently']) {
      expect(usableRuleText(text), text).toBeNull()
    }
  })

  it('declines anything that would leak the implementation', () => {
    for (const text of [
      'rule_type: fixed_per_trip',
      '{"fact":"international","eq":true}',
      'item_id 4f2a9c11-1234-4bcd-9999-000000000000',
      '9f8e7d6c5b4a3210',
    ]) {
      expect(usableRuleText(text), text).toBeNull()
    }
  })

  it('strips importer vocabulary from something otherwise real', () => {
    expect(usableRuleText('Explicit Item: Packed if Apple Watch is brought')).toBe(
      'Packed if Apple Watch is brought',
    )
    expect(usableRuleText('Critical. One per trip.')).toBe('One per trip')
  })

  it('accepts a sentence a person would write', () => {
    expect(usableRuleText('  one   for each  bag ')).toBe('One for each bag')
  })
})

describe('conditions, in the register of a row', () => {
  it('reads as a whole answer rather than as a fragment', () => {
    expect(describeTrigger({ fact: 'international', eq: true })).toBe('International trip')
    expect(describeTrigger({ fact: 'flight_hours', gte: 5 })).toBe('Any flight is at least 5 hours')
    expect(describeTrigger({ fact: 'flight_hours', gt: 5 })).toBe('Flying more than 5 hours')
    expect(describeTrigger({ fact: 'nights', gt: 3 })).toBe('More than 3 nights away')
    expect(describeTrigger({ fact: 'activities', contains: 'swimming' })).toBe(
      'swimming on this trip',
    )
  })

  it('joins a compound condition without inventing a new fact', () => {
    expect(
      describeTrigger({
        all: [{ fact: 'international', eq: true }, { fact: 'flight_hours', gte: 5 }],
      }),
    ).toBe('International trip and Any flight is at least 5 hours')
  })

  it('falls back rather than going blank on a shape it has no phrasing for', () => {
    expect(describeTrigger({ fact: 'has_pool', eq: 'maybe' })).toBeTruthy()
  })
})

describe('rows no packing rule created', () => {
  it('says Alex added it, because that is what the database records', () => {
    expect(
      explainEntrySource({ source: 'user_added', tripOnly: true, reason: null }),
    ).toBe('You added this for this trip')
  })

  it('credits an outfit where the row came from one', () => {
    expect(
      explainEntrySource({ source: 'outfit_generated', tripOnly: false, reason: null }),
    ).toBe('Needed by one of your outfits')
  })

  it('prefers a stored reason over anything inferred from the source', () => {
    expect(
      explainEntrySource({ source: 'user_added', tripOnly: true, reason: 'International trip' }),
    ).toBe('International trip')
  })

  it('says nothing at all rather than inventing a system reason', () => {
    /*
     * The line the brief draws, and it matters more than it looks: claiming
     * the app decided something Alex decided is a small lie that makes every
     * other explanation less trustworthy.
     */
    expect(
      explainEntrySource({ source: 'always_packed', tripOnly: false, reason: null }),
    ).toBeNull()
  })
})

describe('nothing internal ever reaches a row', () => {
  it('holds for every phrase these rules can produce', () => {
    const everyKind: PackingRule[][] = [
      [rule({ ruleType: 'fixed_per_trip', quantityValue: 1 })],
      [rule({ ruleType: 'fixed_per_trip', quantityValue: 5 })],
      [rule({ ruleType: 'per_day', quantityValue: 3 })],
      [rule({ ruleType: 'per_night', quantityValue: 1 })],
      [rule({ ruleType: 'duration_plus_buffer', quantityValue: 1, buffer: 2 })],
      [rule({ ruleType: 'per_activity_occurrence', condition: { fact: 'activities', contains: 'safari' } })],
      [rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: true } })],
      [rule({ ruleType: 'minimum', quantityValue: 4 })],
      [
        rule({ id: 'a', ruleType: 'per_day', quantityValue: 2 }),
        rule({ id: 'b', ruleType: 'maximum', quantityValue: 6 }),
        rule({ id: 'c', ruleType: 'spare', quantityValue: 1 }),
      ],
    ]

    for (const rules of everyKind) {
      const reason = computeQuantity(rules, context()).reason
      expect(reason, JSON.stringify(rules.map((r) => r.ruleType))).toBeTruthy()
      expect(forbidsInternals(reason ?? ''), reason ?? '').toBe(true)
    }
  })

  it('leaves an excluded item with nothing to explain', () => {
    // A blocked gate means the row does not exist, and a reason for a row that
    // is not there would be the engine talking about a decision it reversed.
    const result = computeQuantity(
      [rule({ ruleType: 'conditional_include', condition: { fact: 'international', eq: false } })],
      context(),
    )
    expect(result.quantity).toBeNull()
    expect(result.reason).toBeNull()
  })
})
